"""
BE1 implement: PDF parsing
Input:  raw bytes của PDF file
Output: list of { page: int, text: str }
"""
import pdfplumber
import io
from typing import List, Dict


def parse_pdf(file_bytes: bytes) -> List[Dict]:
    """
    Parse PDF và trả về list các trang với nội dung text.

    Returns:
        [{"page": 1, "text": "..."}, {"page": 2, "text": "..."}, ...]
    """
    pages = []
    with pdfplumber.open(io.BytesIO(file_bytes)) as pdf:
        for i, page in enumerate(pdf.pages, start=1):
            text = page.extract_text()
            if text and text.strip():
                pages.append({
                    "page": i,
                    "text": text.strip()
                })
    return pages
