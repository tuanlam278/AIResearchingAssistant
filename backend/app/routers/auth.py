# app/routers/auth.py
"""Authentication routes using Supabase Auth."""

from typing import Any, Dict

import secrets
from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, EmailStr
from supabase import Client, create_client

from app.config import settings
from app.db.supabase_client import supabase
from app.dependencies import (
    DEV_ADMIN_TOKEN,
    _role_from_auth_user,
    _role_from_profile,
    get_current_user,
)
from app.models.schemas import LoginRequest, RegisterRequest
from app.services.google_auth_service import verify_google_credential
from app.services.internal_jwt_service import create_app_access_token
from app.services.password_reset_service import (
    GENERIC_RESET_REQUEST_MESSAGE,
    OTP_INVALID_MESSAGE,
    OTP_VALID_MESSAGE,
    PASSWORD_UPDATED_MESSAGE,
    SMTP_NOT_CONFIGURED_MESSAGE,
    create_password_reset_otp,
    is_dev_auth_bypass_enabled,
    mark_otp_used,
    send_or_allow_dev_otp,
    verified_password_reset_otp_id,
    verify_password_reset_otp,
)


router = APIRouter(prefix="/api/auth", tags=["auth"])


class GoogleAuthRequest(BaseModel):
    credential: str


class PasswordResetRequest(BaseModel):
    email: EmailStr


class PasswordResetVerifyRequest(BaseModel):
    email: EmailStr
    otp: str


class PasswordResetConfirmRequest(BaseModel):
    email: EmailStr
    otp: str
    new_password: str


def _supabase_response_data(resp: Any):
    if isinstance(resp, dict):
        return resp.get("data"), resp.get("error")
    return getattr(resp, "data", None), getattr(resp, "error", None)


def _anon_client() -> Client:
    """Tạo client mới dùng anon key cho mỗi request auth.
    Tránh lỗi session bị lưu trong singleton supabase client.
    """
    return create_client(settings.SUPABASE_URL, settings.SUPABASE_ANON_KEY)


def _auth_user_field(user_obj: Any, field: str) -> Any:
    if isinstance(user_obj, dict):
        return user_obj.get(field)
    return getattr(user_obj, field, None)


def _auth_users_from_response(resp: Any) -> list[Any]:
    if isinstance(resp, dict):
        return resp.get("users") or (resp.get("data") or {}).get("users") or []

    users = getattr(resp, "users", None)
    if users is not None:
        return users

    data = getattr(resp, "data", None)
    if isinstance(data, list):
        return data

    if isinstance(data, dict):
        return data.get("users") or []

    return []


def _extract_auth_user_from_response(resp: Any) -> Any | None:
    """Supabase-py có thể trả AuthResponse object hoặc dict tùy version.
    Hàm này gom các dạng response phổ biến để lấy user an toàn.
    """
    if resp is None:
        return None

    user = getattr(resp, "user", None)
    if user is not None:
        return user

    data = getattr(resp, "data", None)
    if data is not None:
        data_user = getattr(data, "user", None)
        if data_user is not None:
            return data_user

        if isinstance(data, dict):
            return data.get("user") or data

    if isinstance(resp, dict):
        user = resp.get("user")
        if user is not None:
            return user

        data = resp.get("data")
        if isinstance(data, dict):
            return data.get("user") or data

    return None


def _extract_auth_user_id(resp: Any) -> str | None:
    user = _extract_auth_user_from_response(resp)
    user_id = _auth_user_field(user, "id")

    if not user_id:
        return None

    return str(user_id)


def _extract_auth_user_email(resp: Any) -> str | None:
    user = _extract_auth_user_from_response(resp)
    email = _auth_user_field(user, "email")

    if not email:
        return None

    return str(email)


def _user_payload(
    user_id: str,
    email: str,
    role: str = "user",
    profile: Dict[str, Any] | None = None,
) -> Dict[str, Any]:
    profile = profile or {}
    display = (
        profile.get("display_name")
        or profile.get("full_name")
        or (email.split("@")[0] if "@" in email else email)
    )

    return {
        "id": user_id,
        "user_id": user_id,
        "name": display,
        "email": email,
        "avatar_url": profile.get("avatar_url"),
        "role": role,
        "canUploadLibraryDocuments": profile.get("can_upload_library_documents", profile.get("can_publish_documents", True)),
        "can_upload_library_documents": profile.get("can_upload_library_documents", profile.get("can_publish_documents", True)),
        "canPublishDocuments": profile.get("can_publish_documents", profile.get("can_upload_library_documents", True)),
        "can_publish_documents": profile.get("can_publish_documents", profile.get("can_upload_library_documents", True)),
        "publishBlockedReason": profile.get("publish_blocked_reason"),
        "publishBlockedAt": profile.get("publish_blocked_at"),
    }


def _profile_for_user(user_id: str) -> Dict[str, Any]:
    try:
        resp = (
            supabase.table("profiles")
            .select("*")
            .eq("id", user_id)
            .limit(1)
            .execute()
        )
        rows, error = _supabase_response_data(resp)

        if not error and rows:
            return rows[0]
    except Exception as exc:
        print(f"PROFILE LOOKUP FAILED: {exc}")

    return {}


def _profile_by_google_id(google_id: str) -> Dict[str, Any]:
    try:
        resp = (
            supabase.table("profiles")
            .select("*")
            .eq("google_id", google_id)
            .limit(1)
            .execute()
        )
        rows, error = _supabase_response_data(resp)

        if not error and rows:
            return rows[0]
    except Exception as exc:
        print(f"PROFILE GOOGLE LOOKUP FAILED: {exc}")

    return {}


def _profile_by_email(email: str) -> Dict[str, Any]:
    try:
        resp = (
            supabase.table("profiles")
            .select("*")
            .ilike("email", email)
            .limit(1)
            .execute()
        )
        rows, error = _supabase_response_data(resp)

        if not error and rows:
            return rows[0]
    except Exception as exc:
        print(f"PROFILE EMAIL LOOKUP FAILED: {exc}")

    return {}


def _auth_user_by_email(email: str) -> Any | None:
    try:
        resp = supabase.auth.admin.list_users()

        for auth_user in _auth_users_from_response(resp):
            auth_email = str(_auth_user_field(auth_user, "email") or "")

            if auth_email.lower() == email.lower():
                return auth_user
    except Exception as exc:
        print(f"GOOGLE AUTH USER LOOKUP FAILED: {exc}")

    return None


def _ensure_profile(
    user_id: str,
    email: str,
    values: Dict[str, Any] | None = None,
) -> Dict[str, Any]:
    payload = {
        "id": user_id,
        "email": email,
        **(values or {}),
    }

    try:
        resp = supabase.table("profiles").upsert(payload, on_conflict="id").execute()
        rows, error = _supabase_response_data(resp)

        if not error and rows:
            return rows[0]

        if error:
            print(f"PROFILE UPSERT ERROR: {error}")
    except Exception as exc:
        print(f"PROFILE UPSERT FAILED: {exc}")

        # Fallback cho database chưa có google_email/google_avatar_url.
        fallback_payload = dict(payload)
        fallback_payload.pop("google_email", None)
        fallback_payload.pop("google_avatar_url", None)
        fallback_payload.pop("default_password_must_change", None)

        if fallback_payload != payload:
            try:
                resp = (
                    supabase.table("profiles")
                    .upsert(fallback_payload, on_conflict="id")
                    .execute()
                )
                rows, error = _supabase_response_data(resp)

                if not error and rows:
                    return rows[0]

                if error:
                    print(f"PROFILE FALLBACK UPSERT ERROR: {error}")
            except Exception as retry_exc:
                print(f"PROFILE FALLBACK UPSERT FAILED: {retry_exc}")

    return _profile_for_user(user_id)



def _normalize_display_name(value: str | None) -> str | None:
    normalized = str(value or "").strip()
    return normalized or None


def _display_name_exists(display_name: str, exclude_user_id: str | None = None) -> bool:
    try:
        q = supabase.table("profiles").select("id").ilike("display_name", display_name).limit(1)
        if exclude_user_id:
            q = q.neq("id", exclude_user_id)
        rows, error = _supabase_response_data(q.execute())
        return bool(not error and rows)
    except Exception as exc:
        print(f"DISPLAY NAME UNIQUE CHECK FAILED: {exc}")
        return False


def _raise_display_name_taken() -> None:
    raise HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail={
            "code": "USERNAME_TAKEN",
            "message": "Tên đăng nhập đã tồn tại, vui lòng chọn một tên khác.",
        },
    )


def _is_profile_disabled(profile: Dict[str, Any] | None) -> bool:
    profile = profile or {}
    return (
        profile.get("is_active") is False
        or bool(profile.get("deleted_at"))
        or str(profile.get("status") or "active").lower() not in {"active", ""}
    )

def _is_dev_admin_login(email: str, password: str) -> bool:
    expected_email = settings.SYSTEM_LIBRARY_ADMIN_EMAIL or "admin"
    expected_password = settings.SYSTEM_LIBRARY_ADMIN_PASSWORD or "admin"

    return email.strip() == expected_email and password == expected_password


def _password_for_new_google_user() -> str:
    if is_dev_auth_bypass_enabled():
        return "123456"
    return secrets.token_urlsafe(32)


def _confirm_password_user_email(email: str) -> bool:
    try:
        resp = supabase.auth.admin.list_users()

        for auth_user in _auth_users_from_response(resp):
            auth_email = str(_auth_user_field(auth_user, "email") or "")

            if auth_email.lower() != email.lower():
                continue

            user_id = _auth_user_field(auth_user, "id")
            if not user_id:
                return False

            supabase.auth.admin.update_user_by_id(
                str(user_id),
                {"email_confirm": True},
            )
            return True
    except Exception as exc:
        print(f"AUTO EMAIL CONFIRM FAILED: {exc}")

    return False


@router.post("/register")
async def register(payload: RegisterRequest) -> Dict[str, Any]:
    display_name = _normalize_display_name(payload.name)
    if display_name and _display_name_exists(display_name):
        _raise_display_name_taken()

    if payload.confirm_password is not None and payload.password != payload.confirm_password:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "code": "PASSWORD_CONFIRM_MISMATCH",
                "message": "Mật khẩu nhập lại không khớp.",
            },
        )

    try:
        resp = supabase.auth.admin.create_user(
            {
                "email": payload.email,
                "password": payload.password,
                "email_confirm": True,
                "user_metadata": {
                    "auth_provider": "password",
                    "name": display_name,
                    "full_name": display_name,
                },
            }
        )
    except Exception as exc:
        message = str(exc)
        print(f"LỖI ĐĂNG KÝ: {exc}")

        if any(word in message.lower() for word in ["already", "duplicate", "registered"]):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={
                    "code": "EMAIL_TAKEN",
                    "message": "Email đã được đăng ký",
                },
            ) from exc

        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={
                "code": "INTERNAL_ERROR",
                "message": "Failed to register user",
            },
        ) from exc

    error = getattr(resp, "error", None) or (
        resp.get("error") if isinstance(resp, dict) else None
    )

    if error:
        message = getattr(error, "message", str(error))

        if any(word in message.lower() for word in ["already registered", "duplicate"]):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={
                    "code": "EMAIL_TAKEN",
                    "message": "Email đã được đăng ký",
                },
            )

        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "code": "INTERNAL_ERROR",
                "message": message,
            },
        )

    user_id = _extract_auth_user_id(resp)
    email = _extract_auth_user_email(resp)

    if not user_id or not email:
        print("REGISTER AUTH RESPONSE:", resp)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={
                "code": "INTERNAL_ERROR",
                "message": "Unexpected response from auth provider",
            },
        )

    _ensure_profile(
        user_id,
        email,
        {
            "password_login_enabled": True,
            "auth_provider": "password",
            "full_name": display_name,
            "display_name": display_name,
        },
    )

    return {
        "success": True,
        "data": {
            "user_id": user_id,
            "email": email,
        },
    }


@router.post("/login")
async def login(payload: LoginRequest) -> Dict[str, Any]:
    if _is_dev_admin_login(payload.email, payload.password):
        return {
            "success": True,
            "data": {
                "access_token": DEV_ADMIN_TOKEN,
                "token_type": "bearer",
                "user": _user_payload(
                    "dev-admin",
                    settings.SYSTEM_LIBRARY_ADMIN_EMAIL or "admin",
                    "admin",
                ),
            },
        }

    client = _anon_client()

    try:
        resp = client.auth.sign_in_with_password(
            {
                "email": payload.email,
                "password": payload.password,
            }
        )
    except Exception as exc:
        message = str(exc)
        print(f"LỖI ĐĂNG NHẬP: {exc}")
        if any(word in message.lower() for word in ["invalid", "wrong", "credentials", "email not confirmed"]):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail={
                    "code": "INVALID_CREDENTIALS",
                    "message": "Sai email hoặc mật khẩu. Vui lòng thử lại!",
                },
            ) from exc
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "code": "AUTH_SERVICE_ERROR",
                "message": "Không thể đăng nhập. Vui lòng thử lại sau.",
            },
        ) from exc

    error = getattr(resp, "error", None) or (
        resp.get("error") if isinstance(resp, dict) else None
    )

    if error:
        message = getattr(error, "message", str(error))

        if "email not confirmed" in message.lower() and _confirm_password_user_email(
            payload.email
        ):
            try:
                resp = client.auth.sign_in_with_password(
                    {
                        "email": payload.email,
                        "password": payload.password,
                    }
                )
                error = getattr(resp, "error", None) or (
                    resp.get("error") if isinstance(resp, dict) else None
                )
                message = getattr(error, "message", str(error)) if error else ""
            except Exception as exc:
                print(f"LỖI ĐĂNG NHẬP SAU XÁC NHẬN EMAIL TỰ ĐỘNG: {exc}")
                raise HTTPException(
                    status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                    detail={
                        "code": "INTERNAL_ERROR",
                        "message": "Authentication service error",
                    },
                ) from exc

        if error:
            if "email not confirmed" in message.lower():
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail={
                        "code": "EMAIL_NOT_CONFIRMED",
                        "message": "Email chưa được xác nhận trên hệ thống xác thực. Tài khoản đăng ký mới bằng mật khẩu sẽ được xác nhận tự động; vui lòng đăng ký lại hoặc liên hệ quản trị viên nếu đây là tài khoản cũ.",
                    },
                )

            if any(word in message.lower() for word in ["invalid", "wrong", "credentials"]):
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail={
                        "code": "INVALID_CREDENTIALS",
                        "message": "Sai email hoặc mật khẩu. Vui lòng thử lại!",
                    },
                )

            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={
                    "code": "INTERNAL_ERROR",
                    "message": message,
                },
            )

    session = getattr(resp, "session", None)
    user = getattr(resp, "user", None)

    if not session or not user:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={
                "code": "INTERNAL_ERROR",
                "message": "Failed to obtain access token",
            },
        )

    access_token = getattr(session, "access_token", None)
    user_id = getattr(user, "id", None)
    email = getattr(user, "email", None)

    if not access_token or not user_id or not email:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={
                "code": "INTERNAL_ERROR",
                "message": "Invalid login response from auth provider",
            },
        )

    role = _role_from_auth_user(user) or _role_from_profile(str(user_id)) or "user"

    profile = _ensure_profile(
        str(user_id),
        str(email),
        {
            "password_login_enabled": True,
        },
    )

    if _is_profile_disabled(profile):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "code": "ACCOUNT_DISABLED",
                "message": "Tài khoản của bạn đã bị vô hiệu hóa hoặc không tồn tại.",
            },
        )

    return {
        "success": True,
        "data": {
            "access_token": access_token,
            "token_type": "bearer",
            "user": _user_payload(str(user_id), str(email), role, profile),
        },
    }


@router.get("/me")
async def me(user: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
    profile = _profile_for_user(user["user_id"])

    return {
        "success": True,
        "data": {
            "user": _user_payload(
                user["user_id"],
                user["email"],
                user.get("role", "user"),
                profile,
            )
        },
    }


@router.post("/logout")
async def logout(request: Request) -> Dict[str, Any]:
    authorization = request.headers.get("Authorization", "")

    if not authorization.lower().startswith("bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={
                "code": "UNAUTHORIZED",
                "message": "Missing authorization token",
            },
        )

    try:
        supabase.auth.sign_out()
    except Exception:
        pass

    return {
        "success": True,
        "data": {
            "message": "Đăng xuất thành công",
        },
    }


@router.post("/google")
async def google_login(payload: GoogleAuthRequest) -> Dict[str, Any]:
    claims = verify_google_credential(payload.credential)

    email = str(claims["email"])
    google_id = str(claims["sub"])
    google_name = claims.get("name")
    google_given_name = claims.get("given_name")
    google_picture = claims.get("picture")

    if not settings.JWT_SECRET_KEY:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={
                "code": "GOOGLE_APP_JWT_NOT_CONFIGURED",
                "message": "Google Login cần cấu hình JWT_SECRET_KEY để phát phiên đăng nhập nội bộ.",
            },
        )

    profile = _profile_by_google_id(google_id)

    if profile:
        user_id = str(profile["id"])
        role = str(profile.get("role") or _role_from_profile(user_id) or "user")

        if profile.get("is_active") is False:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail={
                    "code": "ACCOUNT_DISABLED",
                    "message": "Tài khoản của bạn đã bị vô hiệu hóa hoặc không tồn tại.",
                },
            )

        access_token = create_app_access_token(user_id=user_id, email=email, role=role)

        return {
            "success": True,
            "data": {
                "access_token": access_token,
                "token_type": "bearer",
                "user": _user_payload(user_id, email, role, profile),
            },
        }

    profile = _profile_by_email(email)
    auth_user = None

    if profile:
        existing_google_id = profile.get("google_id")

        if existing_google_id and existing_google_id != google_id:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={
                    "code": "GOOGLE_ACCOUNT_CONFLICT",
                    "message": "Email này đang được liên kết với một tài khoản Google khác.",
                },
            )

        user_id = str(profile["id"])
    else:
        auth_user = _auth_user_by_email(email)

        if auth_user:
            auth_user_id = _auth_user_field(auth_user, "id")

            if not auth_user_id:
                raise HTTPException(
                    status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                    detail={
                        "code": "GOOGLE_USER_LOOKUP_FAILED",
                        "message": "Không thể lấy thông tin tài khoản Google.",
                    },
                )

            user_id = str(auth_user_id)
        else:
            try:
                created = supabase.auth.admin.create_user(
                    {
                        "email": email,
                        "password": _password_for_new_google_user(),
                        "email_confirm": True,
                        "user_metadata": {
                            "auth_provider": "google",
                            "google_id": google_id,
                            "full_name": google_name,
                            "name": google_name,
                            "avatar_url": google_picture,
                            "picture": google_picture,
                            "sub": google_id,
                        },
                        "app_metadata": {
                            "provider": "google",
                        },
                    }
                )

                user_id = _extract_auth_user_id(created)

                if not user_id:
                    print("SUPABASE CREATE USER RESPONSE:", created)
                    print("SUPABASE CREATE USER RESPONSE TYPE:", type(created))
                    print("SUPABASE CREATE USER .user:", getattr(created, "user", None))
                    print("SUPABASE CREATE USER .data:", getattr(created, "data", None))
                    raise RuntimeError("Supabase did not return a user id")
            except Exception as exc:
                print(f"GOOGLE USER CREATE FAILED: {exc}")
                raise HTTPException(
                    status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                    detail={
                        "code": "GOOGLE_USER_CREATE_FAILED",
                        "message": "Không thể tạo tài khoản Google.",
                    },
                ) from exc

    profile = _ensure_profile(
        user_id,
        email,
        {
            "full_name": google_name,
            "display_name": google_given_name or google_name,
            "avatar_url": google_picture,
            "google_id": google_id,
            "google_email": email,
            "google_avatar_url": google_picture,
            "auth_provider": "google",
            "is_active": True,
            "password_login_enabled": bool(
                profile.get("password_login_enabled", False)
            )
            if profile
            else is_dev_auth_bypass_enabled(),
            "default_password_must_change": bool(is_dev_auth_bypass_enabled() and not profile),
        },
    )

    role = str(profile.get("role") or _role_from_profile(user_id) or "user")

    if profile.get("is_active") is False:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "code": "ACCOUNT_DISABLED",
                "message": "Tài khoản của bạn đã bị vô hiệu hóa hoặc không tồn tại.",
            },
        )

    access_token = create_app_access_token(user_id=user_id, email=email, role=role)

    return {
        "success": True,
        "data": {
            "access_token": access_token,
            "token_type": "bearer",
            "user": _user_payload(user_id, email, role, profile),
        },
    }


def _password_reset_success(message: str) -> Dict[str, Any]:
    return {"success": True, "data": {"message": message}}


def _get_reset_auth_user(email: str) -> Any | None:
    return _auth_user_by_email(str(email))


def _require_valid_otp_format(otp: str) -> str:
    value = str(otp or "").strip()
    if len(value) != 6 or not value.isdigit():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"code": "INVALID_OTP", "message": OTP_INVALID_MESSAGE},
        )
    return value


def _require_valid_new_password(new_password: str) -> None:
    if len(new_password or "") < 6:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "code": "PASSWORD_TOO_SHORT",
                "message": "Mật khẩu phải có ít nhất 6 ký tự.",
            },
        )


@router.post("/password-reset/request")
async def request_password_reset_otp(payload: PasswordResetRequest) -> Dict[str, Any]:
    normalized_email = str(payload.email).strip().lower()
    auth_user = _get_reset_auth_user(normalized_email)

    if not auth_user:
        return _password_reset_success(GENERIC_RESET_REQUEST_MESSAGE)

    try:
        otp = create_password_reset_otp(normalized_email)
    except Exception as exc:
        print(f"PASSWORD RESET OTP DB INSERT FAILED: {exc}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={
                "code": "PASSWORD_RESET_OTP_PERSIST_FAILED",
                "message": "Không thể tạo mã xác thực. Vui lòng kiểm tra migration password_reset_otps và thử lại sau.",
            },
        ) from exc

    try:
        send_or_allow_dev_otp(normalized_email, otp)
    except Exception as exc:
        message = str(exc)
        print(f"PASSWORD RESET OTP DELIVERY FAILED: {exc}")

        if SMTP_NOT_CONFIGURED_MESSAGE in message:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail={
                    "code": "SMTP_NOT_CONFIGURED",
                    "message": SMTP_NOT_CONFIGURED_MESSAGE,
                },
            ) from exc

        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={
                "code": "PASSWORD_RESET_DELIVERY_FAILED",
                "message": "Không thể gửi mã xác thực. Vui lòng thử lại sau.",
            },
        ) from exc

    return _password_reset_success(GENERIC_RESET_REQUEST_MESSAGE)


@router.post("/password-reset/verify")
async def verify_password_reset(payload: PasswordResetVerifyRequest) -> Dict[str, Any]:
    otp = _require_valid_otp_format(payload.otp)
    if not _get_reset_auth_user(str(payload.email)):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"code": "INVALID_OTP", "message": OTP_INVALID_MESSAGE},
        )

    try:
        valid, message = verify_password_reset_otp(str(payload.email), otp)
    except Exception as exc:
        print(f"PASSWORD RESET OTP VERIFY FAILED: {exc}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"code": "INVALID_OTP", "message": OTP_INVALID_MESSAGE},
        ) from exc

    if not valid:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"code": "INVALID_OTP", "message": message},
        )

    return _password_reset_success(OTP_VALID_MESSAGE)


@router.post("/password-reset/confirm")
async def confirm_password_reset(payload: PasswordResetConfirmRequest) -> Dict[str, Any]:
    otp = _require_valid_otp_format(payload.otp)
    _require_valid_new_password(payload.new_password)

    auth_user = _get_reset_auth_user(str(payload.email))
    if not auth_user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"code": "INVALID_OTP", "message": OTP_INVALID_MESSAGE},
        )

    try:
        valid, message, otp_id = verified_password_reset_otp_id(str(payload.email), otp)
    except Exception as exc:
        print(f"PASSWORD RESET OTP CONFIRM FAILED: {exc}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"code": "INVALID_OTP", "message": OTP_INVALID_MESSAGE},
        ) from exc

    if not valid:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"code": "INVALID_OTP", "message": message},
        )

    user_id = _auth_user_field(auth_user, "id")
    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"code": "PASSWORD_RESET_FAILED", "message": "Không thể cập nhật mật khẩu."},
        )

    try:
        supabase.auth.admin.update_user_by_id(str(user_id), {"password": payload.new_password})
        profile = _profile_for_user(str(user_id))
        profile_updates = {
            "password_login_enabled": True,
            "default_password_must_change": False,
        }
        if profile.get("auth_provider") == "google":
            profile_updates["auth_provider"] = "google"
        _ensure_profile(str(user_id), str(payload.email).strip().lower(), profile_updates)
        if otp_id:
            mark_otp_used(otp_id)
    except Exception as exc:
        print(f"PASSWORD RESET UPDATE FAILED: {exc}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "code": "PASSWORD_RESET_FAILED",
                "message": "Không thể cập nhật mật khẩu. Vui lòng thử lại sau.",
            },
        ) from exc

    return _password_reset_success(PASSWORD_UPDATED_MESSAGE)


@router.post("/request-password-reset")
async def request_password_reset(payload: PasswordResetRequest) -> Dict[str, Any]:
    return await request_password_reset_otp(payload)
