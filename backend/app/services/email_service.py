"""SMTP email helpers used by auth flows."""
from __future__ import annotations

import smtplib
from email.message import EmailMessage

from app.config import settings


SMTP_NOT_CONFIGURED_MESSAGE = "Chưa cấu hình dịch vụ gửi email."


def is_smtp_configured() -> bool:
    return bool(
        settings.SMTP_HOST
        and settings.SMTP_PORT
        and settings.SMTP_USER
        and settings.SMTP_PASSWORD
        and settings.SMTP_FROM
    )


def send_password_reset_otp(email: str, otp: str) -> None:
    """Send a 4-digit password reset OTP by SMTP.

    The OTP is only passed to this helper at send time and should never be
    returned to the frontend.
    """
    if not is_smtp_configured():
        raise RuntimeError(SMTP_NOT_CONFIGURED_MESSAGE)

    message = EmailMessage()
    message["Subject"] = "Mã xác thực đặt lại mật khẩu"
    message["From"] = settings.SMTP_FROM
    message["To"] = email
    message.set_content(
        "Mã xác thực đặt lại mật khẩu của bạn là: "
        f"{otp}\n\n"
        "Mã này hết hạn sau 10 phút. Nếu bạn không yêu cầu đặt lại mật khẩu, "
        "vui lòng bỏ qua email này."
    )

    with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT, timeout=15) as server:
        server.starttls()
        server.login(settings.SMTP_USER, settings.SMTP_PASSWORD)
        server.send_message(message)
