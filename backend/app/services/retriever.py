"""
BE2 implement: Vector search trong Supabase
"""
from app.db.supabase_client import supabase
from app.config import settings
from typing import List


async def retrieve_chunks(query_vector: List[float], doc_id: str) -> List[dict]:
    """
    Tìm top-k chunks liên quan nhất với câu hỏi.

    Returns:
        [{"id": "...", "content": "...", "page_number": 3, "similarity": 0.92}, ...]
    """
    result = supabase.rpc(
        "match_chunks",
        {
            "query_embedding": query_vector,
            "target_doc_id": doc_id,
            "match_count": settings.TOP_K_CHUNKS,
        }
    ).execute()

    return result.data or []
