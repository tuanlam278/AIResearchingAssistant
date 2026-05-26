#Ver 1
# app/dependencies.py
"""Authentication dependency: verify Supabase JWT and inject current user.

Usage:
    @router.get("/protected")
    async def protected(user = Depends(get_current_user)):
        user_id = user["user_id"]
        email = user["email"]
"""

from typing import Dict, Optional, Any
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

from app.db.supabase_client import supabase

# Use auto_error=False so we can control the error payload
bearer_scheme = HTTPBearer(auto_error=False)


async def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme),
) -> Dict[str, str]:
    """
    Verify JWT from Authorization header using Supabase and return user info.

    Raises:
        HTTPException 401 with contract-style error when token is missing, invalid, or expired.

    Returns:
        dict: {"user_id": "<uuid>", "email": "<email>"}
    """
    # Missing token
    if credentials is None or not credentials.credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"code": "UNAUTHORIZED", "message": "Token không hợp lệ hoặc đã hết hạn"},
        )

    token = credentials.credentials

    try:
        # supabase.auth.get_user may return different shapes depending on client version:
        # - {'data': {'user': {...}}, 'error': None}
        # - {'user': {...}}
        # - object with .user attribute
        resp: Any = supabase.auth.get_user(token)
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"code": "UNAUTHORIZED", "message": "Token không hợp lệ hoặc đã hết hạn"},
        )

# Normalize response to find user object and possible error
    user_obj = None
    error_obj = None

    if isinstance(resp, dict):
        error_obj = resp.get("error")
        data = resp.get("data") or {}
        user_obj = data.get("user") or resp.get("user")
    else:
        # Some clients return an object with attributes
        error_obj = getattr(resp, "error", None)
        user_obj = getattr(resp, "user", None)

    if error_obj or not user_obj:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"code": "UNAUTHORIZED", "message": "Token không hợp lệ hoặc đã hết hạn"},
        )

    # --- ĐOẠN ĐÃ ĐƯỢC SỬA ---
    # Extract canonical fields an toàn cho cả Dictionary và Object
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

    return {"user_id": str(user_id), "email": email}