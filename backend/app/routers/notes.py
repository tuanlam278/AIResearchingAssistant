import logging
from datetime import datetime, timezone
from typing import Any, List, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from app.db.supabase_client import supabase
from app.dependencies import get_current_user

logger = logging.getLogger(__name__)
router = APIRouter(tags=["notes"])


class NoteCreateRequest(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)
    content: str = Field(..., min_length=1)
    citations: List[dict] = Field(default_factory=list)
    source_message_id: Optional[str] = None


class NoteUpdateRequest(BaseModel):
    title: Optional[str] = Field(default=None, min_length=1, max_length=200)
    content: Optional[str] = Field(default=None, min_length=1)
    citations: Optional[List[dict]] = None


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


def _normalize_note(row: dict) -> dict:
    citations = row.get("citations")
    if citations is None:
        citations = row.get("citations_json") or []

    return {
        "id": row.get("id"),
        "workspace_id": row.get("workspace_id"),
        "title": row.get("title") or "Ghi chú mới",
        "content": row.get("content") or "",
        "citations": citations,
        "source_message_id": row.get("source_message_id"),
        "created_at": row.get("created_at"),
        "updated_at": row.get("updated_at"),
    }


def _ensure_workspace_owner(workspace_id: str, user_id: str) -> None:
    try:
        resp = (
            supabase.table("notebooks")
            .select("id")
            .match({"id": workspace_id, "user_id": user_id})
            .execute()
        )
    except Exception:
        logger.exception("Supabase workspace ownership check failed")
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


def _get_note_for_user(note_id: str, user_id: str) -> dict:
    try:
        resp = (
            supabase.table("notes")
            .select("id, workspace_id, title, content, citations, source_message_id, created_at, updated_at, notebooks!inner(user_id)")
            .eq("id", note_id)
            .eq("notebooks.user_id", user_id)
            .single()
            .execute()
        )
    except Exception:
        logger.exception("Supabase note lookup failed")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"code": "INTERNAL_ERROR", "message": "Lỗi khi lấy ghi chú"},
        )

    data, error = _supabase_response_data(resp)
    if error or not data:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "DOC_NOT_FOUND", "message": "Không tìm thấy ghi chú"},
        )
    return data


@router.get("/workspaces/{workspace_id}/notes", response_model=dict)
async def list_workspace_notes(
    workspace_id: str,
    user: dict = Depends(get_current_user),
):
    user_id = _get_user_id(user)
    _ensure_workspace_owner(workspace_id, user_id)

    try:
        resp = (
            supabase.table("notes")
            .select("id, workspace_id, title, content, citations, source_message_id, created_at, updated_at")
            .eq("workspace_id", workspace_id)
            .order("updated_at", desc=True)
            .execute()
        )
    except Exception:
        logger.exception("Supabase list notes failed")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"code": "INTERNAL_ERROR", "message": "Lỗi khi lấy danh sách ghi chú"},
        )

    data, error = _supabase_response_data(resp)
    if error:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"code": "INTERNAL_ERROR", "message": "Lỗi khi lấy danh sách ghi chú"},
        )

    notes = [_normalize_note(row) for row in (data or [])]
    return {"success": True, "data": {"notes": notes, "total": len(notes)}}


@router.post("/workspaces/{workspace_id}/notes", response_model=dict)
async def create_workspace_note(
    workspace_id: str,
    body: NoteCreateRequest,
    user: dict = Depends(get_current_user),
):
    user_id = _get_user_id(user)
    _ensure_workspace_owner(workspace_id, user_id)

    now = datetime.now(timezone.utc).isoformat()
    payload = {
        "workspace_id": workspace_id,
        "title": body.title.strip(),
        "content": body.content.strip(),
        "citations": body.citations,
        "source_message_id": body.source_message_id,
        "updated_at": now,
    }

    try:
        resp = supabase.table("notes").insert(payload).execute()
    except Exception:
        logger.exception("Supabase create note failed")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"code": "INTERNAL_ERROR", "message": "Lỗi khi tạo ghi chú"},
        )

    data, error = _supabase_response_data(resp)
    if error or not data:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"code": "INTERNAL_ERROR", "message": "Lỗi khi tạo ghi chú"},
        )

    return {"success": True, "data": {"note": _normalize_note(data[0])}}


@router.patch("/notes/{note_id}", response_model=dict)
async def update_note(
    note_id: str,
    body: NoteUpdateRequest,
    user: dict = Depends(get_current_user),
):
    user_id = _get_user_id(user)
    existing = _get_note_for_user(note_id, user_id)

    updates: dict[str, Any] = {"updated_at": datetime.now(timezone.utc).isoformat()}
    if body.title is not None:
        updates["title"] = body.title.strip()
    if body.content is not None:
        updates["content"] = body.content.strip()
    if body.citations is not None:
        updates["citations"] = body.citations

    if len(updates) == 1:
        return {"success": True, "data": {"note": _normalize_note(existing)}}

    try:
        resp = supabase.table("notes").update(updates).eq("id", note_id).execute()
    except Exception:
        logger.exception("Supabase update note failed")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"code": "INTERNAL_ERROR", "message": "Lỗi khi cập nhật ghi chú"},
        )

    data, error = _supabase_response_data(resp)
    if error or not data:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"code": "INTERNAL_ERROR", "message": "Lỗi khi cập nhật ghi chú"},
        )

    return {"success": True, "data": {"note": _normalize_note(data[0])}}


@router.delete("/notes/{note_id}", response_model=dict)
async def delete_note(
    note_id: str,
    user: dict = Depends(get_current_user),
):
    user_id = _get_user_id(user)
    _get_note_for_user(note_id, user_id)

    try:
        resp = supabase.table("notes").delete().eq("id", note_id).execute()
    except Exception:
        logger.exception("Supabase delete note failed")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"code": "INTERNAL_ERROR", "message": "Lỗi khi xoá ghi chú"},
        )

    _, error = _supabase_response_data(resp)
    if error:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"code": "INTERNAL_ERROR", "message": "Lỗi khi xoá ghi chú"},
        )

    return {"success": True, "data": {"note_id": note_id, "deleted": True}}
