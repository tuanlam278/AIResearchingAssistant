from pydantic_settings import BaseSettings
from typing import List


class Settings(BaseSettings):
    GOOGLE_API_KEY: str
    GROQ_API_KEY: str = ""
    GROQ_FLASHCARD_MODEL: str = "llama-3.1-8b-instant"
    SUPABASE_URL: str
    SUPABASE_SERVICE_KEY: str
    SUPABASE_ANON_KEY: str
    CORS_ORIGINS: List[str] = ["http://localhost:5173"]

    # Chunking
    CHUNK_SIZE: int = 500
    CHUNK_OVERLAP: int = 50

    # Retrieval
    TOP_K_CHUNKS: int = 5
    MIN_SIMILARITY: float = 0.5
    RAG_RELEVANCE_THRESHOLD: float = 0.35

    # Limits
    MAX_UPLOAD_MB: int = 50
    MAX_FILE_SIZE_MB: int = 50  # Backward-compatible alias for older env files
    MAX_QUESTION_LENGTH: int = 1000
    MAX_CHAT_HISTORY_TURNS: int = 10

    class Config:
        env_file = ".env"


settings = Settings()
