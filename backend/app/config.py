import logging
from pydantic import model_validator
from pydantic_settings import BaseSettings
from typing import List

logger = logging.getLogger(__name__)


class Settings(BaseSettings):
    GOOGLE_API_KEY: str = ""
    # Required for Academic Lens vision and scanned-PDF OCR. Keep empty unless configured in .env.
    VISION_MODEL: str = ""
    GROQ_API_KEY: str = ""
    GROQ_FLASHCARD_MODEL: str = "llama-3.1-8b-instant"
    WEB_SEARCH_PROVIDER: str = "duckduckgo"
    WEB_SEARCH_API_KEY: str = ""
    WEB_SEARCH_MAX_RESULTS: int = 5
    SUPABASE_URL: str
    SUPABASE_SERVICE_KEY: str = ""
    SUPABASE_SERVICE_ROLE_KEY: str = ""
    SUPABASE_ANON_KEY: str
    GOOGLE_CLIENT_ID: str = ""
    JWT_SECRET_KEY: str = ""
    SMTP_HOST: str = ""
    SMTP_PORT: int = 587
    SMTP_USER: str = ""
    SMTP_PASSWORD: str = ""
    SMTP_FROM: str = ""
    APP_ENV: str = "development"
    ENABLE_DEV_AUTH_BYPASS: bool = False
    AVATAR_STORAGE_BUCKET: str = "avatars"
    CORS_ORIGINS: List[str] = ["http://localhost:5173"]

    # Chunking
    CHUNK_SIZE: int = 500
    CHUNK_OVERLAP: int = 50

    # Indexing
    BACKGROUND_INDEXING_ENABLED: bool = True
    INDEX_INSERT_BATCH_SIZE: int = 250
    EMBEDDING_MODEL: str = "gemini-embedding-001"
    EMBEDDING_BATCH_SIZE: int = 100
    EMBEDDING_MAX_CONCURRENCY: int = 3
    EMBEDDING_CONCURRENCY: int | None = None  # Backward-compatible alias.
    NOTEBOOK_STORAGE_BUCKET: str = ""
    INDEXING_STORAGE_BUCKET: str = ""
    SUPABASE_STORAGE_BUCKET: str = ""
    DOCUMENTS_BUCKET: str = ""
    INDEXING_WORKER_ENABLED: bool = True
    GENERATION_WORKER_ENABLED: bool = True

    # Retrieval
    TOP_K_CHUNKS: int = 5
    MIN_SIMILARITY: float = 0.5
    RAG_RELEVANCE_THRESHOLD: float = 0.35
    RAG_CANDIDATE_MULTIPLIER: int = 8
    RAG_MAX_CONTEXT_CHUNKS: int = 8
    RAG_ENABLE_NEIGHBOR_CONTEXT: bool = True
    MAX_PROMPT_TOKENS: int = 12000
    RESERVED_HISTORY_TOKENS: int = 1500

    # System Library admin upload account. Override these in production.
    SYSTEM_LIBRARY_ADMIN_EMAIL: str = "admin"
    SYSTEM_LIBRARY_ADMIN_PASSWORD: str = "admin"
    SYSTEM_LIBRARY_STORAGE_BUCKET: str = ""
    COMMUNITY_LIBRARY_STORAGE_BUCKET: str = ""

    # Limits
    MAX_UPLOAD_MB: int = 50
    MAX_FILE_SIZE_MB: int = 50  # Backward-compatible alias for older env files
    MAX_QUESTION_LENGTH: int = 1000
    MAX_CHAT_HISTORY_TURNS: int = 10

    google_client_id: str = ""
    google_client_secret: str = ""

    @model_validator(mode="after")
    def normalize_storage_and_limits(self):
        if not self.SUPABASE_SERVICE_KEY and self.SUPABASE_SERVICE_ROLE_KEY:
            self.SUPABASE_SERVICE_KEY = self.SUPABASE_SERVICE_ROLE_KEY
        elif not self.SUPABASE_SERVICE_ROLE_KEY and self.SUPABASE_SERVICE_KEY:
            self.SUPABASE_SERVICE_ROLE_KEY = self.SUPABASE_SERVICE_KEY

        common_bucket = self.SUPABASE_STORAGE_BUCKET or self.DOCUMENTS_BUCKET
        if not self.INDEXING_STORAGE_BUCKET:
            self.INDEXING_STORAGE_BUCKET = self.NOTEBOOK_STORAGE_BUCKET or common_bucket
        if not self.NOTEBOOK_STORAGE_BUCKET:
            self.NOTEBOOK_STORAGE_BUCKET = self.INDEXING_STORAGE_BUCKET or common_bucket
        if not self.SYSTEM_LIBRARY_STORAGE_BUCKET:
            self.SYSTEM_LIBRARY_STORAGE_BUCKET = common_bucket
        if not self.COMMUNITY_LIBRARY_STORAGE_BUCKET:
            self.COMMUNITY_LIBRARY_STORAGE_BUCKET = self.SYSTEM_LIBRARY_STORAGE_BUCKET

        raw_concurrency = self.EMBEDDING_MAX_CONCURRENCY
        if self.EMBEDDING_CONCURRENCY is not None:
            raw_concurrency = self.EMBEDDING_CONCURRENCY
        if raw_concurrency < 1:
            logger.warning("EMBEDDING_MAX_CONCURRENCY=%s is invalid; clamping to 1", raw_concurrency)
            raw_concurrency = 1
        if raw_concurrency > 5:
            logger.warning("EMBEDDING_MAX_CONCURRENCY=%s exceeds Google RPM-safe limit; clamping to 5", raw_concurrency)
            raw_concurrency = 5
        self.EMBEDDING_MAX_CONCURRENCY = raw_concurrency
        self.EMBEDDING_CONCURRENCY = raw_concurrency
        self.EMBEDDING_BATCH_SIZE = max(1, min(int(self.EMBEDDING_BATCH_SIZE or 100), 100))
        self.VISION_MODEL = str(self.VISION_MODEL or "").strip()
        return self

    class Config:
        env_file = ".env"


settings = Settings()
