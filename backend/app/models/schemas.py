from pydantic import BaseModel, Field
from typing import List, Optional, Literal
from datetime import datetime


# ── Document ──────────────────────────────────────────────

class DocumentResponse(BaseModel):
    doc_id: str
    filename: str
    chunk_count: int
    page_count: int
    created_at: datetime
    status: str = "ready"


class DocumentListResponse(BaseModel):
    documents: List[DocumentResponse]
    total: int


class DeleteDocumentResponse(BaseModel):
    doc_id: str
    deleted: bool


# ── Chat ──────────────────────────────────────────────────

class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str


class AskRequest(BaseModel):
    doc_id: str
    question: str = Field(..., max_length=1000)
    chat_history: List[ChatMessage] = Field(default_factory=list, max_length=20)


class SourceChunk(BaseModel):
    chunk_id: str
    content: str
    page: int
    score: float


class AskResponse(BaseModel):
    answer: str
    sources: List[SourceChunk]
    tokens_used: Optional[int] = None


# ── Summary ───────────────────────────────────────────────

class SummaryResponse(BaseModel):
    summary: str
    key_contributions: List[str]
    doc_id: str


# ── Generic wrapper ───────────────────────────────────────

class SuccessResponse(BaseModel):
    success: bool = True
    data: dict


class ErrorDetail(BaseModel):
    code: str
    message: str


class ErrorResponse(BaseModel):
    success: bool = False
    error: ErrorDetail
