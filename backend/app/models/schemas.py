from pydantic import BaseModel, Field, EmailStr
from pydantic.generics import GenericModel
from typing import List, Optional, Literal, TypeVar, Generic
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


class UserInfo(BaseModel):
    user_id: str
    email: str


class RegisterResponse(BaseModel):
    user: UserInfo


class LoginRequest(BaseModel):
    email: EmailStr
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
    role: Literal["user", "assistant"]
    content: str


class AskRequest(BaseModel):
    notebook_id: str                                        # ← đổi từ doc_id → notebook_id
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


# ── Summary ───────────────────────────────────────────────────────────────────

class SummaryResponse(BaseModel):
    summary: str
    key_contributions: List[str]
    doc_id: str