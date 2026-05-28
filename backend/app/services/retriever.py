"""
Vector search trong Supabase pgvector.
"""
import asyncio
import logging
from app.db.supabase_client import supabase
from app.config import settings
from typing import List

logger = logging.getLogger(__name__)

MIN_SIMILARITY = getattr(settings, "MIN_SIMILARITY", 0.5)


async def retrieve_chunks(query_vector: List[float], notebook_id: str) -> List[dict]:
    """
    Tìm top-k chunks liên quan nhất với câu hỏi bằng cosine similarity.

    - Tìm trên toàn bộ documents trong notebook (không giới hạn 1 file)
    - Lọc bỏ chunk có similarity < MIN_SIMILARITY
    - Kết quả sắp xếp từ liên quan nhất đến ít nhất

    Args:
        query_vector: Embedding vector của câu hỏi (768 chiều).
        notebook_id:  UUID của notebook cần tìm kiếm.

    Returns:
        [{"id": str, "content": str, "page_number": int, "doc_id": str, "similarity": float}, ...]
        Trả về list rỗng nếu không tìm thấy chunk nào vượt ngưỡng.

    Raises:
        RuntimeError: Khi Supabase RPC thất bại.
    """
    if not query_vector:
        raise ValueError("query_vector không được rỗng.")
    if not notebook_id:
        raise ValueError("notebook_id không được rỗng.")

    def _call() -> List[dict]:
        vector_str = "[" + ",".join(map(str, query_vector)) + "]"

        try:
            result = supabase.rpc(
                "match_chunks",
                {
                    "query_embedding": vector_str,
                    "target_notebook_id": notebook_id,   # ← đổi từ target_doc_id
                    "match_count": settings.TOP_K_CHUNKS,
                },
            ).execute()
        except Exception as e:
            logger.error(f"Supabase RPC 'match_chunks' thất bại: {e}")
            raise RuntimeError(f"RETRIEVAL_FAILED: {e}") from e

        raw_chunks = result.data or []

        filtered = [c for c in raw_chunks if c.get("similarity", 0) >= MIN_SIMILARITY]

        if not filtered:
            logger.warning(
                f"Không có chunk nào vượt ngưỡng similarity {MIN_SIMILARITY} "
                f"(notebook_id={notebook_id}, tổng trả về={len(raw_chunks)})."
            )
        else:
            logger.info(
                f"Retrieval: {len(filtered)}/{len(raw_chunks)} chunks vượt ngưỡng "
                f"similarity {MIN_SIMILARITY} (notebook_id={notebook_id})."
            )

        return filtered

    return await asyncio.to_thread(_call)