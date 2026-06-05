import logging
from typing import Any, List, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from app.db.supabase_client import supabase
from app.dependencies import get_current_user
from app.services.generation_jobs import create_generation_job

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



def _load_document_intelligence(workspace_id: str) -> dict[str, dict]:
    try:
        resp = (
            supabase.table("document_intelligence")
            .select("document_id, summary, outline, section_summaries, key_terms, citation_candidates")
            .eq("notebook_id", workspace_id)
            .execute()
        )
        rows, error = _supabase_response_data(resp)
        if error:
            return {}
        return {str(row.get("document_id")): row for row in rows or []}
    except Exception:
        return {}


@router.get("/{workspace_id}/documents/summary", response_model=dict)
async def get_workspace_documents_summary(
    workspace_id: str,
    user: dict = Depends(get_current_user),
):
    user_id = _get_user_id(user)
    _ensure_workspace_owner(workspace_id, user_id)
    documents = [_normalize_document(row) for row in _list_workspace_documents(workspace_id)]
    intelligence = _load_document_intelligence(workspace_id)
    enriched = []
    all_terms = []
    for doc in documents:
        item = intelligence.get(str(doc.get("id"))) or {}
        terms = item.get("key_terms") or []
        all_terms.extend(terms)
        enriched.append(
            {
                **doc,
                "summary": item.get("summary") or "",
                "outline": item.get("outline") or [],
                "section_summaries": item.get("section_summaries") or [],
                "key_points": terms[:5],
                "key_terms": terms,
                "citation_candidates": item.get("citation_candidates") or [],
                "suggested_questions": [f"Giải thích thêm về {term}?" for term in terms[:3]],
            }
        )

    return {
        "success": True,
        "data": {
            "documents": enriched,
            "overall_summary": "" if not enriched else "Workspace đã có metadata tóm tắt sơ bộ từ quá trình index.",
            "overall_key_points": list(dict.fromkeys(all_terms))[:8],
            "suggested_questions": [f"Các tài liệu nói gì về {term}?" for term in list(dict.fromkeys(all_terms))[:5]],
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

    doc_ids = [str(row["id"]) for row in document_rows]
    job = await create_generation_job(
        job_type="workspace_summary",
        resource_id=workspace_id,
        user_id=user_id,
        payload={"workspace_id": workspace_id, "document_ids": doc_ids},
    )
    return {"success": True, "data": {"job_id": job.get("id"), "job": job}}
