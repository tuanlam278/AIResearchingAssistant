"""
Embedding service sử dụng Google Gemini Embedding.
"""
import asyncio
import logging
import random
import time
from google import genai
from google.genai import types
from google.api_core.exceptions import GoogleAPIError, ResourceExhausted
from app.config import settings
from typing import List

logger = logging.getLogger(__name__)

client = genai.Client(api_key=settings.GOOGLE_API_KEY) if settings.GOOGLE_API_KEY.strip() else None

# Đưa vào settings để dễ thay đổi, không hardcode
EMBEDDING_MODEL = settings.EMBEDDING_MODEL
EMBEDDING_DIMENSIONS = 768  # Phải khớp với schema Supabase: VECTOR(768)
BATCH_SIZE = settings.EMBEDDING_BATCH_SIZE
RATE_LIMIT_SLEEP = 1         # Giây chờ giữa các batch tuần tự (tránh 429)
MAX_RETRIES = 3              # Số lần retry khi gặp lỗi tạm thời
EMBEDDING_CONCURRENCY = settings.EMBEDDING_MAX_CONCURRENCY
_embedding_semaphore = asyncio.Semaphore(EMBEDDING_CONCURRENCY)


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
            wait = min(30, (2 ** attempt) * 5) + random.uniform(0, 1.5)
            logger.warning(
                "Google embedding rate limit (attempt %s/%s), waiting %.1fs before retry: %s",
                attempt + 1,
                retries,
                wait,
                e,
            )
            time.sleep(wait)
            last_error = e

        except GoogleAPIError as e:
            # Lỗi API khác — exponential backoff
            wait = (2 ** attempt) + random.uniform(0, 1.0)
            logger.warning(
                "Gemini embedding API error (attempt %s/%s), waiting %.1fs before retry: %s",
                attempt + 1,
                retries,
                wait,
                e,
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
    logger.info(
        "Embedding %s chunks in %s batches (batch_size=%s, max_concurrency=%s)",
        total,
        total_batches,
        BATCH_SIZE,
        EMBEDDING_CONCURRENCY,
    )

    async def _embed_indexed_batch(batch_index: int, batch: List[str]) -> tuple[int, List[List[float]]]:
        async with _embedding_semaphore:
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

    queue: asyncio.Queue[tuple[int, List[str]] | None] = asyncio.Queue()
    for batch_index, (_, batch) in enumerate(batches):
        queue.put_nowait((batch_index, batch))

    completed: list[tuple[int, List[List[float]]]] = []

    async def _worker() -> None:
        while True:
            item = await queue.get()
            try:
                if item is None:
                    return
                batch_index, batch = item
                completed.append(await _embed_indexed_batch(batch_index, batch))
            finally:
                queue.task_done()

    worker_count = min(EMBEDDING_CONCURRENCY, total_batches)
    workers = [asyncio.create_task(_worker()) for _ in range(worker_count)]
    await queue.join()
    for _ in workers:
        queue.put_nowait(None)
    await asyncio.gather(*workers)

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

    async with _embedding_semaphore:
        result = await asyncio.to_thread(
            _embed_batch_with_retry, [text], "RETRIEVAL_QUERY"
        )
    return result[0]