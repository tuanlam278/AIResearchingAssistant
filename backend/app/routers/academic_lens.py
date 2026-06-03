from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from pydantic import BaseModel, Field

from app.services.web_search_service import search_web, is_web_search_configured
from app.dependencies import get_current_user
from app.services.cross_analysis_service import get_document_preview, resolve_document, upload_temp_document
from app.services.llm import GROQ_MODEL, client
from app.services.vision_service import analyze_academic_image, is_vision_configured
from app.services.activity_log_service import log_user_activity

router = APIRouter(tags=["academic-lens"])

ACADEMIC_NOTES: dict[str, str] = {}
ACADEMIC_WEB_CONTEXTS: dict[str, list[dict[str, Any]]] = {}


class AcademicDocumentRef(BaseModel):
    id: str
    source_type: str
    title: str | None = None
    filename: str | None = None
    file_type: str | None = None


class DocumentChatRequest(BaseModel):
    document: AcademicDocumentRef | None = None
    message: str = Field(..., min_length=1, max_length=3000)
    chat_history: list[dict[str, Any]] = Field(default_factory=list)
    extra_contexts: list[dict[str, Any]] = Field(default_factory=list)


class WebChatRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=2000)


class VisionChatRequest(BaseModel):
    image_data_url: str | None = None
    prompt: str = Field(..., min_length=1, max_length=1500)
    document_id: str | None = None


class WebContextRequest(BaseModel):
    content: str = Field(..., min_length=1)
    citations: list[dict[str, Any]] = Field(default_factory=list)


class NotepadPayload(BaseModel):
    document_id: str | None = "draft"
    content: str = ""


def _user_id(user: dict) -> str:
    return str(user.get("id") or user.get("email") or "anonymous")


def _note_key(user: dict, document_id: str | None) -> str:
    return f"{_user_id(user)}:{document_id or 'draft'}"


def _context_from_document(document: dict[str, Any]) -> str:
    snippets = document.get("chunks") or document.get("snippets") or []
    parts = []
    for chunk in snippets[:10]:
        parts.append(str(chunk.get("content") or ""))
    return "\n\n".join(parts)[:14000]


@router.post("/documents/upload", response_model=dict)
async def upload_academic_lens_document(file: UploadFile = File(...), user: dict = Depends(get_current_user)):
    contents = await file.read()
    filename = file.filename or "academic-document"
    document = await upload_temp_document(contents, filename)
    log_user_activity(
        user_id=_user_id(user),
        feature_name="academic_lens",
        action_type="document_upload",
        document_id=document.get("id"),
        document_name=document.get("filename") or filename,
        metadata={
            "file_type": document.get("file_type"),
            "size": len(contents),
            "source": "academic_lens_upload",
            "upload_status": "ready",
            "temp_document_id": document.get("id"),
        },
    )
    preview = get_document_preview(document["id"])
    return {"success": True, "data": {**document, **preview}}


@router.get("/documents/{document_id}/preview", response_model=dict)
async def preview_academic_lens_document(document_id: str, user: dict = Depends(get_current_user)):
    _ = user
    return {"success": True, "data": get_document_preview(document_id)}


@router.post("/document-chat", response_model=dict)
async def document_chat(body: DocumentChatRequest, user: dict = Depends(get_current_user)):
    _ = user
    if not body.document:
        raise HTTPException(status_code=400, detail={"code": "NO_DOCUMENT", "message": "Vui lòng chọn hoặc upload tài liệu trước khi hỏi Document AI."})
    doc = resolve_document(body.document.model_dump())
    history = "\n".join(f"{item.get('role')}: {item.get('content')}" for item in body.chat_history[-8:])
    external_context = "\n\n".join(str(item.get("content") or "") for item in body.extra_contexts[-5:])
    try:
        response = await client.chat.completions.create(
            model=GROQ_MODEL,
            messages=[
                {"role": "system", "content": "Bạn là Document AI trong Kính lúp Học thuật. Trả lời chủ yếu dựa trên tài liệu đang đọc. Nếu có bối cảnh web do người dùng thêm, ghi rõ đó là bối cảnh bổ sung và không xem như nội dung gốc của PDF/DOC."},
                {"role": "user", "content": f"Tài liệu: {doc.get('title')} ({doc.get('filename')})\nNội dung trích xuất:\n{_context_from_document(doc)}\n\nBối cảnh web bổ sung do người dùng thêm:\n{external_context}\n\nLịch sử:\n{history}\n\nCâu hỏi: {body.message}"},
            ],
            temperature=0.25,
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail={"code": "LLM_FAILED", "message": "Không thể gọi AI cho Document AI."}) from exc
    return {"success": True, "data": {"answer": response.choices[0].message.content or "", "citations": [{"title": doc.get("title"), "document_id": doc.get("id")}]}}


@router.post("/web-chat", response_model=dict)
async def web_chat(body: WebChatRequest, user: dict = Depends(get_current_user)):
    _ = user
    if not is_web_search_configured():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={"code": "WEB_SEARCH_NOT_CONFIGURED", "message": "Global Web Chat cần cấu hình Web Search API."},
        )

    # 1. Lấy kết quả web
    results = await search_web(body.message)
    
    # 2. Tạo context từ kết quả
    context = "\n\n".join(
        f"[{idx}] {item.title}\nURL: {item.url}\nSnippet: {item.snippet}\nContent: {item.content}"
        for idx, item in enumerate(results, start=1)
    )

    # 3. Gọi Groq LLM để sinh câu trả lời
    response = await client.chat.completions.create(
        model=GROQ_MODEL, # Thay bằng model Groq bạn đang dùng
        messages=[
            {
                "role": "system",
                "content": "Bạn là Global Web Chat. Trả lời dựa trên kết quả web đã cung cấp và trích dẫn nguồn bằng [1], [2].",
            },
            {"role": "user", "content": f"Kết quả web:\n{context}\n\nCâu hỏi: {body.message}"},
        ],
        temperature=0.2,
    )

    # 4. Trả kết quả về frontend
    return {
        "success": True,
        "data": {
            "answer": response.choices[0].message.content or "",
            "citations": [{"title": r.title, "url": r.url} for r in results],
        },
    }
   


@router.post("/vision-chat", response_model=dict)
async def vision_chat(
    image: UploadFile = File(...),
    prompt: str = Form(...),
    document_id: str | None = Form(None),
    user: dict = Depends(get_current_user),
):
    _ = (document_id, user)
    clean_prompt = (prompt or "").strip()
    if not clean_prompt:
        raise HTTPException(status_code=400, detail={"code": "MISSING_PROMPT", "message": "Vui lòng nhập prompt để phân tích ảnh."})
    if not image:
        raise HTTPException(status_code=400, detail={"code": "MISSING_IMAGE", "message": "Vui lòng gửi ảnh crop để phân tích."})
    if not is_vision_configured():
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail={"code": "VISION_NOT_CONFIGURED", "message": "Tính năng phân tích ảnh cần cấu hình Vision API. Hãy thêm GOOGLE_API_KEY hoặc cấu hình model vision."})

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

    return {"success": True, "data": {"answer": result.answer, "model": result.model, "citations": []}}


@router.post("/add-web-context", response_model=dict)
async def add_web_context(body: WebContextRequest, user: dict = Depends(get_current_user)):
    key = _user_id(user)
    ACADEMIC_WEB_CONTEXTS.setdefault(key, []).append(body.model_dump())
    return {"success": True, "data": {"added": True, "count": len(ACADEMIC_WEB_CONTEXTS[key])}}


@router.get("/notepad", response_model=dict)
async def get_notepad(document_id: str | None = "draft", user: dict = Depends(get_current_user)):
    return {"success": True, "data": {"document_id": document_id, "content": ACADEMIC_NOTES.get(_note_key(user, document_id), "")}}


@router.put("/notepad", response_model=dict)
async def save_notepad(body: NotepadPayload, user: dict = Depends(get_current_user)):
    ACADEMIC_NOTES[_note_key(user, body.document_id)] = body.content
    return {"success": True, "data": {"saved": True, "document_id": body.document_id}}


@router.get("/notepad/export.md")
async def export_notepad_md(document_id: str | None = "draft", user: dict = Depends(get_current_user)):
    return {"success": True, "data": {"filename": "academic-notepad.md", "content": ACADEMIC_NOTES.get(_note_key(user, document_id), "")}}
