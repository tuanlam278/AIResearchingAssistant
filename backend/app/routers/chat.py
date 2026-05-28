import asyncio
import json
import logging

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse

from app.db.supabase_client import supabase
from app.dependencies import get_current_user
from app.models.schemas import AskRequest
from app.services.embedder import embed_query
from app.services.llm import generate_answer, generate_answer_stream
from app.services.retriever import retrieve_chunks

router = APIRouter()
logger = logging.getLogger(__name__)


def _make_error(code: str, message: str) -> dict:
    return {"code": code, "message": message}


def _sse(payload: dict) -> str:
    return f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"


def _fetch_document_titles(chunks: list[dict]) -> dict[str, str]:
    """Best-effort filename lookup for citation metadata."""
    doc_ids = sorted({str(c.get("doc_id")) for c in chunks if c.get("doc_id")})
    if not doc_ids:
        return {}

    try:
        resp = (
            supabase.table("documents")
            .select("id, filename")
            .in_("id", doc_ids)
            .execute()
        )
    except Exception as exc:  # pragma: no cover - defensive logging only
        logger.warning("Could not load document titles for citations: %s", exc)
        return {}

    rows = getattr(resp, "data", None) or []
    return {str(row["id"]): row.get("filename") or "Tài liệu" for row in rows}


def _build_citations(chunks: list[dict]) -> list[dict]:
    doc_titles = _fetch_document_titles(chunks)
    citations = []

    for index, chunk in enumerate(chunks, start=1):
        doc_id = str(chunk.get("doc_id") or "") or None
        page_number = chunk.get("page_number")
        content = chunk.get("content") or ""
        citations.append(
            {
                "id": str(chunk.get("id") or index),
                "chunk_id": str(chunk.get("id") or index),
                "citation_index": index,
                "document_id": doc_id,
                "document_title": doc_titles.get(str(doc_id), "Tài liệu"),
                "section": chunk.get("section", "Unknown"),
                "page_start": page_number,
                "page_end": page_number,
                "page": page_number,
                "snippet": content,
                "content": content,
                "score": round(float(chunk.get("similarity", 0)), 4)
                if chunk.get("similarity") is not None
                else None,
            }
        )

    return citations


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
    chunks = await retrieve_chunks(query_vector, request.notebook_id)
    if not chunks:
        raise HTTPException(
            status_code=404,
            detail=_make_error("DOC_NOT_FOUND", "Không tìm thấy tài liệu hoặc notebook chưa có dữ liệu"),
        )

    citations = _build_citations(chunks)

    # 3. Generate answer
    try:
        answer = await generate_answer(request.question, chunks, request.chat_history)
    except Exception as e:
        print(f"[LLM ERROR] {type(e).__name__}: {e}")
        raise HTTPException(
            status_code=500,
            detail=_make_error("LLM_FAILED", "Lỗi khi gọi LLM"),
        )

    return {
        "success": True,
        "data": {
            "answer": answer["text"],
            "sources": citations,
            "citations": citations,
            "tokens_used": answer.get("tokens_used"),
        },
    }


@router.post("/ask/stream")
async def ask_stream(
    request: AskRequest,
    current_user: dict = Depends(get_current_user),
):
    async def event_generator():
        try:
            yield _sse({"type": "status", "status": "reading", "message": "Đang đọc tài liệu..."})

            try:
                query_vector = await embed_query(request.question)
            except Exception as e:
                print(f"[EMBED ERROR] {type(e).__name__}: {e}")
                yield _sse({"type": "error", "code": "EMBED_FAILED", "message": "Lỗi khi tạo embedding"})
                return

            yield _sse({"type": "status", "status": "retrieving", "message": "Đang tìm đoạn liên quan..."})
            chunks = await retrieve_chunks(query_vector, request.notebook_id)
            if not chunks:
                yield _sse({"type": "error", "code": "DOC_NOT_FOUND", "message": "Không tìm thấy tài liệu trong notebook"})
                return

            citations = _build_citations(chunks)
            yield _sse({"type": "sources", "sources": citations, "citations": citations})
            yield _sse({"type": "status", "status": "generating", "message": "Đang tạo câu trả lời..."})

            async for token in generate_answer_stream(
                request.question, chunks, request.chat_history
            ):
                yield _sse({"type": "token", "content": token})

            yield _sse({"type": "done"})

        except asyncio.CancelledError:
            logger.info("Chat stream cancelled by client disconnect")
            raise
        except Exception as e:
            print(f"[STREAM ERROR] {type(e).__name__}: {e}")
            yield _sse({"type": "error", "code": "LLM_FAILED", "message": "Lỗi khi gọi LLM"})

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )
