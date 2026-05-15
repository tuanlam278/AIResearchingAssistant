"""
BE1 implement: Text chunking
Input:  list of pages từ pdf_parser
Output: list of { content: str, page: int }
"""
from typing import List, Dict
from app.config import settings


def chunk_text(pages: List[Dict]) -> List[Dict]:
    """
    Chia text thành các chunk nhỏ với overlap.
    Giữ nguyên metadata trang.

    Returns:
        [{"content": "...", "page": 2}, ...]
    """
    chunks = []
    chunk_size = settings.CHUNK_SIZE
    overlap = settings.CHUNK_OVERLAP

    for page_data in pages:
        text = page_data["text"]
        page_num = page_data["page"]

        # Split theo từ để không cắt giữa từ
        words = text.split()

        start = 0
        while start < len(words):
            end = start + chunk_size
            chunk_words = words[start:end]
            chunk_content = " ".join(chunk_words).strip()

            if chunk_content:
                chunks.append({
                    "content": chunk_content,
                    "page": page_num,
                })

            # Di chuyển với overlap
            start += chunk_size - overlap

    return chunks
