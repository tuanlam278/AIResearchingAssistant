"""Current-user profile, security, social-link and data-management routes."""
from __future__ import annotations

from datetime import date, datetime, timezone
from typing import Any, Literal
from uuid import uuid4
import logging

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from supabase import Client, create_client
from pydantic import BaseModel, Field

from app.config import settings
from app.db.supabase_client import supabase
from app.services.supabase_storage import (
    ensure_bucket as storage_ensure_bucket,
    public_url as storage_public_url,
    upload_file as storage_upload_file,
)
from app.dependencies import get_current_user
from app.services.google_auth_service import verify_google_credential

router = APIRouter(prefix="/api/profile", tags=["profile"])
logger = logging.getLogger(__name__)


def _anon_client() -> Client:
    return create_client(settings.SUPABASE_URL, settings.SUPABASE_ANON_KEY)

MAX_AVATAR_BYTES = 5 * 1024 * 1024
ALLOWED_AVATAR_TYPES = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp"}
def _supabase_response_data(resp: Any):
    if isinstance(resp, dict):
        return resp.get("data"), resp.get("error")
    return getattr(resp, "data", None), getattr(resp, "error", None)


def _user_id(user: dict) -> str:
    return str(user.get("id") or user.get("user_id"))


def _profile_select() -> str:
    return "*"


def _safe_profile(row: dict | None, user: dict) -> dict:
    row = row or {}
    email = row.get("email") or user.get("email")
    display = row.get("display_name") or row.get("full_name") or (email.split("@")[0] if email and "@" in email else email)
    return {
        "id": _user_id(user),
        "user_id": _user_id(user),
        "email": email,
        "name": display,
        "role": row.get("role") or user.get("role", "user"),
        "avatar_url": row.get("avatar_url"),
        "full_name": row.get("full_name"),
        "display_name": row.get("display_name"),
        "username": row.get("display_name"),
        "gender": row.get("gender"),
        "date_of_birth": row.get("date_of_birth"),
        "created_at": row.get("created_at"),
        "google_connected": bool(row.get("google_id")),
        "google_email": row.get("google_email") or (email if row.get("google_id") and row.get("auth_provider") == "google" else None),
        "google_avatar_url": row.get("google_avatar_url") or (row.get("avatar_url") if row.get("google_id") else None),
        "email_2fa_enabled": bool(row.get("email_2fa_enabled", False)),
        "is_active": row.get("is_active", True),
        "preferred_theme": row.get("preferred_theme") or "system",
        "preferred_language": row.get("preferred_language") or "vi",
        "has_password": bool(row.get("password_login_enabled", False)),
        "canUploadLibraryDocuments": row.get("can_upload_library_documents", row.get("can_publish_documents", True)),
        "can_upload_library_documents": row.get("can_upload_library_documents", row.get("can_publish_documents", True)),
        "canPublishDocuments": row.get("can_publish_documents", row.get("can_upload_library_documents", True)),
        "can_publish_documents": row.get("can_publish_documents", row.get("can_upload_library_documents", True)),
        "publishBlockedReason": row.get("publish_blocked_reason"),
        "publishBlockedAt": row.get("publish_blocked_at"),
        "default_password_must_change": bool(row.get("default_password_must_change", False)),
    }



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

def _get_profile(user: dict) -> dict:
    user_id = _user_id(user)
    try:
        resp = supabase.table("profiles").select(_profile_select()).eq("id", user_id).limit(1).execute()
        rows, error = _supabase_response_data(resp)
        if error:
            raise RuntimeError(error)
        if rows:
            return rows[0]
        created = {
            "id": user_id,
            "email": user.get("email"),
            "role": user.get("role", "user"),
            "is_active": True,
            "preferred_theme": "system",
            "preferred_language": "vi",
        }
        resp = supabase.table("profiles").insert(created).execute()
        rows, _ = _supabase_response_data(resp)
        return rows[0] if rows else created
    except Exception as exc:
        raise HTTPException(status_code=500, detail={"code": "PROFILE_LOAD_FAILED", "message": "Không thể tải hồ sơ."}) from exc


def _update_profile(user: dict, updates: dict) -> dict:
    if not updates:
        return _get_profile(user)
    try:
        resp = supabase.table("profiles").update(updates).eq("id", _user_id(user)).execute()
        rows, error = _supabase_response_data(resp)
        if error:
            raise RuntimeError(error)
        return rows[0] if rows else _get_profile(user)
    except Exception as exc:
        if "display_name" in updates and any(term in str(exc).lower() for term in ("duplicate", "unique", "idx_profiles_display_name_unique")):
            _raise_display_name_taken()
        if any(key in updates for key in ("google_email", "google_avatar_url", "default_password_must_change", "disabled_at", "deleted_at")):
            fallback_updates = dict(updates)
            fallback_updates.pop("google_email", None)
            fallback_updates.pop("google_avatar_url", None)
            fallback_updates.pop("default_password_must_change", None)
            fallback_updates.pop("disabled_at", None)
            fallback_updates.pop("deleted_at", None)
            try:
                resp = supabase.table("profiles").update(fallback_updates).eq("id", _user_id(user)).execute()
                rows, error = _supabase_response_data(resp)
                if error:
                    raise RuntimeError(error)
                return rows[0] if rows else _get_profile(user)
            except Exception as retry_exc:
                raise HTTPException(status_code=500, detail={"code": "PROFILE_UPDATE_FAILED", "message": "Không thể cập nhật hồ sơ."}) from retry_exc
        raise HTTPException(status_code=500, detail={"code": "PROFILE_UPDATE_FAILED", "message": "Không thể cập nhật hồ sơ."}) from exc


class ProfileUpdateRequest(BaseModel):
    full_name: str | None = Field(default=None, max_length=160)
    display_name: str | None = Field(default=None, max_length=80)
    username: str | None = Field(default=None, max_length=80)
    gender: Literal["male", "female", "other", "prefer_not_to_say"] | None = None
    date_of_birth: date | None = None


class ChangePasswordRequest(BaseModel):
    current_password: str | None = None
    new_password: str = Field(..., min_length=6, max_length=128)


class GoogleCredentialRequest(BaseModel):
    credential: str


class PreferencesRequest(BaseModel):
    preferred_theme: Literal["light", "dark", "system"]
    preferred_language: Literal["vi", "en"]



@router.get("/me")
async def get_me(user: dict = Depends(get_current_user)) -> dict:
    profile = _get_profile(user)
    if profile.get("is_active") is False:
        raise HTTPException(status_code=403, detail={"code": "ACCOUNT_DISABLED", "message": "Tài khoản đã bị vô hiệu hóa."})
    return {"success": True, "data": {"user": _safe_profile(profile, user)}}


@router.patch("/me")
async def update_me(payload: ProfileUpdateRequest, user: dict = Depends(get_current_user)) -> dict:
    updates = payload.model_dump(exclude_unset=True)
    if "username" in updates and "display_name" not in updates:
        updates["display_name"] = updates.pop("username")
    else:
        updates.pop("username", None)
    if "display_name" in updates:
        updates["display_name"] = _normalize_display_name(updates.get("display_name"))
        if updates["display_name"] and _display_name_exists(updates["display_name"], _user_id(user)):
            _raise_display_name_taken()
    if "date_of_birth" in updates and updates["date_of_birth"] is not None:
        updates["date_of_birth"] = updates["date_of_birth"].isoformat()
    profile = _update_profile(user, updates)
    return {"success": True, "data": {"user": _safe_profile(profile, user)}}


def _storage_error_detail(exc: Exception) -> str:
    parts = [str(exc)]
    for attr in ("message", "code", "status_code"):
        value = getattr(exc, attr, None)
        if value:
            parts.append(str(value))
    response = getattr(exc, "response", None)
    if response is not None:
        try:
            parts.append(str(response.json()))
        except Exception:
            text = getattr(response, "text", None)
            if text:
                parts.append(str(text))
    return " | ".join(part for part in parts if part)


def _ensure_public_avatar_bucket(bucket: str) -> None:
    """Best-effort guard for local/dev projects that have not run the SQL setup yet."""
    try:
        storage_ensure_bucket(bucket, public=True)
    except Exception as exc:
        logger.warning("Could not inspect/update avatar bucket %s: %s", bucket, _storage_error_detail(exc))


def _avatar_public_url(bucket: str, path: str) -> str:
    return storage_public_url(bucket, path)


def _upload_avatar_file(bucket: str, path: str, content: bytes, content_type: str) -> str:
    storage_upload_file(bucket, path, content, content_type, upsert=True)
    return _avatar_public_url(bucket, path)


@router.post("/avatar")
async def upload_avatar(avatar: UploadFile = File(...), user: dict = Depends(get_current_user)) -> dict:
    if avatar.content_type not in ALLOWED_AVATAR_TYPES:
        raise HTTPException(status_code=400, detail={"code": "INVALID_AVATAR_TYPE", "message": "Avatar phải là JPEG, PNG hoặc WebP."})
    content = await avatar.read()
    if len(content) > MAX_AVATAR_BYTES:
        raise HTTPException(status_code=400, detail={"code": "AVATAR_TOO_LARGE", "message": "Avatar tối đa 5MB."})

    bucket = str(settings.AVATAR_STORAGE_BUCKET or "").strip()
    if not bucket:
        raise HTTPException(status_code=500, detail={"code": "AVATAR_BUCKET_NOT_CONFIGURED", "message": "Chưa cấu hình AVATAR_STORAGE_BUCKET."})

    ext = ALLOWED_AVATAR_TYPES[avatar.content_type]
    path = f"{_user_id(user)}/avatar-{uuid4().hex}.{ext}"
    _ensure_public_avatar_bucket(bucket)
    try:
        public_url = _upload_avatar_file(bucket, path, content, avatar.content_type)
    except Exception as exc:
        detail = _storage_error_detail(exc)
        logger.exception("Avatar upload failed for user_id=%s bucket=%s path=%s detail=%s", _user_id(user), bucket, path, detail)
        message = "Không thể upload avatar lên Supabase Storage. Kiểm tra bucket avatars đã tồn tại/public và backend đang dùng service_role key."
        if "bucket not found" in detail.lower() or "not found" in detail.lower() or "404" in detail:
            message = "Không tìm thấy bucket avatars trong Supabase Storage. Hãy chạy docs/sql/complete_schema.sql hoặc tạo bucket avatars public."
        elif "row-level security" in detail.lower() or "unauthorized" in detail.lower() or "401" in detail or "403" in detail:
            message = "Backend không có quyền upload avatar. Hãy kiểm tra SUPABASE_SERVICE_ROLE_KEY và bucket avatars."
        raise HTTPException(status_code=500, detail={"code": "AVATAR_UPLOAD_FAILED", "message": message}) from exc
    profile = _update_profile(user, {"avatar_url": public_url})
    return {"success": True, "data": {"avatar_url": public_url, "user": _safe_profile(profile, user)}}


@router.post("/change-password")
async def change_password(payload: ChangePasswordRequest, user: dict = Depends(get_current_user)) -> dict:
    if not payload.current_password:
        raise HTTPException(status_code=400, detail={"code": "CURRENT_PASSWORD_REQUIRED", "message": "Vui lòng nhập mật khẩu hiện tại."})

    auth_client = _anon_client()
    try:
        resp = auth_client.auth.sign_in_with_password({"email": user["email"], "password": payload.current_password})
        auth_error = getattr(resp, "error", None) or (resp.get("error") if isinstance(resp, dict) else None)
        if auth_error:
            raise ValueError(str(auth_error))
    except Exception as exc:
        raise HTTPException(status_code=401, detail={"code": "INVALID_CURRENT_PASSWORD", "message": "Mật khẩu hiện tại không đúng."}) from exc

    try:
        supabase.auth.admin.update_user_by_id(_user_id(user), {"password": payload.new_password})
    except Exception as exc:
        message = str(exc)
        print(f"PASSWORD UPDATE ADMIN FALLBACK for user {_user_id(user)}: {exc}")
        try:
            update_resp = auth_client.auth.update_user({"password": payload.new_password})
            update_error = getattr(update_resp, "error", None) or (update_resp.get("error") if isinstance(update_resp, dict) else None)
            if update_error:
                raise RuntimeError(str(update_error))
        except Exception as fallback_exc:
            print(f"PASSWORD UPDATE FAILED for user {_user_id(user)}: admin={message}; session={fallback_exc}")
            raise HTTPException(status_code=400, detail={"code": "PASSWORD_UPDATE_FAILED", "message": "Không thể cập nhật mật khẩu. Vui lòng thử lại sau."}) from fallback_exc
    _update_profile(user, {"password_login_enabled": True, "default_password_must_change": False})
    return {"success": True, "data": {"message": "Đã cập nhật mật khẩu."}}


@router.post("/2fa/email/enable")
async def enable_email_2fa(user: dict = Depends(get_current_user)) -> dict:
    profile = _update_profile(user, {"email_2fa_enabled": True})
    message = "Đã bật 2FA email. Cần cấu hình SMTP để gửi mã xác thực qua email." if not (settings.SMTP_HOST and settings.SMTP_USER and settings.SMTP_PASSWORD and settings.SMTP_FROM) else "Đã bật 2FA email."
    return {"success": True, "data": {"enabled": True, "user": _safe_profile(profile, user), "message": message}}


@router.post("/2fa/email/disable")
async def disable_email_2fa(user: dict = Depends(get_current_user)) -> dict:
    profile = _update_profile(user, {"email_2fa_enabled": False})
    return {"success": True, "data": {"enabled": False, "user": _safe_profile(profile, user), "message": "Đã tắt 2FA email."}}


@router.post("/social/google/connect")
async def connect_google(payload: GoogleCredentialRequest, user: dict = Depends(get_current_user)) -> dict:
    claims = verify_google_credential(payload.credential)
    google_id = claims["sub"]
    try:
        resp = supabase.table("profiles").select("id,email,google_id").eq("google_id", google_id).limit(1).execute()
        rows, error = _supabase_response_data(resp)
        if error:
            raise RuntimeError(error)
        if rows and str(rows[0].get("id")) != _user_id(user):
            raise HTTPException(status_code=409, detail={"code": "GOOGLE_ALREADY_LINKED", "message": "Tài khoản Google này đã được liên kết với tài khoản khác."})
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail={"code": "GOOGLE_LINK_CHECK_FAILED", "message": "Không thể kiểm tra liên kết Google."}) from exc

    updates = {
        "google_id": google_id,
        "google_email": claims.get("email"),
        "google_avatar_url": claims.get("picture"),
        "auth_provider": "google",
        "avatar_url": claims.get("picture"),
    }
    profile = _update_profile(user, updates)
    return {"success": True, "data": {"user": _safe_profile(profile, user), "message": "Đã kết nối Google."}}


@router.post("/social/google/disconnect")
async def disconnect_google(user: dict = Depends(get_current_user)) -> dict:
    profile = _get_profile(user)
    if not profile.get("password_login_enabled"):
        raise HTTPException(status_code=400, detail={"code": "PASSWORD_REQUIRED", "message": "Vui lòng đặt mật khẩu trước khi ngắt kết nối Google."})
    profile = _update_profile(user, {"google_id": None, "google_email": None, "google_avatar_url": None, "auth_provider": "password"})
    return {"success": True, "data": {"user": _safe_profile(profile, user), "message": "Đã ngắt kết nối Google."}}


@router.patch("/preferences")
async def update_preferences(payload: PreferencesRequest, user: dict = Depends(get_current_user)) -> dict:
    profile = _update_profile(user, payload.model_dump())
    return {"success": True, "data": {"user": _safe_profile(profile, user)}}


def _select_owned(table: str, columns: str, user_id: str, *, limit: int | None = None, order: bool = False) -> list[dict]:
    q = supabase.table(table).select(columns).eq("user_id", user_id)
    if order:
        q = q.order("created_at", desc=True)
    if limit:
        q = q.limit(limit)
    rows, error = _supabase_response_data(q.execute())
    return [] if error else (rows or [])


@router.get("/activity")
async def activity(user: dict = Depends(get_current_user)) -> dict:
    user_id = _user_id(user)
    profile = _get_profile(user)
    notebooks = _select_owned("notebooks", "id,name,created_at", user_id, limit=10, order=True)
    notebook_ids = [n["id"] for n in notebooks]
    docs: list[dict] = []
    sessions: list[dict] = []
    notes: list[dict] = []
    try:
        if notebook_ids:
            docs, _ = _supabase_response_data(supabase.table("documents").select("id,filename,created_at,notebook_id").in_("notebook_id", notebook_ids).order("created_at", desc=True).limit(10).execute())
            sessions, _ = _supabase_response_data(supabase.table("research_sessions").select("id,title,created_at,notebook_id").in_("notebook_id", notebook_ids).order("created_at", desc=True).limit(10).execute())
            notes, _ = _supabase_response_data(supabase.table("notes").select("id,title,created_at,workspace_id").in_("workspace_id", notebook_ids).order("created_at", desc=True).limit(10).execute())
    except Exception:
        docs, sessions, notes = [], [], []
    recent = []
    feature_labels = {
        "notebook": "Không gian nghiên cứu",
        "academic_lens": "Kính lúp học thuật",
        "cross_analysis": "So sánh tương quan",
        "system_library": "Thư viện hệ thống",
    }
    try:
        rows, error = _supabase_response_data(
            supabase.table("user_activity_logs")
            .select("*")
            .eq("user_id", user_id)
            .order("created_at", desc=True)
            .limit(20)
            .execute()
        )
        if not error:
            for item in rows or []:
                module = feature_labels.get(item.get("feature_name"), item.get("feature_name") or "Hệ thống")
                document_name = item.get("document_name") or "tài liệu"
                recent.append({
                    "type": item.get("action_type") or "activity",
                    "feature_name": item.get("feature_name"),
                    "module": module,
                    "document_name": item.get("document_name"),
                    "metadata": item.get("metadata") or {},
                    "label": f"{module}: đã tải lên {document_name}",
                    "created_at": item.get("created_at"),
                })
    except Exception:
        pass
    for n in notebooks:
        recent.append({"type": "notebook_created", "label": f"Đã tạo notebook {n.get('name') or ''}".strip(), "created_at": n.get("created_at")})
    for d in docs or []:
        recent.append({"type": "document_uploaded", "module": "Không gian nghiên cứu", "document_name": d.get("filename"), "label": f"Không gian nghiên cứu: đã tải lên {d.get('filename') or ''}".strip(), "created_at": d.get("created_at")})
    for s in sessions or []:
        recent.append({"type": "research_session_created", "label": f"Đã tạo phiên nghiên cứu {s.get('title') or ''}".strip(), "created_at": s.get("created_at")})
    for n in notes or []:
        recent.append({"type": "note_created", "label": f"Đã tạo note {n.get('title') or ''}".strip(), "created_at": n.get("created_at")})
    recent.sort(key=lambda x: x.get("created_at") or "", reverse=True)
    return {"success": True, "data": {"account_created_at": profile.get("created_at"), "stats": {"notebooks": len(notebooks), "documents": len(docs or []), "research_sessions": len(sessions or []), "notes": len(notes or [])}, "recent_activity": recent[:12]}}


@router.get("/export-data")
async def export_data(user: dict = Depends(get_current_user)) -> dict:
    # Deprecated: personal JSON export removed from UI.
    _ = user
    raise HTTPException(
        status_code=status.HTTP_410_GONE,
        detail={
            "code": "PROFILE_EXPORT_REMOVED",
            "message": "Tính năng tải xuống dữ liệu cá nhân dạng JSON đã được gỡ khỏi hồ sơ.",
        },
    )

@router.post("/deactivate")
async def deactivate(user: dict = Depends(get_current_user)) -> dict:
    _update_profile(user, {"is_active": False, "disabled_at": datetime.now(timezone.utc).isoformat()})
    return {"success": True, "data": {"message": "Tài khoản đã được vô hiệu hóa."}}


@router.delete("/account")
async def delete_account(user: dict = Depends(get_current_user)) -> dict:
    anonymized = f"deleted-{_user_id(user)}@deleted.local"
    _update_profile(user, {"is_active": False, "email": anonymized, "full_name": None, "display_name": "Deleted user", "avatar_url": None, "google_id": None, "google_email": None, "google_avatar_url": None, "deleted_at": datetime.now(timezone.utc).isoformat()})
    try:
        supabase.auth.admin.update_user_by_id(_user_id(user), {"user_metadata": {"deleted": True}})
    except Exception:
        pass
    return {"success": True, "data": {"message": "Tài khoản đã được đánh dấu xóa và ẩn danh hồ sơ."}}
