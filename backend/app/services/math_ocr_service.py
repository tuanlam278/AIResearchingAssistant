from __future__ import annotations

from dataclasses import dataclass

from app.config import settings


@dataclass(slots=True)
class MathOcrConfig:
    enabled: bool
    provider: str


def get_math_ocr_config() -> MathOcrConfig:
    provider = str(settings.MATH_OCR_PROVIDER or "none").strip().lower()
    enabled = bool(settings.ENABLE_MATH_OCR and provider not in {"", "none"})
    if provider == "mathpix" and not (settings.MATHPIX_APP_ID.strip() and settings.MATHPIX_APP_KEY.strip()):
        enabled = False
    return MathOcrConfig(enabled=enabled, provider=provider or "none")


def is_math_ocr_enabled() -> bool:
    """Cost guard: paid/specialized Math OCR is opt-in only and disabled by default."""
    return get_math_ocr_config().enabled
