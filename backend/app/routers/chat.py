from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from app.models.schemas import AskRequest
from app.services.embedder import embed_query
from app.services.retriever import retrieve_chunks
from app.services.llm import generate_answer, generate_answer_stream
from app.dependencies import get_current_user
import json

router = APIRouter()


def _make_error(code: str, message: str) -> dict:
    return {"code": code, "message": message}


@router.post("/ask", response_model=dict)
async def ask(
    request: AskRequest,
    current_user: dict = Depends(get_current_user),  # ← JWT auth bắt buộc
):
    # 1. Embed câu hỏi
    try:
        query_vector = await embed_query(request.question)
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=_make_error("EMBED_FAILED", "Lỗi khi tạo embedding cho câu hỏi"),
        )

    # 2. Vector search — kiểm tra doc thuộc về user hiện tại
    chunks = await retrieve_chunks(query_vector, request.doc_id)
    if not chunks:
        raise HTTPException(
            status_code=404,
            detail=_make_error("DOC_NOT_FOUND", "Không tìm thấy tài liệu hoặc tài liệu chưa có dữ liệu"),
        )

    # 3. Generate answer
    try:
        answer = await generate_answer(request.question, chunks, request.chat_history)
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=_make_error("LLM_FAILED", "Lỗi khi gọi Gemini"),
        )

    sources = [
        {
            "chunk_id": c["id"],
            "content": c["content"],
            "page": c["page_number"],
            "score": round(c["similarity"], 4),
        }
        for c in chunks
    ]

    return {
        "success": True,
        "data": {
            "answer": answer["text"],
            "sources": sources,
            "tokens_used": answer.get("tokens_used"),
        },
    }


@router.post("/ask/stream")
async def ask_stream(
    request: AskRequest,
    current_user: dict = Depends(get_current_user),  # ← JWT auth bắt buộc
):
    # 1. Embed câu hỏi
    try:
        query_vector = await embed_query(request.question)
    except Exception:
        raise HTTPException(
            status_code=500,
            detail=_make_error("EMBED_FAILED", "Lỗi khi tạo embedding"),
        )

    # 2. Vector search
    chunks = await retrieve_chunks(query_vector, request.doc_id)
    if not chunks:
        raise HTTPException(
            status_code=404,
            detail=_make_error("DOC_NOT_FOUND", "Không tìm thấy tài liệu"),
        )

    sources = [
        {
            "chunk_id": c["id"],
            "content": c["content"],
            "page": c["page_number"],
            "score": round(c["similarity"], 4),
        }
        for c in chunks
    ]

    async def event_generator():
        try:
            # Gửi sources trước để FE hiển thị ngay
            yield f"data: {json.dumps({'type': 'sources', 'sources': sources})}\n\n"

            # Stream từng token
            async for token in generate_answer_stream(
                request.question, chunks, request.chat_history
            ):
                yield f"data: {json.dumps({'type': 'token', 'content': token})}\n\n"

            yield f"data: {json.dumps({'type': 'done'})}\n\n"

        except Exception:
            # Gửi lỗi qua SSE thay vì để stream die âm thầm
            yield f"data: {json.dumps({'type': 'error', 'code': 'LLM_FAILED', 'message': 'Lỗi khi gọi Gemini'})}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",  # quan trọng nếu deploy sau Nginx
        },
    )