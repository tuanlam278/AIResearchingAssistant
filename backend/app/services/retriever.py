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
from app.services.observability import emit_metric

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
        multiplier = match_count_multiplier or max(1, int(getattr(settings, "RAG_CANDIDATE_MULTIPLIER", 4) or 4))

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

        return chunks

    return await asyncio.to_thread(_call)



def _chunk_identity(chunk: dict) -> str:
    return str(chunk.get("id") or f"{chunk.get('doc_id')}:{chunk.get('chunk_index')}:{chunk.get('page_number')}")


def _rank_hierarchical_candidates(chunks: List[dict], max_count: int | None = None) -> List[dict]:
    """Diversify vector candidates across documents/sections before final prompt packing."""
    if not chunks:
        return []
    max_count = max_count or max(settings.TOP_K_CHUNKS, int(getattr(settings, "RAG_MAX_CONTEXT_CHUNKS", settings.TOP_K_CHUNKS) or settings.TOP_K_CHUNKS))
    sorted_chunks = sorted(chunks, key=lambda row: float(row.get("similarity") or 0), reverse=True)
    selected: list[dict] = []
    seen: set[str] = set()
    doc_counts: dict[str, int] = {}
    section_counts: dict[tuple[str, str], int] = {}

    # Pass 1: keep broad coverage across docs/sections for long notebooks.
    for chunk in sorted_chunks:
        identity = _chunk_identity(chunk)
        if identity in seen:
            continue
        doc_id = str(chunk.get("doc_id") or "")
        section = str(chunk.get("section") or "Unknown")
        if doc_counts.get(doc_id, 0) >= 3 and len(selected) < max_count // 2:
            continue
        if section_counts.get((doc_id, section), 0) >= 2 and len(selected) < max_count // 2:
            continue
        selected.append(chunk)
        seen.add(identity)
        doc_counts[doc_id] = doc_counts.get(doc_id, 0) + 1
        section_counts[(doc_id, section)] = section_counts.get((doc_id, section), 0) + 1
        if len(selected) >= max_count:
            return selected

    # Pass 2: fill remaining slots by raw similarity.
    for chunk in sorted_chunks:
        identity = _chunk_identity(chunk)
        if identity in seen:
            continue
        selected.append(chunk)
        seen.add(identity)
        if len(selected) >= max_count:
            break
    return selected


async def _load_neighbor_chunks(notebook_id: str, seeds: List[dict], max_extra: int) -> List[dict]:
    """Load adjacent chunks for local continuity after high-level vector selection."""
    if not notebook_id or not seeds or max_extra <= 0 or not getattr(settings, "RAG_ENABLE_NEIGHBOR_CONTEXT", True):
        return []

    async def _load_for_seed(seed: dict) -> list[dict]:
        doc_id = seed.get("doc_id")
        chunk_index = seed.get("chunk_index")
        if doc_id is None or chunk_index is None:
            return []
        try:
            index = int(chunk_index)
        except (TypeError, ValueError):
            return []

        def _call() -> list[dict]:
            try:
                result = (
                    supabase.table("document_chunks")
                    .select("id, doc_id, section, content, page_number, chunk_index")
                    .eq("notebook_id", notebook_id)
                    .eq("doc_id", str(doc_id))
                    .gte("chunk_index", max(0, index - 1))
                    .lte("chunk_index", index + 1)
                    .order("chunk_index", desc=False)
                    .execute()
                )
                return result.data or []
            except Exception as exc:
                logger.info("Could not load neighbor chunks for doc=%s index=%s: %s", doc_id, index, exc)
                return []

        return await asyncio.to_thread(_call)

    groups = await asyncio.gather(*(_load_for_seed(seed) for seed in seeds[: settings.TOP_K_CHUNKS]))
    neighbors = [chunk for group in groups for chunk in group]
    ranked_seed_by_identity = {_chunk_identity(seed): seed for seed in seeds}
    extras: list[dict] = []
    seen = set(ranked_seed_by_identity)
    for chunk in neighbors:
        identity = _chunk_identity(chunk)
        if identity in seen:
            continue
        # Neighbor chunks do not have vector similarity; inherit a small score so citations remain sorted after seeds.
        seed = ranked_seed_by_identity.get(identity)
        if seed and seed.get("similarity") is not None:
            chunk["similarity"] = seed.get("similarity")
        extras.append(chunk)
        seen.add(identity)
        if len(extras) >= max_extra:
            break
    return extras


async def build_hierarchical_context(chunks: List[dict], notebook_id: str) -> List[dict]:
    """Build final prompt context using vector ranking, section diversity, and adjacent continuity."""
    max_context = max(settings.TOP_K_CHUNKS, int(getattr(settings, "RAG_MAX_CONTEXT_CHUNKS", settings.TOP_K_CHUNKS) or settings.TOP_K_CHUNKS))
    ranked = _rank_hierarchical_candidates(chunks, max_context)
    if len(ranked) >= max_context:
        return ranked[:max_context]
    extras = await _load_neighbor_chunks(notebook_id, ranked, max_context - len(ranked))
    combined: list[dict] = []
    seen: set[str] = set()
    for chunk in [*ranked, *extras]:
        identity = _chunk_identity(chunk)
        if identity in seen or not _chunk_has_text(chunk):
            continue
        combined.append(chunk)
        seen.add(identity)
        if len(combined) >= max_context:
            break
    return combined


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


async def retrieve_rag_context(query_vector: List[float], notebook_id: str, document_ids: List[str] | None = None, citation_threshold: float | None = 0) -> RetrievalResult:
    """Retrieve selected-document context and classify out-of-scope without blocking.

    First uses the production `MIN_SIMILARITY` threshold. If that returns no chunks,
    it retries with threshold 0 to obtain the nearest selected-document snippets so
    the answer can still be generated with a warning instead of failing the request.
    """
    threshold = 0 if citation_threshold is None else citation_threshold
    chunks = await retrieve_chunks(query_vector, notebook_id, document_ids, match_threshold=threshold)
    if not chunks:
        chunks = await retrieve_chunks(
            query_vector,
            notebook_id,
            document_ids,
            match_threshold=0,
            match_count_multiplier=max(2, int(getattr(settings, "RAG_CANDIDATE_MULTIPLIER", 8) or 8)),
        )
    context_chunks = await build_hierarchical_context(chunks, notebook_id)
    result = analyze_retrieval_scope(context_chunks, threshold)
    emit_metric(
        "retrieval.completed",
        notebook_id=notebook_id,
        selected_doc_count=len(document_ids or []),
        candidate_count=len(chunks or []),
        final_context_count=len(context_chunks or []),
        top_score=result.top_score,
        retrieval_mode="hierarchical",
        out_of_scope=result.is_out_of_scope,
    )
    if not result.chunks and document_ids:
        fallback_chunks = await load_selected_document_context(notebook_id, document_ids, settings.TOP_K_CHUNKS)
        return RetrievalResult(chunks=[chunk for chunk in fallback_chunks if _chunk_has_text(chunk)], top_score=None, is_out_of_scope=True)
    return result
