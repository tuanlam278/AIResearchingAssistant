"""
LLM generation với Llama 3.3 70B via Groq
"""
import logging
import tiktoken
from groq import AsyncGroq
from app.config import settings
from app.models.schemas import ChatMessage
from typing import List, AsyncGenerator

logger = logging.getLogger(__name__)

client = AsyncGroq(api_key=settings.GROQ_API_KEY)
GROQ_MODEL = "llama-3.3-70b-versatile"

MAX_PROMPT_TOKENS = 6000 
RESERVED_HISTORY_TOKENS = 1000

_tokenizer = tiktoken.get_encoding("cl100k_base")

def _count_tokens(text: str) -> int:
    """Hàm phụ trợ đếm số token ước lượng."""
    return len(_tokenizer.encode(text))

def _build_messages(
    question: str,
    chunks: List[dict],
    chat_history: List[ChatMessage],
) -> list:
    """
    Xây dựng mảng messages array theo định dạng OpenAI-compatible phục vụ cho Groq API.
    
    Hàm này tích hợp cấu trúc phân tầng dữ liệu kết hợp với cơ chế cắt tỉa ngữ cảnh động 
    (Dynamic Context Trimming) để ngăn chặn lỗi tràn cửa sổ ngữ cảnh (Context Window Exceeded) 
    và tận dụng metadata 'section' nhằm cung cấp thông tin định vị chính xác cho mô hình lớn.

    Chiến lược quản lý token:
    1. Ước tính phần cố định gồm System Prompt cơ sở và câu hỏi hiện tại của người dùng.
    2. Duyệt qua các văn bản trích dẫn (chunks), trích xuất metadata trang và phân đoạn tài liệu 
       (section), tự động dừng thêm nếu vượt quá giới hạn an toàn dành cho chunk.
    3. Duyệt ngược lịch sử hội thoại (từ mới nhất lùi về cũ nhất) để bù lấp khoảng trống token 
       cho đến khi tiệm cận ngưỡng tối đa `MAX_PROMPT_TOKENS`.

    Args:
        question (str): Câu hỏi hiện tại do người dùng nhập vào.
        chunks (List[dict]): Danh sách các phân đoạn tương đồng thu thập từ Supabase RPC.
            Mỗi dictionary yêu cầu có các khóa: 'page_number', 'section', và 'content'.
        chat_history (List[ChatMessage]): Toàn bộ lịch sử cuộc trò chuyện hiện tại.

    Returns:
        list: Danh sách các dict tin nhắn cấu trúc dạng [{"role": str, "content": str}]
    """
    # 1. Khởi tạo System Prompt cơ bản
    base_system_prompt = (
        "Bạn là trợ lý nghiên cứu AI, giúp người dùng hiểu tài liệu học thuật.\n"
        "Trả lời câu hỏi dựa trên các đoạn trích sau từ tài liệu.\n"
        "Nếu không tìm thấy câu trả lời trong tài liệu, hãy nói rõ "
        '"Tôi không tìm thấy thông tin này trong tài liệu".\n'
        "Trả lời bằng ngôn ngữ của câu hỏi (tiếng Việt hoặc tiếng Anh).\n\n"
        "--- Đoạn trích từ tài liệu ---\n"
    )
    
    # Tính toán lượng token cố định ban đầu (System + Question)
    current_tokens = _count_tokens(base_system_prompt) + _count_tokens(question)
    
    # 2. Xử lý Chunks (Giữ lại các chunk top đầu, cắt bớt chunk cuối nếu quá dài)
    context_parts = []
    chunk_token_limit = MAX_PROMPT_TOKENS - RESERVED_HISTORY_TOKENS

    for chunk in chunks:
        # Khai thác metadata 'section'. Dùng .get(..., 'Unknown') nhằm tương thích ngược với các chunk cũ
        section = chunk.get("section", "Unknown")
        chunk_text = f"[Trang {chunk['page_number']} - Phần {section}] {chunk['content']}"
        chunk_tokens = _count_tokens(chunk_text)
        
        if current_tokens + chunk_tokens > chunk_token_limit:
            logger.warning(
                f"Cảnh báo: Đạt ngưỡng token cho chunks ({chunk_token_limit}). "
                f"Đã cắt bỏ các chunk ít liên quan hơn."
            )
            break
            
        context_parts.append(chunk_text)
        current_tokens += chunk_tokens

    # Ghép chunks vào system prompt
    context_str = "\n\n".join(context_parts)
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
) -> dict:
    """
    Non-streaming generation. Dùng cho POST /api/chat/ask.

    Returns:
        {"text": str, "tokens_used": int | None}

    Raises:
        RuntimeError: Khi Groq API thất bại.
    """
    messages = _build_messages(question, chunks, chat_history)
    try:
        response = await client.chat.completions.create(
            model=GROQ_MODEL,
            messages=messages,
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
) -> AsyncGenerator[str, None]:
    """
    Streaming generation. Dùng cho POST /api/chat/ask/stream.

    Groq SDK hỗ trợ async streaming native — không cần Queue hay thread.

    Yields:
        Từng chuỗi token text từ Llama.

    Raises:
        RuntimeError: Khi Groq API thất bại.
    """
    messages = _build_messages(question, chunks, chat_history)
    try:
        stream = await client.chat.completions.create(
            model=GROQ_MODEL,
            messages=messages,
            stream=True,
        )
        async for chunk in stream:
            token = chunk.choices[0].delta.content
            if token:
                yield token
    except Exception as e:
        logger.error(f"Groq API error (stream): {e}")
        raise RuntimeError(f"LLM_FAILED: {e}") from e