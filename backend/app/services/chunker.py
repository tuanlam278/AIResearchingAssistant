# app/services/chunker.py

import logging
from typing import Any, Dict, List

import tiktoken
from langchain_text_splitters import RecursiveCharacterTextSplitter

logger = logging.getLogger(__name__)

# Chunking configuration
CHUNK_SIZE = 500      # token (khớp với architecture.md)
CHUNK_OVERLAP = 50    # token

# cl100k_base là tokenizer của GPT-4 / text-embedding-ada — phổ biến,
# bám sát số token thực tế hơn so với đếm ký tự
_tokenizer = tiktoken.get_encoding("cl100k_base")


def _count_tokens(text: str) -> int:
    """Đếm số token của một chuỗi văn bản."""
    return len(_tokenizer.encode(text))


def chunk_text(pages: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Chia các trang PDF đã parse thành các chunk theo token.

    Chunking strategy:
    - chunk_size    = 500 tokens  (~1–2 đoạn văn học thuật)
    - chunk_overlap = 50  tokens  (giữ context tại ranh giới chunk)
    - length_function đếm token thật sự, không đếm ký tự

    Input format:
        [
            {"page_number": int, "content": str},
            ...
        ]

    Output format:
        [
            {"chunk_index": int, "page_number": int, "content": str},
            ...
        ]

    Notes:
    - chunk_index là global xuyên suốt toàn bộ tài liệu
    - page_number được giữ nguyên cho mỗi chunk
    - Trang rỗng và chunk chỉ có whitespace bị bỏ qua

    Args:
        pages: Danh sách trang đã parse từ pdf_parser.

    Returns:
        Danh sách chunk phẳng.
    """
    if not pages:
        logger.warning("chunk_text nhận danh sách pages rỗng.")
        return []

    splitter = RecursiveCharacterTextSplitter(
        chunk_size=CHUNK_SIZE,
        chunk_overlap=CHUNK_OVERLAP,
        length_function=_count_tokens,   # ← đếm token, không đếm ký tự
        separators=["\n\n", "\n", " ", ""],
    )

    chunks: List[Dict[str, Any]] = []
    chunk_index = 0
    skipped_pages = 0

    for page in pages:
        page_number = int(page.get("page_number", 0))
        content = str(page.get("content", "")).strip()

        if not content:
            skipped_pages += 1
            continue

        page_chunks = splitter.split_text(content)

        for chunk in page_chunks:
            cleaned = chunk.strip()
            if not cleaned:
                continue

            chunks.append(
                {
                    "chunk_index": chunk_index,
                    "page_number": page_number,
                    "content": cleaned,
                }
            )
            chunk_index += 1

    logger.info(
        f"Chunking hoàn tất: {len(chunks)} chunks từ {len(pages) - skipped_pages} trang "
        f"({skipped_pages} trang rỗng bị bỏ qua)."
    )

    return chunks