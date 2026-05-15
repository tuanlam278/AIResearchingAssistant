"""
BE2 implement: Embedding với Google text-embedding-004
"""
import google.generativeai as genai
from app.config import settings
from typing import List

genai.configure(api_key=settings.GOOGLE_API_KEY)

EMBEDDING_MODEL = "models/text-embedding-004"


async def embed_chunks(texts: List[str]) -> List[List[float]]:
    """
    Embed nhiều chunks cùng lúc.

    Returns:
        List of embedding vectors (768 dims mỗi vector)
    """
    # Google API hỗ trợ batch embedding
    result = genai.embed_content(
        model=EMBEDDING_MODEL,
        content=texts,
        task_type="retrieval_document",  # quan trọng: dùng retrieval_document cho indexing
    )
    return result["embedding"]


async def embed_query(text: str) -> List[float]:
    """
    Embed một câu hỏi.

    Returns:
        Embedding vector (768 dims)
    """
    result = genai.embed_content(
        model=EMBEDDING_MODEL,
        content=text,
        task_type="retrieval_query",  # quan trọng: dùng retrieval_query cho câu hỏi
    )
    return result["embedding"]
