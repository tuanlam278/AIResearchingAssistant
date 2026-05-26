# app/routers/auth.py
"""Authentication routes using Supabase Auth."""

from typing import Any, Dict, Optional
from fastapi import APIRouter, HTTPException, Request, status
from app.models.schemas import RegisterRequest, LoginRequest
from app.dependencies import get_current_user
from app.db.supabase_client import supabase

# PREFIX khớp với api_contract.md: /api/auth/*
router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.post("/register")
async def register(payload: RegisterRequest) -> Dict[str, Any]:
    try:
        resp = supabase.auth.sign_up({"email": payload.email, "password": payload.password})
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
    try:
        resp = supabase.auth.sign_in_with_password({"email": payload.email, "password": payload.password})
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"code": "INTERNAL_ERROR", "message": "Authentication service error"},
        )

    error = getattr(resp, "error", None) or (resp.get("error") if isinstance(resp, dict) else None)
    if error:
        message = getattr(error, "message", str(error))
        if any(w in message.lower() for w in ["invalid", "wrong", "credentials", "email not confirmed"]):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail={"code": "INVALID_CREDENTIALS", "message": "Sai email hoặc mật khẩu"},
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
    token = authorization.split(" ", 1)[1].strip()

    try:
        supabase.auth.sign_out()
    except Exception:
        pass  # sign_out idempotent — luôn trả success

    return {"success": True, "data": {"message": "Đăng xuất thành công"}}