"""
LLM generation với Gemini 1.5 Flash
"""
import asyncio
import google.generativeai as genai
from app.config import settings
from app.models.schemas import ChatMessage
from typing import List, AsyncGenerator

genai.configure(api_key=settings.GOOGLE_API_KEY)

model = genai.GenerativeModel("gemini-1.5-flash")


def _build_prompt(question: str, chunks: List[dict], chat_history: List[ChatMessage]) -> str:
    context_parts = []
    for chunk in chunks:
        context_parts.append(f"[Trang {chunk['page_number']}] {chunk['content']}")
    context = "\n\n".join(context_parts)

    history_text = ""
    if chat_history:
        history_lines = []
        # Chỉ lấy MAX_CHAT_HISTORY_TURNS lượt cuối (1 lượt = 1 user + 1 assistant)
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
    """Non-streaming generation. Dùng cho /ask."""
    prompt = _build_prompt(question, chunks, chat_history)

    def _call():
        response = model.generate_content(prompt)
        return {
            "text": response.text,
            "tokens_used": (
                response.usage_metadata.total_token_count
                if response.usage_metadata
                else None
            ),
        }

    return await asyncio.to_thread(_call)


async def generate_answer_stream(
    question: str,
    chunks: List[dict],
    chat_history: List[ChatMessage],
) -> AsyncGenerator[str, None]:
    """
    Streaming generation. Dùng cho /ask/stream.

    Gemini SDK stream là synchronous iterator. Để không block event loop,
    ta collect tất cả tokens trong thread rồi yield từng cái ra.
    Trade-off: user sẽ thấy delay nhỏ ở đầu nhưng toàn bộ response vẫn stream.
    Nếu cần true token-by-token thì dùng Queue approach (phức tạp hơn).
    """
    prompt = _build_prompt(question, chunks, chat_history)

    def _collect_tokens() -> List[str]:
        tokens = []
        response = model.generate_content(prompt, stream=True)
        for chunk in response:
            if chunk.text:
                tokens.append(chunk.text)
        return tokens

    tokens = await asyncio.to_thread(_collect_tokens)
    for token in tokens:
        yield token