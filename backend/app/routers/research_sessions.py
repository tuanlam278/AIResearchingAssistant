import logging
from typing import Any, List

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from app.db.supabase_client import supabase
from app.dependencies import get_current_user

logger = logging.getLogger(__name__)
router = APIRouter(tags=["research-sessions"])


class CreateResearchSessionRequest(BaseModel):
    selected_document_ids: List[str] = Field(..., min_length=1, max_length=50)


def _supabase_response_data(resp: Any) -> tuple[Any, Any]:
    if isinstance(resp, dict):
        return resp.get("data"), resp.get("error")
    return getattr(resp, "data", None), getattr(resp, "error", None)


def _get_user_id(user: dict) -> str:
    user_id = user.get("id") or user.get("user_id")
    if not user_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail={"code": "UNAUTHORIZED", "message": "Token không hợp lệ"})
    return user_id


def _ensure_notebook_owner(notebook_id: str, user_id: str) -> None:
    try:
        resp = supabase.table("notebooks").select("id").match({"id": notebook_id, "user_id": user_id}).execute()
    except Exception as exc:
        logger.exception("Notebook ownership check failed")
        raise HTTPException(status_code=500, detail={"code": "INTERNAL_ERROR", "message": "Lỗi khi kiểm tra notebook"}) from exc
    data, error = _supabase_response_data(resp)
    if error:
        raise HTTPException(status_code=500, detail={"code": "INTERNAL_ERROR", "message": "Lỗi khi kiểm tra notebook"})
    if not data:
        raise HTTPException(status_code=404, detail={"code": "DOC_NOT_FOUND", "message": "Không tìm thấy notebook"})


def _load_selected_documents(notebook_id: str, document_ids: list[str]) -> list[dict]:
    unique_ids = list(dict.fromkeys(str(doc_id) for doc_id in document_ids if doc_id))
    if not unique_ids:
        raise HTTPException(status_code=400, detail={"code": "NO_DOCUMENT_SELECTED", "message": "Vui lòng chọn ít nhất một tài liệu để nghiên cứu."})
    try:
        resp = (
            supabase.table("documents")
            .select("id, filename, page_count, chunk_count, created_at")
            .eq("notebook_id", notebook_id)
            .in_("id", unique_ids)
            .execute()
        )
    except Exception as exc:
        logger.exception("Could not load selected documents")
        raise HTTPException(status_code=500, detail={"code": "INTERNAL_ERROR", "message": "Lỗi khi kiểm tra tài liệu"}) from exc
    rows, error = _supabase_response_data(resp)
    if error:
        raise HTTPException(status_code=500, detail={"code": "INTERNAL_ERROR", "message": "Lỗi khi kiểm tra tài liệu"})
    if len(rows or []) != len(unique_ids):
        raise HTTPException(status_code=400, detail={"code": "INVALID_SELECTED_DOCUMENTS", "message": "Một hoặc nhiều tài liệu đã bị xóa hoặc không còn hợp lệ."})
    order = {doc_id: index for index, doc_id in enumerate(unique_ids)}
    return sorted(rows or [], key=lambda row: order.get(str(row["id"]), 0))


def _normalize_session(row: dict) -> dict:
    return {
        "id": row.get("id"),
        "notebook_id": row.get("notebook_id"),
        "title": row.get("title"),
        "selected_document_ids": row.get("selected_document_ids") or [],
        "created_at": row.get("created_at"),
        "updated_at": row.get("updated_at"),
    }


@router.get("/workspaces/{workspace_id}/research-sessions", response_model=dict)
async def list_research_sessions(workspace_id: str, user: dict = Depends(get_current_user)):
    user_id = _get_user_id(user)
    _ensure_notebook_owner(workspace_id, user_id)
    try:
        resp = (
            supabase.table("research_sessions")
            .select("id, notebook_id, title, selected_document_ids, created_at, updated_at")
            .eq("notebook_id", workspace_id)
            .order("created_at", desc=True)
            .execute()
        )
    except Exception as exc:
        logger.exception("List research sessions failed")
        raise HTTPException(status_code=500, detail={"code": "INTERNAL_ERROR", "message": "Lỗi khi lấy lịch sử nghiên cứu"}) from exc
    rows, error = _supabase_response_data(resp)
    if error:
        raise HTTPException(status_code=500, detail={"code": "INTERNAL_ERROR", "message": "Lỗi khi lấy lịch sử nghiên cứu"})
    sessions = [_normalize_session(row) for row in rows or []]
    return {"success": True, "data": {"sessions": sessions, "total": len(sessions)}}


@router.post("/workspaces/{workspace_id}/research-sessions", response_model=dict)
async def create_research_session(workspace_id: str, body: CreateResearchSessionRequest, user: dict = Depends(get_current_user)):
    user_id = _get_user_id(user)
    _ensure_notebook_owner(workspace_id, user_id)
    selected_docs = _load_selected_documents(workspace_id, body.selected_document_ids)
    selected_ids = [str(doc["id"]) for doc in selected_docs]
    filenames = [doc.get("filename") or "Tài liệu" for doc in selected_docs]

    try:
        count_resp = supabase.table("research_sessions").select("id").eq("notebook_id", workspace_id).execute()
    except Exception as exc:
        logger.exception("Research session count failed")
        raise HTTPException(status_code=500, detail={"code": "INTERNAL_ERROR", "message": "Lỗi khi tạo phiên nghiên cứu"}) from exc
    existing, error = _supabase_response_data(count_resp)
    if error:
        raise HTTPException(status_code=500, detail={"code": "INTERNAL_ERROR", "message": "Lỗi khi tạo phiên nghiên cứu"})

    title = f"Nghiên cứu từ {', '.join(filenames)} - lần {len(existing or []) + 1}"
    try:
        resp = supabase.table("research_sessions").insert({
            "notebook_id": workspace_id,
            "title": title,
            "selected_document_ids": selected_ids,
        }).execute()
    except Exception as exc:
        logger.exception("Create research session failed")
        raise HTTPException(status_code=500, detail={"code": "INTERNAL_ERROR", "message": "Lỗi khi tạo phiên nghiên cứu"}) from exc
    rows, insert_error = _supabase_response_data(resp)
    if insert_error or not rows:
        raise HTTPException(status_code=500, detail={"code": "INTERNAL_ERROR", "message": "Lỗi khi tạo phiên nghiên cứu"})
    return {"success": True, "data": {"session": _normalize_session(rows[0])}}


@router.get("/research-sessions/{session_id}/messages", response_model=dict)
async def get_research_session_messages(session_id: str, user: dict = Depends(get_current_user)):
    user_id = _get_user_id(user)
    session = _get_owned_session(session_id, user_id)
    try:
        resp = (
            supabase.table("research_session_messages")
            .select("id, role, content, citations, created_at")
            .eq("research_session_id", session_id)
            .order("created_at", desc=False)
            .execute()
        )
    except Exception as exc:
        logger.exception("List research session messages failed")
        raise HTTPException(status_code=500, detail={"code": "INTERNAL_ERROR", "message": "Lỗi khi lấy lịch sử chat"}) from exc
    rows, error = _supabase_response_data(resp)
    if error:
        raise HTTPException(status_code=500, detail={"code": "INTERNAL_ERROR", "message": "Lỗi khi lấy lịch sử chat"})
    messages = [
        {
            "id": row.get("id"),
            "role": row.get("role"),
            "content": row.get("content") or "",
            "citations": row.get("citations") or [],
            "created_at": row.get("created_at"),
        }
        for row in rows or []
    ]
    return {"success": True, "data": {"session": session, "messages": messages}}


@router.delete("/research-sessions/{session_id}/messages", response_model=dict)
async def clear_research_session_messages(session_id: str, user: dict = Depends(get_current_user)):
    user_id = _get_user_id(user)
    _get_owned_session(session_id, user_id)
    try:
        resp = supabase.table("research_session_messages").delete().eq("research_session_id", session_id).execute()
    except Exception as exc:
        logger.exception("Clear research session messages failed")
        raise HTTPException(status_code=500, detail={"code": "INTERNAL_ERROR", "message": "Lỗi khi xóa lịch sử cuộc trò chuyện"}) from exc
    _, error = _supabase_response_data(resp)
    if error:
        raise HTTPException(status_code=500, detail={"code": "INTERNAL_ERROR", "message": "Lỗi khi xóa lịch sử cuộc trò chuyện"})
    return {"success": True, "data": {"message": "Đã xóa lịch sử cuộc trò chuyện."}}


def _get_owned_session(session_id: str, user_id: str) -> dict:
    try:
        resp = (
            supabase.table("research_sessions")
            .select("id, notebook_id, title, selected_document_ids, created_at, updated_at, notebooks!inner(user_id)")
            .eq("id", session_id)
            .eq("notebooks.user_id", user_id)
            .execute()
        )
    except Exception as exc:
        logger.exception("Research session ownership check failed")
        raise HTTPException(status_code=500, detail={"code": "INTERNAL_ERROR", "message": "Lỗi khi kiểm tra phiên nghiên cứu"}) from exc
    rows, error = _supabase_response_data(resp)
    if error:
        raise HTTPException(status_code=500, detail={"code": "INTERNAL_ERROR", "message": "Lỗi khi kiểm tra phiên nghiên cứu"})
    if not rows:
        raise HTTPException(status_code=404, detail={"code": "DOC_NOT_FOUND", "message": "Không tìm thấy phiên nghiên cứu"})
    return _normalize_session(rows[0])
