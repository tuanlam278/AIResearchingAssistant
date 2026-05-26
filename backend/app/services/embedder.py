"""
Embedding với Google text-embedding-004
"""
import asyncio
import google.generativeai as genai
from app.config import settings
from typing import List

genai.configure(api_key=settings.GOOGLE_API_KEY)

EMBEDDING_MODEL = "models/text-embedding-004"


async def embed_chunks(texts: List[str]) -> List[List[float]]:
    """
    Embed nhiều chunks cùng lúc (dùng cho indexing khi upload PDF).

    Returns:
        List of embedding vectors (768 dims mỗi vector)
    """
    def _call():
        result = genai.embed_content(
            model=EMBEDDING_MODEL,
            content=texts,
            task_type="retrieval_document",
        )
        return result["embedding"]

    # Chạy sync SDK trong thread pool để không block event loop
    return await asyncio.to_thread(_call)


async def embed_query(text: str) -> List[float]:
    """
    Embed một câu hỏi (dùng cho query flow).

    Returns:
        Embedding vector (768 dims)
    """
    def _call():
        result = genai.embed_content(
            model=EMBEDDING_MODEL,
            content=text,
            task_type="retrieval_query",
        )
        return result["embedding"]

    return await asyncio.to_thread(_call)