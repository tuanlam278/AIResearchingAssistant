"""Community document library service for curated, user-uploaded, and internet papers."""

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
from app.db.supabase_retry import execute_supabase_with_retry
from app.services.chunker import chunk_text
from app.services.document_parser import EmptyDocumentText, UnsupportedDocumentType, parse_document
from app.services.document_structure_service import normalize_plain_text, page_blocks
from app.services.embedder import embed_chunks, embed_query
from app.services.indexing_jobs import create_indexing_job, report_indexing_progress
from app.services.llm import generate_system_document_metadata
from app.services.supabase_storage import download_file as storage_download_file, upload_file as storage_upload_file

logger = logging.getLogger(__name__)

DOCUMENT_STATUSES = {"PUBLISHED", "PENDING_REVIEW", "HIDDEN", "REJECTED", "DELETED", "NEEDS_CHANGES", "PROCESSING"}
USER_UPLOAD_DEFAULT_STATUS = "PENDING_REVIEW"


SOURCE_TYPE_LABELS = {
    "system": "Hệ thống",
    "community": "Cộng đồng",
    "internet": "Internet / OpenAlex",
}
LEGACY_TO_SOURCE_TYPE = {
    "SYSTEM_UPLOAD": "system",
    "SYSTEM": "system",
    "USER_UPLOAD": "community",
    "COMMUNITY": "community",
    "INTERNET": "internet",
}
SOURCE_TYPE_TO_DB = {
    "system": "SYSTEM_UPLOAD",
    "community": "USER_UPLOAD",
    "internet": "INTERNET",
}
REVIEW_STATUS_TO_DB = {
    "pending_review": "PENDING_REVIEW",
    "published": "PUBLISHED",
    "rejected": "REJECTED",
    "needs_changes": "NEEDS_CHANGES",
    "hidden": "HIDDEN",
    "processing": "PROCESSING",
}

def _to_public_source_type(value: str | None) -> str:
    raw = str(value or "SYSTEM_UPLOAD").strip()
    return LEGACY_TO_SOURCE_TYPE.get(raw.upper(), LEGACY_TO_SOURCE_TYPE.get(raw.lower(), raw.lower() if raw.lower() in SOURCE_TYPE_LABELS else "system"))

def _source_label(source_type: str | None) -> str:
    return SOURCE_TYPE_LABELS.get(_to_public_source_type(source_type), "Hệ thống")

def _to_public_review_status(value: str | None) -> str:
    raw = str(value or "PUBLISHED").upper()
    return {v: k for k, v in REVIEW_STATUS_TO_DB.items()}.get(raw, raw.lower())

def _source_filter_values(values: list[str]) -> list[str]:
    mapped = []
    for value in values or []:
        key = str(value or "").strip()
        if not key:
            continue
        db_value = SOURCE_TYPE_TO_DB.get(key.lower(), key.upper())
        if db_value not in mapped:
            mapped.append(db_value)
    return mapped

def _status_filter_values(values: list[str]) -> list[str]:
    mapped = []
    for value in values or []:
        key = str(value or "").strip()
        if not key:
            continue
        db_value = REVIEW_STATUS_TO_DB.get(key.lower(), key.upper())
        if db_value not in mapped:
            mapped.append(db_value)
    return mapped


def normalize_citation_threshold(value: Any, *, maximum: float | None = None) -> float:
    try:
        threshold = float(value)
    except (TypeError, ValueError):
        return 0.0
    if threshold != threshold or threshold < 0:
        return 0.0
    if maximum is not None and threshold > maximum:
        return maximum
    return threshold


SYSTEM_DOCUMENT_COLUMNS = (
    "id, title, filename, file_type, storage_path, download_url, file_size, mime_type, category, tags, "
    "summary, page_count, word_count, is_vector_ready, created_by, created_at, updated_at, "
    "source_type, status, peer_review_status, access_type, review_type, has_pdf, has_code, has_data, "
    "citation_count, vote_avg, vote_count, download_count, uploader_name, doi, external_url, "
    "status_reason, admin_feedback, processing_status, copyright_confirmed, authors, year, venue, open_access_pdf_url, metadata_only"
)

FALLBACK_SYSTEM_DOCUMENT_COLUMNS = (
    "id, title, filename, file_type, storage_path, download_url, file_size, mime_type, category, tags, "
    "summary, page_count, word_count, is_vector_ready, created_by, created_at, updated_at, "
    "source_type, status, peer_review_status, access_type, review_type, has_pdf, has_code, has_data, "
    "citation_count, vote_avg, vote_count, download_count, uploader_name, doi, external_url"
)


def _supabase_response_data(resp: Any):
    if isinstance(resp, dict):
        return resp.get("data"), resp.get("error")
    return getattr(resp, "data", None), getattr(resp, "error", None)


def _is_missing_table_error(exc_or_error: Any) -> bool:
    message = str(exc_or_error or "").lower()
    return any(token in message for token in ["system_documents", "system_document_bookmarks", "does not exist", "not find", "schema cache", "relation"])


def _is_missing_column_error(exc_or_error: Any) -> bool:
    message = str(exc_or_error or "").lower()
    return any(token in message for token in ["column", "schema cache", "could not find", "does not exist"])


def _is_range_not_satisfiable_error(exc_or_error: Any) -> bool:
    message = str(exc_or_error or "").lower()
    code = ""
    if isinstance(exc_or_error, dict):
        code = str(exc_or_error.get("code") or "").lower()
    else:
        code = str(getattr(exc_or_error, "code", "") or "").lower()
    return code == "pgrst103" or "pgrst103" in message or "requested range not satisfiable" in message


def _empty_document_page(page: int, page_size: int) -> dict:
    return {"documents": [], "page": page, "page_size": page_size, "total_count": 0, "total": 0, "has_more": False}


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


def _first_present(row: dict, keys: Iterable[str], default: Any = None) -> Any:
    for key in keys:
        if row.get(key) is not None:
            return row.get(key)
    return default


def _display_uploader(row: dict) -> str:
    source_type = str(row.get("source_type") or "SYSTEM_UPLOAD").upper()
    if source_type == "SYSTEM_UPLOAD" or row.get("uploaded_by_admin"):
        return "Hệ thống"
    return row.get("uploader_name") or row.get("created_by_name") or "Người dùng"


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
    db_source_type = str(row.get("source_type") or "SYSTEM_UPLOAD").upper()
    source_type = _to_public_source_type(db_source_type)
    has_pdf = bool(_first_present(row, ["has_pdf"], False) or str(row.get("file_type") or "").upper() == "PDF" or str(row.get("mime_type") or "").lower() == "application/pdf")
    downloadable = bool(row.get("storage_path") or (row.get("download_url") and str(row.get("access_type") or "").upper() in {"OPEN_ACCESS", "FREE_TO_READ"}))
    is_vector_ready = bool(row.get("is_vector_ready", False))
    metadata_only = bool(row.get("metadata_only", False) or (source_type == "internet" and not is_vector_ready))
    full_text_indexed = bool(is_vector_ready and not metadata_only)
    vote_avg = float(row.get("vote_avg") or row.get("average_rating") or 0)
    vote_count = int(row.get("vote_count") or row.get("rating_count") or 0)
    review_status = _to_public_review_status(row.get("status"))
    processing_status = row.get("processing_status") or ("published" if review_status == "published" else review_status)

    return {
        "id": str(row.get("id")),
        "title": row.get("title") or row.get("filename") or "Tài liệu",
        "filename": row.get("filename") or "",
        "file_type": row.get("file_type") or "FILE",
        "storage_path": row.get("storage_path"),
        "download_url": row.get("download_url"),
        "file_size": row.get("file_size"),
        "mime_type": row.get("mime_type"),
        "can_download": downloadable,
        "downloadable": downloadable,
        "description": row.get("description") or summary,
        "category": category,
        "subject_area": category,
        "tags": tags,
        "summary": summary,
        "ai_summary": summary,
        "page_count": row.get("page_count"),
        "word_count": row.get("word_count"),
        "is_new": bool(row.get("is_new", is_new)),
        "is_vector_ready": is_vector_ready,
        "full_text_indexed": full_text_indexed,
        "metadata_only": metadata_only,
        "updated_at": row.get("updated_at"),
        "created_at": row.get("created_at"),
        "created_by": row.get("created_by"),
        "uploader_name": _display_uploader(row),
        "source_type": source_type,
        "source_label": _source_label(source_type),
        "legacy_source_type": db_source_type,
        "review_status": review_status,
        "status": str(row.get("status") or "PUBLISHED").upper(),
        "status_reason": row.get("status_reason"),
        "admin_feedback": row.get("admin_feedback"),
        "processing_status": processing_status,
        "indexing_job_id": row.get("indexing_job_id"),
        "peer_review_status": str(row.get("peer_review_status") or "UNKNOWN").upper(),
        "access_type": str(row.get("access_type") or "UNKNOWN").upper(),
        "review_type": str(row.get("review_type") or "UNKNOWN").upper(),
        "has_pdf": has_pdf,
        "has_code": bool(row.get("has_code", False)),
        "has_data": bool(row.get("has_data", False)),
        "citation_count": int(row.get("citation_count") or 0),
        "vote_avg": vote_avg,
        "vote_count": vote_count,
        "average_rating": vote_avg,
        "rating_count": vote_count,
        "my_rating": row.get("my_rating"),
        "download_count": int(row.get("download_count") or 0),
        "doi": row.get("doi"),
        "authors": row.get("authors") or [],
        "year": row.get("year"),
        "venue": row.get("venue"),
        "external_url": row.get("external_url") or row.get("url"),
        "open_access_pdf_url": row.get("open_access_pdf_url") or row.get("download_url"),
        "bookmarked_by_current_user": str(row.get("id")) in bookmarked_ids or bool(row.get("bookmarked_by_current_user", False)),
        "is_bookmarked": str(row.get("id")) in bookmarked_ids or bool(row.get("bookmarked_by_current_user", False)),
        "bookmark": {"is_bookmarked": str(row.get("id")) in bookmarked_ids or bool(row.get("bookmarked_by_current_user", False))},
        "rating": {"average": vote_avg, "count": vote_count, "my_rating": row.get("my_rating")},
        "access_badge": "full_text_indexed" if full_text_indexed else ("metadata_only" if metadata_only else ("open_access_pdf" if row.get("download_url") else "external_link_only")),
        "semantic_score": row.get("similarity") or row.get("score"),
    }


def require_admin(user: dict) -> None:
    if str(user.get("role") or "user").lower() != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail={"code": "ADMIN_FORBIDDEN", "message": "Chỉ admin mới được truy cập chức năng này"})


def _profile_for_user_id(user_id: str) -> dict:
    for table in ("profiles", "users"):
        try:
            resp = supabase.table(table).select("*").eq("id", user_id).limit(1).execute()
            rows, error = _supabase_response_data(resp)
            if not error and rows:
                return rows[0]
        except Exception:
            continue
    return {}


def _profile_publish_allowed(profile: dict) -> bool:
    value = profile.get("can_publish_documents")
    if value is None:
        value = profile.get("can_upload_library_documents")
    return value is not False


def _user_can_publish_documents(user: dict) -> bool:
    if str(user.get("role") or "user").lower() == "admin":
        return True
    profile = _profile_for_user_id(_get_user_id(user))
    return _profile_publish_allowed(profile)


def require_library_publish_allowed(user: dict) -> None:
    if not _user_can_publish_documents(user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"code": "LIBRARY_PUBLISH_LOCKED", "message": "Tài khoản của bạn đã bị tạm khóa quyền đăng tài liệu. Vui lòng liên hệ quản trị viên."},
        )


def _normalize_document_status(value: str | None, default: str = "PUBLISHED") -> str:
    normalized = str(value or default).upper()
    if normalized not in DOCUMENT_STATUSES:
        raise HTTPException(status_code=400, detail={"code": "INVALID_DOCUMENT_STATUS", "message": "Trạng thái tài liệu không hợp lệ."})
    return normalized


def set_user_publish_permission(user_id: str, can_publish: bool, reason: str | None = None) -> dict:
    """Update user publish permission and hide public user uploads in one DB transaction.

    The SQL migration defines `public.set_user_publish_permission`, which executes
    the profile/user update and document status transition atomically.
    """

    try:
        resp = supabase.rpc(
            "set_user_publish_permission",
            {
                "target_user_id": user_id,
                "can_publish": can_publish,
                "blocked_reason": reason,
            },
        ).execute()
        rows, error = _supabase_response_data(resp)
        if error:
            raise RuntimeError(error)
        result = rows[0] if isinstance(rows, list) and rows else (rows or {})
    except Exception as exc:
        logger.exception("Set user publish permission transaction failed")
        raise HTTPException(
            status_code=500,
            detail={"code": "PUBLISH_PERMISSION_UPDATE_FAILED", "message": "Không thể cập nhật quyền đăng tài liệu của user."},
        ) from exc
    return {
        "user_id": user_id,
        "canPublishDocuments": can_publish,
        "publishBlockedReason": None if can_publish else reason,
        "publishBlockedAt": None if can_publish else result.get("publish_blocked_at"),
        "hiddenDocuments": int(result.get("hidden_documents") or 0),
    }


def set_user_library_upload_permission(user_id: str, can_upload: bool, hidden_status: str = "HIDDEN") -> dict:
    # Backwards-compatible wrapper for the previous admin endpoint. New code should
    # call set_user_publish_permission, which always hides published documents.
    _ = hidden_status
    return set_user_publish_permission(user_id, can_upload)


def update_library_document_status(document_id: str, next_status: str, reason: str | None = None, admin_user: dict | None = None) -> dict:
    _ = admin_user
    status_value = _normalize_document_status(next_status)
    try:
        payload = {"status": status_value, "status_reason": reason}
        resp = supabase.table("system_documents").update(payload).eq("id", document_id).execute()
        rows, error = _supabase_response_data(resp)
    except Exception as exc:
        logger.exception("Update library document status failed")
        raise HTTPException(status_code=500, detail={"code": "DOCUMENT_STATUS_UPDATE_FAILED", "message": "Không thể cập nhật trạng thái tài liệu."}) from exc
    if error:
        raise HTTPException(status_code=500, detail={"code": "DOCUMENT_STATUS_UPDATE_FAILED", "message": "Không thể cập nhật trạng thái tài liệu."})
    if not rows:
        raise HTTPException(status_code=404, detail={"code": "DOC_NOT_FOUND", "message": "Không tìm thấy tài liệu."})
    return {"document": normalize_document(rows[0]), "status": status_value, "reason": reason}


def list_top_library_tags(limit: int = 24) -> dict:
    try:
        resp = supabase.table("system_documents").select("tags").eq("status", "PUBLISHED").limit(1000).execute()
    except Exception as exc:
        if _is_missing_table_error(exc):
            return {"tags": []}
        raise HTTPException(status_code=500, detail={"code": "INTERNAL_ERROR", "message": "Không thể tải tag gợi ý."}) from exc
    rows, error = _supabase_response_data(resp)
    if error:
        return {"tags": []}
    counts: dict[str, int] = {}
    for row in rows or []:
        for tag in _parse_tags(row.get("tags")):
            counts[tag] = counts.get(tag, 0) + 1
    tags = [{"tag": tag, "count": count} for tag, count in sorted(counts.items(), key=lambda item: (-item[1], item[0].lower()))[:limit]]
    return {"tags": tags}


def _validate_rating_document_type(document_type: str | None) -> str:
    normalized = str(document_type or "system_library").strip().lower()
    if normalized not in {"system_library", "community_library"}:
        raise HTTPException(status_code=400, detail={"code": "INVALID_DOCUMENT_TYPE", "message": "Loại tài liệu không hợp lệ."})
    return normalized


def _rating_aggregate(document_id: str, user_id: str | None = None) -> dict:
    try:
        votes_resp = supabase.table("system_document_votes").select("user_id, rating").eq("document_id", document_id).execute()
    except Exception as exc:
        if _is_missing_table_error(exc):
            return {"document_id": document_id, "average_rating": 0, "rating_count": 0, "my_rating": None, "vote_avg": 0, "vote_count": 0}
        logger.exception("Get document rating failed")
        raise HTTPException(status_code=500, detail={"code": "INTERNAL_ERROR", "message": "Không thể tải đánh giá tài liệu."}) from exc
    votes, vote_error = _supabase_response_data(votes_resp)
    if vote_error:
        raise HTTPException(status_code=500, detail={"code": "INTERNAL_ERROR", "message": "Không thể tải đánh giá tài liệu."})
    ratings = [int(v.get("rating") or 0) for v in votes or [] if int(v.get("rating") or 0) > 0]
    rating_count = len(ratings)
    average_rating = round(sum(ratings) / rating_count, 2) if rating_count else 0
    my_rating = None
    if user_id:
        for vote in votes or []:
            if str(vote.get("user_id")) == str(user_id):
                my_rating = int(vote.get("rating") or 0) or None
                break
    return {
        "document_id": document_id,
        "average_rating": average_rating,
        "rating_count": rating_count,
        "my_rating": my_rating,
        "vote_avg": average_rating,
        "vote_count": rating_count,
    }


def _persist_document_rating_summary(document_id: str, aggregate: dict) -> None:
    try:
        supabase.table("system_documents").update({"vote_avg": aggregate["average_rating"], "vote_count": aggregate["rating_count"]}).eq("id", document_id).execute()
    except Exception:
        logger.warning("Could not sync rating aggregate to system_documents for %s", document_id, exc_info=True)


def get_document_rating(document_id: str, user: dict, document_type: str | None = "system_library") -> dict:
    _validate_rating_document_type(document_type)
    user_id = _get_user_id(user)
    docs = get_documents_by_ids([document_id])
    if not docs:
        raise HTTPException(status_code=404, detail={"code": "DOC_NOT_FOUND", "message": "Không tìm thấy tài liệu."})
    return _rating_aggregate(document_id, user_id)


def rate_document(document_id: str, user: dict, rating: int, document_type: str | None = "system_library") -> dict:
    _validate_rating_document_type(document_type)
    user_id = _get_user_id(user)
    if int(rating) < 1 or int(rating) > 5:
        raise HTTPException(status_code=400, detail={"code": "INVALID_RATING", "message": "Đánh giá phải từ 1 đến 5 sao."})
    docs = get_documents_by_ids([document_id])
    if not docs:
        raise HTTPException(status_code=404, detail={"code": "DOC_NOT_FOUND", "message": "Không tìm thấy tài liệu."})
    try:
        supabase.table("system_document_votes").upsert(
            {"user_id": user_id, "document_id": document_id, "rating": int(rating)},
            on_conflict="user_id,document_id",
        ).execute()
    except Exception as exc:
        logger.exception("Rate document failed")
        raise HTTPException(status_code=500, detail={"code": "INTERNAL_ERROR", "message": "Không thể cập nhật đánh giá tài liệu."}) from exc
    aggregate = _rating_aggregate(document_id, user_id)
    _persist_document_rating_summary(document_id, aggregate)
    return aggregate


def vote_document(document_id: str, user: dict, rating: int) -> dict:
    # Backward-compatible alias for older clients; new UI uses /rating.
    aggregate = rate_document(document_id, user, rating, "system_library")
    return {"document_id": document_id, "rating": aggregate["my_rating"], "vote_avg": aggregate["average_rating"], "vote_count": aggregate["rating_count"]}


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
    display_name = _safe_filename(filename)
    ascii_name = _ascii_download_filename(display_name)
    if "." not in ascii_name.rsplit("/", 1)[-1] and "." in display_name.rsplit("/", 1)[-1]:
        ascii_name = f"{ascii_name}.{display_name.rsplit('.', 1)[-1]}"
    safe_name = re.sub(r"[/\\]+", "-", ascii_name).strip(".-") or "system-document"
    return f"system-library/{document_id}/{safe_name}"


def _guess_mime_type(filename: str, supplied_mime_type: str | None = None) -> str:
    if supplied_mime_type and supplied_mime_type != "application/octet-stream":
        return supplied_mime_type
    return mimetypes.guess_type(filename)[0] or "application/octet-stream"


def _upload_original_file_to_storage(path: str, file_contents: bytes, mime_type: str) -> None:
    try:
        storage_upload_file(settings.SYSTEM_LIBRARY_STORAGE_BUCKET, path, file_contents, mime_type, upsert=False)
    except Exception as exc:
        logger.exception("Upload original system document to storage failed")
        raise HTTPException(
            status_code=500,
            detail={"code": "STORAGE_UPLOAD_FAILED", "message": "Không thể lưu file gốc để tải xuống."},
        ) from exc


def get_system_document_download(document_id: str, user: dict | None = None) -> dict:
    try:
        resp = (
            supabase.table("system_documents")
            .select("id, title, filename, original_filename, file_type, storage_path, download_url, file_size, mime_type, access_type, download_count, status, created_by")
            .eq("id", document_id)
            .single()
            .execute()
        )
    except Exception:
        try:
            resp = (
                supabase.table("system_documents")
                .select("id, title, filename, file_type, storage_path, download_url, file_size, mime_type, access_type, download_count, status, created_by")
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
                .select("id, title, filename, file_type, storage_path, download_url, file_size, mime_type, access_type, download_count, status, created_by")
                .eq("id", document_id)
                .single()
                .execute()
            )
            row, error = _supabase_response_data(retry_resp)
        except Exception as exc:
            logger.exception("Retry lookup system document download metadata failed")
            raise HTTPException(status_code=500, detail={"code": "INTERNAL_ERROR", "message": "Không thể tải tài liệu."}) from exc
    current_status = str(row.get("status") or "PUBLISHED").upper()
    current_user_id = str((user or {}).get("id") or (user or {}).get("user_id") or "")
    is_owner_or_admin = bool(user and (str(user.get("role") or "user").lower() == "admin" or str(row.get("created_by")) == current_user_id))
    if error or not row or (current_status != "PUBLISHED" and not is_owner_or_admin):
        raise HTTPException(status_code=404, detail={"code": "DOC_NOT_FOUND", "message": "Không tìm thấy tài liệu hoặc tài liệu không còn được công khai."})

    filename = _display_download_filename(row)
    storage_path = row.get("storage_path")
    download_url = row.get("download_url")
    mime_type = row.get("mime_type") or _guess_mime_type(filename)

    if storage_path:
        try:
            supabase.table("system_documents").update({"download_count": int(row.get("download_count") or 0) + 1}).eq("id", document_id).execute()
        except Exception:
            logger.info("Could not increment library document download_count")
        try:
            contents = storage_download_file(settings.SYSTEM_LIBRARY_STORAGE_BUCKET, storage_path)
        except Exception as exc:
            logger.exception("Download original system document from storage failed")
            raise HTTPException(status_code=404, detail={"code": "FILE_NOT_FOUND", "message": "Không tìm thấy file để tải xuống."}) from exc
        return {"type": "bytes", "content": contents, "filename": filename, "mime_type": mime_type}

    if download_url and str(row.get("access_type") or "").upper() in {"OPEN_ACCESS", "FREE_TO_READ"}:
        try:
            supabase.table("system_documents").update({"download_count": int(row.get("download_count") or 0) + 1}).eq("id", document_id).execute()
        except Exception:
            logger.info("Could not increment library document download_count")
        return {"type": "redirect", "url": download_url}

    raise HTTPException(status_code=404, detail={"code": "FILE_NOT_FOUND", "message": "Không tìm thấy file để tải xuống."})


def _parse_tags(raw_tags: str | list[str] | None) -> list[str]:
    if isinstance(raw_tags, list):
        source = raw_tags
    else:
        source = str(raw_tags or "").split(",")
    cleaned: list[str] = []
    for tag in source:
        value = str(tag or "").strip().lstrip("#").lower()
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


async def _replace_system_document_structure(document_id: str, pages: list[dict] | None) -> None:
    if not pages:
        return
    page_rows = [
        {
            "document_id": document_id,
            "page": int(page.get("page") or page.get("page_number") or index),
            "markdown": str(page.get("markdown") or page.get("content") or ""),
            "plain_text": str(page.get("plain_text") or normalize_plain_text(page.get("markdown") or page.get("content") or "")),
        }
        for index, page in enumerate(pages, start=1)
        if str(page.get("markdown") or page.get("content") or "").strip()
    ]
    block_rows = [
        {
            "document_id": document_id,
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
            execute_supabase_with_retry(lambda: supabase.table("system_document_pages").delete().eq("document_id", document_id).execute(), label=f"delete system_document_pages document_id={document_id}")
            execute_supabase_with_retry(lambda: supabase.table("system_document_blocks").delete().eq("document_id", document_id).execute(), label=f"delete system_document_blocks document_id={document_id}")
            for start in range(0, len(page_rows), batch_size):
                execute_supabase_with_retry(lambda batch=page_rows[start : start + batch_size]: supabase.table("system_document_pages").insert(batch).execute(), label=f"insert system_document_pages document_id={document_id}")
            for start in range(0, len(block_rows), batch_size):
                execute_supabase_with_retry(lambda batch=block_rows[start : start + batch_size]: supabase.table("system_document_blocks").insert(batch).execute(), label=f"insert system_document_blocks document_id={document_id}")
        except Exception as exc:
            logger.warning("Structured system document persist skipped for %s: %s", document_id, exc)

    await asyncio.to_thread(_call)


async def _finalize_system_document_vectors(document_id: str, chunks: list[dict], document_status: str, rows: list[dict] | None = None, job_id: str | None = None, pages: list[dict] | None = None) -> dict:
    """Embed and persist System Library chunks; safe to run in request or background."""
    await _replace_system_document_structure(document_id, pages)
    await report_indexing_progress(job_id, stage="embedding", progress=60, message="Đang tạo embedding thư viện")
    texts = [chunk["content"] for chunk in chunks]
    embeddings = await embed_chunks(texts)
    chunk_rows = [
        {
            "document_id": document_id,
            "content": chunks[index]["content"],
            "markdown": chunks[index].get("markdown") or chunks[index]["content"],
            "page_start": chunks[index].get("page_start") or chunks[index].get("page_number"),
            "page_end": chunks[index].get("page_end") or chunks[index].get("page_number"),
            "block_types": chunks[index].get("block_types") or [],
            "block_ids": chunks[index].get("block_ids") or [],
            "contains_table": bool(chunks[index].get("contains_table")),
            "contains_equation": bool(chunks[index].get("contains_equation")),
            "embedding": "[" + ",".join(map(str, embeddings[index])) + "]",
        }
        for index in range(len(chunks))
    ]
    batch_size = max(1, int(getattr(settings, "SUPABASE_VECTOR_INSERT_BATCH_SIZE", getattr(settings, "INDEX_INSERT_BATCH_SIZE", 25)) or 25))

    def _insert_batches() -> None:
        execute_supabase_with_retry(lambda: supabase.table("system_document_chunks").delete().eq("document_id", document_id).execute(), label=f"delete system_document_chunks document_id={document_id}")
        for start in range(0, len(chunk_rows), batch_size):
            batch = chunk_rows[start : start + batch_size]
            try:
                execute_supabase_with_retry(lambda: supabase.table("system_document_chunks").insert(batch).execute(), label=f"insert system_document_chunks document_id={document_id}")
            except Exception as exc:
                legacy_batch = [
                    {key: row[key] for key in ("document_id", "content", "page_start", "page_end", "embedding") if key in row}
                    for row in batch
                ]
                logger.warning("Extended system chunk metadata insert failed; retrying legacy columns: %s", exc)
                execute_supabase_with_retry(lambda: supabase.table("system_document_chunks").insert(legacy_batch).execute(), label=f"insert legacy system_document_chunks document_id={document_id}")

    await report_indexing_progress(job_id, stage="inserting", progress=88, message="Đang lưu vector thư viện")
    await asyncio.to_thread(_insert_batches)
    final_processing_status = "published" if _normalize_document_status(document_status) == "PUBLISHED" else "pending_review"
    try:
        update_resp = supabase.table("system_documents").update({"is_vector_ready": True, "processing_status": final_processing_status}).eq("id", document_id).execute()
    except Exception:
        update_resp = supabase.table("system_documents").update({"is_vector_ready": True}).eq("id", document_id).execute()
    updated_rows, update_error = _supabase_response_data(update_resp)
    if update_error:
        raise RuntimeError(update_error)
    await report_indexing_progress(job_id, stage="ready", progress=100, message="Index thư viện hoàn tất")
    return updated_rows[0] if updated_rows else {**((rows or [{}])[0]), "is_vector_ready": True, "processing_status": final_processing_status}


async def create_system_document_indexing_job(*, document_id: str, storage_path: str, filename: str, document_status: str, user_id: str | None = None) -> dict:
    return await create_indexing_job(
        job_type="system_document",
        resource_id=document_id,
        user_id=user_id,
        payload={
            "document_id": document_id,
            "storage_path": storage_path,
            "filename": filename,
            "document_status": document_status,
        },
    )


async def process_system_document_indexing_job(job: dict[str, Any]) -> dict[str, Any]:
    payload = job.get("payload") or {}
    document_id = str(payload.get("document_id") or job.get("resource_id"))
    storage_path = str(payload.get("storage_path") or "")
    filename = str(payload.get("filename") or "system-document")
    document_status = str(payload.get("document_status") or "PUBLISHED")
    if not storage_path:
        raise RuntimeError("System document indexing job has no storage_path")

    try:
        await report_indexing_progress(str(job.get("id")), stage="parsing", progress=15, message="Đang đọc tài liệu thư viện")
        file_contents = await asyncio.to_thread(lambda: storage_download_file(settings.SYSTEM_LIBRARY_STORAGE_BUCKET, storage_path))
        pages, _parsed_file_type = await parse_document(file_contents, filename)
        await report_indexing_progress(str(job.get("id")), stage="chunking", progress=35, message="Đang chia nhỏ tài liệu thư viện")
        chunks = chunk_text(pages)
        if not chunks:
            raise EmptyDocumentText("Không tạo được chunk nội dung từ file này")
        return await _finalize_system_document_vectors(document_id, chunks, document_status, job_id=str(job.get("id")), pages=pages)
    except Exception:
        try:
            supabase.table("system_documents").update({"is_vector_ready": False, "processing_status": "failed"}).eq("id", document_id).execute()
        except Exception:
            logger.warning("Could not mark failed system document %s", document_id)
        raise



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
    description: str | None = None,
    category: str | None = None,
    tags: str | list[str] | None = None,
    mime_type: str | None = None,
    citation_threshold: float | int | str | None = 0,
    source_type: str = "SYSTEM_UPLOAD",
    document_status: str = "PUBLISHED",
    uploader_name: str = "Hệ thống",
    copyright_confirmed: bool | None = None,
    processing_status: str | None = None,
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

    citation_threshold_value = normalize_citation_threshold(citation_threshold)
    metadata = await _auto_metadata(pages, chunks, category, tags)
    resolved_mime_type = _guess_mime_type(filename, mime_type)
    document_payload = {
        "title": (title or filename).strip(),
        "filename": filename,
        "file_type": _format_system_file_type(parsed_file_type),
        "category": metadata["category"],
        "tags": metadata["tags"],
        "description": (description or "").strip() or None,
        "summary": metadata["summary"],
        "page_count": len(pages),
        "word_count": _estimate_word_count(pages),
        "file_size": len(file_contents),
        "mime_type": resolved_mime_type,
        "citation_threshold": citation_threshold_value,
        "created_by": _valid_uuid_or_none(created_by),
        "uploader_name": uploader_name,
        "source_type": source_type,
        "status": _normalize_document_status(document_status),
        "peer_review_status": "UNKNOWN",
        "access_type": "OPEN_ACCESS",
        "review_type": "UNKNOWN",
        "has_pdf": _format_system_file_type(parsed_file_type) == "PDF",
        "has_code": False,
        "has_data": False,
        "citation_count": 0,
        "download_count": 0,
        "vote_avg": 0,
        "vote_count": 0,
        "is_vector_ready": False,
        "metadata_only": False,
        "copyright_confirmed": copyright_confirmed,
        "processing_status": processing_status or "embedding",
    }

    try:
        resp = supabase.table("system_documents").insert(document_payload).execute()
    except Exception:
        # Backward-compatible fallback until optional metadata columns are applied.
        for optional_key in ("citation_threshold", "description", "metadata_only", "copyright_confirmed", "processing_status"):
            document_payload.pop(optional_key, None)
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
        if getattr(settings, "BACKGROUND_INDEXING_ENABLED", True):
            job = await create_system_document_indexing_job(
                document_id=document_id,
                storage_path=storage_path,
                filename=filename,
                document_status=document_status,
                user_id=created_by,
            )
            source = {**rows[0], "is_vector_ready": False, "processing_status": "embedding", "indexing_job_id": job.get("id")}
        else:
            source = await _finalize_system_document_vectors(document_id, chunks, document_status, rows, pages=pages)
    except Exception as exc:
        logger.exception("System document embedding/chunk insert failed")
        try:
            supabase.table("system_documents").delete().eq("id", document_id).execute()
        except Exception:
            logger.warning("Could not rollback failed system document %s", document_id)
        raise HTTPException(status_code=500, detail={"code": "INDEX_FAILED", "message": "Upload thành công nhưng index/vector hóa thất bại"}) from exc

    return normalize_document(source)


def _query_bookmarked_ids(user_id: str) -> set[str]:
    if not _valid_uuid_or_none(user_id):
        return set()
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
    tags = filters.get("tags") or []
    peer_review_status = filters.get("peer_review_status") or []
    access_types = filters.get("access_types") or filters.get("access_type") or []
    review_types = filters.get("review_types") or filters.get("review_type") or []
    source_types = _source_filter_values(filters.get("source_types") or [])
    statuses = _status_filter_values(filters.get("review_statuses") or filters.get("statuses") or ["published"])
    categories = filters.get("categories") or []

    if statuses:
        query = query.in_("status", statuses)
    if source_types:
        query = query.in_("source_type", source_types)
    if peer_review_status:
        query = query.in_("peer_review_status", peer_review_status)
    if access_types:
        query = query.in_("access_type", access_types)
    if review_types:
        query = query.in_("review_type", review_types)
    if filters.get("has_pdf"):
        query = query.eq("has_pdf", True)
    if filters.get("has_data"):
        query = query.eq("has_data", True)
    if filters.get("has_code"):
        query = query.eq("has_code", True)
    if categories:
        query = query.in_("category", categories)
    if filters.get("is_vector_ready") is not None and filters.get("is_vector_ready") != "":
        query = query.eq("is_vector_ready", bool(filters.get("is_vector_ready")))
    if filters.get("downloadable") is True:
        # File-backed uploads always have storage_path; OpenAlex OA PDFs have download_url.
        query = query.or_("storage_path.not.is.null,download_url.not.is.null")
    if filters.get("year_from") not in (None, ""):
        query = query.gte("year", int(filters.get("year_from")))
    if filters.get("year_to") not in (None, ""):
        query = query.lte("year", int(filters.get("year_to")))
    if filters.get("has_doi") is True:
        query = query.not_.is_("doi", "null")
    citation_min = filters.get("citation_count_min")
    if citation_min not in (None, ""):
        try:
            citation_threshold = max(0, int(float(citation_min)))
        except (TypeError, ValueError):
            citation_threshold = 0
        query = query.gte("citation_count", citation_threshold)
    if tags:
        query = query.contains("tags", tags)
    return query


def _apply_sort(query: Any, sort: str, has_query: bool) -> Any:
    sort = str(sort or "newest")
    if sort == "title_az":
        return query.order("title", desc=False)
    if sort == "title_za":
        return query.order("title", desc=True)
    if sort == "vote_highest":
        return query.order("vote_avg", desc=True).order("vote_count", desc=True)
    if sort == "citation_highest":
        return query.order("citation_count", desc=True)
    if sort == "download_highest":
        return query.order("download_count", desc=True)
    # semantic_relevance is handled after vector ranking when a search query exists.
    return query.order("created_at", desc=True)


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
    page = max(1, int(filters.get("page") or 1))
    page_size = min(100, max(1, int(filters.get("page_size") or 20)))
    offset = (page - 1) * page_size
    my_documents = bool(filters.get("my_documents"))
    if my_documents and not (filters.get("review_statuses") or filters.get("statuses")):
        filters = {**filters, "statuses": sorted(DOCUMENT_STATUSES)}
    bookmarked_ids = _query_bookmarked_ids(user_id)
    bookmarked_only = bool(filters.get("bookmarked"))

    def build_query(columns: str):
        query = supabase.table("system_documents").select(columns, count="exact")
        query = _apply_filters(query, filters)
        if my_documents:
            query = query.eq("created_by", user_id)
        if bookmarked_only:
            query = query.in_("id", list(bookmarked_ids))
        if str(query_text or "").strip():
            term = str(query_text).strip().replace("%", "")
            query = query.or_(f"title.ilike.%{term}%,filename.ilike.%{term}%,summary.ilike.%{term}%,category.ilike.%{term}%")
        query = _apply_sort(query, filters.get("sort"), bool(str(query_text or "").strip()))
        return query.range(offset, offset + page_size - 1)

    if bookmarked_only and not bookmarked_ids:
        return _empty_document_page(page, page_size)

    try:
        resp = build_query(SYSTEM_DOCUMENT_COLUMNS).execute()
    except Exception as exc:
        if _is_range_not_satisfiable_error(exc):
            logger.info("System library page range is out of bounds (page=%s, page_size=%s): %s", page, page_size, exc)
            return _empty_document_page(page, page_size)
        if _is_missing_table_error(exc):
            return _empty_document_page(page, page_size)
        if _is_missing_column_error(exc):
            try:
                resp = build_query(FALLBACK_SYSTEM_DOCUMENT_COLUMNS).execute()
            except Exception as fallback_exc:
                if _is_range_not_satisfiable_error(fallback_exc):
                    logger.info("System library fallback page range is out of bounds (page=%s, page_size=%s): %s", page, page_size, fallback_exc)
                    return _empty_document_page(page, page_size)
                raise
        else:
            logger.exception("List system documents failed")
            raise HTTPException(status_code=500, detail={"code": "INTERNAL_ERROR", "message": "Lỗi khi tải Thư viện tài liệu"}) from exc

    rows, error = _supabase_response_data(resp)
    if error:
        if _is_range_not_satisfiable_error(error):
            logger.info("System library page range is out of bounds (page=%s, page_size=%s): %s", page, page_size, error)
            return _empty_document_page(page, page_size)
        if _is_missing_table_error(error):
            return _empty_document_page(page, page_size)
        if _is_missing_column_error(error):
            try:
                resp = build_query(FALLBACK_SYSTEM_DOCUMENT_COLUMNS).execute()
            except Exception as fallback_exc:
                if _is_range_not_satisfiable_error(fallback_exc):
                    logger.info("System library fallback page range is out of bounds (page=%s, page_size=%s): %s", page, page_size, fallback_exc)
                    return _empty_document_page(page, page_size)
                raise
            rows, error = _supabase_response_data(resp)
        if error:
            if _is_range_not_satisfiable_error(error):
                return _empty_document_page(page, page_size)
            raise HTTPException(status_code=500, detail={"code": "INTERNAL_ERROR", "message": "Lỗi khi tải Thư viện tài liệu"})

    rows = rows or []
    semantic_fallback = False
    if str(query_text or "").strip():
        # NOTE: legacy RPC ranks candidate rows returned by metadata filters. Keep fallback explicit
        # until the DB RPC supports full-library vector search with all facets.
        semantic_rows = await _semantic_ranked_rows(str(query_text), rows)
        if semantic_rows is not None:
            rows = semantic_rows
        else:
            semantic_fallback = True
            terms = [term.lower() for term in str(query_text or "").split() if term.strip()]
            rows = [row for row in rows if _metadata_matches(row, terms)]

    documents = [normalize_document(row, bookmarked_ids) for row in rows]
    total_count = int(getattr(resp, "count", None) or len(documents))
    return {
        "documents": documents,
        "page": page,
        "page_size": page_size,
        "total_count": total_count,
        "total": total_count,
        "has_more": offset + len(documents) < total_count,
        "semantic_fallback": semantic_fallback,
    }

def list_admin_documents() -> dict:
    try:
        resp = supabase.table("system_documents").select(SYSTEM_DOCUMENT_COLUMNS).order("created_at", desc=True).limit(200).execute()
    except Exception as exc:
        if _is_missing_table_error(exc):
            return {"documents": [], "total": 0}
        if _is_missing_column_error(exc):
            resp = supabase.table("system_documents").select(FALLBACK_SYSTEM_DOCUMENT_COLUMNS).order("created_at", desc=True).limit(200).execute()
        else:
            logger.exception("Admin list system documents failed")
            raise HTTPException(status_code=500, detail={"code": "INTERNAL_ERROR", "message": "Lỗi khi tải tài liệu hệ thống"}) from exc
    rows, error = _supabase_response_data(resp)
    if error and _is_missing_column_error(error):
        resp = supabase.table("system_documents").select(FALLBACK_SYSTEM_DOCUMENT_COLUMNS).order("created_at", desc=True).limit(200).execute()
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

async def import_community_document_from_upload(
    *,
    file_contents: bytes,
    filename: str,
    user: dict,
    title: str | None = None,
    description: str | None = None,
    category: str | None = None,
    tags: str | list[str] | None = None,
    mime_type: str | None = None,
    citation_threshold: float | int | str | None = 0,
    copyright_confirmed: bool = False,
) -> dict:
    require_library_publish_allowed(user)
    if not copyright_confirmed:
        raise HTTPException(status_code=400, detail={"code": "COPYRIGHT_CONFIRMATION_REQUIRED", "message": "Bạn cần xác nhận quyền chia sẻ và bản quyền trước khi upload."})
    user_id = _get_user_id(user)
    profile = _profile_for_user_id(user_id)
    uploader_name = profile.get("display_name") or profile.get("full_name") or user.get("name") or user.get("email") or "Người dùng"
    default_status = "PUBLISHED" if str(user.get("role") or "user").lower() == "admin" else USER_UPLOAD_DEFAULT_STATUS
    document = await import_system_document_from_upload(
        file_contents=file_contents,
        filename=filename,
        created_by=user_id,
        title=title,
        description=description,
        category=category,
        tags=tags,
        mime_type=mime_type,
        citation_threshold=citation_threshold,
        source_type="USER_UPLOAD",
        document_status=default_status,
        uploader_name=uploader_name,
        copyright_confirmed=True,
        processing_status="uploaded",
    )
    try:
        payload = {"source_type": "USER_UPLOAD", "uploader_name": uploader_name, "status": default_status, "copyright_confirmed": True}
        payload["processing_status"] = ("pending_review" if default_status == "PENDING_REVIEW" else "published") if document.get("is_vector_ready") else "embedding"
        resp = supabase.table("system_documents").update(payload).eq("id", document["id"]).execute()
        rows, error = _supabase_response_data(resp)
        if not error and rows:
            return normalize_document(rows[0])
    except Exception:
        logger.info("Could not update uploaded document community metadata; returning base document")
    return {**document, "source_type": "USER_UPLOAD", "uploader_name": uploader_name, "status": default_status}


async def import_internet_paper_to_library(paper: dict, user: dict) -> dict:
    require_library_publish_allowed(user)
    user_id = _get_user_id(user)
    profile = _profile_for_user_id(user_id)
    default_status = "PUBLISHED" if str(user.get("role") or "user").lower() == "admin" else USER_UPLOAD_DEFAULT_STATUS
    uploader_name = profile.get("display_name") or profile.get("full_name") or user.get("name") or user.get("email") or "Người dùng"
    fallback_tags = _parse_tags(paper.get("tags") or paper.get("concepts") or [paper.get("source") or "internet"])
    fallback_summary = paper.get("abstract") or paper.get("summary") or ""
    metadata_input = "\n".join(
        str(part)
        for part in [
            paper.get("title"),
            fallback_summary,
            ", ".join(paper.get("authors") or []),
            paper.get("venue") or paper.get("source"),
            ", ".join(fallback_tags),
        ]
        if part
    )
    try:
        ai_metadata = await generate_system_document_metadata(metadata_input) if metadata_input else {}
    except Exception as exc:
        logger.info("AI metadata scan for imported internet paper failed; using provider metadata: %s", exc)
        ai_metadata = {}

    scanned_tags = _parse_tags(ai_metadata.get("tags") or [])
    scanned_summary = str(ai_metadata.get("summary") or "").strip()
    scanned_category = str(ai_metadata.get("category") or "").strip()

    has_pdf = bool(paper.get("has_pdf") or paper.get("hasPdf") or paper.get("pdf_url") or paper.get("pdfUrl"))
    is_open_access = bool(paper.get("is_open_access") or paper.get("isOpenAccess"))
    pdf_url = paper.get("pdf_url") or paper.get("pdfUrl")
    external_url = paper.get("landing_page_url") or paper.get("openalex_url") or paper.get("url")
    doi = paper.get("doi")
    try:
        dup_query = supabase.table("system_documents").select(SYSTEM_DOCUMENT_COLUMNS).eq("source_type", "INTERNET")
        if doi:
            dup_query = dup_query.eq("doi", doi)
        elif external_url:
            dup_query = dup_query.eq("external_url", external_url)
        else:
            dup_query = None
        if dup_query is not None:
            dup_resp = dup_query.limit(1).execute()
            dup_rows, dup_error = _supabase_response_data(dup_resp)
            if not dup_error and dup_rows:
                duplicate = normalize_document(dup_rows[0])
                duplicate["duplicate"] = True
                return duplicate
    except Exception:
        logger.info("OpenAlex duplicate check skipped", exc_info=True)
    payload = {
        "title": paper.get("title") or "Internet paper",
        "filename": paper.get("title") or paper.get("externalId") or paper.get("id") or "internet-paper",
        "file_type": "PDF" if has_pdf else "LINK",
        "download_url": pdf_url if (is_open_access and pdf_url) else None,
        "mime_type": "application/pdf" if has_pdf else None,
        "category": scanned_category or "Internet",
        "tags": scanned_tags or fallback_tags,
        "summary": scanned_summary or fallback_summary,
        "created_by": _valid_uuid_or_none(user_id),
        "uploader_name": uploader_name,
        "source_type": "INTERNET",
        "status": default_status,
        "peer_review_status": paper.get("peer_review_status") or paper.get("peerReviewStatus") or "UNKNOWN",
        "access_type": paper.get("access_type") or paper.get("accessType") or ("OPEN_ACCESS" if is_open_access else "UNKNOWN"),
        "review_type": paper.get("review_type") or paper.get("reviewType") or "UNKNOWN",
        "has_pdf": has_pdf,
        "has_code": bool(paper.get("has_code") or paper.get("hasCode")),
        "has_data": bool(paper.get("has_data") or paper.get("hasData")),
        "citation_count": int(paper.get("citation_count") or paper.get("citationCount") or 0),
        "doi": doi,
        "authors": paper.get("authors") or [],
        "year": paper.get("year"),
        "venue": paper.get("venue") or paper.get("source"),
        "external_url": external_url,
        "open_access_pdf_url": pdf_url,
        "metadata_only": True,
        "processing_status": "metadata_only",
        "download_count": 0,
        "vote_avg": 0,
        "vote_count": 0,
        "is_vector_ready": False,
    }
    try:
        resp = supabase.table("system_documents").insert(payload).execute()
        rows, error = _supabase_response_data(resp)
    except Exception as exc:
        for optional_key in ("authors", "year", "venue", "open_access_pdf_url", "metadata_only", "processing_status"):
            payload.pop(optional_key, None)
        try:
            resp = supabase.table("system_documents").insert(payload).execute()
            rows, error = _supabase_response_data(resp)
        except Exception as retry_exc:
            logger.exception("Import internet paper failed")
            raise HTTPException(status_code=500, detail={"code": "DB_INSERT_FAILED", "message": "Không thể import paper vào thư viện."}) from retry_exc
    if error or not rows:
        raise HTTPException(status_code=500, detail={"code": "DB_INSERT_FAILED", "message": "Không thể import paper vào thư viện."})
    return normalize_document(rows[0])

def _get_owned_document_row(document_id: str, user: dict) -> dict:
    user_id = _get_user_id(user)
    try:
        resp = supabase.table("system_documents").select(SYSTEM_DOCUMENT_COLUMNS).eq("id", document_id).single().execute()
        row, error = _supabase_response_data(resp)
    except Exception as exc:
        logger.exception("Lookup owned library document failed")
        raise HTTPException(status_code=500, detail={"code": "DOC_LOOKUP_FAILED", "message": "Không thể tải tài liệu."}) from exc
    if error or not row:
        raise HTTPException(status_code=404, detail={"code": "DOC_NOT_FOUND", "message": "Không tìm thấy tài liệu."})
    if str(user.get("role") or "user").lower() != "admin" and str(row.get("created_by")) != user_id:
        raise HTTPException(status_code=403, detail={"code": "DOCUMENT_FORBIDDEN", "message": "Bạn chỉ được quản lý tài liệu của chính mình."})
    return row


def update_my_library_document(document_id: str, user: dict, payload: dict) -> dict:
    row = _get_owned_document_row(document_id, user)
    status_value = str(row.get("status") or "PUBLISHED").upper()
    editable_statuses = {"PENDING_REVIEW", "REJECTED", "NEEDS_CHANGES", "PROCESSING"}
    if status_value not in editable_statuses and str(user.get("role") or "user").lower() != "admin":
        raise HTTPException(status_code=400, detail={"code": "DOCUMENT_NOT_EDITABLE", "message": "Tài liệu đã public chỉ có thể chỉnh sửa sau khi gửi yêu cầu duyệt lại."})
    update_payload = {}
    for key in ("title", "description", "category"):
        if key in payload:
            update_payload[key] = (payload.get(key) or "").strip() or None
    if "tags" in payload:
        update_payload["tags"] = _parse_tags(payload.get("tags"))
    if update_payload:
        update_payload["status"] = "PENDING_REVIEW" if status_value in {"REJECTED", "NEEDS_CHANGES"} else status_value
        update_payload["status_reason"] = None
        update_payload["admin_feedback"] = None
        update_payload["processing_status"] = "pending_review"
    try:
        resp = supabase.table("system_documents").update(update_payload).eq("id", document_id).execute()
        rows, error = _supabase_response_data(resp)
    except Exception as exc:
        logger.exception("Update owned library document failed")
        raise HTTPException(status_code=500, detail={"code": "DOC_UPDATE_FAILED", "message": "Không thể cập nhật tài liệu."}) from exc
    if error or not rows:
        raise HTTPException(status_code=500, detail={"code": "DOC_UPDATE_FAILED", "message": "Không thể cập nhật tài liệu."})
    return {"document": normalize_document(rows[0])}


def delete_my_library_document(document_id: str, user: dict) -> dict:
    _get_owned_document_row(document_id, user)
    try:
        resp = supabase.table("system_documents").update({"status": "DELETED", "processing_status": "deleted"}).eq("id", document_id).execute()
        rows, error = _supabase_response_data(resp)
    except Exception as exc:
        logger.exception("Delete owned library document failed")
        raise HTTPException(status_code=500, detail={"code": "DOC_DELETE_FAILED", "message": "Không thể xoá tài liệu."}) from exc
    if error or not rows:
        raise HTTPException(status_code=500, detail={"code": "DOC_DELETE_FAILED", "message": "Không thể xoá tài liệu."})
    return {"document_id": document_id, "deleted": True}


def resubmit_my_library_document(document_id: str, user: dict) -> dict:
    row = _get_owned_document_row(document_id, user)
    if str(row.get("status") or "").upper() not in {"REJECTED", "NEEDS_CHANGES", "HIDDEN"}:
        raise HTTPException(status_code=400, detail={"code": "RESUBMIT_NOT_ALLOWED", "message": "Chỉ tài liệu bị từ chối/cần chỉnh sửa mới gửi duyệt lại."})
    try:
        resp = supabase.table("system_documents").update({"status": "PENDING_REVIEW", "status_reason": None, "admin_feedback": None, "processing_status": "pending_review"}).eq("id", document_id).execute()
        rows, error = _supabase_response_data(resp)
    except Exception as exc:
        logger.exception("Resubmit owned library document failed")
        raise HTTPException(status_code=500, detail={"code": "DOC_RESUBMIT_FAILED", "message": "Không thể gửi duyệt lại."}) from exc
    if error or not rows:
        raise HTTPException(status_code=500, detail={"code": "DOC_RESUBMIT_FAILED", "message": "Không thể gửi duyệt lại."})
    return {"document": normalize_document(rows[0])}
