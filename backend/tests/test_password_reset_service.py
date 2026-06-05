import os
import sys
from pathlib import Path

os.environ.setdefault("GOOGLE_API_KEY", "test-google-key")
os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_SERVICE_KEY", "test-service-key")
os.environ.setdefault("SUPABASE_ANON_KEY", "test-anon-key")
os.environ.setdefault("GROQ_API_KEY", "test-groq-key")

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import settings
from app.services import password_reset_service as service


def test_password_reset_otp_is_four_digits():
    otp = service.generate_otp()

    assert otp.isdigit()
    assert len(otp) == service.OTP_LENGTH == 4


def test_fixed_development_reset_otp_is_accepted(monkeypatch):
    monkeypatch.setattr(settings, "APP_ENV", "development")
    monkeypatch.setattr(settings, "ENABLE_DEV_AUTH_BYPASS", False)

    valid, message, otp_id = service.verified_password_reset_otp_id("user@example.com", "8888")

    assert valid is True
    assert message == service.OTP_VALID_MESSAGE
    assert otp_id is None


def test_fixed_reset_otp_is_always_accepted_without_bypass(monkeypatch):
    monkeypatch.setattr(settings, "APP_ENV", "production")
    monkeypatch.setattr(settings, "ENABLE_DEV_AUTH_BYPASS", False)

    valid, message, otp_id = service.verified_password_reset_otp_id("user@example.com", "8888")

    assert valid is True
    assert message == service.OTP_VALID_MESSAGE
    assert otp_id is None
