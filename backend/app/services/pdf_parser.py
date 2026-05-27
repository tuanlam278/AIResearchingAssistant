# app/services/pdf_parser.py

import asyncio
import io
import logging
import re
from typing import Dict, List

import pdfplumber

logger = logging.getLogger(__name__)


def _clean_text(text: str) -> str:
    """
    Làm sạch text trích xuất từ PDF.

    - Chuẩn hóa dấu gạch nối xuống dòng: "infor-\\nmation" → "information"
    - Gộp nhiều dòng trống liên tiếp thành một
    - Strip khoảng trắng thừa đầu/cuối
    """
    # Nối từ bị ngắt dòng bởi dấu gạch nối (hyphenation)
    text = re.sub(r"-\n(\w)", r"\1", text)
    # Gộp nhiều dòng trắng liên tiếp thành một dòng trắng
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def _parse_sync(file_bytes: bytes) -> List[Dict]:
    """
    Parse PDF đồng bộ — chạy trong thread riêng qua asyncio.to_thread.

    Args:
        file_bytes: Raw bytes của file PDF.

    Returns:
        [{"page_number": int, "content": str}, ...]
        Page number bắt đầu từ 1.

    Raises:
        ValueError:  Khi file không phải PDF hợp lệ.
        RuntimeError: Khi không trích xuất được bất kỳ nội dung nào.
    """
    pages: List[Dict] = []
    failed_pages: List[int] = []

    try:
        pdf = pdfplumber.open(io.BytesIO(file_bytes))
    except Exception as e:
        raise ValueError(f"Không thể mở file PDF: {e}") from e

    with pdf:
        total_pages = len(pdf.pages)
        logger.info(f"Bắt đầu parse PDF: {total_pages} trang.")

        for i, page in enumerate(pdf.pages, start=1):
            try:
                raw_text = page.extract_text() or ""
                content = _clean_text(raw_text)
            except Exception as e:
                logger.warning(f"Không thể trích xuất trang {i}: {e}")
                content = ""
                failed_pages.append(i)

            pages.append({"page_number": i, "content": content})

    # Báo cáo kết quả parse
    non_empty = sum(1 for p in pages if p["content"])
    logger.info(
        f"Parse hoàn tất: {non_empty}/{total_pages} trang có nội dung"
        + (f", {len(failed_pages)} trang lỗi: {failed_pages}." if failed_pages else ".")
    )

    if non_empty == 0:
        raise RuntimeError("PARSE_FAILED: PDF không trích xuất được nội dung nào (có thể là PDF scan).")

    return pages


async def parse_pdf(file_bytes: bytes) -> List[Dict]:
    """
    Parse PDF bất đồng bộ, không block event loop.

    pdfplumber là blocking I/O — wrap trong asyncio.to_thread
    để FastAPI tiếp tục xử lý các request khác trong lúc parse.

    Args:
        file_bytes: Raw bytes của file PDF.

    Returns:
        [{"page_number": int, "content": str}, ...]

    Raises:
        ValueError:   File không phải PDF hợp lệ.
        RuntimeError: PDF không có nội dung (PDF scan).
    """
    return await asyncio.to_thread(_parse_sync, file_bytes)