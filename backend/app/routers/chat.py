import asyncio
import json
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse

from app.db.supabase_client import supabase
from app.dependencies import get_current_user
from app.models.schemas import AskRequest
from app.services.embedder import embed_query
from app.services.llm import generate_answer, generate_answer_stream, generate_suggested_prompts
from app.services.retriever import OUT_OF_SCOPE_WARNING, retrieve_rag_context

router = APIRouter()
logger = logging.getLogger(__name__)


def _supabase_response_data(resp):
    if isinstance(resp, dict):
        return resp.get("data"), resp.get("error")
    return getattr(resp, "data", None), getattr(resp, "error", None)


def _get_user_id(user: dict) -> str:
    user_id = user.get("id") or user.get("user_id")
    if not user_id:
        raise HTTPException(status_code=401, detail=_make_error("UNAUTHORIZED", "Token không hợp lệ"))
    return user_id


def _validate_selected_documents(notebook_id: str, user_id: str, selected_document_ids: list[str]) -> list[str]:
    if not selected_document_ids:
        raise HTTPException(
            status_code=400,
            detail=_make_error("NO_DOCUMENT_SELECTED", "Vui lòng chọn ít nhất một tài liệu để nghiên cứu."),
        )

    unique_ids = list(dict.fromkeys(str(doc_id) for doc_id in selected_document_ids if doc_id))
    if not unique_ids:
        raise HTTPException(
            status_code=400,
            detail=_make_error("NO_DOCUMENT_SELECTED", "Vui lòng chọn ít nhất một tài liệu để nghiên cứu."),
        )
    try:
        resp = (
            supabase.table("documents")
            .select("id, notebooks!inner(user_id)")
            .eq("notebook_id", notebook_id)
            .eq("notebooks.user_id", user_id)
            .in_("id", unique_ids)
            .execute()
        )
    except Exception as exc:
        logger.exception("Selected document validation failed")
        raise HTTPException(status_code=500, detail=_make_error("INTERNAL_ERROR", "Lỗi khi kiểm tra tài liệu")) from exc

    rows, error = _supabase_response_data(resp)
    if error:
        raise HTTPException(status_code=500, detail=_make_error("INTERNAL_ERROR", "Lỗi khi kiểm tra tài liệu"))

    existing_ids = [str(row["id"]) for row in rows or []]
    if len(existing_ids) != len(unique_ids):
        raise HTTPException(
            status_code=400,
            detail=_make_error("INVALID_SELECTED_DOCUMENTS", "Một hoặc nhiều tài liệu đã bị xóa hoặc không còn hợp lệ."),
        )
    return existing_ids


def _persist_session_messages(session_id: str | None, user_content: str, assistant_content: str, citations: list[dict]) -> None:
    if not session_id:
        return
    rows = [
        {"research_session_id": session_id, "role": "user", "content": user_content, "citations": []},
        {"research_session_id": session_id, "role": "assistant", "content": assistant_content, "citations": citations},
    ]
    try:
        supabase.table("research_session_messages").insert(rows).execute()
        supabase.table("research_sessions").update({"updated_at": datetime.now(timezone.utc).isoformat()}).eq("id", session_id).execute()
    except Exception as exc:  # pragma: no cover - persistence should not break answer delivery
        logger.warning("Could not persist research session messages: %s", exc)


def _sanitize_history(history):
    return [msg for msg in history if msg.role in {"user", "assistant"}]


def _make_error(code: str, message: str) -> dict:
    return {"code": code, "message": message}


def _sse(payload: dict) -> str:
    return f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"


def _warning_for_scope(is_out_of_scope: bool) -> str | None:
    return OUT_OF_SCOPE_WARNING if is_out_of_scope else None


def _answer_already_has_warning(answer: str) -> bool:
    return (answer or "").lstrip().startswith(OUT_OF_SCOPE_WARNING)


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
    user_id = _get_user_id(current_user)
    selected_document_ids = _validate_selected_documents(request.notebook_id, user_id, request.selected_document_ids)

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
    retrieval = await retrieve_rag_context(query_vector, request.notebook_id, selected_document_ids)
    chunks = retrieval.chunks
    warning = _warning_for_scope(retrieval.is_out_of_scope)

    citations = _build_citations(chunks)

    # 3. Generate answer
    try:
        answer = await generate_answer(
            request.question,
            chunks,
            _sanitize_history(request.chat_history),
            allow_general_answer=retrieval.is_out_of_scope,
        )
    except Exception as e:
        print(f"[LLM ERROR] {type(e).__name__}: {e}")
        raise HTTPException(
            status_code=500,
            detail=_make_error("LLM_FAILED", "Lỗi khi gọi LLM"),
        )

    answer_text = answer["text"]
    if warning and _answer_already_has_warning(answer_text):
        warning = None
    suggested_prompts = generate_suggested_prompts(request.question, answer_text, chunks)
    _persist_session_messages(request.research_session_id, request.question, answer_text, citations)

    return {
        "success": True,
        "data": {
            "warning": warning,
            "message": {"role": "assistant", "content": answer_text, "citations": citations},
            "answer": answer_text,
            "sources": citations,
            "citations": citations,
            "suggested_prompts": suggested_prompts,
            "tokens_used": answer.get("tokens_used"),
        },
    }


@router.post("/ask/stream")
async def ask_stream(
    request: AskRequest,
    current_user: dict = Depends(get_current_user),
):
    user_id = _get_user_id(current_user)
    selected_document_ids = _validate_selected_documents(request.notebook_id, user_id, request.selected_document_ids)

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
            retrieval = await retrieve_rag_context(query_vector, request.notebook_id, selected_document_ids)
            chunks = retrieval.chunks
            warning = _warning_for_scope(retrieval.is_out_of_scope)

            citations = _build_citations(chunks)
            yield _sse({"type": "sources", "sources": citations, "citations": citations})
            if warning:
                yield _sse({"type": "warning", "warning": warning, "message": warning})
            yield _sse({"type": "status", "status": "generating", "message": "Đang tạo câu trả lời..."})

            full_answer = ""
            async for token in generate_answer_stream(
                request.question,
                chunks,
                _sanitize_history(request.chat_history),
                allow_general_answer=retrieval.is_out_of_scope,
            ):
                full_answer += token
                yield _sse({"type": "token", "content": token})

            if warning and _answer_already_has_warning(full_answer):
                warning = None
            suggested_prompts = generate_suggested_prompts(request.question, full_answer, chunks)
            _persist_session_messages(request.research_session_id, request.question, full_answer if "full_answer" in locals() else "", citations)
            yield _sse({"type": "suggested_prompts", "suggested_prompts": suggested_prompts})
            yield _sse({"type": "done", "warning": warning, "suggested_prompts": suggested_prompts})

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
