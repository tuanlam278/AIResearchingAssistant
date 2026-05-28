import logging
from typing import List, Dict, Any

from fastapi import APIRouter, Depends, UploadFile, File, HTTPException, status
from pydantic import BaseModel

from app.dependencies import get_current_user
from app.services.pdf_parser import parse_pdf
from app.services.chunker import chunk_text
from app.services.embedder import embed_chunks
from app.db.supabase_client import supabase
from app.config import settings

logger = logging.getLogger(__name__)


def _supabase_response_data(resp: Any) -> tuple[Any, Any]:
    if isinstance(resp, dict):
        return resp.get("data"), resp.get("error")
    return getattr(resp, "data", None), getattr(resp, "error", None)


router = APIRouter(tags=["documents"])

# ---------------------------
# Pydantic Schemas
# ---------------------------

class UploadResponseData(BaseModel):
    doc_id: str
    filename: str
    chunk_count: int
    page_count: int
    created_at: str | None = None
    status: str = "ready"


class UploadResponse(BaseModel):
    success: bool = True
    data: UploadResponseData


class DocumentItem(BaseModel):
    doc_id: str
    filename: str
    page_count: int
    chunk_count: int
    created_at: str


class ListDocumentsData(BaseModel):
    documents: List[DocumentItem]
    total: int


class ListDocumentsResponse(BaseModel):
    success: bool = True
    data: ListDocumentsData


class DeleteDocumentData(BaseModel):
    doc_id: str
    deleted: bool


class DeleteDocumentResponse(BaseModel):
    success: bool = True
    data: DeleteDocumentData


# ---------------------------
# Endpoints
# ---------------------------

@router.post("/upload", response_model=UploadResponse)
async def upload_document(file: UploadFile = File(...), user: dict = Depends(get_current_user)):
    """Upload a PDF document, parse it, chunk it, embed and store in Supabase."""

    if file.content_type != "application/pdf":
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail={"code": "INVALID_FILE_TYPE", "message": "Chỉ chấp nhận PDF"},
        )

    try:
        contents = await file.read()
    except Exception:
        logger.exception("Failed to read uploaded file")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"code": "PARSE_FAILED", "message": "Không thể đọc file upload"},
        )

    max_size_bytes = settings.MAX_FILE_SIZE_MB * 1024 * 1024
    if len(contents) > max_size_bytes:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail={"code": "FILE_TOO_LARGE", "message": "File vượt quá giới hạn"},
        )

    try:
        pages: List[Dict[str, Any]] = await parse_pdf(contents)
        page_count = len(pages)
    except Exception:
        logger.exception("PDF parsing failed")
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"code": "PARSE_FAILED", "message": "Không thể đọc nội dung PDF"},
        )

    try:
        chunks = chunk_text(pages)
        chunk_count = len(chunks)
    except Exception:
        logger.exception("Chunking failed")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"code": "INTERNAL_ERROR", "message": "Lỗi khi chia đoạn văn bản"},
        )

    user_id = user.get("id") or user.get("user_id")
    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"code": "UNAUTHORIZED", "message": "Token không hợp lệ"},
        )

    # --- Bước 1: Insert document metadata ---
    try:
        insert_payload = {
            "user_id": user_id,
            "filename": file.filename,
            "page_count": page_count,
            "chunk_count": chunk_count,
        }
        resp = supabase.table("documents").insert(insert_payload).execute()
    except Exception as exc:
        logger.exception("Supabase insert operation raised an exception")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"code": "INTERNAL_ERROR", "message": "Lỗi server khi lưu tài liệu"},
        )

    data, error = _supabase_response_data(resp)
    if error:
        logger.error("Supabase insert returned error: %s", getattr(error, "message", repr(error)))
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"code": "INTERNAL_ERROR", "message": "Lỗi server khi lưu tài liệu"},
        )

    if not data or len(data) == 0:
        logger.error("Supabase insert returned no data: %s", resp)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"code": "INTERNAL_ERROR", "message": "Không nhận được dữ liệu từ Supabase"},
        )

    created = data[0]
    doc_id = created["id"]

    # --- Bước 2: Embed toàn bộ chunks ---
    try:
        texts = [c["content"] for c in chunks]
        embeddings = await embed_chunks(texts)
    except Exception:
        logger.exception("Embedding chunks failed")
        # Rollback: xóa document vừa insert để tránh orphan record
        supabase.table("documents").delete().eq("id", doc_id).execute()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"code": "EMBED_FAILED", "message": "Lỗi khi tạo embedding cho tài liệu"},
        )

    # --- Bước 3: Insert chunks + embeddings vào document_chunks ---
    try:
        chunk_rows = [
            {
                "doc_id": doc_id,
                "content": chunks[i]["content"],
                "page_number": chunks[i]["page_number"],
                "chunk_index": i,
                "embedding": "[" + ",".join(map(str, embeddings[i])) + "]",
            }
            for i in range(len(chunks))
        ]
        supabase.table("document_chunks").insert(chunk_rows).execute()
    except Exception:
        logger.exception("Inserting document_chunks failed")
        # Rollback: xóa document (chunks sẽ cascade delete theo foreign key)
        supabase.table("documents").delete().eq("id", doc_id).execute()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"code": "INTERNAL_ERROR", "message": "Lỗi khi lưu chunks vào database"},
        )

    return UploadResponse(
        data=UploadResponseData(
            doc_id=doc_id,
            filename=created["filename"],
            chunk_count=created["chunk_count"],
            page_count=created["page_count"],
            created_at=created["created_at"],
        )
    )


@router.get("", response_model=ListDocumentsResponse)
async def list_documents(user: dict = Depends(get_current_user)):
    """Return all documents belonging to the authenticated user."""
    user_id = user.get("id") or user.get("user_id")
    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"code": "UNAUTHORIZED", "message": "Token không hợp lệ"},
        )

    try:
        resp = supabase.table("documents").select(
            "id, filename, page_count, chunk_count, created_at"
        ).eq("user_id", user_id).order("created_at", desc=True).execute()
    except Exception as exc:
        logger.exception("Supabase select operation raised an exception")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"code": "INTERNAL_ERROR", "message": "Lỗi khi truy vấn danh sách tài liệu"},
        )

    data, error = _supabase_response_data(resp)
    if error:
        logger.error("Supabase select returned error: %s", getattr(error, "message", repr(error)))
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"code": "INTERNAL_ERROR", "message": "Lỗi khi truy vấn danh sách tài liệu"},
        )

    documents: List[DocumentItem] = []
    if data:
        for row in data:
            documents.append(
                DocumentItem(
                    doc_id=row["id"],
                    filename=row["filename"],
                    page_count=row["page_count"],
                    chunk_count=row["chunk_count"],
                    created_at=row["created_at"],
                )
            )

    return ListDocumentsResponse(data=ListDocumentsData(documents=documents, total=len(documents)))


@router.delete("/{doc_id}", response_model=DeleteDocumentResponse)
async def delete_document(doc_id: str, user: dict = Depends(get_current_user)):
    """Delete a document by id belonging to the authenticated user."""
    user_id = user.get("id") or user.get("user_id")
    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"code": "UNAUTHORIZED", "message": "Token không hợp lệ"},
        )

    # Verify ownership: document → notebook → user_id
    try:
        check_resp = (
            supabase.table("documents")
            .select("id, notebooks!inner(user_id)")
            .eq("id", doc_id)
            .eq("notebooks.user_id", user_id)
            .execute()
        )
    except Exception:
        logger.exception("Supabase ownership check failed")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"code": "INTERNAL_ERROR", "message": "Lỗi khi kiểm tra tài liệu"},
        )

    check_data, _ = _supabase_response_data(check_resp)
    if not check_data:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "DOC_NOT_FOUND", "message": "Không tìm thấy tài liệu"},
        )

    try:
        resp = supabase.table("documents").delete().eq("id", doc_id).execute()
    except Exception as exc:
        logger.exception("Supabase delete operation raised an exception")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"code": "INTERNAL_ERROR", "message": "Lỗi khi xóa tài liệu"},
        )

    data, error = _supabase_response_data(resp)
    if error:
        logger.error("Supabase delete returned error: %s", getattr(error, "message", repr(error)))
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"code": "INTERNAL_ERROR", "message": "Lỗi khi xóa tài liệu"},
        )

    if not data or len(data) == 0:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "DOC_NOT_FOUND", "message": "Không tìm thấy tài liệu"},
        )

    return DeleteDocumentResponse(data=DeleteDocumentData(doc_id=doc_id, deleted=True))


@router.post("/{doc_id}/summarize")
async def summarize_document(doc_id: str, user: dict = Depends(get_current_user)):
    """Stub for document summarization endpoint."""
    raise HTTPException(
        status_code=status.HTTP_501_NOT_IMPLEMENTED,
        detail={"code": "NOT_IMPLEMENTED", "message": "Tóm tắt tài liệu chưa được hỗ trợ"},
    )