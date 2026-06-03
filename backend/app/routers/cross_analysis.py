from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter, Depends, File, UploadFile
from pydantic import BaseModel, Field

from app.dependencies import get_current_user
from app.services.cross_analysis_service import chat_about_documents, compare_documents, create_cross_analysis_session, delete_cross_analysis_session, detect_conflicts, get_cross_analysis_session, get_document_preview, list_cross_analysis_sessions, synthesize_documents, update_cross_analysis_session, upload_temp_document
from app.services.activity_log_service import log_user_activity

router = APIRouter(tags=["cross-analysis"])


class CrossDocumentRef(BaseModel):
    id: str
    source_type: Literal["upload", "system_library"]
    title: str | None = None
    filename: str | None = None
    file_type: str | None = None


class CompareRequest(BaseModel):
    document_a: CrossDocumentRef
    document_b: CrossDocumentRef
    criteria: list[str] = Field(default_factory=list)


class TwoDocumentRequest(BaseModel):
    document_a: CrossDocumentRef
    document_b: CrossDocumentRef


class ChatRequest(TwoDocumentRequest):
    message: str = Field(..., min_length=1, max_length=1500)
    chat_history: list[dict[str, Any]] = Field(default_factory=list)
    selected_row: dict[str, Any] | None = None


class CrossAnalysisSessionRequest(BaseModel):
    title: str | None = None
    document_a_ref: dict[str, Any] | None = None
    document_b_ref: dict[str, Any] | None = None
    selected_preset: str | None = None
    selected_criteria: list[Any] = Field(default_factory=list)
    comparison_result: dict[str, Any] | None = None
    chat_history: list[dict[str, Any]] = Field(default_factory=list)


@router.post("/documents/upload", response_model=dict)
async def upload_cross_analysis_document(file: UploadFile = File(...), user: dict = Depends(get_current_user)):
    contents = await file.read()
    filename = file.filename or "uploaded-document"
    document = await upload_temp_document(contents, filename)
    user_id = str(user.get("id") or user.get("user_id") or user.get("email") or "")
    log_user_activity(
        user_id=user_id,
        feature_name="cross_analysis",
        action_type="document_upload",
        document_id=document.get("id"),
        document_name=document.get("filename") or filename,
        metadata={
            "file_type": document.get("file_type"),
            "size": len(contents),
            "source": "cross_analysis_upload",
            "upload_status": "ready",
            "temp_document_id": document.get("id"),
        },
    )
    return {"success": True, "data": document}


@router.post("/compare", response_model=dict)
async def compare_cross_analysis_documents(body: CompareRequest, user: dict = Depends(get_current_user)):
    _ = user
    result = await compare_documents(body.document_a.model_dump(), body.document_b.model_dump(), body.criteria)
    return {"success": True, "data": result}


@router.post("/conflicts", response_model=dict)
async def find_cross_analysis_conflicts(body: TwoDocumentRequest, user: dict = Depends(get_current_user)):
    _ = user
    result = await detect_conflicts(body.document_a.model_dump(), body.document_b.model_dump())
    return {"success": True, "data": result}


@router.post("/synthesis", response_model=dict)
async def synthesize_cross_analysis_documents(body: TwoDocumentRequest, user: dict = Depends(get_current_user)):
    _ = user
    result = await synthesize_documents(body.document_a.model_dump(), body.document_b.model_dump())
    return {"success": True, "data": result}


@router.post("/chat", response_model=dict)
async def chat_cross_analysis_documents(body: ChatRequest, user: dict = Depends(get_current_user)):
    _ = user
    result = await chat_about_documents(body.document_a.model_dump(), body.document_b.model_dump(), body.message, body.chat_history, body.selected_row)
    return {"success": True, "data": result}


@router.post("/chat/clear", response_model=dict)
async def clear_cross_analysis_chat(body: TwoDocumentRequest, user: dict = Depends(get_current_user)):
    _ = (body, user)
    return {"success": True, "data": {"cleared": True}}


@router.get("/documents/{document_id}/preview", response_model=dict)
async def preview_cross_analysis_document(document_id: str, user: dict = Depends(get_current_user)):
    _ = user
    result = get_document_preview(document_id)
    return {"success": True, "data": result}


@router.post("/sessions", response_model=dict)
async def create_cross_analysis_session_endpoint(body: CrossAnalysisSessionRequest, user: dict = Depends(get_current_user)):
    result = create_cross_analysis_session(body.model_dump(), user)
    return {"success": True, "data": result}


@router.get("/sessions", response_model=dict)
async def list_cross_analysis_sessions_endpoint(user: dict = Depends(get_current_user)):
    result = list_cross_analysis_sessions(user)
    return {"success": True, "data": {"sessions": result}}


@router.get("/sessions/{session_id}", response_model=dict)
async def get_cross_analysis_session_endpoint(session_id: str, user: dict = Depends(get_current_user)):
    result = get_cross_analysis_session(session_id, user)
    return {"success": True, "data": result}


@router.patch("/sessions/{session_id}", response_model=dict)
async def update_cross_analysis_session_endpoint(session_id: str, body: CrossAnalysisSessionRequest, user: dict = Depends(get_current_user)):
    result = update_cross_analysis_session(session_id, body.model_dump(exclude_unset=True), user)
    return {"success": True, "data": result}


@router.delete("/sessions/{session_id}", response_model=dict)
async def delete_cross_analysis_session_endpoint(session_id: str, user: dict = Depends(get_current_user)):
    result = delete_cross_analysis_session(session_id, user)
    return {"success": True, "data": result}
