"""
BE2 implement: LLM generation với Gemini 1.5 Flash
"""
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
        for msg in chat_history[-settings.MAX_CHAT_HISTORY_TURNS * 2:]:
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


async def generate_answer(question: str, chunks: List[dict], chat_history: List[ChatMessage]) -> dict:
    prompt = _build_prompt(question, chunks, chat_history)
    response = model.generate_content(prompt)
    return {
        "text": response.text,
        "tokens_used": response.usage_metadata.total_token_count if response.usage_metadata else None,
    }


async def generate_answer_stream(
    question: str,
    chunks: List[dict],
    chat_history: List[ChatMessage],
) -> AsyncGenerator[str, None]:
    prompt = _build_prompt(question, chunks, chat_history)
    response = model.generate_content(prompt, stream=True)
    for chunk in response:
        if chunk.text:
            yield chunk.text
