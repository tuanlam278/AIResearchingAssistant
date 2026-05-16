"""
BE1 implement: Auth endpoints
Dùng Supabase Auth — không tự hash password, không tự quản lý session.
"""
from fastapi import APIRouter, HTTPException
from app.models.schemas import RegisterRequest, LoginRequest
from app.db.supabase_client import supabase

router = APIRouter()


@router.post("/register")
async def register(body: RegisterRequest):
    try:
        result = supabase.auth.sign_up({
            "email": body.email,
            "password": body.password,
        })
        user = result.user
        if not user:
            raise HTTPException(status_code=409, detail={"code": "EMAIL_TAKEN", "message": "Email đã được đăng ký"})

        return {
            "success": True,
            "data": {"user_id": str(user.id), "email": user.email}
        }
    except Exception as e:
        msg = str(e)
        if "already registered" in msg.lower():
            raise HTTPException(status_code=409, detail={"code": "EMAIL_TAKEN", "message": "Email đã được đăng ký"})
        raise HTTPException(status_code=500, detail={"code": "INTERNAL_ERROR", "message": msg})


@router.post("/login")
async def login(body: LoginRequest):
    try:
        result = supabase.auth.sign_in_with_password({
            "email": body.email,
            "password": body.password,
        })
        session = result.session
        user = result.user

        if not session:
            raise HTTPException(status_code=401, detail={"code": "INVALID_CREDENTIALS", "message": "Sai email hoặc mật khẩu"})

        return {
            "success": True,
            "data": {
                "access_token": session.access_token,
                "token_type": "bearer",
                "user": {"user_id": str(user.id), "email": user.email},
            }
        }
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=401, detail={"code": "INVALID_CREDENTIALS", "message": "Sai email hoặc mật khẩu"})


@router.post("/logout")
async def logout():
    supabase.auth.sign_out()
    return {"success": True, "data": {"message": "Đăng xuất thành công"}}
