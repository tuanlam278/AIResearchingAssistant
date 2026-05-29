import logging
from typing import List, Any

from fastapi import APIRouter, Depends, UploadFile, File, HTTPException, status
from pydantic import BaseModel

from app.dependencies import get_current_user
from app.services.pdf_parser import parse_pdf
from app.services.chunker import chunk_text
from app.services.embedder import embed_chunks
from app.db.supabase_client import supabase
from app.config import settings

logger = logging.getLogger(__name__)

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


class NotebookItem(BaseModel):
    notebook_id: str
    name: str
    created_at: str


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
        },
    }


@router.get("", response_model=dict)
async def list_notebooks(user: dict = Depends(get_current_user)):
    """Lấy danh sách notebooks của user đang đăng nhập."""
    user_id = _get_user_id(user)

    try:
        resp = supabase.table("notebooks").select(
            "id, name, created_at"
        ).eq("user_id", user_id).order("created_at", desc=True).execute()
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
        {"notebook_id": row["id"], "name": row["name"], "created_at": row["created_at"]}
        for row in (data or [])
    ]

    return {"success": True, "data": {"notebooks": notebooks, "total": len(notebooks)}}


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
    user: dict = Depends(get_current_user),
):
    """
    Upload nhiều file PDF vào một notebook.
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
        result = await _process_single_file(file, notebook_id, max_size_bytes)
        results.append(result)

    return {
        "success": True,
        "data": {
            "uploaded": [r for r in results if r.get("status") == "ready"],
            "failed": [r for r in results if r.get("status") == "error"],
            "total": len(results),
        },
    }


async def _process_single_file(file: UploadFile, notebook_id: str, max_size_bytes: int) -> dict:
    """Xử lý 1 file PDF: validate → parse → chunk → embed → insert Supabase."""

    # Validate file type
    if file.content_type != "application/pdf":
        return {
            "filename": file.filename,
            "status": "error",
            "error": "INVALID_FILE_TYPE",
        }

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

    # Parse PDF
    try:
        pages = await parse_pdf(contents)
        page_count = len(pages)
    except Exception:
        logger.exception(f"PDF parse failed: {file.filename}")
        return {"filename": file.filename, "status": "error", "error": "PARSE_FAILED"}

    # Chunk
    try:
        chunks = chunk_text(pages)
        chunk_count = len(chunks)
    except Exception:
        logger.exception(f"Chunking failed: {file.filename}")
        return {"filename": file.filename, "status": "error", "error": "CHUNK_FAILED"}

    # Insert document metadata
    try:
        resp = supabase.table("documents").insert({
            "notebook_id": notebook_id,
            "filename": file.filename,
            "page_count": page_count,
            "chunk_count": chunk_count,
        }).execute()
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
        "page_count": page_count,
        "chunk_count": chunk_count,
        "created_at": created_at,
        "status": "ready",
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
            "filename": row["filename"],
            "page_count": row["page_count"],
            "chunk_count": row["chunk_count"],
            "created_at": row["created_at"],
        }
        for row in (data or [])
    ]

    return {"success": True, "data": {"documents": documents, "total": len(documents)}}