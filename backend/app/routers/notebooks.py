import logging
from typing import List, Any

from fastapi import APIRouter, Depends, UploadFile, File, Form, HTTPException, status
from pydantic import BaseModel, Field

from app.dependencies import get_current_user
from app.services.document_parser import (
    EmptyDocumentText,
    UnsupportedDocumentType,
    get_file_type,
    parse_document,
)
from app.services.chunker import chunk_text
from app.services.embedder import embed_chunks
from app.db.supabase_client import supabase
from app.config import settings
from app.services.activity_log_service import log_user_activity

logger = logging.getLogger(__name__)


def _normalize_citation_threshold(value: Any) -> float:
    try:
        threshold = float(value)
    except (TypeError, ValueError):
        return 0.0
    if threshold != threshold or threshold < 0:
        return 0.0
    return threshold


def _parse_tags(raw_tags: str | None) -> list[str]:
    tags: list[str] = []
    for item in str(raw_tags or "").split(","):
        tag = item.strip().lstrip("#").lower()
        if tag and tag not in tags:
            tags.append(tag)
    return tags

router = APIRouter(tags=["notebooks"])


# ---------------------------
# Helper
# ---------------------------

def _supabase_response_data(resp: Any):
    if isinstance(resp, dict):
        return resp.get("data"), resp.get("error")
    return getattr(resp, "data", None), getattr(resp, "error", None)


def _get_user_id(user: dict) -> str:
    user_id = user.get("id") or user.get("user_id")
    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"code": "UNAUTHORIZED", "message": "Token không hợp lệ"},
        )
    return user_id


# ---------------------------
# Pydantic Schemas
# ---------------------------

class CreateNotebookRequest(BaseModel):
    name: str


class UpdateNotebookRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    is_starred: bool | None = None


class NotebookItem(BaseModel):
    notebook_id: str
    name: str
    created_at: str
    is_starred: bool = False


class NotebookListResponse(BaseModel):
    success: bool = True
    data: dict

# ---------------------------
# Endpoints
# ---------------------------

@router.post("", response_model=dict)
async def create_notebook(
    body: CreateNotebookRequest,
    user: dict = Depends(get_current_user),
):
    """Tạo một notebook mới cho user đang đăng nhập."""
    user_id = _get_user_id(user)

    try:
        resp = supabase.table("notebooks").insert({
            "user_id": user_id,
            "name": body.name,
        }).execute()
    except Exception:
        logger.exception("Supabase insert notebook failed")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"code": "INTERNAL_ERROR", "message": "Lỗi khi tạo notebook"},
        )

    data, error = _supabase_response_data(resp)
    if error or not data:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"code": "INTERNAL_ERROR", "message": "Lỗi khi tạo notebook"},
        )

    created = data[0]
    return {
        "success": True,
        "data": {
            "notebook_id": created["id"],
            "name": created["name"],
            "created_at": created["created_at"],
            "is_starred": created.get("is_starred", False),
        },
    }


@router.get("", response_model=dict)
async def list_notebooks(user: dict = Depends(get_current_user)):
    """Lấy danh sách notebooks của user đang đăng nhập."""
    user_id = _get_user_id(user)

    try:
        resp = supabase.table("notebooks").select(
            "id, name, created_at, is_starred"
        ).eq("user_id", user_id).order("is_starred", desc=True).order("created_at", desc=True).execute()
    except Exception:
        logger.exception("Supabase select notebooks failed")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"code": "INTERNAL_ERROR", "message": "Lỗi khi lấy danh sách notebook"},
        )

    data, error = _supabase_response_data(resp)
    if error:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"code": "INTERNAL_ERROR", "message": "Lỗi khi lấy danh sách notebook"},
        )

    notebooks = [
        {"notebook_id": row["id"], "name": row["name"], "created_at": row["created_at"], "is_starred": row.get("is_starred", False)}
        for row in (data or [])
    ]

    return {"success": True, "data": {"notebooks": notebooks, "total": len(notebooks)}}


@router.patch("/{notebook_id}", response_model=dict)
async def update_notebook(
    notebook_id: str,
    body: UpdateNotebookRequest,
    user: dict = Depends(get_current_user),
):
    """Update mutable notebook metadata for the current user."""
    user_id = _get_user_id(user)
    updates: dict[str, Any] = {}
    if body.name is not None:
        updates["name"] = body.name.strip()
    if body.is_starred is not None:
        updates["is_starred"] = body.is_starred

    if not updates:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"code": "NO_UPDATES", "message": "Không có dữ liệu cập nhật"},
        )

    try:
        resp = supabase.table("notebooks").update(updates).match({
            "id": notebook_id,
            "user_id": user_id,
        }).execute()
    except Exception:
        logger.exception("Supabase update notebook failed")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"code": "INTERNAL_ERROR", "message": "Lỗi khi cập nhật notebook"},
        )

    data, error = _supabase_response_data(resp)
    if error:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"code": "INTERNAL_ERROR", "message": "Lỗi khi cập nhật notebook"},
        )
    if not data:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "DOC_NOT_FOUND", "message": "Không tìm thấy notebook"},
        )

    updated = data[0]
    return {
        "success": True,
        "data": {
            "notebook": {
                "notebook_id": updated["id"],
                "name": updated["name"],
                "created_at": updated["created_at"],
                "is_starred": updated.get("is_starred", False),
            }
        },
    }


@router.delete("/{notebook_id}", response_model=dict)
async def delete_notebook(notebook_id: str, user: dict = Depends(get_current_user)):
    """Xóa notebook (cascade xóa toàn bộ documents + chunks bên trong)."""
    user_id = _get_user_id(user)

    try:
        resp = supabase.table("notebooks").delete().match({
            "id": notebook_id,
            "user_id": user_id,
        }).execute()
    except Exception:
        logger.exception("Supabase delete notebook failed")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"code": "INTERNAL_ERROR", "message": "Lỗi khi xóa notebook"},
        )

    data, error = _supabase_response_data(resp)
    if error:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"code": "INTERNAL_ERROR", "message": "Lỗi khi xóa notebook"},
        )
    if not data:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "DOC_NOT_FOUND", "message": "Không tìm thấy notebook"},
        )

    return {"success": True, "data": {"notebook_id": notebook_id, "deleted": True}}


@router.post("/{notebook_id}/upload", response_model=dict)
async def upload_documents(
    notebook_id: str,
    files: List[UploadFile] = File(...),
    citation_threshold: float | None = Form(default=0),
    tags: str = Form(default=""),
    user: dict = Depends(get_current_user),
):
    """
    Upload nhiều file tài liệu nghiên cứu vào một notebook.
    Mỗi file được parse → chunk → embed → lưu vào Supabase độc lập.
    Trả về danh sách kết quả của từng file.
    """
    user_id = _get_user_id(user)

    # Kiểm tra notebook thuộc về user
    try:
        nb_resp = supabase.table("notebooks").select("id").match({
            "id": notebook_id,
            "user_id": user_id,
        }).execute()
    except Exception:
        logger.exception("Supabase check notebook failed")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"code": "INTERNAL_ERROR", "message": "Lỗi khi kiểm tra notebook"},
        )

    nb_data, _ = _supabase_response_data(nb_resp)
    if not nb_data:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "DOC_NOT_FOUND", "message": "Không tìm thấy notebook"},
        )

    incoming_names = [((file.filename or "").strip().lower()) for file in files]
    if len(incoming_names) != len(set(incoming_names)):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": "DUPLICATE_DOCUMENT", "message": "Tài liệu đã tồn tại trong notebook."},
        )

    try:
        existing_resp = supabase.table("documents").select("filename").eq("notebook_id", notebook_id).execute()
    except Exception:
        logger.exception("Supabase duplicate filename check failed")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"code": "INTERNAL_ERROR", "message": "Lỗi khi kiểm tra tài liệu trùng tên"},
        )
    existing_rows, existing_error = _supabase_response_data(existing_resp)
    if existing_error:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"code": "INTERNAL_ERROR", "message": "Lỗi khi kiểm tra tài liệu trùng tên"},
        )
    existing_names = {(row.get("filename") or "").strip().lower() for row in existing_rows or []}
    if any(name in existing_names for name in incoming_names):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": "DUPLICATE_DOCUMENT", "message": "Tài liệu đã tồn tại trong notebook."},
        )

    max_upload_mb = getattr(settings, "MAX_UPLOAD_MB", settings.MAX_FILE_SIZE_MB)
    max_size_bytes = max_upload_mb * 1024 * 1024
    results = []

    for file in files:
        result = await _process_single_file(file, notebook_id, max_size_bytes, citation_threshold, tags)
        if result.get("status") == "ready":
            log_user_activity(
                user_id=user_id,
                feature_name="notebook",
                action_type="document_upload",
                document_id=result.get("doc_id") or result.get("id"),
                document_name=result.get("filename"),
                metadata={
                    "file_type": result.get("file_type"),
                    "size": result.get("size"),
                    "source": "notebook_upload",
                    "upload_status": result.get("status"),
                    "notebook_id": notebook_id,
                },
            )
        results.append(result)

    return {
        "success": True,
        "data": {
            "uploaded": [r for r in results if r.get("status") == "ready"],
            "failed": [r for r in results if r.get("status") == "error"],
            "total": len(results),
        },
    }


async def _process_single_file(file: UploadFile, notebook_id: str, max_size_bytes: int, citation_threshold: float | None = 0, tags: str = "") -> dict:
    """Xử lý 1 file: validate → parse → chunk → embed → insert Supabase."""

    file_type = get_file_type(file.filename)

    # Đọc nội dung
    try:
        contents = await file.read()
    except Exception:
        return {"filename": file.filename, "status": "error", "error": "READ_FAILED"}

    # Validate file size
    if len(contents) > max_size_bytes:
        return {
            "filename": file.filename,
            "status": "error",
            "error": "FILE_TOO_LARGE",
            "message": f"File quá lớn. Vui lòng chọn file dưới {max_size_bytes // 1024 // 1024}MB.",
        }

    # Parse document
    try:
        pages, file_type = await parse_document(contents, file.filename)
        page_count = len(pages)
    except UnsupportedDocumentType as exc:
        return {"filename": file.filename, "file_type": file_type, "status": "error", "error": "INVALID_FILE_TYPE", "message": str(exc)}
    except EmptyDocumentText as exc:
        return {"filename": file.filename, "file_type": file_type, "status": "error", "error": "PARSE_FAILED", "message": str(exc)}
    except Exception:
        logger.exception(f"Document parse failed: {file.filename}")
        return {"filename": file.filename, "file_type": file_type, "status": "error", "error": "PARSE_FAILED", "message": "Không đọc được nội dung văn bản từ file này."}

    # Chunk
    try:
        chunks = chunk_text(pages)
        chunk_count = len(chunks)
        if chunk_count == 0:
            return {"filename": file.filename, "file_type": file_type, "status": "error", "error": "PARSE_FAILED", "message": "Không đọc được nội dung văn bản từ file này."}
    except Exception:
        logger.exception(f"Chunking failed: {file.filename}")
        return {"filename": file.filename, "status": "error", "error": "CHUNK_FAILED"}

    # Insert document metadata
    try:
        document_payload = {
            "notebook_id": notebook_id,
            "filename": file.filename,
            "file_type": file_type,
            "page_count": page_count,
            "chunk_count": chunk_count,
            "status": "ready",
            "processing_status": "ready",
            "is_vector_ready": True,
            "citation_threshold": _normalize_citation_threshold(citation_threshold),
            "tags": _parse_tags(tags),
        }
        try:
            resp = supabase.table("documents").insert(document_payload).execute()
        except Exception:
            # Backward-compatible fallback for databases that have not added file_type/status yet.
            document_payload.pop("file_type", None)
            document_payload.pop("status", None)
            document_payload.pop("processing_status", None)
            document_payload.pop("is_vector_ready", None)
            document_payload.pop("citation_threshold", None)
            document_payload.pop("tags", None)
            resp = supabase.table("documents").insert(document_payload).execute()
    except Exception:
        logger.exception(f"Insert document failed: {file.filename}")
        return {"filename": file.filename, "status": "error", "error": "DB_INSERT_FAILED"}

    data, error = _supabase_response_data(resp)
    if error or not data:
        return {"filename": file.filename, "status": "error", "error": "DB_INSERT_FAILED"}

    doc_id = data[0]["id"]
    created_at = data[0]["created_at"]

    # Embed chunks
    try:
        texts = [c["content"] for c in chunks]
        embeddings = await embed_chunks(texts)
    except Exception:
        logger.exception(f"Embedding failed: {file.filename}")
        supabase.table("documents").delete().eq("id", doc_id).execute()
        return {"filename": file.filename, "status": "error", "error": "EMBED_FAILED"}

    # Insert chunks + embeddings
    try:
        chunk_rows = [
            {
                "doc_id": doc_id,
                "notebook_id": notebook_id,          # ← thêm notebook_id để search nhanh
                "section": chunks[i].get("section", "Unknown"),
                "content": chunks[i]["content"],
                "page_number": chunks[i]["page_number"],
                "chunk_index": i,
                "embedding": "[" + ",".join(map(str, embeddings[i])) + "]",
            }
            for i in range(len(chunks))
        ]
        supabase.table("document_chunks").insert(chunk_rows).execute()
    except Exception:
        logger.exception(f"Insert chunks failed: {file.filename}")
        supabase.table("documents").delete().eq("id", doc_id).execute()
        return {"filename": file.filename, "status": "error", "error": "CHUNK_INSERT_FAILED"}

    return {
        "filename": file.filename,
        "doc_id": doc_id,
        "id": doc_id,
        "file_type": file_type,
        "page_count": page_count,
        "chunk_count": chunk_count,
        "size": len(contents),
        "created_at": created_at,
        "status": "ready",
        "processing_status": "ready",
        "processing_error": None,
        "is_vector_ready": True,
    }


@router.get("/{notebook_id}/documents", response_model=dict)
async def list_documents_in_notebook(
    notebook_id: str,
    user: dict = Depends(get_current_user),
):
    """Lấy danh sách documents trong một notebook."""
    user_id = _get_user_id(user)

    # Kiểm tra notebook thuộc về user
    try:
        nb_resp = supabase.table("notebooks").select("id").match({
            "id": notebook_id,
            "user_id": user_id,
        }).execute()
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"code": "INTERNAL_ERROR", "message": "Lỗi server"},
        )

    nb_data, _ = _supabase_response_data(nb_resp)
    if not nb_data:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "DOC_NOT_FOUND", "message": "Không tìm thấy notebook"},
        )

    try:
        try:
            resp = supabase.table("documents").select(
                "id, filename, file_type, status, processing_status, processing_error, is_vector_ready, page_count, chunk_count, created_at"
            ).eq("notebook_id", notebook_id).order("created_at", desc=False).execute()
        except Exception:
            resp = supabase.table("documents").select(
                "id, filename, page_count, chunk_count, created_at"
            ).eq("notebook_id", notebook_id).order("created_at", desc=False).execute()
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"code": "INTERNAL_ERROR", "message": "Lỗi khi lấy danh sách tài liệu"},
        )

    data, error = _supabase_response_data(resp)
    if error:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"code": "INTERNAL_ERROR", "message": "Lỗi khi lấy danh sách tài liệu"},
        )

    documents = [
        {
            "doc_id": row["id"],
            "id": row["id"],
            "filename": row["filename"],
            "file_type": row.get("file_type") or get_file_type(row.get("filename")),
            "status": row.get("status") or "ready",
            "processing_status": row.get("processing_status") or row.get("status") or "ready",
            "processing_error": row.get("processing_error"),
            "is_vector_ready": row.get("is_vector_ready") if row.get("is_vector_ready") is not None else ((row.get("status") or "ready") == "ready"),
            "page_count": row["page_count"],
            "chunk_count": row["chunk_count"],
            "created_at": row["created_at"],
        }
        for row in (data or [])
    ]

    return {"success": True, "data": {"documents": documents, "total": len(documents)}}

class LinkSystemDocumentRequest(BaseModel):
    system_document_id: str


def _ensure_notebook_owner(notebook_id: str, user_id: str) -> None:
    try:
        nb_resp = supabase.table("notebooks").select("id").match({"id": notebook_id, "user_id": user_id}).execute()
    except Exception as exc:
        logger.exception("Supabase check notebook failed")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail={"code": "INTERNAL_ERROR", "message": "Lỗi khi kiểm tra notebook"}) from exc
    nb_data, _ = _supabase_response_data(nb_resp)
    if not nb_data:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail={"code": "DOC_NOT_FOUND", "message": "Không tìm thấy notebook"})


def _vector_to_string(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, str):
        return value
    if isinstance(value, list):
        return "[" + ",".join(map(str, value)) + "]"
    return str(value)


@router.post("/{notebook_id}/system-documents", response_model=dict)
async def link_system_document_to_notebook(
    notebook_id: str,
    body: LinkSystemDocumentRequest,
    user: dict = Depends(get_current_user),
):
    """Link a system document into a user's research notebook without duplicating the physical file."""
    user_id = _get_user_id(user)
    _ensure_notebook_owner(notebook_id, user_id)

    try:
        doc_resp = supabase.table("system_documents").select(
            "id, title, filename, file_type, page_count, is_vector_ready, status"
        ).eq("id", body.system_document_id).limit(1).execute()
    except Exception as exc:
        logger.exception("Load system document failed")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail={"code": "INTERNAL_ERROR", "message": "Lỗi khi tải tài liệu hệ thống"}) from exc
    doc_rows, doc_error = _supabase_response_data(doc_resp)
    if doc_error:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail={"code": "INTERNAL_ERROR", "message": "Lỗi khi tải tài liệu hệ thống"})
    if not doc_rows:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail={"code": "DOC_NOT_FOUND", "message": "Không tìm thấy tài liệu hệ thống"})

    system_doc = doc_rows[0]
    if str(system_doc.get("status") or "PUBLISHED").upper() != "PUBLISHED":
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail={"code": "DOC_NOT_FOUND", "message": "Tài liệu không còn được công khai"})
    if not system_doc.get("is_vector_ready"):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail={"code": "VECTOR_NOT_READY", "message": "Tài liệu thư viện chưa sẵn sàng cho RAG"})

    linked_filename = f"[Hệ thống] {system_doc.get('title') or system_doc.get('filename')}"
    try:
        existing_resp = supabase.table("documents").select("id, filename, file_type, status, page_count, chunk_count, created_at").eq("notebook_id", notebook_id).eq("source_type", "system_document").eq("source_id", body.system_document_id).limit(1).execute()
        existing_rows, _ = _supabase_response_data(existing_resp)
        if existing_rows:
            row = existing_rows[0]
            return {"success": True, "data": {"document": {"doc_id": row["id"], "id": row["id"], "filename": row["filename"], "file_type": row.get("file_type"), "status": row.get("status") or "ready", "processing_status": row.get("processing_status") or row.get("status") or "ready", "processing_error": row.get("processing_error"), "is_vector_ready": row.get("is_vector_ready") if row.get("is_vector_ready") is not None else ((row.get("status") or "ready") == "ready"), "page_count": row.get("page_count"), "chunk_count": row.get("chunk_count"), "created_at": row.get("created_at"), "source_type": "system_document", "source_id": body.system_document_id}, "already_linked": True}}
    except Exception:
        # Older schema may not have source_type/source_id yet; continue and rely on filename uniqueness.
        pass

    try:
        chunks_resp = supabase.table("system_document_chunks").select("id, content, page_start, page_end, embedding").eq("document_id", body.system_document_id).order("created_at", desc=False).execute()
        chunks, chunks_error = _supabase_response_data(chunks_resp)
    except Exception as exc:
        logger.exception("Load system document chunks failed")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail={"code": "INTERNAL_ERROR", "message": "Không thể đọc vector tài liệu hệ thống"}) from exc
    if chunks_error or not chunks:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail={"code": "VECTOR_NOT_READY", "message": "Tài liệu hệ thống chưa có chunks/vector"})

    doc_payload = {
        "notebook_id": notebook_id,
        "filename": linked_filename,
        "file_type": system_doc.get("file_type"),
        "page_count": system_doc.get("page_count") or 0,
        "chunk_count": len(chunks),
        "status": "ready",
        "processing_status": "ready",
        "is_vector_ready": True,
        "source_type": "system_document",
        "source_id": body.system_document_id,
    }
    try:
        insert_resp = supabase.table("documents").insert(doc_payload).execute()
    except Exception as exc:
        logger.warning("Insert linked system document with extended columns failed, retrying with legacy payload: %s", exc)
        for optional_key in ("file_type", "status", "processing_status", "is_vector_ready", "source_type", "source_id"):
            doc_payload.pop(optional_key, None)
        insert_resp = supabase.table("documents").insert(doc_payload).execute()
    inserted, insert_error = _supabase_response_data(insert_resp)
    if insert_error or not inserted:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail={"code": "DB_INSERT_FAILED", "message": "Không thể thêm tài liệu vào Không gian Nghiên cứu"})

    linked_doc = inserted[0]
    linked_doc_id = linked_doc["id"]
    try:
        chunk_rows = [
            {
                "doc_id": linked_doc_id,
                "notebook_id": notebook_id,
                "section": "System Library",
                "content": chunk.get("content") or "",
                "page_number": chunk.get("page_start") or chunk.get("page_end") or 1,
                "chunk_index": index,
                "embedding": _vector_to_string(chunk.get("embedding")),
            }
            for index, chunk in enumerate(chunks)
            if chunk.get("content")
        ]
        supabase.table("document_chunks").insert(chunk_rows).execute()
    except Exception as exc:
        logger.exception("Copy system chunks into notebook failed")
        supabase.table("documents").delete().eq("id", linked_doc_id).execute()
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail={"code": "CHUNK_INSERT_FAILED", "message": "Không thể đưa tài liệu hệ thống vào RAG notebook"}) from exc

    return {"success": True, "data": {"document": {"doc_id": linked_doc_id, "id": linked_doc_id, "filename": linked_doc.get("filename") or linked_filename, "file_type": linked_doc.get("file_type") or system_doc.get("file_type"), "status": "ready", "processing_status": linked_doc.get("processing_status") or "ready", "processing_error": linked_doc.get("processing_error"), "is_vector_ready": linked_doc.get("is_vector_ready") if linked_doc.get("is_vector_ready") is not None else True, "page_count": linked_doc.get("page_count") or system_doc.get("page_count"), "chunk_count": len(chunks), "created_at": linked_doc.get("created_at"), "source_type": "system_document", "source_id": body.system_document_id}, "already_linked": False}}
