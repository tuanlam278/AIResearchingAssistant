from pydantic_settings import BaseSettings
from typing import List


class Settings(BaseSettings):
    GOOGLE_API_KEY: str
    SUPABASE_URL: str
    SUPABASE_SERVICE_KEY: str
    CORS_ORIGINS: List[str] = ["http://localhost:5173"]

    # Chunking
    CHUNK_SIZE: int = 500
    CHUNK_OVERLAP: int = 50

    # Retrieval
    TOP_K_CHUNKS: int = 5

    # Limits
    MAX_FILE_SIZE_MB: int = 20
    MAX_QUESTION_LENGTH: int = 1000
    MAX_CHAT_HISTORY_TURNS: int = 10

    class Config:
        env_file = ".env"


settings = Settings()
