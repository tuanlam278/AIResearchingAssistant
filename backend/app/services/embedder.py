"""
Embedding service sử dụng Google Gemini Embedding.
"""
import asyncio
import logging
import time
from google import genai
from google.genai import types
from google.api_core.exceptions import GoogleAPIError, ResourceExhausted
from app.config import settings
from typing import List

logger = logging.getLogger(__name__)

client = genai.Client(api_key=settings.GOOGLE_API_KEY) if settings.GOOGLE_API_KEY.strip() else None

# Đưa vào settings để dễ thay đổi, không hardcode
EMBEDDING_MODEL = getattr(settings, "EMBEDDING_MODEL", "gemini-embedding-2")
EMBEDDING_DIMENSIONS = 768  # Phải khớp với schema Supabase: VECTOR(768)
BATCH_SIZE = 100             # Giới hạn của Gemini Embedding API
RATE_LIMIT_SLEEP = 1         # Giây chờ giữa các batch (tránh 429)
MAX_RETRIES = 3              # Số lần retry khi gặp lỗi tạm thời
EMBEDDING_CONCURRENCY = max(1, int(getattr(settings, "EMBEDDING_CONCURRENCY", 1) or 1))


def _embed_batch_with_retry(
    batch: List[str],
    task_type: str,
    retries: int = MAX_RETRIES,
) -> List[List[float]]:
    """
    Gọi Gemini Embedding API cho một batch, có retry + exponential backoff.

    Args:
        batch:     Danh sách text cần embed.
        task_type: "RETRIEVAL_DOCUMENT" hoặc "RETRIEVAL_QUERY".
        retries:   Số lần thử lại tối đa.

    Returns:
        List các embedding vectors.

    Raises:
        RuntimeError: Sau khi hết số lần retry.
    """
    if client is None:
        raise RuntimeError("EMBEDDING_NOT_CONFIGURED: GOOGLE_API_KEY is required for embeddings")

    last_error: Exception = RuntimeError("Unknown embedding error")

    for attempt in range(retries):
        try:
            result = client.models.embed_content(
                model=EMBEDDING_MODEL,
                contents=batch,
                config=types.EmbedContentConfig(
                    task_type=task_type,
                    output_dimensionality=EMBEDDING_DIMENSIONS,
                ),
            )
            return [e.values for e in result.embeddings]

        except ResourceExhausted as e:
            # 429 Rate limit — chờ lâu hơn
            wait = 60 * (attempt + 1)
            logger.warning(
                f"Rate limit (attempt {attempt + 1}/{retries}), chờ {wait}s... — {e}"
            )
            time.sleep(wait)
            last_error = e

        except GoogleAPIError as e:
            # Lỗi API khác — exponential backoff
            wait = 2 ** attempt
            logger.warning(
                f"Gemini API error (attempt {attempt + 1}/{retries}), chờ {wait}s... — {e}"
            )
            time.sleep(wait)
            last_error = e

    logger.error(f"Embedding thất bại sau {retries} lần thử: {last_error}")
    raise RuntimeError(f"EMBED_FAILED: {last_error}") from last_error


async def embed_chunks(texts: List[str]) -> List[List[float]]:
    """
    Embed danh sách văn bản (document chunks) theo batch.

    - Batch size: 100 (giới hạn API)
    - Chờ {RATE_LIMIT_SLEEP}s giữa các batch để tránh rate limit
    - Tự động retry khi gặp lỗi tạm thời

    Args:
        texts: Danh sách nội dung chunk cần embed.

    Returns:
        List các vector 768 chiều, thứ tự tương ứng với texts.

    Raises:
        RuntimeError: Khi một batch thất bại sau MAX_RETRIES lần.
    """
    if not texts:
        return []

    total = len(texts)
    batches = [(i, texts[i : i + BATCH_SIZE]) for i in range(0, total, BATCH_SIZE)]
    total_batches = len(batches)
    semaphore = asyncio.Semaphore(EMBEDDING_CONCURRENCY)

    async def _embed_indexed_batch(batch_index: int, batch: List[str]) -> tuple[int, List[List[float]]]:
        async with semaphore:
            logger.info(
                "Embedding batch %s/%s (%s chunks, concurrency=%s)...",
                batch_index + 1,
                total_batches,
                len(batch),
                EMBEDDING_CONCURRENCY,
            )
            result = await asyncio.to_thread(_embed_batch_with_retry, batch, "RETRIEVAL_DOCUMENT")
            if RATE_LIMIT_SLEEP and batch_index + 1 < total_batches and EMBEDDING_CONCURRENCY == 1:
                logger.info("Chờ %ss trước batch tiếp theo...", RATE_LIMIT_SLEEP)
                await asyncio.sleep(RATE_LIMIT_SLEEP)
            return batch_index, result

    completed = await asyncio.gather(
        *(_embed_indexed_batch(batch_index, batch) for batch_index, (_, batch) in enumerate(batches))
    )
    completed.sort(key=lambda item: item[0])
    all_embeddings = [vector for _, batch_vectors in completed for vector in batch_vectors]

    logger.info(f"Embed thành công {total} chunks.")
    return all_embeddings


async def embed_query(text: str) -> List[float]:
    """
    Embed một câu hỏi của user để dùng cho vector search.

    Args:
        text: Câu hỏi cần embed.

    Returns:
        Vector 768 chiều.

    Raises:
        RuntimeError: Khi Gemini API thất bại sau MAX_RETRIES lần.
    """
    if not text or not text.strip():
        raise ValueError("Query text không được để trống.")

    result = await asyncio.to_thread(
        _embed_batch_with_retry, [text], "RETRIEVAL_QUERY"
    )
    return result[0]