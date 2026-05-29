# app/services/chunker.py

import logging
import re
from typing import Any, Dict, List

import tiktoken
from langchain_text_splitters import RecursiveCharacterTextSplitter

logger = logging.getLogger(__name__)

# Chunking configuration
CHUNK_SIZE = 500        # token (~1–2 đoạn văn học thuật)
CHUNK_OVERLAP = 50      # token (giữ context tại ranh giới chunk)

# Chunk ngắn hơn ngưỡng này thường là header, page number, caption lẻ...
# → nhiễu khi vector search, bỏ qua luôn
MIN_CHUNK_TOKENS = 30

# cl100k_base là tokenizer của GPT-4 — phổ biến, bám sát số token thực tế
# hơn đếm ký tự. Gemini dùng tokenizer riêng nên có thể lệch ~5-10%,
# nhưng không ảnh hưởng đáng kể đến chất lượng chunking.
try:
    _tokenizer = tiktoken.get_encoding("cl100k_base")
except Exception as exc:  # pragma: no cover - offline startup fallback
    logger.warning("Falling back to simple token counting because tiktoken encoding is unavailable: %s", exc)

    class _SimpleTokenizer:
        def encode(self, text: str) -> list[str]:
            return (text or "").split()

    _tokenizer = _SimpleTokenizer()

# Regex nhận diện các section học thuật phổ biến
# Hỗ trợ cả định dạng số hoặc chữ số La Mã đứng trước (e.g., "1. Introduction", "I. RELATED WORK")
ACADEMIC_SECTIONS_REGEX = (
    r'^(?:[0-9]+\.|[IVX]+\.)?\s*'
    r'(Abstract|Introduction|Related\s+Work|Literature\s+Review|Methodology|'
    r'Proposed\s+(?:Method|Architecture|System)|Experiments|Evaluation|'
    r'Results|Discussion|Conclusion|References)\b'
)


def _count_tokens(text: str) -> int:
    """Đếm số token của một chuỗi văn bản."""
    return len(_tokenizer.encode(text))


def chunk_text(pages: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Chia các trang PDF đã parse thành các chunk theo giới hạn token và bóc tách metadata Section.

    Hàm này thực hiện chia nhỏ văn bản bằng RecursiveCharacterTextSplitter,
    đồng thời quét qua các đoạn văn bản để theo dõi xem người dùng đang ở phần nào của 
    tài liệu học thuật (Abstract, Introduction, Methodology, v.v.) dựa trên Regex.

    Chunking strategy:
    - chunk_size     = 500 tokens  (~1–2 đoạn văn học thuật)
    - chunk_overlap  = 50  tokens  (giữ context tại ranh giới chunk)
    - min_chunk_size = 30  tokens  (bỏ chunk quá ngắn: header, page number...)
    - length_function: đếm token thật sự bằng tiktoken cl100k_base, không đếm ký tự.

    Args:
        pages (List[Dict[str, Any]]): Danh sách các trang đã được trích xuất từ PDF.
            Mỗi phần tử có cấu trúc: {"page_number": int, "content": str}

    Returns:
        List[Dict[str, Any]]: Danh sách các chunk đã được làm phẳng, sẵn sàng để embedding.
            Mỗi chunk có cấu trúc:
            {
                "chunk_index": int,     # Số thứ tự global của chunk trong toàn bộ tài liệu
                "page_number": int,     # Trang gốc chứa chunk này
                "section": str,         # Tên phần của tài liệu (ví dụ: 'Introduction')
                "content": str          # Nội dung text đã được dọn dẹp
            }

    Notes:
        - Các trang rỗng, hoặc chunk chỉ chứa khoảng trắng, hoặc chunk có độ dài 
          nhỏ hơn MIN_CHUNK_TOKENS sẽ tự động bị bỏ qua để giảm nhiễu cho Vector DB.
    """
    if not pages:
        logger.warning("chunk_text nhận danh sách pages rỗng.")
        return []

    splitter = RecursiveCharacterTextSplitter(
        chunk_size=CHUNK_SIZE,
        chunk_overlap=CHUNK_OVERLAP,
        length_function=_count_tokens,
        separators=["\n\n", "\n", " ", ""],
    )

    chunks: List[Dict[str, Any]] = []
    chunk_index = 0
    skipped_pages = 0
    skipped_short = 0
    
    # Khởi tạo trạng thái ban đầu khi chưa nhận diện được section nào
    current_section = "Abstract/Pre-introduction" 

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

            if _count_tokens(cleaned) < MIN_CHUNK_TOKENS:
                skipped_short += 1
                continue

            # Bóc tách 2 dòng đầu tiên của chunk để kiểm tra xem có Section Header mới không
            lines = [line.strip() for line in cleaned.split('\n') if line.strip()]
            for line in lines[:2]:
                match = re.match(ACADEMIC_SECTIONS_REGEX, line, re.IGNORECASE)
                if match:
                    # Chuẩn hóa format chữ (Ví dụ: INTRODUCTION -> Introduction)
                    current_section = match.group(1).title()
                    break # Phát hiện rồi thì không cần check dòng tiếp theo nữa

            chunks.append(
                {
                    "chunk_index": chunk_index,
                    "page_number": page_number,
                    "section": current_section,
                    "content": cleaned,
                }
            )
            chunk_index += 1

    logger.info(
        f"Chunking hoàn tất: {len(chunks)} chunks từ {len(pages) - skipped_pages} trang. "
        f"Cấu trúc tài liệu đã được bóc tách."
    )

    return chunks