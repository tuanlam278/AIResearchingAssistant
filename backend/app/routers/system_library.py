from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends
from fastapi.responses import RedirectResponse, Response
from pydantic import BaseModel, Field

from app.dependencies import get_current_user
from app.services.system_library_service import (
    add_bookmark,
    content_disposition_for_filename,
    get_system_document_download,
    list_or_search_documents,
    remove_bookmark,
)

router = APIRouter(tags=["system-library"])


class SystemLibraryFilters(BaseModel):
    categories: list[str] = Field(default_factory=list)
    file_types: list[str] = Field(default_factory=list)
    tags: list[str] = Field(default_factory=list)
    updated_ranges: list[str] = Field(default_factory=list)
    vector_status: list[Literal["ready", "processing"]] = Field(default_factory=list)
    bookmarked: bool = False


class SystemLibrarySearchRequest(BaseModel):
    query: str = Field(default="", max_length=500)
    filters: SystemLibraryFilters = Field(default_factory=SystemLibraryFilters)


@router.get("/documents", response_model=dict)
async def list_documents(
    q: str = "",
    category: str | None = None,
    file_type: str | None = None,
    tags: str | None = None,
    user: dict = Depends(get_current_user),
):
    filters = SystemLibraryFilters(
        categories=[category] if category else [],
        file_types=[file_type] if file_type else [],
        tags=[tag for tag in (tags or "").split(",") if tag],
    )
    data = await list_or_search_documents(user, q, filters.model_dump())
    return {"success": True, "data": data}


@router.post("/search", response_model=dict)
async def search_documents(body: SystemLibrarySearchRequest, user: dict = Depends(get_current_user)):
    data = await list_or_search_documents(user, body.query, body.filters.model_dump())
    return {"success": True, "data": data}


@router.get("/documents/{document_id}/download")
async def download_document(document_id: str, user: dict = Depends(get_current_user)):
    # Authenticated users may download available System Library originals; service role stays server-side.
    _ = user
    download = get_system_document_download(document_id)
    if download.get("type") == "redirect":
        return RedirectResponse(download["url"])
    content_type = download.get("mime_type") or "application/octet-stream"
    return Response(
        content=download["content"],
        media_type=content_type,
        headers={
            "Content-Type": content_type,
            "Content-Disposition": content_disposition_for_filename(download.get("filename") or f"document-{document_id}.pdf"),
        },
    )


@router.get("/bookmarks", response_model=dict)
async def list_bookmarks(user: dict = Depends(get_current_user)):
    data = await list_or_search_documents(user, "", {"bookmarked": True})
    return {"success": True, "data": data}


@router.post("/documents/{document_id}/bookmark", response_model=dict)
async def bookmark_document(document_id: str, user: dict = Depends(get_current_user)):
    return {"success": True, "data": add_bookmark(document_id, user)}


@router.delete("/documents/{document_id}/bookmark", response_model=dict)
async def unbookmark_document(document_id: str, user: dict = Depends(get_current_user)):
    return {"success": True, "data": remove_bookmark(document_id, user)}
