from __future__ import annotations

from fastapi import APIRouter, Depends, File, Form, UploadFile

from app.dependencies import get_current_user
from app.services.system_library_service import (
    delete_system_document,
    import_system_document_from_upload,
    list_admin_documents,
    require_admin,
    _get_user_id,
)

router = APIRouter(prefix="/api/admin", tags=["admin"])


@router.get("/system-library/documents", response_model=dict)
async def list_system_documents(user: dict = Depends(get_current_user)):
    require_admin(user)
    return {"success": True, "data": list_admin_documents()}


@router.post("/system-library/import", response_model=dict)
async def import_system_document(
    file: UploadFile = File(...),
    title: str | None = Form(default=None),
    category: str | None = Form(default=None),
    tags: str = Form(default=""),
    user: dict = Depends(get_current_user),
):
    require_admin(user)
    contents = await file.read()
    document = await import_system_document_from_upload(
        file_contents=contents,
        filename=file.filename or "system-document",
        created_by=_get_user_id(user),
        title=title,
        category=category,
        tags=tags,
        mime_type=file.content_type,
    )
    return {"success": True, "data": {"document": document}}


@router.delete("/system-library/documents/{document_id}", response_model=dict)
async def delete_system_document_endpoint(document_id: str, user: dict = Depends(get_current_user)):
    require_admin(user)
    return {"success": True, "data": delete_system_document(document_id)}
