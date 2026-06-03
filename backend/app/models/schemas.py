from pydantic import BaseModel, Field, field_validator, EmailStr
from pydantic.generics import GenericModel
from typing import List, Optional, Literal, TypeVar, Generic, Any
from datetime import datetime

T = TypeVar("T")

# ── Common / Response wrapper ────────────────────────────────────────────────

class SuccessResponse(GenericModel, Generic[T]):
    success: bool = True
    data: T


class ErrorDetail(BaseModel):
    code: str
    message: str


class ErrorResponse(BaseModel):
    success: bool = False
    error: ErrorDetail


# ── Auth ─────────────────────────────────────────────────────────────────────

class RegisterRequest(BaseModel):
    email: EmailStr
    password: str = Field(..., min_length=6)
    confirm_password: Optional[str] = Field(default=None, min_length=6)
    name: Optional[str] = Field(default=None, max_length=160)


class UserInfo(BaseModel):
    user_id: str
    email: str
    role: str = "user"


class RegisterResponse(BaseModel):
    user: UserInfo


class LoginRequest(BaseModel):
    email: str
    password: str


class LoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserInfo


# ── Notebook ──────────────────────────────────────────────────────────────────

class CreateNotebookRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)


class NotebookItem(BaseModel):
    notebook_id: str
    name: str
    created_at: datetime


class NotebookListData(BaseModel):
    notebooks: List[NotebookItem]
    total: int


# ── Document ──────────────────────────────────────────────────────────────────

class DocumentResponse(BaseModel):
    doc_id: str
    notebook_id: str
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


# ── Chat ──────────────────────────────────────────────────────────────────────

class ChatMessage(BaseModel):
    role: Literal["system", "user", "assistant"]
    content: str
    id: Optional[str] = None
    citations: Optional[List[dict[str, Any]]] = None
    warning: Optional[str] = None
    created_at: Optional[datetime] = None


class AskRequest(BaseModel):
    notebook_id: str                                        # ← đổi từ doc_id → notebook_id
    question: str = Field(..., max_length=1000)
    chat_history: List[ChatMessage] = Field(default_factory=list, max_length=20)
    selected_document_ids: List[str] = Field(default_factory=list, max_length=50)
    research_session_id: Optional[str] = None
    citation_threshold: float = 0

    @field_validator("citation_threshold", mode="before")
    @classmethod
    def normalize_citation_threshold(cls, value):
        if value in (None, ""):
            return 0
        try:
            parsed = float(value)
        except (TypeError, ValueError):
            return 0
        if parsed != parsed or parsed < 0:
            return 0
        return parsed


class SourceChunk(BaseModel):
    chunk_id: str
    citation_index: int
    id: str
    document_id: Optional[str] = None
    document_title: str = "Tài liệu"
    section: str = "Unknown"
    content: str
    snippet: str
    page: int
    page_start: Optional[int] = None
    page_end: Optional[int] = None
    score: Optional[float] = None


class AskResponse(BaseModel):
    answer: str
    sources: List[SourceChunk]
    warning: Optional[str] = None
    message: Optional[ChatMessage] = None
    citations: List[SourceChunk] = Field(default_factory=list)
    suggested_prompts: List[str] = Field(default_factory=list)
    tokens_used: Optional[int] = None


# ── Summary ───────────────────────────────────────────────────────────────────

class SummaryResponse(BaseModel):
    summary: str
    key_contributions: List[str]
    doc_id: str