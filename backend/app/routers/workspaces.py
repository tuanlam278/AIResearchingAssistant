import logging
from typing import Any, List, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from app.db.supabase_client import supabase
from app.dependencies import get_current_user
from app.services.llm import generate_workspace_summary

logger = logging.getLogger(__name__)
router = APIRouter(tags=["workspaces"])


class SummaryGenerateRequest(BaseModel):
    document_ids: Optional[List[str]] = Field(default=None, max_length=50)


def _supabase_response_data(resp: Any) -> tuple[Any, Any]:
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


def _ensure_workspace_owner(workspace_id: str, user_id: str) -> None:
    try:
        resp = (
            supabase.table("notebooks")
            .select("id")
            .match({"id": workspace_id, "user_id": user_id})
            .execute()
        )
    except Exception:
        logger.exception("Workspace ownership check failed")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"code": "INTERNAL_ERROR", "message": "Lỗi khi kiểm tra workspace"},
        )

    data, error = _supabase_response_data(resp)
    if error:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"code": "INTERNAL_ERROR", "message": "Lỗi khi kiểm tra workspace"},
        )
    if not data:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "DOC_NOT_FOUND", "message": "Không tìm thấy workspace"},
        )


def _normalize_document(row: dict, status_value: str = "ready") -> dict:
    return {
        "id": row.get("id"),
        "doc_id": row.get("id"),
        "filename": row.get("filename"),
        "title": row.get("filename"),
        "page_count": row.get("page_count") or 0,
        "chunk_count": row.get("chunk_count") or 0,
        "status": row.get("status") or status_value,
        "created_at": row.get("created_at"),
    }


def _list_workspace_documents(workspace_id: str, document_ids: Optional[List[str]] = None) -> list[dict]:
    query = (
        supabase.table("documents")
        .select("id, filename, page_count, chunk_count, created_at")
        .eq("notebook_id", workspace_id)
        .order("created_at", desc=False)
    )
    if document_ids:
        query = query.in_("id", document_ids)

    try:
        resp = query.execute()
    except Exception:
        logger.exception("List workspace documents failed")
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
    return data or []


def _load_document_chunks(workspace_id: str, doc_ids: list[str]) -> dict[str, list[dict]]:
    if not doc_ids:
        return {}

    try:
        resp = (
            supabase.table("document_chunks")
            .select("doc_id, content, page_number, chunk_index, section")
            .eq("notebook_id", workspace_id)
            .in_("doc_id", doc_ids)
            .order("chunk_index", desc=False)
            .execute()
        )
    except Exception:
        logger.exception("Load document chunks failed")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"code": "INTERNAL_ERROR", "message": "Lỗi khi lấy nội dung tài liệu"},
        )

    data, error = _supabase_response_data(resp)
    if error:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"code": "INTERNAL_ERROR", "message": "Lỗi khi lấy nội dung tài liệu"},
        )

    grouped: dict[str, list[dict]] = {doc_id: [] for doc_id in doc_ids}
    for row in data or []:
        grouped.setdefault(row.get("doc_id"), []).append(row)
    return grouped


@router.get("/{workspace_id}/documents/summary", response_model=dict)
async def get_workspace_documents_summary(
    workspace_id: str,
    user: dict = Depends(get_current_user),
):
    user_id = _get_user_id(user)
    _ensure_workspace_owner(workspace_id, user_id)
    documents = [_normalize_document(row) for row in _list_workspace_documents(workspace_id)]

    return {
        "success": True,
        "data": {
            "documents": [
                {
                    **doc,
                    "summary": "",
                    "key_points": [],
                    "suggested_questions": [],
                }
                for doc in documents
            ],
            "overall_summary": "",
            "overall_key_points": [],
            "suggested_questions": [],
        },
    }


@router.post("/{workspace_id}/documents/summary/generate", response_model=dict)
async def generate_workspace_documents_summary(
    workspace_id: str,
    body: SummaryGenerateRequest,
    user: dict = Depends(get_current_user),
):
    user_id = _get_user_id(user)
    _ensure_workspace_owner(workspace_id, user_id)

    document_rows = _list_workspace_documents(workspace_id, body.document_ids)
    if not document_rows:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "DOC_NOT_FOUND", "message": "Không tìm thấy tài liệu để tóm tắt"},
        )

    doc_ids = [row["id"] for row in document_rows]
    chunks_by_doc = _load_document_chunks(workspace_id, doc_ids)
    documents_for_llm = []
    for row in document_rows:
        documents_for_llm.append(
            {
                "id": row["id"],
                "filename": row.get("filename"),
                "page_count": row.get("page_count") or 0,
                "chunk_count": row.get("chunk_count") or 0,
                "chunks": chunks_by_doc.get(row["id"], []),
            }
        )

    try:
        generated = await generate_workspace_summary(documents_for_llm)
    except RuntimeError as exc:
        logger.exception("Summary generation failed")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"code": "SUMMARY_FAILED", "message": str(exc)},
        )

    generated_docs = {str(doc.get("id")): doc for doc in generated.get("documents", [])}
    documents = []
    for row in document_rows:
        base = _normalize_document(row)
        generated_doc = generated_docs.get(str(row["id"]), {})
        documents.append(
            {
                **base,
                "title": generated_doc.get("title") or base["title"],
                "summary": generated_doc.get("summary") or "",
                "key_points": generated_doc.get("key_points") or [],
                "suggested_questions": generated_doc.get("suggested_questions") or [],
            }
        )

    return {
        "success": True,
        "data": {
            "documents": documents,
            "overall_summary": generated.get("overall_summary") or "",
            "overall_key_points": generated.get("overall_key_points") or [],
            "suggested_questions": generated.get("suggested_questions") or [],
        },
    }
