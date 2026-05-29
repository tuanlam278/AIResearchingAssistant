"""
Module quản lý các thao tác trực tiếp trên từng tài liệu (Document).
Lưu ý: Thao tác upload file đã được chuyển về notebooks.py để đảm bảo file 
luôn được gắn vào một notebook cụ thể.
"""

import logging
from typing import List, Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from app.dependencies import get_current_user
from app.db.supabase_client import supabase
from app.models.schemas import DocumentResponse

logger = logging.getLogger(__name__)

router = APIRouter(tags=["documents"])


# ---------------------------
# Helper Functions
# ---------------------------

def _supabase_response_data(resp: Any) -> tuple[Any, Any]:
    """Hàm phụ trợ bóc tách data và error từ response của Supabase."""
    if isinstance(resp, dict):
        return resp.get("data"), resp.get("error")
    return getattr(resp, "data", None), getattr(resp, "error", None)


def _get_user_id(user: dict) -> str:
    """Trích xuất và xác thực user_id từ token payload."""
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


class ListDocumentsData(BaseModel):
    """Schema chứa danh sách tài liệu và tổng số lượng."""
    documents: List[DocumentResponse]
    total: int


class ListDocumentsResponse(BaseModel):
    """Schema phản hồi cho endpoint lấy danh sách tài liệu."""
    success: bool = True
    data: ListDocumentsData


class DeleteDocumentData(BaseModel):
    """Schema chứa thông tin kết quả xóa tài liệu."""
    doc_id: str
    deleted: bool


class DeleteDocumentResponse(BaseModel):
    """Schema phản hồi cho endpoint xóa tài liệu."""
    success: bool = True
    data: DeleteDocumentData


# ---------------------------
# Endpoints
# ---------------------------

@router.get("", response_model=ListDocumentsResponse)
async def list_all_documents(user: dict = Depends(get_current_user)):
    """
    Lấy danh sách TOÀN BỘ tài liệu của user đang đăng nhập (ở tất cả các notebook).
    
    Do bảng `documents` không còn cột `user_id`, truy vấn này sử dụng INNER JOIN 
    với bảng `notebooks` để xác thực quyền sở hữu.
    """
    user_id = _get_user_id(user)

    try:
        # Sử dụng PostgREST syntax để JOIN với bảng notebooks và lọc theo user_id
        resp = (
            supabase.table("documents")
            .select("id, notebook_id, filename, page_count, chunk_count, created_at, notebooks!inner(user_id)")
            .eq("notebooks.user_id", user_id)
            .order("created_at", desc=True)
            .execute()
        )
    except Exception:
        logger.exception("Supabase select operation raised an exception in list_all_documents")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"code": "INTERNAL_ERROR", "message": "Lỗi khi truy vấn danh sách toàn bộ tài liệu"},
        )

    data, error = _supabase_response_data(resp)
    if error:
        logger.error("Supabase select returned error: %s", getattr(error, "message", repr(error)))
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"code": "INTERNAL_ERROR", "message": "Lỗi khi truy vấn dữ liệu từ database"},
        )

    documents: List[DocumentResponse] = []
    if data:
        for row in data:
            documents.append(
                DocumentResponse(
                    doc_id=row["id"],
                    notebook_id=row["notebook_id"],
                    filename=row["filename"],
                    page_count=row["page_count"],
                    chunk_count=row["chunk_count"],
                    created_at=row["created_at"],
                )
            )

    return ListDocumentsResponse(
        data=ListDocumentsData(documents=documents, total=len(documents))
    )


@router.delete("/{doc_id}", response_model=DeleteDocumentResponse)
async def delete_document(doc_id: str, user: dict = Depends(get_current_user)):
    """
    Xóa một tài liệu dựa vào ID.
    
    Quyền sở hữu được xác thực bằng cách truy xuất ngược từ Document -> Notebook -> User.
    Khi tài liệu bị xóa, các đoạn văn bản (chunks) liên quan trong bảng `document_chunks`
    cũng sẽ tự động bị xóa nhờ cơ chế CASCADE ON DELETE trong Database.
    """
    user_id = _get_user_id(user)

    # Bước 1: Xác minh quyền sở hữu tài liệu thông qua notebook
    try:
        check_resp = (
            supabase.table("documents")
            .select("id, notebook_id, notebooks!inner(user_id)")
            .eq("id", doc_id)
            .eq("notebooks.user_id", user_id)
            .execute()
        )
    except Exception:
        logger.exception("Supabase ownership check failed")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"code": "INTERNAL_ERROR", "message": "Lỗi khi kiểm tra quyền sở hữu tài liệu"},
        )

    check_data, _ = _supabase_response_data(check_resp)
    if not check_data:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "DOC_NOT_FOUND", "message": "Không tìm thấy tài liệu hoặc bạn không có quyền xóa"},
        )

    notebook_id = check_data[0].get("notebook_id")

    # Bước 2: Xóa dữ liệu phụ thuộc trước để không còn chunk/embedding stale nếu DB chưa bật cascade.
    try:
        supabase.table("document_chunks").delete().eq("doc_id", doc_id).execute()
    except Exception:
        logger.warning("Could not delete document chunks for %s; continuing with document delete", doc_id)

    # Bước 3: Gỡ document khỏi selected_document_ids của các research session trong notebook.
    try:
        sessions_resp = (
            supabase.table("research_sessions")
            .select("id, selected_document_ids")
            .eq("notebook_id", notebook_id)
            .execute()
        )
        sessions, _ = _supabase_response_data(sessions_resp)
        for session in sessions or []:
            selected_ids = [str(item) for item in (session.get("selected_document_ids") or []) if str(item) != str(doc_id)]
            if selected_ids != (session.get("selected_document_ids") or []):
                supabase.table("research_sessions").update({"selected_document_ids": selected_ids}).eq("id", session.get("id")).execute()
    except Exception:
        logger.warning("Could not remove deleted document from research sessions", exc_info=True)

    # Bước 4: Thực hiện lệnh xóa document metadata
    try:
        resp = supabase.table("documents").delete().eq("id", doc_id).execute()
    except Exception:
        logger.exception("Supabase delete operation raised an exception")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"code": "INTERNAL_ERROR", "message": "Lỗi server khi xóa tài liệu"},
        )

    data, error = _supabase_response_data(resp)
    if error:
        logger.error("Supabase delete returned error: %s", getattr(error, "message", repr(error)))
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"code": "INTERNAL_ERROR", "message": "Lỗi database khi xóa tài liệu"},
        )

    if not data or len(data) == 0:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "DOC_NOT_FOUND", "message": "Không tìm thấy tài liệu để xóa"},
        )

    return DeleteDocumentResponse(data=DeleteDocumentData(doc_id=doc_id, deleted=True))


@router.post("/{doc_id}/summarize")
async def summarize_document(doc_id: str, user: dict = Depends(get_current_user)):
    """
    (Endpoint chờ phát triển) Tính năng tóm tắt toàn văn nội dung một tài liệu.
    """
    # NOTE: Cần xác thực user_id tương tự như hàm delete trước khi xử lý logic LLM
    raise HTTPException(
        status_code=status.HTTP_501_NOT_IMPLEMENTED,
        detail={"code": "NOT_IMPLEMENTED", "message": "Tính năng tóm tắt tài liệu đang được phát triển"},
    )