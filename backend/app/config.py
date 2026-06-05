from pydantic_settings import BaseSettings
from typing import List


class Settings(BaseSettings):
    GOOGLE_API_KEY: str = ""
    VISION_MODEL: str = "gemini-1.5-flash"
    GROQ_API_KEY: str = ""
    GROQ_FLASHCARD_MODEL: str = "llama-3.1-8b-instant"
    WEB_SEARCH_PROVIDER: str = "duckduckgo"
    WEB_SEARCH_API_KEY: str = ""
    WEB_SEARCH_MAX_RESULTS: int = 5
    SUPABASE_URL: str
    SUPABASE_SERVICE_KEY: str
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
    EMBEDDING_CONCURRENCY: int = 2
    INDEXING_STORAGE_BUCKET: str = "document-uploads"
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
    SYSTEM_LIBRARY_STORAGE_BUCKET: str = "system-documents"

    # Limits
    MAX_UPLOAD_MB: int = 50
    MAX_FILE_SIZE_MB: int = 50  # Backward-compatible alias for older env files
    MAX_QUESTION_LENGTH: int = 1000
    MAX_CHAT_HISTORY_TURNS: int = 10

    google_client_id: str = ""
    google_client_secret: str = ""

    class Config:
        env_file = ".env"


settings = Settings()
