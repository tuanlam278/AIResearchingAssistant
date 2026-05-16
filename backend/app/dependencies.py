"""
Dependency dùng chung: verify JWT token và lấy user_id.
Inject vào bất kỳ endpoint nào cần auth bằng:

    from app.dependencies import get_current_user

    @router.get("/something")
    async def something(user=Depends(get_current_user)):
        user_id = user["id"]
"""
from fastapi import Depends, HTTPException
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from app.db.supabase_client import supabase

bearer_scheme = HTTPBearer()


async def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme)):
    token = credentials.credentials
    try:
        result = supabase.auth.get_user(token)
        user = result.user
        if not user:
            raise HTTPException(status_code=401, detail={"code": "UNAUTHORIZED", "message": "Token không hợp lệ hoặc đã hết hạn"})
        return {"id": str(user.id), "email": user.email}
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=401, detail={"code": "UNAUTHORIZED", "message": "Token không hợp lệ hoặc đã hết hạn"})
