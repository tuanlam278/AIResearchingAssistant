from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from app.models.schemas import AskRequest, AskResponse
from app.services.embedder import embed_query
from app.services.retriever import retrieve_chunks
from app.services.llm import generate_answer, generate_answer_stream
import json

router = APIRouter()


@router.post("/ask", response_model=dict)
async def ask(request: AskRequest):
    # 1. Embed câu hỏi
    try:
        query_vector = await embed_query(request.question)
    except Exception:
        raise HTTPException(status_code=500, detail={"code": "EMBED_FAILED", "message": "Lỗi khi tạo embedding cho câu hỏi"})

    # 2. Vector search
    chunks = await retrieve_chunks(query_vector, request.doc_id)
    if not chunks:
        raise HTTPException(status_code=404, detail={"code": "DOC_NOT_FOUND", "message": "Không tìm thấy tài liệu hoặc chưa có dữ liệu"})

    # 3. Generate answer
    try:
        answer = await generate_answer(request.question, chunks, request.chat_history)
    except Exception:
        raise HTTPException(status_code=500, detail={"code": "LLM_FAILED", "message": "Lỗi khi gọi Gemini"})

    sources = [
        {"chunk_id": c["id"], "content": c["content"], "page": c["page_number"], "score": round(c["similarity"], 4)}
        for c in chunks
    ]

    return {
        "success": True,
        "data": {
            "answer": answer["text"],
            "sources": sources,
            "tokens_used": answer.get("tokens_used"),
        }
    }


@router.post("/ask/stream")
async def ask_stream(request: AskRequest):
    # 1. Embed câu hỏi
    try:
        query_vector = await embed_query(request.question)
    except Exception:
        raise HTTPException(status_code=500, detail={"code": "EMBED_FAILED", "message": "Lỗi khi tạo embedding"})

    # 2. Vector search
    chunks = await retrieve_chunks(query_vector, request.doc_id)
    if not chunks:
        raise HTTPException(status_code=404, detail={"code": "DOC_NOT_FOUND", "message": "Không tìm thấy tài liệu"})

    sources = [
        {"chunk_id": c["id"], "content": c["content"], "page": c["page_number"], "score": round(c["similarity"], 4)}
        for c in chunks
    ]

    async def event_generator():
        # Gửi sources trước
        yield f"data: {json.dumps({'type': 'sources', 'sources': sources})}\n\n"

        # Stream tokens
        async for token in generate_answer_stream(request.question, chunks, request.chat_history):
            yield f"data: {json.dumps({'type': 'token', 'content': token})}\n\n"

        yield f"data: {json.dumps({'type': 'done'})}\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")
