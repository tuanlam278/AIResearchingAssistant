# app/routers/auth.py
"""Authentication routes using Supabase Auth."""

from typing import Any, Dict
from fastapi import APIRouter, HTTPException, Request, status
from supabase import create_client, Client
from app.models.schemas import RegisterRequest, LoginRequest
from app.dependencies import get_current_user
from app.db.supabase_client import supabase
from app.config import settings

# PREFIX khớp với api_contract.md: /api/auth/*
router = APIRouter(prefix="/api/auth", tags=["auth"])


def _anon_client() -> Client:
    """Tạo client mới dùng anon key cho mỗi request auth.
    Tránh lỗi session bị lưu trong singleton supabase client.
    """
    return create_client(settings.SUPABASE_URL, settings.SUPABASE_ANON_KEY)


@router.post("/register")
async def register(payload: RegisterRequest) -> Dict[str, Any]:
    client = _anon_client()
    try:
        resp = client.auth.sign_up({"email": payload.email, "password": payload.password})
    except Exception as e:
        print(f"LỖI ĐĂNG KÝ: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"code": "INTERNAL_ERROR", "message": "Failed to register user"},
        )

    error = getattr(resp, "error", None) or (resp.get("error") if isinstance(resp, dict) else None)
    user = getattr(resp, "user", None) or (resp.get("data", {}) or {}).get("user")

    if error:
        message = getattr(error, "message", str(error))
        if "already registered" in message.lower() or "duplicate" in message.lower():
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={"code": "EMAIL_TAKEN", "message": "Email đã được đăng ký"},
            )
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"code": "INTERNAL_ERROR", "message": message},
        )

    if not user:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"code": "INTERNAL_ERROR", "message": "Unexpected response from auth provider"},
        )

    user_id = getattr(user, "id", None) or (user.get("id") if isinstance(user, dict) else None)
    email = getattr(user, "email", None) or (user.get("email") if isinstance(user, dict) else None)
    return {"success": True, "data": {"user_id": user_id, "email": email}}


@router.post("/login")
async def login(payload: LoginRequest) -> Dict[str, Any]:
    client = _anon_client()
    try:
        resp = client.auth.sign_in_with_password({"email": payload.email, "password": payload.password})
    except Exception as e:
        print(f"LỖI ĐĂNG NHẬP: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"code": "INTERNAL_ERROR", "message": "Authentication service error"},
        )

    error = getattr(resp, "error", None) or (resp.get("error") if isinstance(resp, dict) else None)
    if error:
        message = getattr(error, "message", str(error))
        if "email not confirmed" in message.lower():
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail={"code": "EMAIL_NOT_CONFIRMED", "message": "Email chưa được xác nhận. Vui lòng kiểm tra hộp thư."},
            )
        if any(w in message.lower() for w in ["invalid", "wrong", "credentials"]):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail={"code": "INVALID_CREDENTIALS", "message": "Sai email hoặc mật khẩu. Vui lòng thử lại!"},
            )
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"code": "INTERNAL_ERROR", "message": message},
        )

    session = getattr(resp, "session", None)
    user = getattr(resp, "user", None)
    if not session or not user:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"code": "INTERNAL_ERROR", "message": "Failed to obtain access token"},
        )

    access_token = getattr(session, "access_token", None)
    user_id = getattr(user, "id", None)
    email = getattr(user, "email", None)

    return {
        "success": True,
        "data": {
            "access_token": access_token,
            "token_type": "bearer",
            "user": {"user_id": user_id, "email": email},
        },
    }


@router.post("/logout")
async def logout(request: Request) -> Dict[str, Any]:
    authorization = request.headers.get("Authorization", "")
    if not authorization.lower().startswith("bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"code": "UNAUTHORIZED", "message": "Missing authorization token"},
        )

    try:
        supabase.auth.sign_out()
    except Exception:
        pass  # sign_out idempotent — luôn trả success

    return {"success": True, "data": {"message": "Đăng xuất thành công"}}