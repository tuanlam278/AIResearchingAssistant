"""Shared background indexing pipeline for large uploaded documents."""

from __future__ import annotations

import asyncio
import logging
import mimetypes
from dataclasses import dataclass
from typing import Any

from app.config import settings
from app.db.supabase_client import supabase
from app.db.supabase_retry import execute_supabase_with_retry
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
from app.services.document_structure_service import normalize_plain_text, page_blocks
from app.services.observability import emit_metric, metric_timer
from app.services.supabase_storage import download_file as storage_download_file, upload_file as storage_upload_file
from app.utils.filenames import storage_safe_filename

logger = logging.getLogger(__name__)

STORAGE_CONFIG_WARNING = "Tài liệu đã được xử lý tạm thời nhưng chưa lưu bền do thiếu storage bucket. Vui lòng kiểm tra cấu hình Supabase bucket."


@dataclass(slots=True)
class SourceStorageResult:
    storage_path: str | None
    bucket: str
    warning: dict[str, str] | None = None


def _storage_error_detail(exc: Exception) -> str:
    return str(exc)


def _db_error_detail(exc: Exception) -> str:
    return f"{type(exc).__name__}: {exc}"


def _is_route_not_found_error(exc: Exception) -> bool:
    detail = _db_error_detail(exc).lower()
    return (("route " in detail and " not found" in detail) or "statuscode': 404" in detail or '"statuscode":404' in detail)


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
    safe_suffix = storage_safe_filename(filename, fallback="document")
    return f"notebook-documents/{document_id}/{safe_suffix}"


def upload_indexing_source_file(document_id: str, filename: str, contents: bytes, mime_type: str | None = None) -> SourceStorageResult:
    """Persist source bytes for durable worker processing and expose explicit config warnings."""
    bucket = str(settings.INDEXING_STORAGE_BUCKET or settings.NOTEBOOK_STORAGE_BUCKET or "").strip()
    path = _storage_object_path(document_id, filename)
    if not bucket:
        logger.warning("Notebook source file was not persisted: INDEXING_STORAGE_BUCKET/NOTEBOOK_STORAGE_BUCKET is not configured (document_id=%s)", document_id)
        return SourceStorageResult(
            storage_path=None,
            bucket="",
            warning={"code": "INDEXING_STORAGE_BUCKET_NOT_CONFIGURED", "message": STORAGE_CONFIG_WARNING},
        )

    content_type = mime_type or mimetypes.guess_type(filename)[0] or "application/octet-stream"
    try:
        storage_upload_file(bucket, path, contents, content_type, upsert=True)
        return SourceStorageResult(storage_path=path, bucket=bucket)
    except Exception as exc:
        detail = _storage_error_detail(exc)
        code = "INDEXING_STORAGE_PERSIST_FAILED"
        if "bucket not found" in detail.lower() or "404" in detail:
            code = "INDEXING_STORAGE_BUCKET_NOT_FOUND"
        logger.warning(
            "Could not persist notebook source file to Supabase indexing storage bucket=%r path=%r; falling back to temporary in-process payload: %s",
            bucket,
            path,
            detail,
        )
        return SourceStorageResult(
            storage_path=None,
            bucket=bucket,
            warning={"code": code, "message": STORAGE_CONFIG_WARNING, "bucket": bucket},
        )


def download_indexing_source_file(storage_path: str) -> bytes:
    bucket = str(settings.INDEXING_STORAGE_BUCKET or settings.NOTEBOOK_STORAGE_BUCKET or "").strip()
    if not bucket:
        raise RuntimeError("INDEXING_STORAGE_BUCKET_NOT_CONFIGURED")
    return storage_download_file(bucket, storage_path)


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
        except Exception as primary_exc:
            legacy_updates = dict(clean_updates)
            for optional_key in ("file_type", "status", "processing_status", "processing_error", "is_vector_ready", "citation_threshold", "tags"):
                legacy_updates.pop(optional_key, None)
            if not legacy_updates:
                raise RuntimeError(_db_error_detail(primary_exc)) from primary_exc
            try:
                return supabase.table("documents").update(legacy_updates).eq("id", doc_id).execute()
            except Exception as legacy_exc:
                if _is_route_not_found_error(legacy_exc):
                    raise RuntimeError(
                        "DOCUMENTS_TABLE_ROUTE_NOT_FOUND: PostgREST cannot route public.documents. "
                        "Run docs/sql/complete_schema.sql, ensure SUPABASE_URL is the project origin, "
                        "then restart the backend. "
                        f"Original error: {_db_error_detail(legacy_exc)}"
                    ) from legacy_exc
                raise RuntimeError(_db_error_detail(legacy_exc)) from legacy_exc

    resp = await asyncio.to_thread(_call)
    rows, error = _supabase_response_data(resp)
    if error:
        raise RuntimeError(error)
    return rows[0] if rows else None


async def _update_document_best_effort(doc_id: str, updates: dict, *, stage: str) -> dict | None:
    try:
        return await _update_document(doc_id, updates)
    except Exception as exc:
        logger.warning("Skipping non-critical document update stage=%s doc_id=%s: %s", stage, doc_id, exc)
        return None


async def _delete_document_chunks(doc_id: str) -> None:
    def _call() -> None:
        execute_supabase_with_retry(lambda: supabase.table("document_chunks").delete().eq("doc_id", doc_id).execute(), label=f"delete document_chunks doc_id={doc_id}")

    await asyncio.to_thread(_call)


async def _replace_document_structure(doc_id: str, pages: list[dict]) -> None:
    """Persist page/block Markdown when optional structured tables exist; never fail indexing."""
    page_rows = [
        {
            "document_id": doc_id,
            "page": int(page.get("page") or page.get("page_number") or index),
            "markdown": str(page.get("markdown") or page.get("content") or ""),
            "plain_text": str(page.get("plain_text") or normalize_plain_text(page.get("markdown") or page.get("content") or "")),
        }
        for index, page in enumerate(pages, start=1)
        if str(page.get("markdown") or page.get("content") or "").strip()
    ]
    block_rows = [
        {
            "document_id": doc_id,
            "page": int(block.get("page") or 1),
            "block_index": int(block.get("block_index") or 0),
            "block_type": block.get("block_type") or "unknown",
            "section": block.get("section"),
            "markdown": block.get("markdown") or "",
            "plain_text": block.get("text") or normalize_plain_text(block.get("markdown") or ""),
            "bbox": block.get("bbox"),
            "confidence": block.get("confidence"),
            "source": block.get("source") or "unknown",
        }
        for block in page_blocks(pages)
        if str(block.get("markdown") or "").strip()
    ]
    batch_size = max(1, int(getattr(settings, "INDEX_INSERT_BATCH_SIZE", 250) or 250))

    def _call() -> None:
        try:
            execute_supabase_with_retry(lambda: supabase.table("document_pages").delete().eq("document_id", doc_id).execute(), label=f"delete document_pages document_id={doc_id}")
            execute_supabase_with_retry(lambda: supabase.table("document_blocks").delete().eq("document_id", doc_id).execute(), label=f"delete document_blocks document_id={doc_id}")
            for start in range(0, len(page_rows), batch_size):
                execute_supabase_with_retry(lambda batch=page_rows[start : start + batch_size]: supabase.table("document_pages").insert(batch).execute(), label=f"insert document_pages document_id={doc_id}")
            for start in range(0, len(block_rows), batch_size):
                execute_supabase_with_retry(lambda batch=block_rows[start : start + batch_size]: supabase.table("document_blocks").insert(batch).execute(), label=f"insert document_blocks document_id={doc_id}")
        except Exception as exc:
            logger.warning("Structured document_pages/document_blocks persist skipped for %s: %s", doc_id, exc)

    await asyncio.to_thread(_call)


async def _insert_chunk_rows(rows: list[dict]) -> None:
    if not rows:
        return
    batch_size = max(1, int(getattr(settings, "SUPABASE_VECTOR_INSERT_BATCH_SIZE", getattr(settings, "INDEX_INSERT_BATCH_SIZE", 25)) or 25))

    def _insert_batch(batch: list[dict]) -> None:
        try:
            execute_supabase_with_retry(lambda: supabase.table("document_chunks").insert(batch).execute(), label="insert document_chunks batch")
        except Exception as exc:
            legacy_batch = [
                {key: row[key] for key in ("doc_id", "notebook_id", "section", "content", "page_number", "chunk_index", "embedding") if key in row}
                for row in batch
            ]
            logger.warning("Extended document chunk metadata insert failed; retrying legacy columns: %s", exc)
            execute_supabase_with_retry(lambda: supabase.table("document_chunks").insert(legacy_batch).execute(), label="insert legacy document_chunks batch")

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
        await _update_document_best_effort(doc_id, {"status": "processing", "processing_status": "parsing", "processing_error": None, "is_vector_ready": False}, stage="parsing")
        with metric_timer("indexing.parse", doc_id=doc_id, notebook_id=notebook_id, filename=filename, file_size=len(contents)):
            pages, file_type = await parse_document(contents, filename)
        page_count = len(pages)

        await report_indexing_progress(job_id, stage="chunking", progress=30, message="Đang chia nhỏ tài liệu")
        await _update_document_best_effort(doc_id, {"file_type": file_type, "page_count": page_count, "processing_status": "chunking"}, stage="chunking")
        with metric_timer("indexing.chunk", doc_id=doc_id, notebook_id=notebook_id, page_count=page_count) as chunk_metric:
            chunks = chunk_text(pages)
            chunk_metric["chunk_count"] = len(chunks)
        if not chunks:
            raise EmptyDocumentText("Không đọc được nội dung văn bản từ file này.")

        await report_indexing_progress(job_id, stage="embedding", progress=55, message="Đang tạo embedding")
        await _update_document_best_effort(doc_id, {"chunk_count": len(chunks), "processing_status": "embedding"}, stage="embedding")
        texts = [chunk["content"] for chunk in chunks]
        with metric_timer("indexing.embed", doc_id=doc_id, notebook_id=notebook_id, chunk_count=len(chunks)):
            embeddings = await embed_chunks(texts)

        await report_indexing_progress(job_id, stage="inserting", progress=85, message="Đang lưu vector")
        await _delete_document_chunks(doc_id)
        await _replace_document_structure(doc_id, pages)
        chunk_rows = [
            {
                "doc_id": doc_id,
                "notebook_id": notebook_id,
                "section": chunks[index].get("section", "Unknown"),
                "content": chunks[index]["content"],
                "page_number": chunks[index].get("page_number") or 1,
                "page_start": chunks[index].get("page_start") or chunks[index].get("page_number") or 1,
                "page_end": chunks[index].get("page_end") or chunks[index].get("page_number") or 1,
                "chunk_index": index,
                "markdown": chunks[index].get("markdown") or chunks[index]["content"],
                "block_types": chunks[index].get("block_types") or [],
                "block_ids": chunks[index].get("block_ids") or [],
                "contains_table": bool(chunks[index].get("contains_table")),
                "contains_equation": bool(chunks[index].get("contains_equation")),
                "embedding": _vector_to_string(embeddings[index]),
            }
            for index in range(len(chunks))
        ]
        with metric_timer("indexing.insert", doc_id=doc_id, notebook_id=notebook_id, chunk_count=len(chunk_rows)):
            await _insert_chunk_rows(chunk_rows)
        intelligence = build_document_intelligence(doc_id=doc_id, notebook_id=notebook_id, filename=filename, pages=pages, chunks=chunks)
        await persist_document_intelligence(intelligence)
        final_updates = {
            "file_type": file_type,
            "page_count": page_count,
            "chunk_count": len(chunks),
            "status": "ready",
            "processing_status": "ready",
            "processing_error": None,
            "is_vector_ready": True,
            "citation_threshold": normalize_citation_threshold(citation_threshold),
            "tags": parse_tags(tags),
        }
        updated = await _update_document_best_effort(doc_id, final_updates, stage="ready")
        await report_indexing_progress(job_id, stage="ready", progress=100, message="Index hoàn tất")
        emit_metric("indexing.completed", doc_id=doc_id, notebook_id=notebook_id, page_count=page_count, chunk_count=len(chunks), job_id=job_id)
        return updated or {"id": doc_id, **final_updates}
    except (UnsupportedDocumentType, EmptyDocumentText) as exc:
        logger.warning("Notebook document indexing failed for %s: %s", filename, exc)
        await _update_document_best_effort(doc_id, {"status": "failed", "processing_status": "failed", "processing_error": str(exc), "is_vector_ready": False}, stage="failed")
        raise
    except Exception as exc:
        logger.exception("Notebook document indexing failed for %s", filename)
        await _update_document_best_effort(doc_id, {"status": "failed", "processing_status": "failed", "processing_error": "Không thể index/vector hóa tài liệu.", "is_vector_ready": False}, stage="failed")
        raise


async def schedule_notebook_indexing(**kwargs: Any) -> dict[str, Any]:
    """Backward-compatible wrapper that now enqueues a durable job instead of create_task."""
    return await create_notebook_indexing_job(**kwargs)
