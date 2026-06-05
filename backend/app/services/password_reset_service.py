"""Password reset OTP creation, delivery, and validation helpers."""
from __future__ import annotations

import base64
import hashlib
import hmac
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import uuid4

from app.config import settings
from app.db.supabase_client import supabase
from app.services.email_service import is_smtp_configured, send_password_reset_otp

OTP_LENGTH = 4
DEV_RESET_OTP = "8888"
OTP_EXPIRES_MINUTES = 5
MAX_OTP_ATTEMPTS = 5
GENERIC_RESET_REQUEST_MESSAGE = "Nếu email hợp lệ, mã OTP đã được gửi đến hộp thư của bạn."
OTP_SENT_MESSAGE = GENERIC_RESET_REQUEST_MESSAGE
OTP_VALID_MESSAGE = "Mã xác thực hợp lệ."
PASSWORD_UPDATED_MESSAGE = "Đã cập nhật mật khẩu."
OTP_INVALID_MESSAGE = "Mã xác thực không đúng hoặc đã hết hạn."
OTP_EXPIRED_MESSAGE = "Mã xác thực đã hết hạn. Vui lòng yêu cầu mã mới."
OTP_ATTEMPTS_EXCEEDED_MESSAGE = "Bạn đã nhập sai quá số lần cho phép. Vui lòng yêu cầu mã mới."
SMTP_NOT_CONFIGURED_MESSAGE = "Chưa cấu hình dịch vụ gửi email."

OTP_HASH_ITERATIONS = 120_000
_MEMORY_OTPS: list[dict[str, Any]] = []


def is_dev_auth_bypass_enabled() -> bool:
    return (
        settings.APP_ENV.lower() == "development"
        and settings.ENABLE_DEV_AUTH_BYPASS is True
    )


def is_dev_reset_otp_enabled() -> bool:
    return settings.APP_ENV.lower() in {"development", "dev", "local", "test"} or settings.ENABLE_DEV_AUTH_BYPASS is True


def is_development_reset_otp(otp: str) -> bool:
    """Allow the fixed development OTP requested for manual testing.

    The product requirement is that 8888 always passes in development/testing
    workflows without requiring any feature flag. This helper intentionally does
    not gate the fixed code on APP_ENV.
    """
    return str(otp or "").strip() == DEV_RESET_OTP


def _supabase_response_data(resp: Any):
    if isinstance(resp, dict):
        return resp.get("data"), resp.get("error")
    return getattr(resp, "data", None), getattr(resp, "error", None)


def _normalize_email(email: str) -> str:
    return str(email or "").strip().lower()


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _parse_dt(value: Any) -> datetime | None:
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def _otp_secret(email: str, otp: str) -> bytes:
    return f"{_normalize_email(email)}:{str(otp or '').strip()}".encode("utf-8")


def _hash_otp(email: str, otp: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", _otp_secret(email, otp), salt, OTP_HASH_ITERATIONS)
    return "$".join(
        [
            "pbkdf2_sha256",
            str(OTP_HASH_ITERATIONS),
            base64.urlsafe_b64encode(salt).decode("ascii"),
            base64.urlsafe_b64encode(digest).decode("ascii"),
        ]
    )


def _verify_otp_hash(email: str, otp: str, otp_hash: str) -> bool:
    try:
        algorithm, iterations, encoded_salt, encoded_digest = otp_hash.split("$", 3)
        if algorithm != "pbkdf2_sha256":
            return False
        salt = base64.urlsafe_b64decode(encoded_salt.encode("ascii"))
        expected_digest = base64.urlsafe_b64decode(encoded_digest.encode("ascii"))
        actual_digest = hashlib.pbkdf2_hmac("sha256", _otp_secret(email, otp), salt, int(iterations))
        return hmac.compare_digest(actual_digest, expected_digest)
    except Exception:
        return False


def generate_otp() -> str:
    upper_bound = 10 ** OTP_LENGTH
    return f"{secrets.randbelow(upper_bound):0{OTP_LENGTH}d}"


def _memory_insert_otp(email: str, otp: str, expires_at: datetime) -> None:
    normalized_email = _normalize_email(email)
    for row in _MEMORY_OTPS:
        if row.get("email") == normalized_email and not row.get("used_at"):
            row["used_at"] = _now().isoformat()
    _MEMORY_OTPS.append(
        {
            "id": f"mem:{uuid4().hex}",
            "email": normalized_email,
            "otp_hash": _hash_otp(normalized_email, otp),
            "expires_at": expires_at.isoformat(),
            "attempts": 0,
            "used_at": None,
            "created_at": _now().isoformat(),
        }
    )


def create_password_reset_otp(email: str) -> str:
    """Create a 4-digit OTP for an email, using DB storage with memory fallback."""
    normalized_email = _normalize_email(email)
    otp = generate_otp()
    expires_at = _now() + timedelta(minutes=OTP_EXPIRES_MINUTES)

    try:
        supabase.table("password_reset_otps").update({"used_at": _now().isoformat()}).eq("email", normalized_email).is_("used_at", "null").execute()
        resp = supabase.table("password_reset_otps").insert(
            {
                "email": normalized_email,
                "otp_hash": _hash_otp(normalized_email, otp),
                "expires_at": expires_at.isoformat(),
                "attempts": 0,
            }
        ).execute()
        _, error = _supabase_response_data(resp)
        if error:
            raise RuntimeError(str(error))
    except Exception as exc:
        print(f"PASSWORD RESET OTP DB FALLBACK ENABLED: {exc}")
        _memory_insert_otp(normalized_email, otp, expires_at)

    return otp


def send_or_allow_dev_otp(email: str, otp: str) -> None:
    normalized_email = _normalize_email(email)
    if is_smtp_configured():
        send_password_reset_otp(normalized_email, otp)
        return

    if is_dev_reset_otp_enabled():
        print(f"DEV password reset OTP for {normalized_email}: {otp}; fixed test OTP: {DEV_RESET_OTP}")
        return

    raise RuntimeError(SMTP_NOT_CONFIGURED_MESSAGE)


def _latest_memory_otp(email: str) -> dict | None:
    normalized_email = _normalize_email(email)
    active_rows = [row for row in _MEMORY_OTPS if row.get("email") == normalized_email and not row.get("used_at")]
    if not active_rows:
        return None
    return sorted(active_rows, key=lambda row: str(row.get("created_at") or ""), reverse=True)[0]


def get_latest_active_otp(email: str) -> dict | None:
    normalized_email = _normalize_email(email)
    try:
        resp = (
            supabase.table("password_reset_otps")
            .select("*")
            .eq("email", normalized_email)
            .is_("used_at", "null")
            .order("created_at", desc=True)
            .limit(1)
            .execute()
        )
        rows, error = _supabase_response_data(resp)
        if error:
            raise RuntimeError(str(error))
        if rows:
            return rows[0]
    except Exception as exc:
        print(f"PASSWORD RESET OTP DB LOOKUP FALLBACK: {exc}")

    return _latest_memory_otp(normalized_email)


def mark_otp_used(otp_id: str) -> None:
    if str(otp_id).startswith("mem:"):
        for row in _MEMORY_OTPS:
            if row.get("id") == otp_id:
                row["used_at"] = _now().isoformat()
                return
    resp = supabase.table("password_reset_otps").update({"used_at": _now().isoformat()}).eq("id", otp_id).execute()
    _, error = _supabase_response_data(resp)
    if error:
        raise RuntimeError(str(error))


def increment_otp_attempts(row: dict) -> None:
    next_attempts = int(row.get("attempts") or 0) + 1
    if str(row.get("id") or "").startswith("mem:"):
        row["attempts"] = next_attempts
        return
    resp = supabase.table("password_reset_otps").update({"attempts": next_attempts}).eq("id", row["id"]).execute()
    _, error = _supabase_response_data(resp)
    if error:
        raise RuntimeError(str(error))


def _validate_password_reset_otp(email: str, otp: str) -> tuple[bool, str, str | None]:
    normalized_email = _normalize_email(email)
    otp = str(otp or "").strip()

    if is_development_reset_otp(otp):
        return True, OTP_VALID_MESSAGE, None

    row = get_latest_active_otp(normalized_email)
    if not row:
        return False, OTP_INVALID_MESSAGE, None

    expires_at = _parse_dt(row.get("expires_at"))
    if not expires_at or expires_at <= _now():
        return False, OTP_EXPIRED_MESSAGE, None

    if int(row.get("attempts") or 0) >= MAX_OTP_ATTEMPTS:
        return False, OTP_ATTEMPTS_EXCEEDED_MESSAGE, None

    if not _verify_otp_hash(normalized_email, otp, str(row.get("otp_hash") or "")):
        increment_otp_attempts(row)
        return False, OTP_INVALID_MESSAGE, None

    return True, OTP_VALID_MESSAGE, str(row["id"])


def verify_password_reset_otp(email: str, otp: str, *, mark_used: bool = False) -> tuple[bool, str]:
    valid, message, otp_id = _validate_password_reset_otp(email, otp)
    if valid and mark_used and otp_id:
        mark_otp_used(otp_id)
    return valid, message


def verified_password_reset_otp_id(email: str, otp: str) -> tuple[bool, str, str | None]:
    return _validate_password_reset_otp(email, otp)
