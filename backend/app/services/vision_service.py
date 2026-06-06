from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass

from google import genai
from google.genai import types

from app.config import settings

SUPPORTED_IMAGE_MIME_TYPES = {"image/png", "image/jpeg", "image/webp"}
MAX_VISION_IMAGE_BYTES = 8 * 1024 * 1024
logger = logging.getLogger(__name__)


@dataclass(slots=True)
class VisionResult:
    answer: str
    model: str


def is_vision_configured() -> bool:
    return bool(settings.GOOGLE_API_KEY.strip() and settings.VISION_MODEL.strip())


def get_vision_model() -> str:
    model = settings.VISION_MODEL.strip()
    if not model:
        raise RuntimeError("VISION_MODEL chưa được cấu hình.")
    return model


def validate_image_payload(image_bytes: bytes, mime_type: str) -> None:
    if not image_bytes:
        raise ValueError("EMPTY_IMAGE")
    if len(image_bytes) > MAX_VISION_IMAGE_BYTES:
        raise ValueError("IMAGE_TOO_LARGE")
    if mime_type not in SUPPORTED_IMAGE_MIME_TYPES:
        raise ValueError("UNSUPPORTED_IMAGE_TYPE")


def _generate_with_gemini(image_bytes: bytes, mime_type: str, prompt: str) -> VisionResult:
    client = genai.Client(api_key=settings.GOOGLE_API_KEY)
    model = get_vision_model()
    logger.info("Running Academic Lens vision request with configured VISION_MODEL=%s", model)
    response = client.models.generate_content(
        model=model,
        contents=[
            "Bạn là trợ lý phân tích ảnh học thuật. Trả lời bằng tiếng Việt, không bịa nếu ảnh không đủ thông tin.",
            prompt,
            types.Part.from_bytes(data=image_bytes, mime_type=mime_type),
        ],
    )
    return VisionResult(answer=response.text or "", model=model)


async def analyze_academic_image(image_bytes: bytes, mime_type: str, prompt: str) -> VisionResult:
    validate_image_payload(image_bytes, mime_type)
    return await asyncio.to_thread(_generate_with_gemini, image_bytes, mime_type, prompt)
