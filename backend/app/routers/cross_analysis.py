from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter, Depends, File, UploadFile
from pydantic import BaseModel, Field

from app.dependencies import get_current_user
from app.services.cross_analysis_service import chat_about_documents, compare_documents, detect_conflicts, get_document_preview, synthesize_documents, upload_temp_document

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


@router.post("/documents/upload", response_model=dict)
async def upload_cross_analysis_document(file: UploadFile = File(...), user: dict = Depends(get_current_user)):
    _ = user
    contents = await file.read()
    document = await upload_temp_document(contents, file.filename or "uploaded-document")
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
    result = await chat_about_documents(body.document_a.model_dump(), body.document_b.model_dump(), body.message, body.chat_history)
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
