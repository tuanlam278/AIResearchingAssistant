#Ver 2
from pydantic import BaseModel, Field, EmailStr, conlist
from pydantic.generics import GenericModel
from typing import List, Optional, Literal, TypeVar, Generic
from datetime import datetime

T = TypeVar("T")

# ── Common / Response wrapper ────────────────────────────────────────────────

class SuccessResponse(GenericModel, Generic[T]):
    """Generic success wrapper matching API contract: { "success": true, "data": ... }"""
    success: bool = True
    data: T


class ErrorDetail(BaseModel):
    code: str
    message: str


class ErrorResponse(BaseModel):
    """Error wrapper matching API contract: { "success": false, "error": { ... } }"""
    success: bool = False
    error: ErrorDetail


# ── Auth ───────────────────────────────────────────────────────────────────

class RegisterRequest(BaseModel):
    email: EmailStr
    password: str = Field(..., min_length=6)


class UserInfo(BaseModel):
    """Normalized user object used across responses (ensures user_id + email)."""
    user_id: str
    email: str


class RegisterResponse(BaseModel):
    """Return the created user info inside the data object."""
    user: UserInfo


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class LoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserInfo


# ── Document ────────────────────────────────────────────────────────────────

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


# ── Chat ────────────────────────────────────────────────────────────────────

class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str


class AskRequest(BaseModel):
    doc_id: str
    question: str = Field(..., max_length=1000)
    # Enforce max items for chat_history using conlist (fixed from previous Field(max_length=...))
    chat_history: conlist(ChatMessage, max_length=20) = Field(default_factory=list)


class SourceChunk(BaseModel):
    chunk_id: str
    content: str
    page: int
    score: float


class AskResponse(BaseModel):
    answer: str
    sources: List[SourceChunk]
    tokens_used: Optional[int] = None


# ── Summary ─────────────────────────────────────────────────────────────────

class SummaryResponse(BaseModel):
    summary: str
    key_contributions: List[str]
    doc_id: str
