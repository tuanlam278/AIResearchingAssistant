from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, File, Form, Query, UploadFile
from fastapi.responses import RedirectResponse, Response
from pydantic import BaseModel, Field

from app.dependencies import get_current_user
from app.services.system_library_service import (
    add_bookmark,
    content_disposition_for_filename,
    get_system_document_download,
    import_community_document_from_upload,
    get_document_rating,
    import_internet_paper_to_library,
    list_or_search_documents,
    list_top_library_tags,
    rate_document,
    remove_bookmark,
    vote_document,
)
from app.services.paper_providers import get_paper_provider
from app.services.activity_log_service import log_user_activity

router = APIRouter(tags=["system-library"])


class SystemLibraryFilters(BaseModel):
    tags: list[str] = Field(default_factory=list)
    peer_review_status: list[Literal["PEER_REVIEWED", "PREPRINT", "UNKNOWN"]] = Field(default_factory=list)
    access_types: list[Literal["OPEN_ACCESS", "FREE_TO_READ", "INSTITUTIONAL_ACCESS", "UNKNOWN"]] = Field(default_factory=list)
    review_types: list[Literal["RESEARCH_ARTICLE", "REVIEW", "SYSTEMATIC_REVIEW", "META_ANALYSIS", "EDITORIAL", "UNKNOWN"]] = Field(default_factory=list)
    source_types: list[Literal["USER_UPLOAD", "SYSTEM_UPLOAD", "INTERNET"]] = Field(default_factory=list)
    has_pdf: bool = False
    has_data: bool = False
    has_code: bool = False
    citation_count_min: int | None = None
    sort: Literal["newest", "title_az", "title_za", "vote_highest", "citation_highest", "download_highest", "semantic_relevance"] = "newest"
    bookmarked: bool = False
    my_documents: bool = False
    # Reserved AI-powered filter schema. Stance is only meaningful when hypothesis is present.
    research_methodology: list[str] = Field(default_factory=list)
    readability_level: list[str] = Field(default_factory=list)
    estimated_reading_time: list[str] = Field(default_factory=list)
    empirical_evidence: list[str] = Field(default_factory=list)
    outcome_stance: list[str] = Field(default_factory=list)
    hypothesis: str = ""


class SystemLibrarySearchRequest(BaseModel):
    query: str = Field(default="", max_length=500)
    filters: SystemLibraryFilters = Field(default_factory=SystemLibraryFilters)


class VoteRequest(BaseModel):
    rating: int = Field(ge=1, le=5)


class RatingRequest(BaseModel):
    document_type: Literal["system_library", "community_library"] = "system_library"
    rating: int = Field(ge=1, le=5)


class PaperSearchRequest(BaseModel):
    query: str = Field(min_length=2, max_length=500)
    provider: str = "openalex"
    limit: int = Field(default=20, ge=1, le=50)


class ImportInternetPaperRequest(BaseModel):
    paper: dict


@router.get("/documents", response_model=dict)
async def list_documents(
    q: str = "",
    category: str | None = None,
    file_type: str | None = None,
    tags: str | None = None,
    user: dict = Depends(get_current_user),
):
    _ = category, file_type
    filters = SystemLibraryFilters(tags=[tag for tag in (tags or "").split(",") if tag])
    data = await list_or_search_documents(user, q, filters.model_dump())
    return {"success": True, "data": data}


@router.post("/search", response_model=dict)
async def search_documents(body: SystemLibrarySearchRequest, user: dict = Depends(get_current_user)):
    data = await list_or_search_documents(user, body.query, body.filters.model_dump())
    return {"success": True, "data": data}


@router.get("/documents/{document_id}/download")
async def download_document(document_id: str, user: dict = Depends(get_current_user)):
    # Authenticated users may download available System Library originals; service role stays server-side.
    download = get_system_document_download(document_id, user)
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


@router.get("/tags", response_model=dict)
async def list_tags(limit: int = Query(default=200, ge=1, le=500), user: dict = Depends(get_current_user)):
    _ = user
    return {"success": True, "data": list_top_library_tags(limit=limit)}


@router.post("/documents/upload", response_model=dict)
async def upload_document(
    file: UploadFile = File(...),
    title: str | None = Form(default=None),
    description: str | None = Form(default=None),
    category: str | None = Form(default=None),
    tags: str = Form(default=""),
    citation_threshold: float | None = Form(default=0),
    user: dict = Depends(get_current_user),
):
    contents = await file.read()
    filename = file.filename or "library-document"
    document = await import_community_document_from_upload(
        file_contents=contents,
        filename=filename,
        user=user,
        title=title,
        description=description,
        category=category,
        tags=tags,
        mime_type=file.content_type,
        citation_threshold=0 if citation_threshold is None else citation_threshold,
    )
    log_user_activity(
        user_id=str(user.get("id") or user.get("user_id") or ""),
        feature_name="system_library",
        action_type="community_document_upload",
        document_id=document.get("id"),
        document_name=document.get("filename") or document.get("title") or filename,
        metadata={
            "file_type": document.get("file_type"),
            "size": len(contents),
            "source": "system_library_upload",
            "upload_status": document.get("status") or "ready",
        },
    )
    return {"success": True, "data": {"document": document}}


@router.post("/papers/search", response_model=dict)
async def search_papers(body: PaperSearchRequest, user: dict = Depends(get_current_user)):
    _ = user
    provider = get_paper_provider(body.provider)
    return {"success": True, "data": {"papers": provider.search(body.query, body.limit), "source": provider.source}}


@router.post("/papers/import", response_model=dict)
async def import_paper(body: ImportInternetPaperRequest, user: dict = Depends(get_current_user)):
    return {"success": True, "data": {"document": await import_internet_paper_to_library(body.paper, user)}}


@router.get("/documents/{document_id}/rating", response_model=dict)
async def get_rating(
    document_id: str,
    document_type: Literal["system_library", "community_library"] = "system_library",
    user: dict = Depends(get_current_user),
):
    return {"success": True, "data": get_document_rating(document_id, user, document_type)}


@router.post("/documents/{document_id}/rating", response_model=dict)
async def rate(document_id: str, body: RatingRequest, user: dict = Depends(get_current_user)):
    return {"success": True, "data": rate_document(document_id, user, body.rating, body.document_type)}


@router.post("/documents/{document_id}/vote", response_model=dict)
async def vote(document_id: str, body: VoteRequest, user: dict = Depends(get_current_user)):
    return {"success": True, "data": vote_document(document_id, user, body.rating)}


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
