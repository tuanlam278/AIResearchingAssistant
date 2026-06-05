"""Document intelligence extraction shared by RAG, summaries, and reading maps."""

from __future__ import annotations

import asyncio
import logging
import re
from collections import Counter, defaultdict
from typing import Any

from app.db.supabase_client import supabase
from app.services.observability import emit_metric

logger = logging.getLogger(__name__)

_STOPWORDS = {
    "the", "and", "for", "with", "this", "that", "from", "into", "are", "was", "were", "been", "have", "has",
    "của", "và", "là", "các", "cho", "trong", "một", "những", "được", "với", "khi", "này", "đến",
}


def _clean(text: str, limit: int = 700) -> str:
    return re.sub(r"\s+", " ", str(text or "")).strip()[:limit]


def _terms(text: str, limit: int = 12) -> list[str]:
    words = [w.lower() for w in re.findall(r"[\wÀ-ỹ-]{4,}", text or "")]
    counts = Counter(w for w in words if w not in _STOPWORDS and not w.isdigit())
    return [word for word, _count in counts.most_common(limit)]


def build_document_intelligence(*, doc_id: str, notebook_id: str | None, filename: str, pages: list[dict], chunks: list[dict]) -> dict[str, Any]:
    by_section: dict[str, list[dict]] = defaultdict(list)
    for chunk in chunks:
        by_section[str(chunk.get("section") or "Nội dung")].append(chunk)

    section_summaries = []
    for section, rows in by_section.items():
        text = _clean(" ".join(str(row.get("content") or "") for row in rows[:3]), 900)
        pages_for_section = [row.get("page_number") for row in rows if row.get("page_number")]
        section_summaries.append(
            {
                "section": section,
                "summary": text,
                "page_start": min(pages_for_section) if pages_for_section else None,
                "page_end": max(pages_for_section) if pages_for_section else None,
                "chunk_count": len(rows),
            }
        )

    full_sample = " ".join(str(chunk.get("content") or "") for chunk in chunks[:12])
    outline = [item["section"] for item in section_summaries[:16]]
    citation_candidates = [
        {
            "chunk_index": chunk.get("chunk_index", index),
            "page_number": chunk.get("page_number"),
            "section": chunk.get("section"),
            "snippet": _clean(chunk.get("content") or "", 260),
        }
        for index, chunk in enumerate(chunks[:12])
        if chunk.get("content")
    ]
    return {
        "document_id": doc_id,
        "notebook_id": notebook_id,
        "filename": filename,
        "summary": _clean(full_sample, 1200),
        "outline": outline,
        "section_summaries": section_summaries,
        "key_terms": _terms(full_sample),
        "citation_candidates": citation_candidates,
        "page_count": len(pages),
        "chunk_count": len(chunks),
    }


async def persist_document_intelligence(intelligence: dict[str, Any]) -> None:
    """Best-effort persistence; deployments can apply docs/sql/document_intelligence.sql."""
    document_id = intelligence.get("document_id")
    if not document_id:
        return

    def _call() -> None:
        row = {
            "document_id": document_id,
            "notebook_id": intelligence.get("notebook_id"),
            "summary": intelligence.get("summary"),
            "outline": intelligence.get("outline") or [],
            "section_summaries": intelligence.get("section_summaries") or [],
            "key_terms": intelligence.get("key_terms") or [],
            "citation_candidates": intelligence.get("citation_candidates") or [],
        }
        supabase.table("document_intelligence").upsert(row, on_conflict="document_id").execute()

    try:
        await asyncio.to_thread(_call)
        emit_metric(
            "document_intelligence.persisted",
            document_id=document_id,
            section_count=len(intelligence.get("section_summaries") or []),
            key_term_count=len(intelligence.get("key_terms") or []),
        )
    except Exception as exc:
        logger.info("Document intelligence persistence skipped for %s: %s", document_id, exc)
