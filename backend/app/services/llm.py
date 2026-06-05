"""
LLM generation với Llama 3.3 70B via Groq
"""
import json
import logging
import time
import tiktoken
from groq import AsyncGroq
from app.config import settings
from app.models.schemas import ChatMessage
from app.services.observability import emit_metric
from typing import List, AsyncGenerator

logger = logging.getLogger(__name__)

client = AsyncGroq(api_key=settings.GROQ_API_KEY)
GROQ_MODEL = "llama-3.3-70b-versatile"

MAX_PROMPT_TOKENS = int(getattr(settings, "MAX_PROMPT_TOKENS", 12000) or 12000)
RESERVED_HISTORY_TOKENS = int(getattr(settings, "RESERVED_HISTORY_TOKENS", 1500) or 1500)

try:
    _tokenizer = tiktoken.get_encoding("cl100k_base")
except Exception as exc:  # pragma: no cover - offline startup fallback
    logger.warning("Falling back to simple tokenizer because tiktoken encoding is unavailable: %s", exc)

    class _SimpleTokenizer:
        def encode(self, text: str) -> list[str]:
            return (text or "").split()

        def decode(self, tokens: list[str]) -> str:
            return " ".join(tokens)

    _tokenizer = _SimpleTokenizer()

def _count_tokens(text: str) -> int:
    """Hàm phụ trợ đếm số token ước lượng."""
    return len(_tokenizer.encode(text))

def _build_messages(
    question: str,
    chunks: List[dict],
    chat_history: List[ChatMessage],
    *,
    allow_general_answer: bool = False,
) -> list:
    # 1. Khởi tạo System Prompt cơ bản theo chế độ
    if allow_general_answer:
        base_system_prompt = (
            "Bạn là trợ lý nghiên cứu AI, giúp người dùng hiểu tài liệu học thuật.\n"
            "Trả lời câu hỏi dựa trên các đoạn trích sau từ tài liệu.\n"
            "Lưu ý: Hệ thống cho phép sử dụng kiến thức chung. Nếu câu hỏi nằm ngoài tài liệu được cung cấp, "
            "bạn có thể trả lời bằng kiến thức chung nhưng PHẢI nói rõ phần nào là thông tin ngoài tài liệu.\n"
            "Khi dùng thông tin từ đoạn trích, trích dẫn dạng [1], [2].\n\n"
            "--- Đoạn trích từ tài liệu ---\n"
        )
    else:
        base_system_prompt = (
            "Bạn là trợ lý nghiên cứu AI. Nhiệm vụ của bạn là trả lời câu hỏi CHỈ DỰA VÀO các đoạn trích tài liệu bên dưới.\n"
            "--- QUY TẮC NGHIÊM NGẶT ---\n"
            "1. TUYỆT ĐỐI KHÔNG sử dụng kiến thức bên ngoài, KHÔNG tự suy diễn hay thêm thắt thông tin.\n"
            "2. Nếu tài liệu bên dưới không chứa nội dung để trả lời, bạn PHẢI trả lời chính xác câu này: 'Tôi không tìm thấy thông tin này trong tài liệu'.\n"
            "3. Trả lời bằng ngôn ngữ của câu hỏi (tiếng Việt hoặc tiếng Anh).\n"
            "4. Bắt buộc trích dẫn nguồn dạng [1], [2] tương ứng với đoạn trích được cung cấp.\n\n"
            "--- Đoạn trích từ tài liệu ---\n"
        )
    
    # Tính toán lượng token cố định ban đầu (System + Question)
    current_tokens = _count_tokens(base_system_prompt) + _count_tokens(question)
    
    # 2. Xử lý Chunks... (GIỮ NGUYÊN CODE CŨ CỦA BẠN ĐẾN HẾT VÒNG LẶP FOR)
    context_parts = []
    chunk_token_limit = MAX_PROMPT_TOKENS - RESERVED_HISTORY_TOKENS

    for index, chunk in enumerate(chunks, start=1):
        section = chunk.get("section", "Unknown")
        chunk_text = f"[{index}] [Trang {chunk['page_number']} - Phần {section}] {chunk['content']}"
        chunk_tokens = _count_tokens(chunk_text)
        
        if current_tokens + chunk_tokens > chunk_token_limit:
            logger.warning(
                f"Cảnh báo: Đạt ngưỡng token cho chunks ({chunk_token_limit}). "
                f"Đã cắt bỏ các chunk ít liên quan hơn."
            )
            break
            
        context_parts.append(chunk_text)
        current_tokens += chunk_tokens

    # Ghép chunks vào system prompt (ĐÃ XÓA KHỐI IF ALLOW_GENERAL_ANSWER CŨ Ở ĐÂY VÌ ĐÃ GỘP LÊN TRÊN)
    context_str = "\n\n".join(context_parts)
    
    if not context_str:
        context_str = "Không có đoạn trích nào từ tài liệu."
        
    full_system_prompt = base_system_prompt + context_str
    messages = [{"role": "system", "content": full_system_prompt}]

    # 3. Xử lý Chat History (Lọc từ MỚI NHẤT lùi về CŨ NHẤT)
    # Cắt lấy max turns theo settings trước
    recent_history = chat_history[-(settings.MAX_CHAT_HISTORY_TURNS * 2):]
    
    history_messages = []
    # Duyệt ngược (reversed) để ưu tiên add tin nhắn mới nhất trước
    for msg in reversed(recent_history):
        msg_tokens = _count_tokens(msg.content)
        
        if current_tokens + msg_tokens > MAX_PROMPT_TOKENS:
            logger.warning("Cảnh báo: Đạt tổng giới hạn token. Đã cắt bỏ các lịch sử chat cũ.")
            break
            
        # Chèn vào đầu list để giữ đúng thứ tự thời gian (cũ -> mới)
        history_messages.insert(0, {"role": msg.role, "content": msg.content})
        current_tokens += msg_tokens

    # 4. Gắn History và Câu hỏi hiện tại vào mảng messages
    messages.extend(history_messages)
    messages.append({"role": "user", "content": question})
    
    logger.info(f"Đã build messages. Tổng tokens ước tính: {current_tokens}/{MAX_PROMPT_TOKENS}")
    return messages


async def generate_answer(
    question: str,
    chunks: List[dict],
    chat_history: List[ChatMessage],
    *,
    allow_general_answer: bool = False,
) -> dict:
    """
    Non-streaming generation. Dùng cho POST /api/chat/ask.

    Returns:
        {"text": str, "tokens_used": int | None}

    Raises:
        RuntimeError: Khi Groq API thất bại.
    """
    messages = _build_messages(question, chunks, chat_history, allow_general_answer=allow_general_answer)
    started = time.perf_counter()
    try:
        response = await client.chat.completions.create(
            model=GROQ_MODEL,
            messages=messages,
            temperature=0.0,
        )
        emit_metric(
            "llm.completed",
            model=GROQ_MODEL,
            mode="non_stream",
            total_latency_ms=round((time.perf_counter() - started) * 1000, 2),
            prompt_tokens=response.usage.prompt_tokens if response.usage else None,
            completion_tokens=response.usage.completion_tokens if response.usage else None,
            total_tokens=response.usage.total_tokens if response.usage else None,
        )
        return {
            "text": response.choices[0].message.content,
            "tokens_used": (
                response.usage.total_tokens if response.usage else None
            ),
        }
    except Exception as e:
        logger.error(f"Groq API error (non-stream): {e}")
        raise RuntimeError(f"LLM_FAILED: {e}") from e


async def generate_answer_stream(
    question: str,
    chunks: List[dict],
    chat_history: List[ChatMessage],
    *,
    allow_general_answer: bool = False,
) -> AsyncGenerator[str, None]:
    """
    Streaming generation. Dùng cho POST /api/chat/ask/stream.

    Groq SDK hỗ trợ async streaming native — không cần Queue hay thread.

    Yields:
        Từng chuỗi token text từ Llama.

    Raises:
        RuntimeError: Khi Groq API thất bại.
    """
    messages = _build_messages(question, chunks, chat_history, allow_general_answer=allow_general_answer)
    started = time.perf_counter()
    first_token_at = None
    token_count = 0
    try:
        stream = await client.chat.completions.create(
            model=GROQ_MODEL,
            messages=messages,
            stream=True,
            temperature=0.0,
        )
        async for chunk in stream:
            token = chunk.choices[0].delta.content
            if token:
                if first_token_at is None:
                    first_token_at = time.perf_counter()
                token_count += 1
                yield token
        emit_metric(
            "llm.completed",
            model=GROQ_MODEL,
            mode="stream",
            total_latency_ms=round((time.perf_counter() - started) * 1000, 2),
            time_to_first_token_ms=round((first_token_at - started) * 1000, 2) if first_token_at else None,
            streamed_chunks=token_count,
        )
    except Exception as e:
        logger.error(f"Groq API error (stream): {e}")
        raise RuntimeError(f"LLM_FAILED: {e}") from e


def generate_suggested_prompts(question: str = "", answer: str = "", chunks: List[dict] | None = None) -> list[str]:
    """Cheap contextual follow-up suggestions without an extra LLM call."""
    chunks = chunks or []
    text_seed = " ".join(
        part.strip()
        for part in [question, answer[:500], " ".join((chunk.get("section") or "") for chunk in chunks[:3])]
        if part and part.strip()
    )
    has_compare = any(word in (question or "").lower() for word in ["so sánh", "compare", "khác nhau", "giống nhau"])
    has_terms = any(word in (question or "").lower() for word in ["thuật ngữ", "khái niệm", "term", "concept"])

    if has_compare:
        candidates = [
            "Tóm tắt điểm khác biệt quan trọng nhất",
            "Lập bảng so sánh ngắn gọn hơn",
            "Các điểm giống nhau ảnh hưởng gì đến kết luận?",
        ]
    elif has_terms:
        candidates = [
            "Cho ví dụ dễ hiểu cho từng thuật ngữ",
            "Thuật ngữ nào quan trọng nhất trong tài liệu?",
            "Tạo flashcards cho các khái niệm này",
        ]
    elif text_seed:
        candidates = [
            "Tóm tắt ý chính của phần vừa trả lời",
            "Giải thích sâu hơn bằng ví dụ cụ thể",
            "Tạo câu hỏi ôn tập từ nội dung trên",
        ]
    else:
        candidates = [
            "Tóm tắt ý chính của tài liệu này",
            "Giải thích thuật ngữ quan trọng trong tài liệu",
            "Tạo câu hỏi ôn tập từ nội dung trên",
        ]

    cleaned = []
    for prompt in candidates:
        prompt = " ".join(prompt.split())[:120]
        if prompt and prompt not in cleaned:
            cleaned.append(prompt)
    return cleaned[:3]


def _extract_json_object(text: str) -> dict:
    """Extract the first JSON object from an LLM response."""
    cleaned = (text or "").strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.strip("`")
        if cleaned.lower().startswith("json"):
            cleaned = cleaned[4:].strip()
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        start = cleaned.find("{")
        end = cleaned.rfind("}")
        if start == -1 or end == -1 or end <= start:
            raise
        return json.loads(cleaned[start : end + 1])


def _trim_text_for_summary(text: str, max_tokens: int = 1200) -> str:
    tokens = _tokenizer.encode(text or "")
    if len(tokens) <= max_tokens:
        return text or ""
    return _tokenizer.decode(tokens[:max_tokens])


async def generate_workspace_summary(documents: List[dict]) -> dict:
    """
    Generate document-level and workspace-level summaries from uploaded document chunks.

    Returns JSON-compatible dict:
    {
      "documents": [{"id", "title", "summary", "key_points", "suggested_questions"}],
      "overall_summary": str,
      "overall_key_points": list[str],
      "suggested_questions": list[str]
    }
    """
    if not documents:
        return {
            "documents": [],
            "overall_summary": "",
            "overall_key_points": [],
            "suggested_questions": [],
        }

    document_blocks = []
    budget_per_doc = max(700, min(1400, 4200 // max(len(documents), 1)))
    for index, doc in enumerate(documents, start=1):
        chunks = doc.get("chunks") or []
        chunk_text = "\n\n".join(
            f"[Trang {chunk.get('page_number', '?')}] {chunk.get('content', '')}"
            for chunk in chunks[:8]
        )
        document_blocks.append(
            "\n".join(
                [
                    f"Tài liệu {index}",
                    f"id: {doc.get('id')}",
                    f"filename: {doc.get('filename')}",
                    f"page_count: {doc.get('page_count')}",
                    f"chunk_count: {doc.get('chunk_count')}",
                    "Nội dung trích xuất:",
                    _trim_text_for_summary(chunk_text, budget_per_doc),
                ]
            )
        )

    prompt = (
        "Bạn là trợ lý nghiên cứu AI. Hãy đọc các trích đoạn tài liệu đã upload và tạo JSON hợp lệ. "
        "Không bịa thông tin ngoài nội dung được cung cấp. Nếu thiếu thông tin, viết ngắn gọn theo phần có sẵn.\n\n"
        "Yêu cầu JSON chính xác theo schema:\n"
        "{\n"
        "  \"documents\": [\n"
        "    {\"id\": \"...\", \"title\": \"...\", \"summary\": \"...\", \"key_points\": [\"...\"], \"suggested_questions\": [\"...\"]}\n"
        "  ],\n"
        "  \"overall_summary\": \"...\",\n"
        "  \"overall_key_points\": [\"3-5 ý chính\"],\n"
        "  \"suggested_questions\": [\"4-6 câu hỏi cụ thể dựa trên tài liệu\"]\n"
        "}\n\n"
        "Tài liệu:\n"
        + "\n\n---\n\n".join(document_blocks)
    )

    started = time.perf_counter()
    try:
        response = await client.chat.completions.create(
            model=GROQ_MODEL,
            messages=[
                {"role": "system", "content": "Chỉ trả về JSON hợp lệ, không markdown."},
                {"role": "user", "content": prompt},
            ],
            temperature=0.2,
        )
        parsed = _extract_json_object(response.choices[0].message.content)
    except Exception as e:
        logger.error(f"Groq API error (summary): {e}")
        raise RuntimeError(f"SUMMARY_FAILED: {e}") from e

    parsed.setdefault("documents", [])
    parsed.setdefault("overall_summary", "")
    parsed.setdefault("overall_key_points", [])
    parsed.setdefault("suggested_questions", [])
    return parsed


async def generate_system_document_metadata(text: str) -> dict:
    """Generate category, tags, and a 1-2 sentence summary for a system document."""
    sample = _trim_text_for_summary(text or "", 1800)
    if not sample.strip():
        return {"category": "Khác", "tags": [], "summary": ""}

    prompt = (
        "Hãy phân loại tài liệu sau cho thư viện số. Trả về JSON hợp lệ, không Markdown, "
        "gồm đúng các trường: category, tags, summary. Category ngắn gọn. Tags là mảng chuỗi ngắn, "
        "ưu tiên tiếng Việt nếu tài liệu tiếng Việt, không quá 6 tags. Summary chỉ 1-2 câu, tối đa 70 từ.\n\n"
        f"Nội dung tài liệu:\n{sample}"
    )
    response = await client.chat.completions.create(
        model=GROQ_MODEL,
        messages=[
            {"role": "system", "content": "Chỉ trả về JSON hợp lệ, không markdown."},
            {"role": "user", "content": prompt},
        ],
        temperature=0.1,
    )
    parsed = _extract_json_object(response.choices[0].message.content)
    tags = parsed.get("tags") or []
    if isinstance(tags, str):
        tags = [item.strip() for item in tags.split(",") if item.strip()]
    return {
        "category": str(parsed.get("category") or "Khác").strip() or "Khác",
        "tags": tags[:6] if isinstance(tags, list) else [],
        "summary": str(parsed.get("summary") or "").strip(),
    }
