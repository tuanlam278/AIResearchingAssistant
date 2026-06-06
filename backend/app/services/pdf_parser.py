import asyncio
import io
import logging
from typing import Dict, List

import fitz  # PyMuPDF
from PIL import Image
from google import genai
from google.genai import types

from app.config import settings
from app.services.document_structure_service import (
    DocumentBlock,
    blocks_to_page,
    build_blocks_from_markdown,
    classify_markdown_block,
    normalize_plain_text,
)
from app.services.pdf_table_extractor import extract_tables_with_pdfplumber
from app.services.vision_service import get_vision_model

logger = logging.getLogger(__name__)

client = genai.Client(api_key=settings.GOOGLE_API_KEY) if settings.GOOGLE_API_KEY.strip() else None

# Ngưỡng đánh giá text có đọc được không.
# Text bình thường: avg word length >= 3.0
# Text bị fragment ("T r a n s f o r m e r"): avg word length ~1.0-1.5
MIN_AVG_WORD_LENGTH = 3.0

# Số trang đầu dùng để sample khi kiểm tra chất lượng text
SAMPLE_PAGES = 3


def _bbox_overlap_ratio(a: list[float] | None, b: list[float] | None) -> float:
    if not a or not b or len(a) != 4 or len(b) != 4:
        return 0.0
    ax0, ay0, ax1, ay1 = a
    bx0, by0, bx1, by1 = b
    ix0, iy0 = max(ax0, bx0), max(ay0, by0)
    ix1, iy1 = min(ax1, bx1), min(ay1, by1)
    if ix1 <= ix0 or iy1 <= iy0:
        return 0.0
    inter = (ix1 - ix0) * (iy1 - iy0)
    area = max((ax1 - ax0) * (ay1 - ay0), 1.0)
    return inter / area


def _extract_text_blocks_direct(file_bytes: bytes) -> List[Dict]:
    """Extract page-level Markdown plus structured local blocks with PyMuPDF + pdfplumber tables."""
    table_blocks_by_page = extract_tables_with_pdfplumber(file_bytes)
    doc = fitz.open(stream=file_bytes, filetype="pdf")
    pages: list[dict] = []
    current_section: str | None = None
    try:
        for page_number, page in enumerate(doc, start=1):
            blocks: list[DocumentBlock] = []
            table_blocks = table_blocks_by_page.get(page_number, [])
            table_bboxes = [block.bbox for block in table_blocks if block.bbox]

            for raw in page.get_text("blocks") or []:
                if len(raw) < 5:
                    continue
                x0, y0, x1, y1, text = raw[:5]
                markdown = str(text or "").strip()
                if not markdown:
                    continue
                bbox = [float(x0), float(y0), float(x1), float(y1)]
                if any(_bbox_overlap_ratio(bbox, table_bbox) > 0.35 for table_bbox in table_bboxes):
                    # Prefer table Markdown over duplicated cell text in the same region.
                    continue
                block_type = classify_markdown_block(markdown)
                if block_type == "heading":
                    current_section = markdown.lstrip("#").strip()[:180]
                blocks.append(
                    DocumentBlock(
                        page=page_number,
                        block_index=0,
                        block_type=block_type,
                        section=current_section,
                        markdown=markdown,
                        text=normalize_plain_text(markdown),
                        bbox=bbox,
                        confidence=None,
                        source="pymupdf",
                    )
                )

            for table_block in table_blocks:
                table_block.section = current_section
                blocks.append(table_block)

            # Sort approximately by reading order. Bbox-less blocks go last.
            blocks.sort(key=lambda block: ((block.bbox or [10**9, 10**9, 10**9, 10**9])[1], (block.bbox or [10**9, 10**9, 10**9, 10**9])[0]))
            for block_index, block in enumerate(blocks):
                block.block_index = block_index
            if blocks:
                current_section = blocks[-1].section
            pages.append(blocks_to_page(page_number, blocks))
    finally:
        doc.close()
    return pages


def _extract_text_direct(file_bytes: bytes) -> List[Dict]:
    """
    Đọc text trực tiếp từ PDF bằng PyMuPDF + bảng local bằng pdfplumber.
    Không tốn API call nào. Trả về list pages kể cả trang rỗng.
    """
    return _extract_text_blocks_direct(file_bytes)


def _is_text_readable(pages: List[Dict]) -> bool:
    sample = [p for p in pages[:SAMPLE_PAGES] if p.get("content")]
    if not sample:
        return False

    all_words = []
    for page in sample:
        all_words.extend(str(page.get("plain_text") or page.get("content") or "").split())

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


OCR_MARKDOWN_PROMPT = """
Bạn là engine OCR học thuật. Nhiệm vụ duy nhất: trích xuất nguyên văn nội dung trong ảnh/trang tài liệu sang Markdown học thuật chuẩn.

Yêu cầu bắt buộc:
1. Chỉ trả về nội dung Markdown của tài liệu, không thêm lời chào, diễn giải, tóm tắt hay nhận xét ngoài nội dung gốc.
2. Giữ heading/section/subsection nếu thấy trong trang. Dùng Markdown heading (`#`, `##`, `###`) khi phù hợp.
3. Bảng phải là Markdown table hợp lệ: có hàng header, hàng separator `| --- | --- |`, và các hàng dữ liệu. Không trả bảng dạng text rời nếu có thể parse thành bảng.
4. Nếu không xác định được header bảng, dùng header generic: `Column 1`, `Column 2`, ... Không bịa tên cột.
5. Công thức inline phải dùng LaTeX trong `$...$`.
6. Công thức block/multiline phải dùng đúng dạng:
$$
...
$$
7. Giữ ký hiệu toán học, chỉ số trên/dưới, ma trận, phân số và equation number nếu đọc được. Không fake LaTeX khi không đọc được; đánh dấu `[uncertain]` ngay cạnh phần không chắc.
8. Figure/table caption phải được giữ nguyên. Nếu hình không đọc được nội dung, chỉ trích caption nhìn thấy, không mô tả thêm.
9. Không bỏ sót chữ nhìn thấy; không bịa thêm nội dung.
"""


async def _extract_text_from_image(image: Image.Image, page_num: int) -> str:
    """
    Gọi Gemini Vision để trích xuất text từ một trang ảnh.
    Trả về chuỗi rỗng nếu lỗi (không raise để tiếp tục các trang khác).
    """
    # Convert PIL Image → JPEG bytes để Gemini SDK chấp nhận
    buf = io.BytesIO()
    image.save(buf, format="JPEG", quality=85)
    image_bytes = buf.getvalue()

    if client is None:
        logger.warning("GOOGLE_API_KEY is not configured; scanned-PDF Vision OCR fallback is unavailable.")
        return ""

    RETRYABLE = ("429", "503", "quota", "rate", "unavailable", "overloaded")

    for attempt in range(1, 4):  # tối đa 3 lần
        try:
            response = await client.aio.models.generate_content(
                model=get_vision_model(),
                contents=[
                    types.Part.from_bytes(data=image_bytes, mime_type="image/jpeg"),
                    OCR_MARKDOWN_PROMPT,
                ],
                config=types.GenerateContentConfig(temperature=0.0),
            )
            return (response.text or "").strip()
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
                blocks = build_blocks_from_markdown(i, content, source="vision")
                return blocks_to_page(i, blocks)
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
    Parse PDF theo chiến lược cost-safe:

    1. Đọc text trực tiếp bằng PyMuPDF và bảng text-native bằng pdfplumber (0 API call).
    2. Kiểm tra chất lượng text.
       - Đạt ngưỡng  → trả về structured Markdown, không gọi Gemini.
       - Không đạt   → chỉ fallback Vision nếu ENABLE_PDF_VISION_FALLBACK=true và Vision đã cấu hình.
    3. Fallback Vision khi được bật: gọi Gemini 1 lần/trang.
    """
    # ── Bước 1: Thử đọc text trực tiếp ──
    try:
        all_pages = await asyncio.to_thread(_extract_text_direct, file_bytes)
    except Exception as e:
        logger.error(f"Không thể mở PDF: {e}")
        raise ValueError(f"Không thể đọc file PDF: {e}") from e

    total_pages = len(all_pages)
    non_empty_pages = [p for p in all_pages if p.get("content")]

    logger.info(
        f"Direct extract: {len(non_empty_pages)}/{total_pages} trang có text/Markdown."
    )

    # ── Bước 2: Kiểm tra chất lượng ──
    if _is_text_readable(non_empty_pages):
        logger.info(
            f"Text/table-first thành công: {len(non_empty_pages)} trang, 0 API call."
        )
        return non_empty_pages

    # ── Bước 3: Fallback Vision chỉ khi bật rõ ràng ──
    if not getattr(settings, "ENABLE_PDF_VISION_FALLBACK", False):
        logger.info("PDF Vision fallback is disabled; returning local extraction only.")
        if non_empty_pages:
            return non_empty_pages
        raise RuntimeError("PARSE_FAILED: Không trích xuất được nội dung local từ PDF và Vision fallback đang tắt.")

    logger.info("Chuyển sang Vision mode vì ENABLE_PDF_VISION_FALLBACK=true...")
    pages = await _parse_with_vision(file_bytes)

    non_empty = sum(1 for p in pages if p.get("content"))
    logger.info(
        f"Parse hoàn tất (Vision): {non_empty}/{total_pages} trang có nội dung."
    )

    if non_empty == 0:
        raise RuntimeError("PARSE_FAILED: Không trích xuất được nội dung nào từ PDF.")

    return pages
