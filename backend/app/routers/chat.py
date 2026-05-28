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
    current_user: dict = Depends(get_current_user),
):
    # 1. Embed câu hỏi
    try:
        query_vector = await embed_query(request.question)
    except Exception as e:
        print(f"[EMBED ERROR] {type(e).__name__}: {e}")
        raise HTTPException(
            status_code=500,
            detail=_make_error("EMBED_FAILED", "Lỗi khi tạo embedding cho câu hỏi"),
        )

    # 2. Vector search theo notebook_id (tìm trên tất cả file trong notebook)
    chunks = await retrieve_chunks(query_vector, request.notebook_id)   # ← đổi
    if not chunks:
        raise HTTPException(
            status_code=404,
            detail=_make_error("DOC_NOT_FOUND", "Không tìm thấy tài liệu hoặc notebook chưa có dữ liệu"),
        )

    # 3. Generate answer
    try:
        answer = await generate_answer(request.question, chunks, request.chat_history)
    except Exception as e:
        print(f"[LLM ERROR] {type(e).__name__}: {e}")
        raise HTTPException(
            status_code=500,
            detail=_make_error("LLM_FAILED", "Lỗi khi gọi LLM"),
        )

    sources = [
        {
            "chunk_id": c["id"],
            "section": c.get("section", "Unknown"),
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
    current_user: dict = Depends(get_current_user),
):
    # 1. Embed câu hỏi
    try:
        query_vector = await embed_query(request.question)
    except Exception as e:
        print(f"[EMBED ERROR] {type(e).__name__}: {e}")
        raise HTTPException(
            status_code=500,
            detail=_make_error("EMBED_FAILED", "Lỗi khi tạo embedding"),
        )

    # 2. Vector search theo notebook_id
    chunks = await retrieve_chunks(query_vector, request.notebook_id)   # ← đổi
    if not chunks:
        raise HTTPException(
            status_code=404,
            detail=_make_error("DOC_NOT_FOUND", "Không tìm thấy tài liệu trong notebook"),
        )

    sources = [
        {
            "chunk_id": c["id"],
            "section": c.get("section", "Unknown"),
            "content": c["content"],
            "page": c["page_number"],
            "score": round(c["similarity"], 4),
        }
        for c in chunks
    ]

    async def event_generator():
        try:
            yield f"data: {json.dumps({'type': 'sources', 'sources': sources})}\n\n"

            async for token in generate_answer_stream(
                request.question, chunks, request.chat_history
            ):
                yield f"data: {json.dumps({'type': 'token', 'content': token})}\n\n"

            yield f"data: {json.dumps({'type': 'done'})}\n\n"

        except Exception as e:
            print(f"[STREAM ERROR] {type(e).__name__}: {e}")
            yield f"data: {json.dumps({'type': 'error', 'code': 'LLM_FAILED', 'message': 'Lỗi khi gọi LLM'})}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )