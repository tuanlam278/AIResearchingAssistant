from pydantic import BaseModel, Field, EmailStr
from typing import List, Optional, Literal
from datetime import datetime


# ── Auth ──────────────────────────────────────────────────

class RegisterRequest(BaseModel):
    email: EmailStr
    password: str = Field(..., min_length=6)


class RegisterResponse(BaseModel):
    user_id: str
    email: str


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class UserInfo(BaseModel):
    user_id: str
    email: str


class LoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserInfo


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

class ErrorDetail(BaseModel):
    code: str
    message: str


class ErrorResponse(BaseModel):
    success: bool = False
    error: ErrorDetail
