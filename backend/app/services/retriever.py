"""
Service thực hiện truy vấn Vector Search trên Supabase (pgvector).

Module này chịu trách nhiệm giao tiếp với hàm RPC trên Supabase để tìm kiếm
các đoạn văn bản (chunks) có độ tương đồng cosine cao nhất với câu hỏi của người dùng.
RPC `match_chunks` trả về `similarity`: điểm càng cao càng liên quan.
"""

import asyncio
import logging
from dataclasses import dataclass
from typing import List

from app.config import settings
from app.db.supabase_client import supabase

logger = logging.getLogger(__name__)


OUT_OF_SCOPE_WARNING = "Nội dung câu hỏi của bạn đi xa ra khỏi mức của tài liệu, nên nội dung sau có thể đúng hoặc sai."


@dataclass
class RetrievalResult:
    chunks: List[dict]
    top_score: float | None
    is_out_of_scope: bool


def _chunk_has_text(chunk: dict) -> bool:
    return bool((chunk.get("content") or "").strip())


def analyze_retrieval_scope(chunks: List[dict], threshold: float | None = None) -> RetrievalResult:
    """Classify RAG relevance from Supabase similarity scores.

    `match_chunks` exposes cosine similarity where higher is better, so questions are
    out-of-scope when no usable chunks are returned or the top similarity is below
    `RAG_RELEVANCE_THRESHOLD`.
    """
    threshold = settings.RAG_RELEVANCE_THRESHOLD if threshold is None else threshold
    usable_chunks = [chunk for chunk in chunks if _chunk_has_text(chunk)]
    scores = [float(chunk["similarity"]) for chunk in usable_chunks if chunk.get("similarity") is not None]
    top_score = max(scores) if scores else None
    is_out_of_scope = not usable_chunks or (top_score is not None and top_score < threshold)
    if top_score is None and usable_chunks:
        is_out_of_scope = False
    return RetrievalResult(chunks=usable_chunks, top_score=top_score, is_out_of_scope=is_out_of_scope)


async def retrieve_chunks(
    query_vector: List[float],
    notebook_id: str,
    document_ids: List[str] | None = None,
    *,
    match_threshold: float | None = None,
    match_count_multiplier: int | None = None,
) -> List[dict]:
    """
    Tìm kiếm top-K chunks liên quan nhất với vector câu hỏi của người dùng.

    RPC `match_chunks` trả về `similarity` (cao hơn là liên quan hơn). `match_threshold`
    cho phép gọi fallback ngưỡng thấp để vẫn lấy ngữ cảnh khi câu hỏi đi xa tài liệu.
    """
    if not query_vector:
        raise ValueError("query_vector không được rỗng.")
    if not notebook_id:
        raise ValueError("notebook_id không được rỗng.")

    def _call() -> List[dict]:
        vector_str = "[" + ",".join(map(str, query_vector)) + "]"
        threshold = settings.MIN_SIMILARITY if match_threshold is None else match_threshold
        multiplier = match_count_multiplier or (4 if document_ids else 1)

        try:
            result = supabase.rpc(
                "match_chunks",
                {
                    "query_embedding": vector_str,
                    "target_notebook_id": notebook_id,
                    "match_count": settings.TOP_K_CHUNKS * multiplier,
                    "match_threshold": threshold,
                },
            ).execute()
        except Exception as e:
            logger.error("Supabase RPC 'match_chunks' thất bại: %s", e)
            raise RuntimeError(f"RETRIEVAL_FAILED: {e}") from e

        chunks = result.data or []
        if document_ids:
            allowed_ids = {str(doc_id) for doc_id in document_ids}
            chunks = [chunk for chunk in chunks if str(chunk.get("doc_id")) in allowed_ids]

        if not chunks:
            logger.warning(
                "Không có chunk nào vượt ngưỡng %s (notebook_id=%s).",
                threshold,
                notebook_id,
            )
        else:
            logger.info("Retrieval: Tìm thấy %s chunks liên quan (notebook_id=%s).", len(chunks), notebook_id)

        return chunks[: settings.TOP_K_CHUNKS]

    return await asyncio.to_thread(_call)


async def load_selected_document_context(notebook_id: str, document_ids: List[str], limit: int | None = None) -> List[dict]:
    """Fallback context strictly scoped to selected documents when vector RPC returns none."""
    if not notebook_id or not document_ids:
        return []

    def _call() -> List[dict]:
        try:
            result = (
                supabase.table("document_chunks")
                .select("id, doc_id, section, content, page_number, chunk_index")
                .eq("notebook_id", notebook_id)
                .in_("doc_id", [str(doc_id) for doc_id in document_ids])
                .order("chunk_index", desc=False)
                .limit(limit or settings.TOP_K_CHUNKS)
                .execute()
            )
        except Exception as e:
            logger.error("Fallback selected document context failed: %s", e)
            raise RuntimeError(f"RETRIEVAL_FAILED: {e}") from e
        return result.data or []

    return await asyncio.to_thread(_call)


async def retrieve_rag_context(query_vector: List[float], notebook_id: str, document_ids: List[str] | None = None) -> RetrievalResult:
    """Retrieve selected-document context and classify out-of-scope without blocking.

    First uses the production `MIN_SIMILARITY` threshold. If that returns no chunks,
    it retries with threshold 0 to obtain the nearest selected-document snippets so
    the answer can still be generated with a warning instead of failing the request.
    """
    chunks = await retrieve_chunks(query_vector, notebook_id, document_ids)
    if not chunks:
        chunks = await retrieve_chunks(
            query_vector,
            notebook_id,
            document_ids,
            match_threshold=0,
            match_count_multiplier=8 if document_ids else 2,
        )
    result = analyze_retrieval_scope(chunks)
    if not result.chunks and document_ids:
        fallback_chunks = await load_selected_document_context(notebook_id, document_ids, settings.TOP_K_CHUNKS)
        return RetrievalResult(chunks=[chunk for chunk in fallback_chunks if _chunk_has_text(chunk)], top_score=None, is_out_of_scope=True)
    return result
