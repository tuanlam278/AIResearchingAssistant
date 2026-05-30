"""Minimal HS256 JWT helpers for app-owned sessions."""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time
from typing import Any

from app.config import settings

ISSUER = "ai-researching-assistant"
AUDIENCE = "ai-researching-assistant-api"
DEFAULT_TTL_SECONDS = 60 * 60 * 24 * 7


def _b64url_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _b64url_decode(data: str) -> bytes:
    return base64.urlsafe_b64decode(data + "=" * (-len(data) % 4))


def _secret() -> bytes:
    if not settings.JWT_SECRET_KEY:
        raise RuntimeError("JWT_SECRET_KEY is required for app-owned Google sessions")
    return settings.JWT_SECRET_KEY.encode("utf-8")


def create_app_access_token(*, user_id: str, email: str, role: str = "user", ttl_seconds: int = DEFAULT_TTL_SECONDS) -> str:
    now = int(time.time())
    header = {"alg": "HS256", "typ": "JWT"}
    payload = {
        "iss": ISSUER,
        "aud": AUDIENCE,
        "sub": str(user_id),
        "email": email,
        "role": role,
        "iat": now,
        "exp": now + ttl_seconds,
        "token_use": "access",
    }
    signing_input = f"{_b64url_encode(json.dumps(header, separators=(',', ':')).encode())}.{_b64url_encode(json.dumps(payload, separators=(',', ':')).encode())}"
    signature = hmac.new(_secret(), signing_input.encode("ascii"), hashlib.sha256).digest()
    return f"{signing_input}.{_b64url_encode(signature)}"


def verify_app_access_token(token: str) -> dict[str, Any] | None:
    if not settings.JWT_SECRET_KEY or token.count(".") != 2:
        return None
    try:
        header_b64, payload_b64, signature_b64 = token.split(".")
        signing_input = f"{header_b64}.{payload_b64}"
        expected = hmac.new(settings.JWT_SECRET_KEY.encode("utf-8"), signing_input.encode("ascii"), hashlib.sha256).digest()
        supplied = _b64url_decode(signature_b64)
        if not hmac.compare_digest(expected, supplied):
            return None
        header = json.loads(_b64url_decode(header_b64))
        payload = json.loads(_b64url_decode(payload_b64))
        if header.get("alg") != "HS256" or payload.get("iss") != ISSUER or payload.get("aud") != AUDIENCE:
            return None
        if int(payload.get("exp") or 0) < int(time.time()):
            return None
        if payload.get("token_use") != "access" or not payload.get("sub") or not payload.get("email"):
            return None
        return payload
    except Exception:
        return None
