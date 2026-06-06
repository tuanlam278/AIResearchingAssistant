from __future__ import annotations

import asyncio
import math
import re
from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from pydantic import BaseModel, Field

from app.db.supabase_client import supabase
from app.dependencies import get_current_user
from app.services.activity_log_service import log_user_activity
from app.utils.filenames import normalize_upload_filename
from app.services.cross_analysis_service import get_document_preview, resolve_document, upload_temp_document
from app.services.embedder import embed_query
from app.services.llm import GROQ_MODEL, client
from app.services.vision_service import analyze_academic_image, is_vision_configured
from app.services.web_search_service import is_web_search_configured, search_web

router = APIRouter(tags=["academic-lens"])

ACADEMIC_NOTES: dict[str, str] = {}
ACADEMIC_WEB_CONTEXTS: dict[str, list[dict[str, Any]]] = {}
ACADEMIC_SESSIONS: dict[str, dict[str, Any]] = {}
ACADEMIC_MESSAGES: dict[str, list[dict[str, Any]]] = {}

TOP_K_DOCUMENT_CHUNKS = 8
MIN_KEYWORD_SCORE = 0.08


class AcademicDocumentRef(BaseModel):
    id: str
    source_type: str
    title: str | None = None
    filename: str | None = None
    file_type: str | None = None


class DocumentChatRequest(BaseModel):
    document: AcademicDocumentRef | None = None
    document_id: str | None = None
    message: str = Field(..., min_length=1, max_length=3000)
    chat_history: list[dict[str, Any]] = Field(default_factory=list)
    extra_contexts: list[dict[str, Any]] = Field(default_factory=list)
    enabled_web_context_ids: list[str] = Field(default_factory=list)
    session_id: str | None = None


class WebChatRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=2000)


class WebContextRequest(BaseModel):
    title: str | None = None
    url: str | None = None
    content: str = Field(..., min_length=1)
    citations: list[dict[str, Any]] = Field(default_factory=list)
    session_id: str | None = None
    document_id: str | None = None
    enabled: bool = True


class WebContextPatch(BaseModel):
    title: str | None = None
    url: str | None = None
    content: str | None = None
    enabled: bool | None = None


class NotepadPayload(BaseModel):
    document_id: str | None = "draft"
    session_id: str | None = None
    content: str = ""


class SessionPayload(BaseModel):
    document_id: str
    title: str | None = None


class MessagePayload(BaseModel):
    role: str = Field(..., pattern="^(user|assistant)$")
    content: str = ""
    citations: list[dict[str, Any]] = Field(default_factory=list)
    attachments: list[dict[str, Any]] = Field(default_factory=list)


def _user_id(user: dict) -> str:
    return str(user.get("id") or user.get("email") or "anonymous")


def _note_key(user: dict, document_id: str | None, session_id: str | None = None) -> str:
    return f"{_user_id(user)}:{document_id or 'draft'}:{session_id or 'default'}"


def _clean_text(value: Any, limit: int | None = None) -> str:
    text = re.sub(r"\s+", " ", str(value or "")).strip()
    return text[:limit].rstrip() if limit and len(text) > limit else text


def _parse_vector(value: Any) -> list[float] | None:
    if value is None:
        return None
    if isinstance(value, list):
        try:
            return [float(item) for item in value]
        except (TypeError, ValueError):
            return None
    text = str(value).strip().strip("[]")
    if not text:
        return None
    try:
        return [float(item) for item in text.split(",")]
    except ValueError:
        return None


def _cosine_similarity(a: list[float] | None, b: list[float] | None) -> float | None:
    if not a or not b or len(a) != len(b):
        return None
    dot = sum(x * y for x, y in zip(a, b))
    norm_a = math.sqrt(sum(x * x for x in a))
    norm_b = math.sqrt(sum(y * y for y in b))
    if not norm_a or not norm_b:
        return None
    return max(0.0, min(1.0, (dot / (norm_a * norm_b) + 1) / 2))


def _keyword_score(text: str, query: str) -> float:
    content = _clean_text(text).lower()
    terms = [term for term in re.split(r"\W+", query.lower()) if len(term) >= 3]
    if not content or not terms:
        return 0.0
    unique_terms = set(terms)
    hits = sum(1 for term in unique_terms if term in content)
    density = min(0.25, sum(content.count(term) for term in unique_terms) / max(len(content.split()), 1))
    return max(0.0, min(1.0, (hits / max(len(unique_terms), 1)) * 0.75 + density))


def _page_start(chunk: dict[str, Any]) -> int | None:
    page = chunk.get("page_start") or chunk.get("page_number") or chunk.get("page")
    try:
        return int(page) if page not in (None, "") else None
    except (TypeError, ValueError):
        return None


def _page_end(chunk: dict[str, Any]) -> int | None:
    page = chunk.get("page_end") or chunk.get("page_number") or chunk.get("page_start") or chunk.get("page")
    try:
        return int(page) if page not in (None, "") else None
    except (TypeError, ValueError):
        return None


def _citation_from_chunk(document: dict[str, Any], chunk: dict[str, Any], score: float) -> dict[str, Any] | None:
    snippet = _clean_text(chunk.get("content"), 650)
    page_start = _page_start(chunk)
    page_end = _page_end(chunk) or page_start
    if not snippet or page_start is None:
        return None
    return {
        "document_id": str(document.get("id") or ""),
        "title": document.get("title") or document.get("filename") or "Tài liệu",
        "page_start": page_start,
        "page_end": page_end,
        "section": chunk.get("section") or "Không rõ section",
        "snippet": snippet,
        "score": round(max(0.0, min(float(score), 1.0)), 4),
        "chunk_id": str(chunk.get("id") or chunk.get("chunk_id") or chunk.get("chunk_index") or ""),
    }


async def _retrieve_question_chunks(document: dict[str, Any], question: str, top_k: int = TOP_K_DOCUMENT_CHUNKS) -> list[dict[str, Any]]:
    chunks = [chunk for chunk in (document.get("chunks") or document.get("snippets") or []) if _clean_text(chunk.get("content"))]
    if not chunks:
        return []

    query_vector: list[float] | None = None
    if any(chunk.get("embedding") for chunk in chunks):
        try:
            query_vector = await embed_query(question)
        except Exception:
            query_vector = None

    ranked: list[tuple[float, dict[str, Any]]] = []
    for chunk in chunks:
        score = _cosine_similarity(query_vector, _parse_vector(chunk.get("embedding"))) if query_vector else None
        if score is None:
            score = _keyword_score(chunk.get("content") or "", question)
        if score >= (0 if query_vector else MIN_KEYWORD_SCORE):
            ranked.append((score, chunk))
    ranked.sort(key=lambda item: item[0], reverse=True)
    return [{**chunk, "_retrieval_score": score} for score, chunk in ranked[:top_k]]


def _format_chunks_for_prompt(citations: list[dict[str, Any]]) -> str:
    return "\n\n".join(
        f"[{idx}] page={c.get('page_start')}-{c.get('page_end')} section={c.get('section')} score={c.get('score')}\n{c.get('snippet')}"
        for idx, c in enumerate(citations, start=1)
    )


def _session_key(user_id: str, session_id: str) -> str:
    return f"{user_id}:{session_id}"


def _supabase_call(fn):
    return fn().execute()


async def _db_call(fn):
    return await asyncio.to_thread(_supabase_call, fn)


async def _load_enabled_web_contexts(user_id: str, session_id: str | None, enabled_ids: list[str]) -> list[dict[str, Any]]:
    if not session_id and not enabled_ids:
        return []
    try:
        def query():
            req = supabase.table("academic_lens_web_contexts").select("id,title,url,content,enabled,created_at").eq("user_id", user_id)
            if enabled_ids:
                req = req.in_("id", enabled_ids)
            elif session_id:
                req = req.eq("session_id", session_id).eq("enabled", True)
            return req.order("created_at", desc=True).limit(5)
        resp = await _db_call(query)
        return [row for row in (resp.data or []) if row.get("enabled") is not False and row.get("content")]
    except Exception:
        return []


@router.post("/documents/upload", response_model=dict)
async def upload_academic_lens_document(file: UploadFile = File(...), user: dict = Depends(get_current_user)):
    contents = await file.read()
    filename = normalize_upload_filename(file.filename, "academic-document")
    document = await upload_temp_document(contents, filename)
    document["storage_status"] = "temporary"
    document["is_temporary"] = True
    document["persistence_warning"] = "Tài liệu tạm thời, có thể mất khi kết thúc phiên hoặc server restart."
    log_user_activity(
        user_id=_user_id(user),
        feature_name="academic_lens",
        action_type="document_upload",
        document_id=document.get("id"),
        document_name=document.get("filename") or filename,
        metadata={"file_type": document.get("file_type"), "size": len(contents), "source": "academic_lens_upload", "upload_status": "temporary", "temp_document_id": document.get("id")},
    )
    preview = get_document_preview(document["id"])
    return {"success": True, "data": {**document, **preview}}


@router.get("/documents/{document_id}/preview", response_model=dict)
async def preview_academic_lens_document(document_id: str, user: dict = Depends(get_current_user)):
    _ = user
    return {"success": True, "data": get_document_preview(document_id)}


@router.post("/document-chat", response_model=dict)
async def document_chat(body: DocumentChatRequest, user: dict = Depends(get_current_user)):
    user_id = _user_id(user)
    if not body.document and not body.document_id:
        raise HTTPException(status_code=400, detail={"code": "NO_DOCUMENT", "message": "Vui lòng chọn hoặc upload tài liệu trước khi hỏi Document AI."})
    ref = body.document.model_dump() if body.document else {"id": body.document_id, "source_type": "upload"}
    doc = resolve_document(ref)
    retrieved = await _retrieve_question_chunks(doc, body.message)
    citations = [citation for chunk in retrieved if (citation := _citation_from_chunk(doc, chunk, chunk.get("_retrieval_score", 0)))]
    if not citations:
        return {"success": True, "data": {"answer": "Không tìm thấy đoạn liên quan rõ trong tài liệu. Mình không thể trả lời chắc chắn nếu không có nguồn kiểm chứng từ tài liệu.", "citations": [], "used_web_context": False}}

    history = "\n".join(f"{item.get('role')}: {_clean_text(item.get('content'), 800)}" for item in body.chat_history[-6:])
    db_web_contexts = await _load_enabled_web_contexts(user_id, body.session_id, body.enabled_web_context_ids)
    inline_web_contexts = body.extra_contexts[-5:]
    web_contexts = [*db_web_contexts, *inline_web_contexts]
    external_context = "\n\n".join(f"Web context: {_clean_text(item.get('title') or item.get('url'), 180)}\n{_clean_text(item.get('content'), 1800)}" for item in web_contexts if item.get("content"))
    try:
        response = await client.chat.completions.create(
            model=GROQ_MODEL,
            messages=[
                {"role": "system", "content": "Bạn là Document AI trong Kính lúp Học thuật. Chỉ trả lời từ các chunks truy hồi được và bối cảnh web được bật. Không bịa thông tin ngoài nguồn. Khi dùng bối cảnh web, nói rõ đó là ngữ cảnh bổ sung, không phải nội dung gốc của tài liệu."},
                {"role": "user", "content": f"Tài liệu: {doc.get('title')} ({doc.get('filename')})\nChunks liên quan đã truy hồi theo câu hỏi:\n{_format_chunks_for_prompt(citations)}\n\nBối cảnh web bổ sung đã bật:\n{external_context}\n\nLịch sử ngắn:\n{history}\n\nCâu hỏi: {body.message}\n\nHãy trả lời súc tích, có kiểm chứng. Nếu nguồn không đủ, nêu rõ phần chưa chắc."},
            ],
            temperature=0.2,
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail={"code": "LLM_FAILED", "message": "Không thể gọi AI cho Document AI."}) from exc
    return {"success": True, "data": {"answer": response.choices[0].message.content or "", "citations": citations, "used_web_context": bool(external_context)}}


@router.post("/web-chat", response_model=dict)
async def web_chat(body: WebChatRequest, user: dict = Depends(get_current_user)):
    _ = user
    if not is_web_search_configured():
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail={"code": "WEB_SEARCH_NOT_CONFIGURED", "message": "Global Web Chat cần cấu hình Web Search API."})
    results = await search_web(body.message)
    context = "\n\n".join(f"[{idx}] {item.title}\nURL: {item.url}\nSnippet: {item.snippet}\nContent: {item.content}" for idx, item in enumerate(results, start=1))
    response = await client.chat.completions.create(
        model=GROQ_MODEL,
        messages=[{"role": "system", "content": "Bạn là Global Web Chat. Trả lời dựa trên kết quả web đã cung cấp và trích dẫn nguồn bằng [1], [2]."}, {"role": "user", "content": f"Kết quả web:\n{context}\n\nCâu hỏi: {body.message}"}],
        temperature=0.2,
    )
    return {"success": True, "data": {"answer": response.choices[0].message.content or "", "citations": [{"title": r.title, "url": r.url, "snippet": r.snippet} for r in results]}}


@router.post("/vision-chat", response_model=dict)
async def vision_chat(image: UploadFile = File(...), prompt: str = Form(...), document_id: str | None = Form(None), page_number: str | None = Form(None), bbox: str | None = Form(None), user: dict = Depends(get_current_user)):
    _ = (document_id, page_number, bbox, user)
    clean_prompt = (prompt or "").strip()
    if not clean_prompt:
        raise HTTPException(status_code=400, detail={"code": "MISSING_PROMPT", "message": "Vui lòng nhập prompt để phân tích ảnh."})
    if not image:
        raise HTTPException(status_code=400, detail={"code": "MISSING_IMAGE", "message": "Vui lòng gửi ảnh crop để phân tích."})
    if not is_vision_configured():
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail={"code": "VISION_NOT_CONFIGURED", "message": "Tính năng phân tích ảnh cần cấu hình Vision API. Hãy thêm GOOGLE_API_KEY và VISION_MODEL."})
    mime_type = image.content_type or ""
    image_bytes = await image.read()
    try:
        result = await analyze_academic_image(image_bytes=image_bytes, mime_type=mime_type, prompt=clean_prompt)
    except ValueError as exc:
        code = str(exc)
        if code == "IMAGE_TOO_LARGE":
            raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail={"code": code, "message": "Ảnh crop quá lớn. Vui lòng chọn vùng nhỏ hơn hoặc nén ảnh."}) from exc
        if code == "UNSUPPORTED_IMAGE_TYPE":
            raise HTTPException(status_code=400, detail={"code": code, "message": "Chỉ hỗ trợ ảnh PNG, JPEG hoặc WEBP."}) from exc
        raise HTTPException(status_code=400, detail={"code": code, "message": "Ảnh crop không hợp lệ."}) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail={"code": "VISION_MODEL_FAILED", "message": "Vision model không trả lời được. Vui lòng kiểm tra GOOGLE_API_KEY/VISION_MODEL và quota."}) from exc
    return {"success": True, "data": {"answer": result.answer, "model": result.model, "image_preview_url": None, "citations": []}}


@router.post("/add-web-context", response_model=dict)
async def add_web_context_legacy(body: WebContextRequest, user: dict = Depends(get_current_user)):
    return await create_web_context(body, user)


@router.get("/web-contexts", response_model=dict)
async def list_web_contexts(session_id: str | None = None, document_id: str | None = None, user: dict = Depends(get_current_user)):
    user_id = _user_id(user)
    try:
        def query():
            req = supabase.table("academic_lens_web_contexts").select("id,user_id,session_id,document_id,title,url,content,enabled,created_at").eq("user_id", user_id)
            if session_id:
                req = req.eq("session_id", session_id)
            if document_id:
                req = req.eq("document_id", document_id)
            return req.order("created_at", desc=True)
        resp = await _db_call(query)
        return {"success": True, "data": {"contexts": resp.data or [], "storage": "database"}}
    except Exception:
        return {"success": True, "data": {"contexts": ACADEMIC_WEB_CONTEXTS.get(user_id, []), "storage": "memory_fallback"}}


@router.post("/web-contexts", response_model=dict)
async def create_web_context(body: WebContextRequest, user: dict = Depends(get_current_user)):
    user_id = _user_id(user)
    row = {"id": str(uuid4()), "user_id": user_id, "session_id": body.session_id, "document_id": body.document_id, "title": body.title or "Web context", "url": body.url, "content": body.content, "enabled": body.enabled, "created_at": datetime.now(timezone.utc).isoformat()}
    try:
        resp = await _db_call(lambda: supabase.table("academic_lens_web_contexts").insert(row))
        return {"success": True, "data": {"context": (resp.data or [row])[0], "storage": "database"}}
    except Exception:
        ACADEMIC_WEB_CONTEXTS.setdefault(user_id, []).append(row)
        return {"success": True, "data": {"context": row, "storage": "memory_fallback"}}


@router.patch("/web-contexts/{context_id}", response_model=dict)
async def update_web_context(context_id: str, body: WebContextPatch, user: dict = Depends(get_current_user)):
    user_id = _user_id(user)
    patch = {key: value for key, value in body.model_dump().items() if value is not None}
    try:
        resp = await _db_call(lambda: supabase.table("academic_lens_web_contexts").update(patch).eq("id", context_id).eq("user_id", user_id))
        return {"success": True, "data": {"context": (resp.data or [patch])[0], "storage": "database"}}
    except Exception:
        for item in ACADEMIC_WEB_CONTEXTS.get(user_id, []):
            if item.get("id") == context_id:
                item.update(patch)
        return {"success": True, "data": {"storage": "memory_fallback"}}


@router.delete("/web-contexts/{context_id}", response_model=dict)
async def delete_web_context(context_id: str, user: dict = Depends(get_current_user)):
    user_id = _user_id(user)
    try:
        await _db_call(lambda: supabase.table("academic_lens_web_contexts").delete().eq("id", context_id).eq("user_id", user_id))
        return {"success": True, "data": {"deleted": True, "storage": "database"}}
    except Exception:
        ACADEMIC_WEB_CONTEXTS[user_id] = [item for item in ACADEMIC_WEB_CONTEXTS.get(user_id, []) if item.get("id") != context_id]
        return {"success": True, "data": {"deleted": True, "storage": "memory_fallback"}}


@router.get("/notes", response_model=dict)
@router.get("/notepad", response_model=dict)
async def get_notepad(document_id: str | None = "draft", session_id: str | None = None, user: dict = Depends(get_current_user)):
    user_id = _user_id(user)
    try:
        def query():
            req = supabase.table("academic_lens_notes").select("id,document_id,session_id,content,version,updated_at").eq("user_id", user_id).eq("document_id", document_id or "draft")
            if session_id:
                req = req.eq("session_id", session_id)
            else:
                req = req.is_("session_id", "null")
            return req.order("updated_at", desc=True).limit(1)
        resp = await _db_call(query)
        row = (resp.data or [{}])[0] if resp.data else {}
        return {"success": True, "data": {"document_id": document_id, "session_id": session_id, "content": row.get("content", ""), "storage": "database"}}
    except Exception:
        return {"success": True, "data": {"document_id": document_id, "session_id": session_id, "content": ACADEMIC_NOTES.get(_note_key(user, document_id, session_id), ""), "storage": "memory_fallback"}}


@router.put("/notes", response_model=dict)
@router.put("/notepad", response_model=dict)
async def save_notepad(body: NotepadPayload, user: dict = Depends(get_current_user)):
    user_id = _user_id(user)
    row = {"user_id": user_id, "document_id": body.document_id or "draft", "session_id": body.session_id, "content": body.content, "updated_at": datetime.now(timezone.utc).isoformat()}
    try:
        select_req = supabase.table("academic_lens_notes").select("id,version").eq("user_id", user_id).eq("document_id", row["document_id"])
        select_req = select_req.eq("session_id", body.session_id) if body.session_id else select_req.is_("session_id", "null")
        existing = await _db_call(lambda: select_req.limit(1))
        if existing.data:
            note_id = existing.data[0]["id"]
            version = int(existing.data[0].get("version") or 1) + 1
            resp = await _db_call(lambda: supabase.table("academic_lens_notes").update({**row, "version": version}).eq("id", note_id))
        else:
            resp = await _db_call(lambda: supabase.table("academic_lens_notes").insert({**row, "id": str(uuid4()), "version": 1, "created_at": datetime.now(timezone.utc).isoformat()}))
        saved = (resp.data or [row])[0]
        return {"success": True, "data": {"saved": True, "document_id": body.document_id, "version": saved.get("version"), "storage": "database"}}
    except Exception:
        ACADEMIC_NOTES[_note_key(user, body.document_id, body.session_id)] = body.content
        return {"success": True, "data": {"saved": True, "document_id": body.document_id, "storage": "memory_fallback"}}


@router.get("/notepad/export.md")
@router.post("/notes/export.md")
async def export_notepad_md(document_id: str | None = "draft", session_id: str | None = None, user: dict = Depends(get_current_user)):
    note = await get_notepad(document_id, session_id, user)
    return {"success": True, "data": {"filename": "academic-notepad.md", "content": note["data"].get("content", "")}}


@router.post("/sessions", response_model=dict)
async def create_session(body: SessionPayload, user: dict = Depends(get_current_user)):
    user_id = _user_id(user)
    row = {"id": str(uuid4()), "user_id": user_id, "document_id": body.document_id, "title": body.title or "Academic Lens session", "created_at": datetime.now(timezone.utc).isoformat(), "updated_at": datetime.now(timezone.utc).isoformat()}
    try:
        resp = await _db_call(lambda: supabase.table("academic_lens_sessions").insert(row))
        return {"success": True, "data": {"session": (resp.data or [row])[0], "storage": "database"}}
    except Exception:
        ACADEMIC_SESSIONS[_session_key(user_id, row["id"])] = row
        ACADEMIC_MESSAGES[row["id"]] = []
        return {"success": True, "data": {"session": row, "storage": "memory_fallback"}}


@router.get("/sessions", response_model=dict)
async def list_sessions(document_id: str | None = None, user: dict = Depends(get_current_user)):
    user_id = _user_id(user)
    try:
        def query():
            req = supabase.table("academic_lens_sessions").select("id,document_id,title,created_at,updated_at").eq("user_id", user_id)
            if document_id:
                req = req.eq("document_id", document_id)
            return req.order("updated_at", desc=True).limit(30)
        resp = await _db_call(query)
        return {"success": True, "data": {"sessions": resp.data or [], "storage": "database"}}
    except Exception:
        rows = [value for key, value in ACADEMIC_SESSIONS.items() if key.startswith(f"{user_id}:") and (not document_id or value.get("document_id") == document_id)]
        return {"success": True, "data": {"sessions": rows, "storage": "memory_fallback"}}


@router.get("/sessions/{session_id}", response_model=dict)
async def get_session(session_id: str, user: dict = Depends(get_current_user)):
    user_id = _user_id(user)
    try:
        session_resp = await _db_call(lambda: supabase.table("academic_lens_sessions").select("id,document_id,title,created_at,updated_at").eq("id", session_id).eq("user_id", user_id).single())
        msg_resp = await _db_call(lambda: supabase.table("academic_lens_messages").select("id,role,content,citations,attachments,created_at").eq("session_id", session_id).order("created_at"))
        return {"success": True, "data": {"session": session_resp.data, "messages": msg_resp.data or [], "storage": "database"}}
    except Exception:
        return {"success": True, "data": {"session": ACADEMIC_SESSIONS.get(_session_key(user_id, session_id)), "messages": ACADEMIC_MESSAGES.get(session_id, []), "storage": "memory_fallback"}}


@router.delete("/sessions/{session_id}", response_model=dict)
async def delete_session(session_id: str, user: dict = Depends(get_current_user)):
    user_id = _user_id(user)
    try:
        await _db_call(lambda: supabase.table("academic_lens_sessions").delete().eq("id", session_id).eq("user_id", user_id))
        return {"success": True, "data": {"deleted": True, "storage": "database"}}
    except Exception:
        ACADEMIC_SESSIONS.pop(_session_key(user_id, session_id), None)
        ACADEMIC_MESSAGES.pop(session_id, None)
        return {"success": True, "data": {"deleted": True, "storage": "memory_fallback"}}


@router.post("/sessions/{session_id}/messages", response_model=dict)
async def add_session_message(session_id: str, body: MessagePayload, user: dict = Depends(get_current_user)):
    _ = user
    row = {"id": str(uuid4()), "session_id": session_id, "role": body.role, "content": body.content, "citations": body.citations, "attachments": body.attachments, "created_at": datetime.now(timezone.utc).isoformat()}
    try:
        resp = await _db_call(lambda: supabase.table("academic_lens_messages").insert(row))
        await _db_call(lambda: supabase.table("academic_lens_sessions").update({"updated_at": datetime.now(timezone.utc).isoformat()}).eq("id", session_id))
        return {"success": True, "data": {"message": (resp.data or [row])[0], "storage": "database"}}
    except Exception:
        ACADEMIC_MESSAGES.setdefault(session_id, []).append(row)
        return {"success": True, "data": {"message": row, "storage": "memory_fallback"}}


@router.delete("/sessions/{session_id}/messages", response_model=dict)
async def clear_session_messages(session_id: str, user: dict = Depends(get_current_user)):
    _ = user
    try:
        await _db_call(lambda: supabase.table("academic_lens_messages").delete().eq("session_id", session_id))
        return {"success": True, "data": {"deleted": True, "storage": "database"}}
    except Exception:
        ACADEMIC_MESSAGES[session_id] = []
        return {"success": True, "data": {"deleted": True, "storage": "memory_fallback"}}


@router.get("/documents/{document_id}/reading-map", response_model=dict)
async def reading_map(document_id: str, source_type: str = "upload", user: dict = Depends(get_current_user)):
    _ = user
    doc = resolve_document({"id": document_id, "source_type": source_type})
    sections: dict[str, dict[str, Any]] = {}
    for chunk in doc.get("chunks") or doc.get("snippets") or []:
        text = _clean_text(chunk.get("content"), 280)
        page = _page_start(chunk)
        section = str(chunk.get("section") or "").strip() or "Nội dung"
        label = next((name for name in ["Abstract", "Introduction", "Related Work", "Method", "Experiments", "Results", "Limitations", "Future Work"] if name.lower() in section.lower() or name.lower() in text[:120].lower()), section)
        item = sections.setdefault(label, {"label": label, "page_start": page, "page_end": page, "summary": "", "chunk_ids": []})
        if page:
            item["page_start"] = min([p for p in [item.get("page_start"), page] if p])
            item["page_end"] = max([p for p in [item.get("page_end"), page] if p])
        item["chunk_ids"].append(str(chunk.get("id") or chunk.get("chunk_index") or ""))
        if not item["summary"] and text:
            item["summary"] = text
    return {"success": True, "data": {"reading_map": list(sections.values())[:12]}}
