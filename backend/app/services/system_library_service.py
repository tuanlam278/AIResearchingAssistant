"""System Library service for admin-managed RAG-ready documents."""

from __future__ import annotations

import asyncio
import logging
import mimetypes
import re
import unicodedata
from datetime import datetime, timedelta, timezone
from typing import Any, Iterable
from urllib.parse import quote
from uuid import UUID

from fastapi import HTTPException, status

from app.config import settings
from app.db.supabase_client import supabase
from app.services.chunker import chunk_text
from app.services.document_parser import EmptyDocumentText, UnsupportedDocumentType, parse_document
from app.services.embedder import embed_chunks, embed_query
from app.services.llm import generate_system_document_metadata

logger = logging.getLogger(__name__)

SYSTEM_DOCUMENT_COLUMNS = (
    "id, title, filename, file_type, storage_path, download_url, file_size, mime_type, category, tags, "
    "summary, page_count, word_count, is_vector_ready, created_by, created_at, updated_at"
)


def _supabase_response_data(resp: Any):
    if isinstance(resp, dict):
        return resp.get("data"), resp.get("error")
    return getattr(resp, "data", None), getattr(resp, "error", None)


def _is_missing_table_error(exc_or_error: Any) -> bool:
    message = str(exc_or_error or "").lower()
    return any(token in message for token in ["system_documents", "system_document_bookmarks", "does not exist", "not find", "schema cache", "relation"])


def _get_user_id(user: dict) -> str:
    user_id = user.get("id") or user.get("user_id")
    if not user_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail={"code": "UNAUTHORIZED", "message": "Token không hợp lệ"})
    return str(user_id)


def _valid_uuid_or_none(value: str | None) -> str | None:
    if not value:
        return None
    try:
        return str(UUID(str(value)))
    except (TypeError, ValueError):
        return None


def normalize_document(row: dict, bookmarked_ids: set[str] | None = None) -> dict:
    bookmarked_ids = bookmarked_ids or set()
    created_at = row.get("created_at")
    is_new = False
    if created_at:
        try:
            dt = datetime.fromisoformat(str(created_at).replace("Z", "+00:00"))
            is_new = dt >= datetime.now(timezone.utc) - timedelta(days=7)
        except ValueError:
            is_new = False

    tags = row.get("tags") or []
    if isinstance(tags, str):
        tags = [tag.strip().lstrip("#") for tag in tags.split(",") if tag.strip()]

    category = row.get("category") or row.get("subject_area") or "Khác"
    summary = row.get("summary") or row.get("ai_summary") or row.get("description") or ""

    return {
        "id": str(row.get("id")),
        "title": row.get("title") or row.get("filename") or "Tài liệu hệ thống",
        "filename": row.get("filename") or "",
        "file_type": row.get("file_type") or "FILE",
        "storage_path": row.get("storage_path"),
        "download_url": row.get("download_url"),
        "file_size": row.get("file_size"),
        "mime_type": row.get("mime_type"),
        "can_download": bool(row.get("storage_path") or row.get("download_url")),
        "description": row.get("description") or summary,
        "category": category,
        "subject_area": category,
        "tags": tags,
        "summary": summary,
        "ai_summary": summary,
        "page_count": row.get("page_count"),
        "word_count": row.get("word_count"),
        "is_new": bool(row.get("is_new", is_new)),
        "is_vector_ready": bool(row.get("is_vector_ready", False)),
        "updated_at": row.get("updated_at"),
        "created_at": row.get("created_at"),
        "created_by": row.get("created_by"),
        "bookmarked_by_current_user": str(row.get("id")) in bookmarked_ids or bool(row.get("bookmarked_by_current_user", False)),
        "is_bookmarked": str(row.get("id")) in bookmarked_ids or bool(row.get("bookmarked_by_current_user", False)),
        "semantic_score": row.get("similarity") or row.get("score"),
    }


def require_admin(user: dict) -> None:
    if str(user.get("role") or "user").lower() != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail={"code": "ADMIN_FORBIDDEN", "message": "Chỉ admin mới được truy cập chức năng này"})


def _format_system_file_type(file_type: str) -> str:
    normalized = str(file_type or "").lower()
    if normalized == "pdf":
        return "PDF"
    if normalized == "docx":
        return "DOCX"
    if normalized in {"txt", "md"}:
        return normalized.upper()
    return normalized.upper() or "FILE"


def _safe_filename(filename: str) -> str:
    value = (filename or "system-document").strip().replace("\x00", "")
    return value or "system-document"


def _ascii_download_filename(filename: str) -> str:
    raw = _safe_filename(filename)
    normalized = unicodedata.normalize("NFKD", raw).encode("ascii", "ignore").decode("ascii")
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "-", normalized).strip("-._")
    return cleaned or "system-document"


def content_disposition_for_filename(filename: str) -> str:
    original = _safe_filename(filename)
    ascii_fallback = _ascii_download_filename(original) or "document-download"
    return f"attachment; filename=\"{ascii_fallback}\"; filename*=UTF-8''{quote(original, safe='')}"


def _extension_from_document(row: dict) -> str:
    for value in (row.get("original_filename"), row.get("filename"), row.get("storage_path")):
        if value and "." in str(value).rsplit("/", 1)[-1]:
            return "." + str(value).rsplit("/", 1)[-1].rsplit(".", 1)[-1]
    guessed = mimetypes.guess_extension(row.get("mime_type") or "") or ""
    if guessed:
        return guessed
    file_type = str(row.get("file_type") or "").strip().lower().lstrip(".")
    return f".{file_type}" if file_type else ".pdf"


def _display_download_filename(row: dict) -> str:
    for key in ("original_filename", "filename"):
        value = _safe_filename(str(row.get(key) or ""))
        if value and value != "system-document":
            return value
    title = _safe_filename(str(row.get("title") or ""))
    if title and title != "system-document":
        if "." not in title.rsplit("/", 1)[-1]:
            title = f"{title}{_extension_from_document(row)}"
        return title
    return f"document-{row.get('id') or 'download'}{_extension_from_document(row)}"


def _storage_object_path(document_id: str, filename: str) -> str:
    safe_name = re.sub(r"[/\\]+", "-", _safe_filename(filename)).strip(".-") or "system-document"
    return f"system-library/{document_id}/{safe_name}"


def _guess_mime_type(filename: str, supplied_mime_type: str | None = None) -> str:
    if supplied_mime_type and supplied_mime_type != "application/octet-stream":
        return supplied_mime_type
    return mimetypes.guess_type(filename)[0] or "application/octet-stream"


def _upload_original_file_to_storage(path: str, file_contents: bytes, mime_type: str) -> None:
    try:
        supabase.storage.from_(settings.SYSTEM_LIBRARY_STORAGE_BUCKET).upload(
            path,
            file_contents,
            {"content-type": mime_type, "upsert": "false"},
        )
    except Exception as exc:
        logger.exception("Upload original system document to storage failed")
        raise HTTPException(
            status_code=500,
            detail={"code": "STORAGE_UPLOAD_FAILED", "message": "Không thể lưu file gốc để tải xuống."},
        ) from exc


def get_system_document_download(document_id: str) -> dict:
    try:
        resp = (
            supabase.table("system_documents")
            .select("id, title, filename, original_filename, file_type, storage_path, download_url, file_size, mime_type")
            .eq("id", document_id)
            .single()
            .execute()
        )
    except Exception:
        try:
            resp = (
                supabase.table("system_documents")
                .select("id, title, filename, file_type, storage_path, download_url, file_size, mime_type")
                .eq("id", document_id)
                .single()
                .execute()
            )
        except Exception as exc:
            logger.exception("Lookup system document download metadata failed")
            raise HTTPException(status_code=500, detail={"code": "INTERNAL_ERROR", "message": "Không thể tải tài liệu."}) from exc

    row, error = _supabase_response_data(resp)
    if error:
        try:
            retry_resp = (
                supabase.table("system_documents")
                .select("id, title, filename, file_type, storage_path, download_url, file_size, mime_type")
                .eq("id", document_id)
                .single()
                .execute()
            )
            row, error = _supabase_response_data(retry_resp)
        except Exception as exc:
            logger.exception("Retry lookup system document download metadata failed")
            raise HTTPException(status_code=500, detail={"code": "INTERNAL_ERROR", "message": "Không thể tải tài liệu."}) from exc
    if error or not row:
        raise HTTPException(status_code=404, detail={"code": "DOC_NOT_FOUND", "message": "Không tìm thấy tài liệu hệ thống."})

    filename = _display_download_filename(row)
    storage_path = row.get("storage_path")
    download_url = row.get("download_url")
    mime_type = row.get("mime_type") or _guess_mime_type(filename)

    if storage_path:
        try:
            contents = supabase.storage.from_(settings.SYSTEM_LIBRARY_STORAGE_BUCKET).download(storage_path)
        except Exception as exc:
            logger.exception("Download original system document from storage failed")
            raise HTTPException(status_code=404, detail={"code": "FILE_NOT_FOUND", "message": "Không tìm thấy file để tải xuống."}) from exc
        return {"type": "bytes", "content": contents, "filename": filename, "mime_type": mime_type}

    if download_url:
        return {"type": "redirect", "url": download_url}

    raise HTTPException(status_code=404, detail={"code": "FILE_NOT_FOUND", "message": "Không tìm thấy file để tải xuống."})


def _parse_tags(raw_tags: str | list[str] | None) -> list[str]:
    if isinstance(raw_tags, list):
        source = raw_tags
    else:
        source = str(raw_tags or "").split(",")
    cleaned: list[str] = []
    for tag in source:
        value = str(tag or "").strip().lstrip("#")
        if value and value not in cleaned:
            cleaned.append(value)
    return cleaned


def _estimate_word_count(pages: list[dict]) -> int:
    text = " ".join(str(page.get("content") or "") for page in pages)
    return len([word for word in text.split() if word.strip()])


def _metadata_sample(pages: list[dict], chunks: list[dict]) -> str:
    first_pages = "\n\n".join(str(page.get("content") or "") for page in pages[:2])
    sampled_chunks = "\n\n".join(str(chunk.get("content") or "") for chunk in chunks[:4])
    return (first_pages + "\n\n" + sampled_chunks).strip()[:12000]


async def _auto_metadata(pages: list[dict], chunks: list[dict], category_override: str | None, tags_override: str | list[str] | None) -> dict:
    fallback = {
        "category": (category_override or "Khác").strip() or "Khác",
        "tags": _parse_tags(tags_override),
        "summary": "",
    }
    try:
        generated = await generate_system_document_metadata(_metadata_sample(pages, chunks))
    except Exception as exc:  # metadata failure should not fail the import
        logger.warning("System document AI metadata generation failed: %s", exc)
        generated = {}

    category = (category_override or generated.get("category") or fallback["category"] or "Khác").strip()
    tags = _parse_tags(tags_override) or _parse_tags(generated.get("tags"))
    summary = str(generated.get("summary") or "").strip()
    return {"category": category or "Khác", "tags": tags, "summary": summary}


async def import_system_document_from_upload(
    *,
    file_contents: bytes,
    filename: str,
    created_by: str | None = None,
    title: str | None = None,
    category: str | None = None,
    tags: str | list[str] | None = None,
    mime_type: str | None = None,
) -> dict:
    """Parse, chunk, embed, auto-catalog, and persist an admin-uploaded System Library document."""
    max_size_bytes = settings.MAX_UPLOAD_MB * 1024 * 1024
    if len(file_contents) > max_size_bytes:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail={"code": "FILE_TOO_LARGE", "message": f"File quá lớn. Vui lòng chọn file dưới {settings.MAX_UPLOAD_MB}MB."},
        )

    try:
        pages, parsed_file_type = await parse_document(file_contents, filename)
        chunks = chunk_text(pages)
    except UnsupportedDocumentType as exc:
        raise HTTPException(status_code=400, detail={"code": "INVALID_FILE_TYPE", "message": str(exc)}) from exc
    except EmptyDocumentText as exc:
        raise HTTPException(status_code=400, detail={"code": "PARSE_FAILED", "message": str(exc)}) from exc
    except Exception as exc:
        logger.exception("System document parse/chunk failed")
        raise HTTPException(status_code=500, detail={"code": "PARSE_FAILED", "message": "Không đọc được nội dung văn bản từ file này"}) from exc

    if not chunks:
        raise HTTPException(status_code=400, detail={"code": "PARSE_FAILED", "message": "Không tạo được chunk nội dung từ file này"})

    metadata = await _auto_metadata(pages, chunks, category, tags)
    resolved_mime_type = _guess_mime_type(filename, mime_type)
    document_payload = {
        "title": (title or filename).strip(),
        "filename": filename,
        "file_type": _format_system_file_type(parsed_file_type),
        "category": metadata["category"],
        "tags": metadata["tags"],
        "summary": metadata["summary"],
        "page_count": len(pages),
        "word_count": _estimate_word_count(pages),
        "file_size": len(file_contents),
        "mime_type": resolved_mime_type,
        "created_by": _valid_uuid_or_none(created_by),
        "is_vector_ready": False,
    }

    try:
        resp = supabase.table("system_documents").insert(document_payload).execute()
    except Exception as exc:
        logger.exception("Insert system document metadata failed")
        raise HTTPException(status_code=500, detail={"code": "DB_INSERT_FAILED", "message": "Không thể tạo metadata tài liệu hệ thống"}) from exc
    rows, error = _supabase_response_data(resp)
    if error or not rows:
        raise HTTPException(status_code=500, detail={"code": "DB_INSERT_FAILED", "message": "Không thể tạo metadata tài liệu hệ thống"})

    document_id = str(rows[0]["id"])
    storage_path = _storage_object_path(document_id, filename)
    try:
        _upload_original_file_to_storage(storage_path, file_contents, resolved_mime_type)
    except HTTPException:
        try:
            supabase.table("system_documents").delete().eq("id", document_id).execute()
        except Exception:
            logger.warning("Could not rollback system document %s after storage upload failure", document_id)
        raise

    try:
        storage_resp = supabase.table("system_documents").update({"storage_path": storage_path}).eq("id", document_id).execute()
        storage_rows, storage_error = _supabase_response_data(storage_resp)
        if storage_error:
            raise RuntimeError(storage_error)
        if storage_rows:
            rows[0] = storage_rows[0]
    except Exception as exc:
        logger.exception("Update system document storage metadata failed")
        try:
            supabase.table("system_documents").delete().eq("id", document_id).execute()
        except Exception:
            logger.warning("Could not rollback system document %s after storage metadata failure", document_id)
        raise HTTPException(status_code=500, detail={"code": "DB_UPDATE_FAILED", "message": "Không thể lưu metadata file tải xuống."}) from exc

    try:
        texts = [chunk["content"] for chunk in chunks]
        embeddings = await embed_chunks(texts)
        chunk_rows = [
            {
                "document_id": document_id,
                "content": chunks[index]["content"],
                "page_start": chunks[index].get("page_number"),
                "page_end": chunks[index].get("page_number"),
                "embedding": "[" + ",".join(map(str, embeddings[index])) + "]",
            }
            for index in range(len(chunks))
        ]
        supabase.table("system_document_chunks").insert(chunk_rows).execute()
        update_resp = supabase.table("system_documents").update({"is_vector_ready": True}).eq("id", document_id).execute()
        updated_rows, update_error = _supabase_response_data(update_resp)
        if update_error:
            raise RuntimeError(update_error)
        source = updated_rows[0] if updated_rows else {**rows[0], "is_vector_ready": True}
    except Exception as exc:
        logger.exception("System document embedding/chunk insert failed")
        try:
            supabase.table("system_documents").delete().eq("id", document_id).execute()
        except Exception:
            logger.warning("Could not rollback failed system document %s", document_id)
        raise HTTPException(status_code=500, detail={"code": "INDEX_FAILED", "message": "Upload thành công nhưng index/vector hóa thất bại"}) from exc

    return normalize_document(source)


def _query_bookmarked_ids(user_id: str) -> set[str]:
    try:
        resp = supabase.table("system_document_bookmarks").select("document_id").eq("user_id", user_id).execute()
    except Exception as exc:
        if _is_missing_table_error(exc):
            return set()
        logger.exception("List system document bookmarks failed")
        raise HTTPException(status_code=500, detail={"code": "INTERNAL_ERROR", "message": "Lỗi khi lấy tủ sách cá nhân"}) from exc
    rows, error = _supabase_response_data(resp)
    if error:
        if _is_missing_table_error(error):
            return set()
        raise HTTPException(status_code=500, detail={"code": "INTERNAL_ERROR", "message": "Lỗi khi lấy tủ sách cá nhân"})
    return {str(row.get("document_id")) for row in rows or []}


def _apply_filters(query: Any, filters: dict) -> Any:
    categories = filters.get("categories") or []
    file_types = filters.get("file_types") or []
    vector_status = filters.get("vector_status") or []
    tags = filters.get("tags") or []
    updated_ranges = filters.get("updated_ranges") or []

    if categories:
        query = query.in_("category", categories)
    if file_types:
        query = query.in_("file_type", file_types)
    if len(vector_status) == 1:
        query = query.eq("is_vector_ready", vector_status[0] == "ready")
    if tags:
        query = query.contains("tags", tags)
    if updated_ranges:
        now = datetime.now(timezone.utc)
        if "week" in updated_ranges:
            query = query.gte("updated_at", (now - timedelta(days=7)).isoformat())
        elif "month" in updated_ranges:
            query = query.gte("updated_at", (now - timedelta(days=31)).isoformat())
        elif "year" in updated_ranges:
            query = query.gte("updated_at", (now - timedelta(days=365)).isoformat())
    return query


async def _semantic_ranked_rows(query_text: str, candidate_rows: list[dict]) -> list[dict] | None:
    if not query_text.strip() or not candidate_rows:
        return candidate_rows

    candidate_by_id = {str(row.get("id")): row for row in candidate_rows}

    def _call_rpc(vector: list[float]) -> list[dict]:
        vector_str = "[" + ",".join(map(str, vector)) + "]"
        result = supabase.rpc(
            "match_system_documents",
            {
                "query_embedding": vector_str,
                "match_count": min(100, max(10, len(candidate_rows))),
                "match_threshold": 0,
            },
        ).execute()
        return result.data or []

    try:
        query_vector = await embed_query(query_text)
        matches = await asyncio.to_thread(_call_rpc, query_vector)
    except Exception as exc:
        logger.info("System library semantic RPC unavailable; falling back to metadata search: %s", exc)
        return None

    ranked_rows: list[dict] = []
    seen: set[str] = set()
    for match in matches:
        doc_id = str(match.get("id") or match.get("document_id") or match.get("doc_id"))
        if doc_id in candidate_by_id and doc_id not in seen:
            ranked_rows.append({**candidate_by_id[doc_id], "similarity": match.get("similarity") or match.get("score")})
            seen.add(doc_id)
    return ranked_rows


def _metadata_matches(row: dict, terms: list[str]) -> bool:
    if not terms:
        return True
    haystack = " ".join(
        str(value or "")
        for value in [
            row.get("title"), row.get("filename"), row.get("summary"), row.get("category"), " ".join(row.get("tags") or []),
        ]
    ).lower()
    return all(term in haystack for term in terms)


async def list_or_search_documents(user: dict, query_text: str = "", filters: dict | None = None) -> dict:
    user_id = _get_user_id(user)
    filters = filters or {}
    bookmarked_ids = _query_bookmarked_ids(user_id)
    bookmarked_only = bool(filters.get("bookmarked"))

    try:
        query = supabase.table("system_documents").select(SYSTEM_DOCUMENT_COLUMNS)
        query = _apply_filters(query, filters)
        if bookmarked_only:
            if not bookmarked_ids:
                return {"documents": [], "total": 0}
            query = query.in_("id", list(bookmarked_ids))
        query = query.order("updated_at", desc=True).limit(100)
        resp = query.execute()
    except Exception as exc:
        if _is_missing_table_error(exc):
            return {"documents": [], "total": 0}
        logger.exception("List system documents failed")
        raise HTTPException(status_code=500, detail={"code": "INTERNAL_ERROR", "message": "Lỗi khi tải Thư viện Hệ thống"}) from exc

    rows, error = _supabase_response_data(resp)
    if error:
        if _is_missing_table_error(error):
            return {"documents": [], "total": 0}
        raise HTTPException(status_code=500, detail={"code": "INTERNAL_ERROR", "message": "Lỗi khi tải Thư viện Hệ thống"})

    rows = rows or []
    if str(query_text or "").strip():
        semantic_rows = await _semantic_ranked_rows(str(query_text), rows)
        if semantic_rows is not None:
            rows = semantic_rows
        else:
            terms = [term.lower() for term in str(query_text or "").split() if term.strip()]
            rows = [row for row in rows if _metadata_matches(row, terms)]

    documents = [normalize_document(row, bookmarked_ids) for row in rows]
    return {"documents": documents, "total": len(documents)}


def list_admin_documents() -> dict:
    try:
        resp = supabase.table("system_documents").select(SYSTEM_DOCUMENT_COLUMNS).order("created_at", desc=True).limit(200).execute()
    except Exception as exc:
        if _is_missing_table_error(exc):
            return {"documents": [], "total": 0}
        logger.exception("Admin list system documents failed")
        raise HTTPException(status_code=500, detail={"code": "INTERNAL_ERROR", "message": "Lỗi khi tải tài liệu hệ thống"}) from exc
    rows, error = _supabase_response_data(resp)
    if error:
        raise HTTPException(status_code=500, detail={"code": "INTERNAL_ERROR", "message": "Lỗi khi tải tài liệu hệ thống"})
    documents = [normalize_document(row) for row in rows or []]
    return {"documents": documents, "total": len(documents)}


def delete_system_document(document_id: str) -> dict:
    try:
        resp = supabase.table("system_documents").delete().eq("id", document_id).execute()
    except Exception as exc:
        logger.exception("Delete system document failed")
        raise HTTPException(status_code=500, detail={"code": "INTERNAL_ERROR", "message": "Không thể xoá tài liệu hệ thống"}) from exc
    rows, error = _supabase_response_data(resp)
    if error:
        raise HTTPException(status_code=500, detail={"code": "INTERNAL_ERROR", "message": "Không thể xoá tài liệu hệ thống"})
    if not rows:
        raise HTTPException(status_code=404, detail={"code": "DOC_NOT_FOUND", "message": "Không tìm thấy tài liệu hệ thống"})
    return {"document_id": document_id, "deleted": True}


def get_documents_by_ids(document_ids: Iterable[str]) -> list[dict]:
    ids = [str(doc_id) for doc_id in document_ids if doc_id]
    if not ids:
        return []
    try:
        resp = supabase.table("system_documents").select(SYSTEM_DOCUMENT_COLUMNS).in_("id", ids).execute()
    except Exception as exc:
        logger.exception("Get system documents by ids failed")
        raise HTTPException(status_code=500, detail={"code": "INTERNAL_ERROR", "message": "Lỗi khi tải tài liệu hệ thống"}) from exc
    rows, error = _supabase_response_data(resp)
    if error:
        raise HTTPException(status_code=500, detail={"code": "INTERNAL_ERROR", "message": "Lỗi khi tải tài liệu hệ thống"})
    return [normalize_document(row) for row in rows or []]


def add_bookmark(document_id: str, user: dict) -> dict:
    user_id = _get_user_id(user)
    docs = get_documents_by_ids([document_id])
    if not docs:
        raise HTTPException(status_code=404, detail={"code": "DOC_NOT_FOUND", "message": "Không tìm thấy tài liệu hệ thống"})
    try:
        resp = supabase.table("system_document_bookmarks").upsert({"user_id": user_id, "document_id": document_id}, on_conflict="user_id,document_id").execute()
    except Exception as exc:
        logger.exception("Bookmark system document failed")
        raise HTTPException(status_code=500, detail={"code": "INTERNAL_ERROR", "message": "Không thể ghim tài liệu"}) from exc
    _, error = _supabase_response_data(resp)
    if error:
        raise HTTPException(status_code=500, detail={"code": "INTERNAL_ERROR", "message": "Không thể ghim tài liệu"})
    return {"document_id": document_id, "bookmarked": True}


def remove_bookmark(document_id: str, user: dict) -> dict:
    user_id = _get_user_id(user)
    try:
        resp = supabase.table("system_document_bookmarks").delete().eq("user_id", user_id).eq("document_id", document_id).execute()
    except Exception as exc:
        logger.exception("Unbookmark system document failed")
        raise HTTPException(status_code=500, detail={"code": "INTERNAL_ERROR", "message": "Không thể bỏ ghim tài liệu"}) from exc
    _, error = _supabase_response_data(resp)
    if error:
        raise HTTPException(status_code=500, detail={"code": "INTERNAL_ERROR", "message": "Không thể bỏ ghim tài liệu"})
    return {"document_id": document_id, "bookmarked": False}
