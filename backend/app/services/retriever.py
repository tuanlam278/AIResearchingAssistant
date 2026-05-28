"""
Service thực hiện truy vấn Vector Search trên Supabase (pgvector).

Module này chịu trách nhiệm giao tiếp với hàm RPC trên Supabase để tìm kiếm 
các đoạn văn bản (chunks) có độ tương đồng cosine cao nhất với câu hỏi của người dùng.
Việc lọc theo ngưỡng (threshold) được đẩy thẳng xuống Database để tối ưu hiệu suất.
"""

import asyncio
import logging
from app.db.supabase_client import supabase
from app.config import settings
from typing import List

logger = logging.getLogger(__name__)

async def retrieve_chunks(query_vector: List[float], notebook_id: str) -> List[dict]:
    """
    Tìm kiếm top-K chunks liên quan nhất với vector câu hỏi của người dùng.

    Hàm này gọi RPC `match_chunks` trên Supabase, truyền vào vector câu hỏi, 
    ID của notebook cần tìm kiếm, số lượng kết quả mong muốn (TOP_K_CHUNKS) 
    và ngưỡng tương đồng tối thiểu (MIN_SIMILARITY). 
    
    Database sẽ tự động dùng index HNSW để tìm kiếm và chỉ trả về những chunks 
    vượt qua ngưỡng `MIN_SIMILARITY`.

    Args:
        query_vector (List[float]): Vector embedding của câu hỏi (768 chiều).
        notebook_id (str): UUID của notebook cần tìm kiếm (giới hạn phạm vi search).

    Returns:
        List[dict]: Danh sách các dictionary chứa thông tin chunk thỏa mãn điều kiện.
            Mỗi dict có cấu trúc: 
            {
                "id": str, 
                "section": str, 
                "content": str, 
                "page_number": int, 
                "doc_id": str, 
                "similarity": float
            }
            Trả về list rỗng ([]) nếu không có chunk nào vượt qua ngưỡng.

    Raises:
        ValueError: Nếu `query_vector` hoặc `notebook_id` bị rỗng/None.
        RuntimeError: Nếu lời gọi RPC tới Supabase gặp sự cố (lỗi mạng, lỗi SQL,...).
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
                    "target_notebook_id": notebook_id,
                    "match_count": settings.TOP_K_CHUNKS,
                    "match_threshold": settings.MIN_SIMILARITY
                },
            ).execute()
        except Exception as e:
            logger.error(f"Supabase RPC 'match_chunks' thất bại: {e}")
            raise RuntimeError(f"RETRIEVAL_FAILED: {e}") from e

        chunks = result.data or []

        if not chunks:
            logger.warning(
                f"Không có chunk nào vượt ngưỡng {settings.MIN_SIMILARITY} "
                f"(notebook_id={notebook_id})."
            )
        else:
            logger.info(
                f"Retrieval: Tìm thấy {len(chunks)} chunks liên quan "
                f"(notebook_id={notebook_id})."
            )

        return chunks

    return await asyncio.to_thread(_call)