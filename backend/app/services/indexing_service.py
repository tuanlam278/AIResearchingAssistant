"""Shared background indexing pipeline for large uploaded documents."""

from __future__ import annotations

import asyncio
import logging
import mimetypes
from typing import Any

from app.config import settings
from app.db.supabase_client import supabase
from app.services.chunker import chunk_text
from app.services.document_parser import (
    EmptyDocumentText,
    UnsupportedDocumentType,
    get_file_type,
    parse_document,
    validate_research_file,
)
from app.services.document_intelligence import build_document_intelligence, persist_document_intelligence
from app.services.embedder import embed_chunks
from app.services.indexing_jobs import create_indexing_job, create_memory_indexing_job, report_indexing_progress
from app.services.observability import emit_metric, metric_timer

logger = logging.getLogger(__name__)


def _supabase_response_data(resp: Any) -> tuple[Any, Any]:
    if isinstance(resp, dict):
        return resp.get("data"), resp.get("error")
    return getattr(resp, "data", None), getattr(resp, "error", None)


def normalize_citation_threshold(value: Any) -> float:
    try:
        threshold = float(value)
    except (TypeError, ValueError):
        return 0.0
    if threshold != threshold or threshold < 0:
        return 0.0
    return threshold


def parse_tags(raw_tags: str | None) -> list[str]:
    tags: list[str] = []
    for item in str(raw_tags or "").split(","):
        tag = item.strip().lstrip("#").lower()
        if tag and tag not in tags:
            tags.append(tag)
    return tags


def _vector_to_string(vector: list[float] | str | None) -> str:
    if isinstance(vector, str):
        return vector
    return "[" + ",".join(map(str, vector or [])) + "]"


def _storage_object_path(document_id: str, filename: str) -> str:
    safe_suffix = (filename or "document").replace("/", "_").replace("\\", "_")
    return f"notebook-documents/{document_id}/{safe_suffix}"


def upload_indexing_source_file(document_id: str, filename: str, contents: bytes, mime_type: str | None = None) -> str | None:
    """Persist source bytes for durable worker processing; return storage path when available."""
    path = _storage_object_path(document_id, filename)
    content_type = mime_type or mimetypes.guess_type(filename)[0] or "application/octet-stream"
    try:
        supabase.storage.from_(settings.INDEXING_STORAGE_BUCKET).upload(
            path,
            contents,
            {"content-type": content_type, "upsert": "true"},
        )
        return path
    except Exception as exc:
        logger.warning("Could not persist notebook source file to indexing storage; falling back to in-process payload: %s", exc)
        return None


def download_indexing_source_file(storage_path: str) -> bytes:
    return supabase.storage.from_(settings.INDEXING_STORAGE_BUCKET).download(storage_path)


async def create_notebook_indexing_job(
    *,
    doc_id: str,
    notebook_id: str,
    filename: str,
    storage_path: str | None,
    contents: bytes | None = None,
    citation_threshold: float | None = 0,
    tags: str = "",
    user_id: str | None = None,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "doc_id": doc_id,
        "notebook_id": notebook_id,
        "filename": filename,
        "storage_path": storage_path,
        "citation_threshold": normalize_citation_threshold(citation_threshold),
        "tags": tags,
    }
    # Fallback only. Durable deployments should apply docs/sql/indexing_jobs.sql and create INDEXING_STORAGE_BUCKET.
    if not storage_path and contents is not None:
        payload["inline_contents_hex"] = contents.hex()
        return create_memory_indexing_job(job_type="notebook_document", resource_id=doc_id, payload=payload, user_id=user_id)
    return await create_indexing_job(job_type="notebook_document", resource_id=doc_id, payload=payload, user_id=user_id)


async def process_notebook_indexing_job(job: dict[str, Any]) -> dict[str, Any]:
    payload = job.get("payload") or {}
    storage_path = payload.get("storage_path")
    if storage_path:
        contents = await asyncio.to_thread(download_indexing_source_file, storage_path)
    elif payload.get("inline_contents_hex"):
        contents = bytes.fromhex(payload["inline_contents_hex"])
    else:
        raise RuntimeError("Indexing job has no durable source file payload")

    return await index_notebook_document(
        doc_id=str(payload.get("doc_id") or job.get("resource_id")),
        notebook_id=str(payload.get("notebook_id") or ""),
        filename=str(payload.get("filename") or "uploaded-document"),
        contents=contents,
        citation_threshold=payload.get("citation_threshold"),
        tags=str(payload.get("tags") or ""),
        job_id=str(job.get("id")),
    )


async def _insert_document_payload(payload: dict) -> dict:
    def _call() -> dict:
        try:
            return supabase.table("documents").insert(payload).execute()
        except Exception:
            legacy_payload = dict(payload)
            for optional_key in (
                "file_type",
                "status",
                "processing_status",
                "processing_error",
                "is_vector_ready",
                "citation_threshold",
                "tags",
            ):
                legacy_payload.pop(optional_key, None)
            return supabase.table("documents").insert(legacy_payload).execute()

    resp = await asyncio.to_thread(_call)
    rows, error = _supabase_response_data(resp)
    if error or not rows:
        raise RuntimeError("DB_INSERT_FAILED")
    return rows[0]


async def _update_document(doc_id: str, updates: dict) -> dict | None:
    clean_updates = {key: value for key, value in updates.items() if value is not None}
    if not clean_updates:
        return None

    def _call() -> Any:
        try:
            return supabase.table("documents").update(clean_updates).eq("id", doc_id).execute()
        except Exception:
            legacy_updates = dict(clean_updates)
            for optional_key in ("file_type", "status", "processing_status", "processing_error", "is_vector_ready", "citation_threshold", "tags"):
                legacy_updates.pop(optional_key, None)
            if not legacy_updates:
                return None
            return supabase.table("documents").update(legacy_updates).eq("id", doc_id).execute()

    resp = await asyncio.to_thread(_call)
    if resp is None:
        return None
    rows, error = _supabase_response_data(resp)
    if error:
        raise RuntimeError(error)
    return rows[0] if rows else None


async def _delete_document_chunks(doc_id: str) -> None:
    def _call() -> None:
        supabase.table("document_chunks").delete().eq("doc_id", doc_id).execute()

    await asyncio.to_thread(_call)


async def _insert_chunk_rows(rows: list[dict]) -> None:
    if not rows:
        return
    batch_size = max(1, int(getattr(settings, "INDEX_INSERT_BATCH_SIZE", 250) or 250))

    def _insert_batch(batch: list[dict]) -> None:
        supabase.table("document_chunks").insert(batch).execute()

    for index in range(0, len(rows), batch_size):
        await asyncio.to_thread(_insert_batch, rows[index : index + batch_size])


async def create_queued_notebook_document(
    *,
    notebook_id: str,
    filename: str,
    file_size: int,
    citation_threshold: float | None = 0,
    tags: str = "",
) -> dict:
    """Create a lightweight queued document row and return it immediately to the UI."""
    ext = validate_research_file(filename)
    file_type = ext.lstrip(".") or get_file_type(filename)
    payload = {
        "notebook_id": notebook_id,
        "filename": filename,
        "file_type": file_type,
        "page_count": 0,
        "chunk_count": 0,
        "status": "processing",
        "processing_status": "uploaded",
        "processing_error": None,
        "is_vector_ready": False,
        "citation_threshold": normalize_citation_threshold(citation_threshold),
        "tags": parse_tags(tags),
    }
    row = await _insert_document_payload(payload)
    return {
        "filename": row.get("filename") or filename,
        "doc_id": row["id"],
        "id": row["id"],
        "file_type": row.get("file_type") or file_type,
        "page_count": row.get("page_count") or 0,
        "chunk_count": row.get("chunk_count") or 0,
        "size": file_size,
        "created_at": row.get("created_at"),
        "status": row.get("status") or "processing",
        "processing_status": row.get("processing_status") or "uploaded",
        "processing_error": row.get("processing_error"),
        "is_vector_ready": bool(row.get("is_vector_ready")),
    }


async def index_notebook_document(
    *,
    doc_id: str,
    notebook_id: str,
    filename: str,
    contents: bytes,
    citation_threshold: float | None = 0,
    tags: str = "",
    job_id: str | None = None,
) -> dict:
    """Parse, chunk, embed, and persist vectors for one notebook document."""
    try:
        await report_indexing_progress(job_id, stage="parsing", progress=10, message="Đang đọc tài liệu")
        await _update_document(doc_id, {"status": "processing", "processing_status": "parsing", "processing_error": None, "is_vector_ready": False})
        with metric_timer("indexing.parse", doc_id=doc_id, notebook_id=notebook_id, filename=filename, file_size=len(contents)):
            pages, file_type = await parse_document(contents, filename)
        page_count = len(pages)

        await report_indexing_progress(job_id, stage="chunking", progress=30, message="Đang chia nhỏ tài liệu")
        await _update_document(doc_id, {"file_type": file_type, "page_count": page_count, "processing_status": "chunking"})
        with metric_timer("indexing.chunk", doc_id=doc_id, notebook_id=notebook_id, page_count=page_count) as chunk_metric:
            chunks = chunk_text(pages)
            chunk_metric["chunk_count"] = len(chunks)
        if not chunks:
            raise EmptyDocumentText("Không đọc được nội dung văn bản từ file này.")

        await report_indexing_progress(job_id, stage="embedding", progress=55, message="Đang tạo embedding")
        await _update_document(doc_id, {"chunk_count": len(chunks), "processing_status": "embedding"})
        texts = [chunk["content"] for chunk in chunks]
        with metric_timer("indexing.embed", doc_id=doc_id, notebook_id=notebook_id, chunk_count=len(chunks)):
            embeddings = await embed_chunks(texts)

        await report_indexing_progress(job_id, stage="inserting", progress=85, message="Đang lưu vector")
        await _delete_document_chunks(doc_id)
        chunk_rows = [
            {
                "doc_id": doc_id,
                "notebook_id": notebook_id,
                "section": chunks[index].get("section", "Unknown"),
                "content": chunks[index]["content"],
                "page_number": chunks[index].get("page_number") or 1,
                "chunk_index": index,
                "embedding": _vector_to_string(embeddings[index]),
            }
            for index in range(len(chunks))
        ]
        with metric_timer("indexing.insert", doc_id=doc_id, notebook_id=notebook_id, chunk_count=len(chunk_rows)):
            await _insert_chunk_rows(chunk_rows)
        intelligence = build_document_intelligence(doc_id=doc_id, notebook_id=notebook_id, filename=filename, pages=pages, chunks=chunks)
        await persist_document_intelligence(intelligence)
        updated = await _update_document(
            doc_id,
            {
                "file_type": file_type,
                "page_count": page_count,
                "chunk_count": len(chunks),
                "status": "ready",
                "processing_status": "ready",
                "processing_error": None,
                "is_vector_ready": True,
                "citation_threshold": normalize_citation_threshold(citation_threshold),
                "tags": parse_tags(tags),
            },
        )
        await report_indexing_progress(job_id, stage="ready", progress=100, message="Index hoàn tất")
        emit_metric("indexing.completed", doc_id=doc_id, notebook_id=notebook_id, page_count=page_count, chunk_count=len(chunks), job_id=job_id)
        return updated or {"id": doc_id, "status": "ready", "processing_status": "ready", "is_vector_ready": True}
    except (UnsupportedDocumentType, EmptyDocumentText) as exc:
        logger.warning("Notebook document indexing failed for %s: %s", filename, exc)
        await _update_document(doc_id, {"status": "failed", "processing_status": "failed", "processing_error": str(exc), "is_vector_ready": False})
        raise
    except Exception as exc:
        logger.exception("Notebook document indexing failed for %s", filename)
        await _update_document(doc_id, {"status": "failed", "processing_status": "failed", "processing_error": "Không thể index/vector hóa tài liệu.", "is_vector_ready": False})
        raise


async def schedule_notebook_indexing(**kwargs: Any) -> dict[str, Any]:
    """Backward-compatible wrapper that now enqueues a durable job instead of create_task."""
    return await create_notebook_indexing_job(**kwargs)
