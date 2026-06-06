"""Google Identity Services token verification helpers."""
from __future__ import annotations

import logging
import time

from fastapi import HTTPException, status
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token

from app.config import settings


GOOGLE_AUTH_ERROR = "Không thể xác thực Google."
logger = logging.getLogger(__name__)
_google_request = google_requests.Request()


def verify_google_credential(credential: str) -> dict:
    """Verify a Google ID token and return the trusted claims."""
    if not settings.GOOGLE_CLIENT_ID:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={"code": "GOOGLE_AUTH_NOT_CONFIGURED", "message": "Google Login chưa được cấu hình."},
        )
    if not credential:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"code": "INVALID_GOOGLE_TOKEN", "message": GOOGLE_AUTH_ERROR},
        )

    try:
        started = time.perf_counter()
        claims = id_token.verify_oauth2_token(
            credential,
            _google_request,
            settings.GOOGLE_CLIENT_ID,
        )
        logger.info("Google login timing verify_token_ms=%.1f", (time.perf_counter() - started) * 1000)
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"code": "INVALID_GOOGLE_TOKEN", "message": GOOGLE_AUTH_ERROR},
        ) from exc

    if claims.get("aud") != settings.GOOGLE_CLIENT_ID:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"code": "INVALID_GOOGLE_AUDIENCE", "message": GOOGLE_AUTH_ERROR},
        )
    if claims.get("email_verified") is False:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"code": "GOOGLE_EMAIL_NOT_VERIFIED", "message": "Email Google chưa được xác minh."},
        )
    if not claims.get("email") or not claims.get("sub"):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"code": "INVALID_GOOGLE_TOKEN", "message": GOOGLE_AUTH_ERROR},
        )
    return claims
