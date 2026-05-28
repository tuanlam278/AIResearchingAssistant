import asyncio
import logging
from typing import Dict, List

import io
import fitz  # PyMuPDF
from PIL import Image
from google import genai
from google.genai import types

from app.config import settings

logger = logging.getLogger(__name__)

client = genai.Client(api_key=settings.GOOGLE_API_KEY)

# Ngưỡng đánh giá text có đọc được không.
# Text bình thường: avg word length >= 3.0
# Text bị fragment ("T r a n s f o r m e r"): avg word length ~1.0-1.5
MIN_AVG_WORD_LENGTH = 3.0

# Số trang đầu dùng để sample khi kiểm tra chất lượng text
SAMPLE_PAGES = 3


# ─────────────────────────────────────────────
# Bước 1: Thử đọc text trực tiếp (không tốn API call)
# ─────────────────────────────────────────────

def _extract_text_direct(file_bytes: bytes) -> List[Dict]:
    """
    Đọc text trực tiếp từ PDF bằng PyMuPDF.
    Không tốn API call nào. Trả về list pages kể cả trang rỗng.
    """
    doc = fitz.open(stream=file_bytes, filetype="pdf")
    pages = []
    for i, page in enumerate(doc, start=1):
        text = page.get_text().strip()
        pages.append({"page_number": i, "content": text})
    doc.close()
    return pages


def _is_text_readable(pages: List[Dict]) -> bool:
    sample = [p for p in pages[:SAMPLE_PAGES] if p["content"]]
    if not sample:
        return False

    all_words = []
    for page in sample:
        all_words.extend(page["content"].split())

    if len(all_words) < 20:
        return False

    avg_word_length = sum(len(w) for w in all_words) / len(all_words)

    # Fix: thêm kiểm tra tỉ lệ từ có >= 2 ký tự
    # PDF font fragment sẽ có rất nhiều từ 1 ký tự
    ratio_long_words = sum(1 for w in all_words if len(w) >= 2) / len(all_words)

    readable = avg_word_length >= MIN_AVG_WORD_LENGTH or ratio_long_words >= 0.7
    return readable


# ─────────────────────────────────────────────
# Bước 2 (fallback): Vision — dùng khi PDF là scan hoặc text bị lỗi
# ─────────────────────────────────────────────

def _convert_pdf_to_images(file_bytes: bytes) -> List:
    """
    Chuyển PDF sang ảnh bằng PyMuPDF.
    Matrix(2, 2) ≈ 144 DPI — đủ rõ để Gemini Vision đọc, không quá nặng.
    """
    doc = fitz.open(stream=file_bytes, filetype="pdf")
    images = []
    for page in doc:
        pix = page.get_pixmap(matrix=fitz.Matrix(2, 2))
        img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
        images.append(img)
    doc.close()
    return images


async def _extract_text_from_image(image: Image.Image, page_num: int) -> str:
    """
    Gọi Gemini Vision để trích xuất text từ một trang ảnh.
    Trả về chuỗi rỗng nếu lỗi (không raise để tiếp tục các trang khác).
    """
    # Convert PIL Image → JPEG bytes để Gemini SDK chấp nhận
    buf = io.BytesIO()
    image.save(buf, format="JPEG", quality=85)
    image_bytes = buf.getvalue()

    prompt = """
    Hãy đóng vai một chuyên gia bóc tách dữ liệu. Nhiệm vụ của bạn là trích xuất toàn bộ nội dung trong bức ảnh (trang tài liệu) này sang định dạng Markdown.

    Yêu cầu bắt buộc:
    1. Giữ nguyên cấu trúc các cột, đoạn văn.
    2. Biểu diễn bảng biểu bằng Markdown table (| Header | Header |).
    3. Trích xuất chính xác các công thức toán học, ký hiệu đặc biệt.
    4. Không bỏ sót bất kỳ chữ nào, không bịa thêm nội dung.
    5. Chỉ trả về nội dung Markdown, không thêm lời chào hay giải thích gì thêm.
    """
    RETRYABLE = ("429", "503", "quota", "rate", "unavailable", "overloaded")

    for attempt in range(1, 4):  # tối đa 3 lần
        try:
            response = await client.aio.models.generate_content(
                model="gemini-2.5-flash",
                contents=[
                    types.Part.from_bytes(data=image_bytes, mime_type="image/jpeg"),
                    prompt,
                ],
                config=types.GenerateContentConfig(temperature=0.0),
            )
            return response.text.strip()
        except Exception as e:
            err = str(e).lower()
            logger.error(f"Lỗi Gemini Vision trang {page_num} (lần {attempt}): {type(e).__name__}: {e}")
            if attempt < 3 and any(k in err for k in RETRYABLE):
                wait = 10 * attempt  # 10s, 20s
                logger.warning(f"Thử lại trang {page_num} sau {wait}s...")
                await asyncio.sleep(wait)
            else:
                break
    return ""


async def _parse_with_vision(file_bytes: bytes) -> List[Dict]:
    """
    Parse toàn bộ PDF bằng Gemini Vision (fallback cho scanned/garbled PDF).
    Các trang được xử lý song song, giới hạn MAX_CONCURRENT trang cùng lúc
    để tránh rate limit free tier.
    """
    images = await asyncio.to_thread(_convert_pdf_to_images, file_bytes)
    total_pages = len(images)
    logger.info(f"Vision mode: {total_pages} trang, bắt đầu gọi Gemini (song song)...")

    # Free tier: ~10 RPM → giới hạn 3 trang song song là an toàn
    MAX_CONCURRENT = 3
    semaphore = asyncio.Semaphore(MAX_CONCURRENT)

    async def _process_page(i: int, img) -> dict | None:
        async with semaphore:
            logger.info(f"Vision: trang {i}/{total_pages}...")
            content = await _extract_text_from_image(img, i)
            if content:
                return {"page_number": i, "content": content}
            logger.warning(f"Vision: trang {i} không trích xuất được nội dung.")
            return None

    tasks = [_process_page(i, img) for i, img in enumerate(images, start=1)]
    results = await asyncio.gather(*tasks)

    pages = [r for r in results if r is not None]
    pages.sort(key=lambda p: p["page_number"])  # giữ đúng thứ tự trang

    failed = total_pages - len(pages)
    if failed:
        logger.warning(f"Vision: {failed} trang lỗi.")

    return pages


# ─────────────────────────────────────────────
# Hàm public — entry point duy nhất
# ─────────────────────────────────────────────

async def parse_pdf(file_bytes: bytes) -> List[Dict]:
    """
    Parse PDF theo chiến lược text-first:

    1. Đọc text trực tiếp bằng PyMuPDF (0 API call).
    2. Kiểm tra chất lượng text (avg word length).
       - Đạt ngưỡng  → trả về luôn, không gọi Gemini.
       - Không đạt   → PDF bị scan hoặc font lỗi → fallback Vision.
    3. Fallback Vision: gọi Gemini 1 lần/trang.

    Args:
        file_bytes: Nội dung file PDF dạng bytes.

    Returns:
        List[{"page_number": int, "content": str}]
        Chỉ chứa các trang có nội dung (bỏ trang rỗng).

    Raises:
        ValueError:   Không thể mở file PDF.
        RuntimeError: Không trích xuất được nội dung nào sau cả 2 bước.
    """
    # ── Bước 1: Thử đọc text trực tiếp ──
    try:
        all_pages = await asyncio.to_thread(_extract_text_direct, file_bytes)
    except Exception as e:
        logger.error(f"Không thể mở PDF: {e}")
        raise ValueError(f"Không thể đọc file PDF: {e}") from e

    total_pages = len(all_pages)
    non_empty_pages = [p for p in all_pages if p["content"]]

    logger.info(
        f"Direct extract: {len(non_empty_pages)}/{total_pages} trang có text."
    )

    # ── Bước 2: Kiểm tra chất lượng ──
    if _is_text_readable(non_empty_pages):
        logger.info(
            f"Text-first thành công: {len(non_empty_pages)} trang, 0 API call."
        )
        return non_empty_pages

    # ── Bước 3: Fallback Vision ──
    logger.info("Chuyển sang Vision mode...")
    pages = await _parse_with_vision(file_bytes)

    non_empty = sum(1 for p in pages if p["content"])
    logger.info(
        f"Parse hoàn tất (Vision): {non_empty}/{total_pages} trang có nội dung."
    )

    if non_empty == 0:
        raise RuntimeError("PARSE_FAILED: Không trích xuất được nội dung nào từ PDF.")

    return pages