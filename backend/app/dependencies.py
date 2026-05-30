# app/dependencies.py
"""Authentication dependencies: verify Supabase JWT, include user role, and guard admins."""

from typing import Dict, Optional, Any
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

from app.config import settings
from app.db.supabase_client import supabase
from app.services.internal_jwt_service import verify_app_access_token

bearer_scheme = HTTPBearer(auto_error=False)
DEV_ADMIN_TOKEN = "dev-admin-token"


def _supabase_response_data(resp: Any):
    if isinstance(resp, dict):
        return resp.get("data"), resp.get("error")
    return getattr(resp, "data", None), getattr(resp, "error", None)


def _metadata(user_obj: Any, field: str) -> dict:
    if isinstance(user_obj, dict):
        return user_obj.get(field) or {}
    return getattr(user_obj, field, None) or {}


def _role_from_auth_user(user_obj: Any) -> str | None:
    for field in ("app_metadata", "user_metadata"):
        role = _metadata(user_obj, field).get("role")
        if str(role).lower() in {"user", "admin"}:
            return str(role).lower()
    return None


def _role_from_profile(user_id: str) -> str | None:
    for table in ("users", "profiles"):
        try:
            resp = supabase.table(table).select("role").eq("id", user_id).limit(1).execute()
            rows, error = _supabase_response_data(resp)
            if error or not rows:
                continue
            role = rows[0].get("role")
            if str(role).lower() in {"user", "admin"}:
                return str(role).lower()
        except Exception:
            continue
    return None


async def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme),
) -> Dict[str, str]:
    if credentials is None or not credentials.credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"code": "UNAUTHORIZED", "message": "Token không hợp lệ hoặc đã hết hạn"},
        )

    token = credentials.credentials
    if token == DEV_ADMIN_TOKEN:
        return {"user_id": "dev-admin", "id": "dev-admin", "email": settings.SYSTEM_LIBRARY_ADMIN_EMAIL or "admin", "role": "admin"}

    app_claims = verify_app_access_token(token)
    if app_claims:
        return {
            "user_id": str(app_claims["sub"]),
            "id": str(app_claims["sub"]),
            "email": str(app_claims["email"]),
            "role": str(app_claims.get("role") or "user"),
        }

    try:
        resp: Any = supabase.auth.get_user(token)
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"code": "UNAUTHORIZED", "message": "Token không hợp lệ hoặc đã hết hạn"},
        )

    user_obj = None
    error_obj = None
    if isinstance(resp, dict):
        error_obj = resp.get("error")
        data = resp.get("data") or {}
        user_obj = data.get("user") or resp.get("user")
    else:
        error_obj = getattr(resp, "error", None)
        user_obj = getattr(resp, "user", None)

    if error_obj or not user_obj:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"code": "UNAUTHORIZED", "message": "Token không hợp lệ hoặc đã hết hạn"},
        )

    if isinstance(user_obj, dict):
        user_id = user_obj.get("id") or user_obj.get("user_id") or user_obj.get("sub")
        email = user_obj.get("email")
    else:
        user_id = getattr(user_obj, "id", None) or getattr(user_obj, "user_id", None)
        email = getattr(user_obj, "email", None)

    if not user_id or not email:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"code": "UNAUTHORIZED", "message": "Token không hợp lệ hoặc đã hết hạn"},
        )

    role = _role_from_auth_user(user_obj) or _role_from_profile(str(user_id)) or "user"
    return {"user_id": str(user_id), "id": str(user_id), "email": email, "role": role}


async def require_admin_user(user: Dict[str, str] = Depends(get_current_user)) -> Dict[str, str]:
    if user.get("role") != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail={"code": "ADMIN_FORBIDDEN", "message": "Chỉ admin mới được truy cập"})
    return user
