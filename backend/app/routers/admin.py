from __future__ import annotations

from fastapi import APIRouter, Depends, File, Form, UploadFile

from app.dependencies import get_current_user
from pydantic import BaseModel

from app.services.system_library_service import (
    delete_system_document,
    import_system_document_from_upload,
    list_admin_documents,
    require_admin,
    set_user_library_upload_permission,
    set_user_publish_permission,
    update_library_document_status,
    _get_user_id,
)

router = APIRouter(prefix="/api/admin", tags=["admin"])


class LibraryUploadPermissionRequest(BaseModel):
    can_upload: bool
    hidden_status: str = "HIDDEN"


class PublishPermissionRequest(BaseModel):
    canPublishDocuments: bool
    reason: str | None = None


class LibraryDocumentStatusRequest(BaseModel):
    status: str
    reason: str | None = None


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
    citation_threshold: float | None = Form(default=0),
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
        citation_threshold=0 if citation_threshold is None else citation_threshold,
    )
    return {"success": True, "data": {"document": document}}


@router.delete("/system-library/documents/{document_id}", response_model=dict)
async def delete_system_document_endpoint(document_id: str, user: dict = Depends(get_current_user)):
    require_admin(user)
    return {"success": True, "data": delete_system_document(document_id)}


@router.patch("/users/{user_id}/library-upload", response_model=dict)
async def update_user_library_upload_permission(user_id: str, body: LibraryUploadPermissionRequest, user: dict = Depends(get_current_user)):
    require_admin(user)
    return {"success": True, "data": set_user_library_upload_permission(user_id, body.can_upload, body.hidden_status)}


@router.patch("/users/{user_id}/publish-permission", response_model=dict)
async def update_user_publish_permission(user_id: str, body: PublishPermissionRequest, user: dict = Depends(get_current_user)):
    require_admin(user)
    return {"success": True, "data": set_user_publish_permission(user_id, body.canPublishDocuments, body.reason)}


@router.patch("/library/documents/{document_id}/status", response_model=dict)
async def update_library_document_status_endpoint(document_id: str, body: LibraryDocumentStatusRequest, user: dict = Depends(get_current_user)):
    require_admin(user)
    return {"success": True, "data": update_library_document_status(document_id, body.status, body.reason, user)}
