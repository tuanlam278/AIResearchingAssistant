"""
LLM generation với Gemini 2.5 Flash
"""
import asyncio
import logging
from google import genai
from google.api_core.exceptions import GoogleAPIError
from app.config import settings
from app.models.schemas import ChatMessage
from typing import List, AsyncGenerator

logger = logging.getLogger(__name__)

client = genai.Client(api_key=settings.GOOGLE_API_KEY)
GEMINI_MODEL = "gemini-2.5-flash"

# Sentinel báo hiệu stream kết thúc
_STREAM_DONE = object()


def _build_prompt(question: str, chunks: List[dict], chat_history: List[ChatMessage]) -> str:
    """Xây dựng prompt từ context chunks và lịch sử hội thoại."""
    context_parts = []
    for chunk in chunks:
        context_parts.append(f"[Trang {chunk['page_number']}] {chunk['content']}")
    context = "\n\n".join(context_parts)

    history_text = ""
    if chat_history:
        history_lines = []
        for msg in chat_history[-(settings.MAX_CHAT_HISTORY_TURNS * 2):]:
            role = "Người dùng" if msg.role == "user" else "Trợ lý"
            history_lines.append(f"{role}: {msg.content}")
        history_text = "\n".join(history_lines)

    prompt = f"""Bạn là trợ lý nghiên cứu AI, giúp người dùng hiểu tài liệu học thuật.
Trả lời câu hỏi dựa trên các đoạn trích sau từ tài liệu.
Nếu không tìm thấy câu trả lời trong tài liệu, hãy nói rõ "Tôi không tìm thấy thông tin này trong tài liệu".
Trả lời bằng ngôn ngữ của câu hỏi (tiếng Việt hoặc tiếng Anh).

--- Đoạn trích từ tài liệu ---
{context}

--- Lịch sử hội thoại ---
{history_text if history_text else "(Chưa có)"}

--- Câu hỏi ---
{question}

--- Trả lời ---"""
    return prompt


async def generate_answer(
    question: str,
    chunks: List[dict],
    chat_history: List[ChatMessage],
) -> dict:
    """
    Non-streaming generation. Dùng cho POST /api/chat/ask.

    Returns:
        {"text": str, "tokens_used": int | None}

    Raises:
        RuntimeError: Khi Gemini API thất bại.
    """
    prompt = _build_prompt(question, chunks, chat_history)

    def _call() -> dict:
        try:
            response = client.models.generate_content(
                model=GEMINI_MODEL,
                contents=prompt,
            )
            return {
                "text": response.text,
                "tokens_used": (
                    response.usage_metadata.total_token_count
                    if response.usage_metadata
                    else None
                ),
            }
        except GoogleAPIError as e:
            logger.error(f"Gemini API error (non-stream): {e}")
            raise RuntimeError(f"LLM_FAILED: {e}") from e

    return await asyncio.to_thread(_call)


async def generate_answer_stream(
    question: str,
    chunks: List[dict],
    chat_history: List[ChatMessage],
) -> AsyncGenerator[str, None]:
    """
    Streaming generation. Dùng cho POST /api/chat/ask/stream.

    Dùng asyncio.Queue để bridge sync Gemini stream → async generator thật sự,
    đảm bảo token được yield ngay khi Gemini trả về, không buffer toàn bộ.

    Yields:
        Từng chuỗi token text từ Gemini.

    Raises:
        RuntimeError: Khi Gemini API thất bại (propagate qua queue).
    """
    prompt = _build_prompt(question, chunks, chat_history)
    queue: asyncio.Queue = asyncio.Queue()
    loop = asyncio.get_running_loop()

    def _stream_to_queue() -> None:
        """Chạy trong thread riêng, đẩy token vào queue ngay khi có."""
        try:
            for chunk in client.models.generate_content_stream(
                model=GEMINI_MODEL,
                contents=prompt,
            ):
                if chunk.text:
                    loop.call_soon_threadsafe(queue.put_nowait, chunk.text)
        except GoogleAPIError as e:
            logger.error(f"Gemini API error (stream): {e}")
            error = RuntimeError(f"LLM_FAILED: {e}")
            loop.call_soon_threadsafe(queue.put_nowait, error)
        finally:
            # Luôn đẩy sentinel để async generator biết lúc nào dừng
            loop.call_soon_threadsafe(queue.put_nowait, _STREAM_DONE)

    # Chạy stream trong thread pool, không block event loop
    loop.run_in_executor(None, _stream_to_queue)

    while True:
        item = await queue.get()

        if item is _STREAM_DONE:
            # Stream kết thúc bình thường
            break

        if isinstance(item, Exception):
            # Propagate lỗi từ thread ra ngoài
            raise item

        yield item