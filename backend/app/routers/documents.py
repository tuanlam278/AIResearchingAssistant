from fastapi import APIRouter, UploadFile, File, HTTPException
from app.services.pdf_parser import parse_pdf
from app.services.chunker import chunk_text
from app.services.embedder import embed_chunks
from app.db.supabase_client import supabase
from app.config import settings
from app.models.schemas import DocumentResponse, DocumentListResponse, DeleteDocumentResponse
import uuid
from datetime import datetime, timezone

router = APIRouter()

MAX_FILE_SIZE = settings.MAX_FILE_SIZE_MB * 1024 * 1024


@router.post("/upload", response_model=dict)
async def upload_document(file: UploadFile = File(...)):
    # Validate file type
    if not file.filename.endswith(".pdf"):
        raise HTTPException(status_code=415, detail={"code": "INVALID_FILE_TYPE", "message": "Chỉ chấp nhận file PDF"})

    # Validate file size
    content = await file.read()
    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(status_code=413, detail={"code": "FILE_TOO_LARGE", "message": f"File vượt quá {settings.MAX_FILE_SIZE_MB}MB"})

    # 1. Parse PDF
    try:
        pages = parse_pdf(content)
    except Exception:
        raise HTTPException(status_code=422, detail={"code": "PARSE_FAILED", "message": "Không thể đọc nội dung PDF"})

    # 2. Chunk
    chunks = chunk_text(pages)

    # 3. Embed
    try:
        embeddings = await embed_chunks([c["content"] for c in chunks])
    except Exception:
        raise HTTPException(status_code=500, detail={"code": "EMBED_FAILED", "message": "Lỗi khi tạo embedding"})

    # 4. Save to Supabase
    doc_id = str(uuid.uuid4())
    supabase.table("documents").insert({
        "id": doc_id,
        "filename": file.filename,
        "page_count": len(pages),
        "chunk_count": len(chunks),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }).execute()

    rows = [
        {
            "doc_id": doc_id,
            "content": chunk["content"],
            "page_number": chunk["page"],
            "chunk_index": i,
            "embedding": embeddings[i],
        }
        for i, chunk in enumerate(chunks)
    ]
    supabase.table("document_chunks").insert(rows).execute()

    return {
        "success": True,
        "data": {
            "doc_id": doc_id,
            "filename": file.filename,
            "chunk_count": len(chunks),
            "page_count": len(pages),
            "created_at": datetime.now(timezone.utc).isoformat(),
            "status": "ready",
        }
    }


@router.get("", response_model=dict)
async def list_documents():
    result = supabase.table("documents").select("*").order("created_at", desc=True).execute()
    docs = [
        {
            "doc_id": d["id"],
            "filename": d["filename"],
            "page_count": d["page_count"],
            "chunk_count": d["chunk_count"],
            "created_at": d["created_at"],
        }
        for d in result.data
    ]
    return {"success": True, "data": {"documents": docs, "total": len(docs)}}


@router.delete("/{doc_id}", response_model=dict)
async def delete_document(doc_id: str):
    result = supabase.table("documents").delete().eq("id", doc_id).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail={"code": "DOC_NOT_FOUND", "message": "Không tìm thấy tài liệu"})
    return {"success": True, "data": {"doc_id": doc_id, "deleted": True}}


@router.post("/{doc_id}/summarize", response_model=dict)
async def summarize_document(doc_id: str):
    # TODO: BE2 implement — lấy toàn bộ chunks của doc, prompt Gemini tóm tắt
    raise HTTPException(status_code=501, detail={"code": "NOT_IMPLEMENTED", "message": "Tính năng đang phát triển"})
