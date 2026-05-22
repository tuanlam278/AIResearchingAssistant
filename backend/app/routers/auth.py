#Ver 1
# app/routers/auth.py
"""Authentication routes using Supabase Auth."""

from typing import Any, Dict

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi import Request

from app.models.schemas import UserRegister, UserLogin
from app.dependencies import get_current_user, security
from app.db.supabase_client import supabase

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])


@router.post("/register")
async def register(payload: UserRegister) -> Dict[str, Any]:
    """
    Register a new user via Supabase Auth.

    On success returns:
    {
      "success": true,
      "data": { "user_id": "...", "email": "..." }
    }

    Maps common Supabase errors to appropriate HTTP responses.
    """
    try:
        # supabase.auth.sign_up expects a dict with email and password
        resp = supabase.auth.sign_up({"email": payload.email, "password": payload.password})
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"code": "INTERNAL_ERROR", "message": "Failed to register user"},
        )

    # Normalize response shapes
    error = None
    user = None
    if isinstance(resp, dict):
        error = resp.get("error")
        # new client: resp.get("data", {}).get("user")
        data = resp.get("data") or {}
        user = data.get("user") or resp.get("user")
    else:
        # If client returns an object with attributes
        user = getattr(resp, "user", None)
        error = getattr(resp, "error", None)

    if error:
        # Map known error messages to contract codes
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

    user_id = user.get("id") or user.get("user_id")
    email = user.get("email")

    return {"success": True, "data": {"user_id": user_id, "email": email}}


@router.post("/login")
async def login(payload: UserLogin) -> Dict[str, Any]:
    """
    Authenticate user via Supabase and return access token.

    On success returns:
    {
      "success": true,
      "data": {
        "access_token": "...",
        "token_type": "bearer",
        "user": { "user_id": "...", "email": "..." }
      }
    }
    """
    try:
        # Newer supabase client uses sign_in_with_password
        resp = supabase.auth.sign_in_with_password({"email": payload.email, "password": payload.password})
    except Exception:
        # Try older method name for compatibility
        try:
            resp = supabase.auth.sign_in({"email": payload.email, "password": payload.password})
        except Exception:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail={"code": "INTERNAL_ERROR", "message": "Authentication service error"},
            )

    # Normalize response
    error = None
    session = None
    if isinstance(resp, dict):
        error = resp.get("error")
        data = resp.get("data") or {}
        # session may be in data.get("session") or resp.get("session")
        session = data.get("session") or resp.get("session") or data
    else:
        session = getattr(resp, "session", None)
        error = getattr(resp, "error", None)

    if error:
        message = getattr(error, "message", str(error))
        # Map invalid credentials
        if "invalid" in message.lower() or "wrong" in message.lower() or "credentials" in message.lower():
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail={"code": "INVALID_CREDENTIALS", "message": "Sai email hoặc mật khẩu"},
            )
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"code": "INTERNAL_ERROR", "message": message},
        )

    # Extract access token and user
    access_token = None
    user = None
    if isinstance(session, dict):
        access_token = session.get("access_token") or session.get("accessToken") or session.get("token")
        user = session.get("user") or session.get("user_metadata") or session.get("data")
    else:
        access_token = getattr(session, "access_token", None)
        user = getattr(session, "user", None)

    if not access_token:
        # Some clients return top-level 'access_token'
        access_token = resp.get("access_token") if isinstance(resp, dict) else None

    if not access_token or not user:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"code": "INTERNAL_ERROR", "message": "Failed to obtain access token"},
        )

    user_id = user.get("id") or user.get("user_id")
    email = user.get("email")

    return {
        "success": True,
        "data": {
            "access_token": access_token,
            "token_type": "bearer",
            "user": {"user_id": user_id, "email": email},
        },
    }


@router.post("/logout")
async def logout(request: Request, credentials: Depends(security)) -> Dict[str, Any]:
    """
    Logout the current user by revoking the Supabase session token.

    This endpoint requires the Authorization header with Bearer token.
    """
    # Extract token from Authorization header using HTTPBearer
    auth: Optional[Dict] = None
    # FastAPI's Depends can't be used directly here to get credentials; extract manually
    authorization: str = request.headers.get("authorization") or request.headers.get("Authorization") or ""
    if not authorization.lower().startswith("bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"code": "UNAUTHORIZED", "message": "Missing authorization token"},
        )
    token = authorization.split(" ", 1)[1].strip()
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"code": "UNAUTHORIZED", "message": "Missing authorization token"},
        )

    try:
        # Attempt to sign out / revoke session on Supabase
        # Different supabase clients expose different methods; try common ones.
        resp = None
        try:
            resp = supabase.auth.sign_out(token)
        except Exception:
            # fallback to api.sign_out if available
            try:
                resp = supabase.auth.api.sign_out(token)
            except Exception:
                resp = None
    except Exception:
        resp = None

    # If supabase returned an error shape, handle it
    if isinstance(resp, dict):
        error = resp.get("error")
        if error:
            # If token already invalid/expired, treat as success (idempotent)
            return {"success": True, "data": {"message": "Đăng xuất thành công"}}

    # In many setups sign_out returns None or empty on success
    return {"success": True, "data": {"message": "Đăng xuất thành công"}}
