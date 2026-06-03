"""Cross-document analysis service for comparing two uploaded or System Library documents."""

from __future__ import annotations

import json
import logging
import re
from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from fastapi import HTTPException, status

from app.config import settings
from app.db.supabase_client import supabase
from app.services.chunker import chunk_text
from app.services.document_parser import EmptyDocumentText, UnsupportedDocumentType, get_file_type, parse_document
from app.services.llm import GROQ_MODEL, client

logger = logging.getLogger(__name__)

TEMP_DOCUMENTS: dict[str, dict[str, Any]] = {}
MAX_CONTEXT_CHARS_PER_DOC = 14000
MAX_SNIPPETS = 8

CRITERIA_CATALOG = {
    "problem_motivation": {
        "label": "Vấn đề & Động lực nghiên cứu",
        "subquestions": "Mục tiêu cốt lõi; hai tài liệu có giải quyết cùng bài toán không; giả định ban đầu; động lực nghiên cứu khác nhau ra sao.",
    },
    "methodology": {
        "label": "Phương pháp tiếp cận",
        "subquestions": "Khác biệt thuật toán; kiến trúc/kỹ thuật; tính mới; chi phí tính toán/độ phức tạp.",
    },
    "datasets_experiments": {
        "label": "Dữ liệu & Thiết lập thực nghiệm",
        "subquestions": "Datasets; baselines; metrics; mức độ công bằng trong setup.",
    },
    "results_tradeoffs": {
        "label": "Kết quả & Đánh đổi",
        "subquestions": "Điều kiện chiến thắng; trade-offs; ablation study; tốc độ so với độ chính xác nếu có.",
    },
    "scalability_limitations": {
        "label": "Khả năng mở rộng & Hạn chế",
        "subquestions": "Ứng dụng thực tiễn; rủi ro production; hạn chế chung; hướng nghiên cứu tương lai.",
    },
    "datasets_experimental_setup": {
        "label": "Dữ liệu & Thiết lập thực nghiệm",
        "subquestions": "Datasets; baselines; metrics; protocol thực nghiệm và mức độ công bằng trong setup.",
    },
    "novelty": {
        "label": "Tính mới",
        "subquestions": "Đóng góp mới, khác biệt so với nghiên cứu trước và mức độ sáng tạo của đề xuất.",
    },
    "complexity": {
        "label": "Chi phí tính toán / Độ phức tạp",
        "subquestions": "Tài nguyên, độ phức tạp thuật toán, latency, bộ nhớ và chi phí triển khai nếu có.",
    },
    "baselines_metrics": {
        "label": "Baseline & Chỉ số đánh giá",
        "subquestions": "Baseline so sánh, metric chính, protocol đánh giá và tính công bằng của phép đo.",
    },
    "practical_application": {
        "label": "Khả năng ứng dụng thực tế",
        "subquestions": "Tính khả thi khi triển khai, use case, ràng buộc vận hành và giá trị thực tế.",
    },
    "limitations": {
        "label": "Hạn chế",
        "subquestions": "Các điểm yếu được nêu, thiếu sót trong thực nghiệm và rủi ro khi diễn giải kết quả.",
    },
}


def _supabase_response_data(resp: Any):
    if isinstance(resp, dict):
        return resp.get("data"), resp.get("error")
    return getattr(resp, "data", None), getattr(resp, "error", None)


def _clean_text(value: str | None, max_length: int | None = None) -> str:
    text = re.sub(r"\s+", " ", str(value or "")).strip()
    if max_length and len(text) > max_length:
        return text[: max_length - 1].rstrip() + "…"
    return text


def _document_preview(chunks: list[dict[str, Any]]) -> str:
    return "\n\n".join(_clean_text(chunk.get("content"), 1500) for chunk in chunks[:MAX_SNIPPETS] if chunk.get("content"))[:MAX_CONTEXT_CHARS_PER_DOC]


def _normalize_temp_document(temp_id: str, filename: str, file_type: str, chunks: list[dict[str, Any]], pages: list[dict[str, Any]]) -> dict[str, Any]:
    title = filename.rsplit(".", 1)[0] if "." in filename else filename
    snippets = [
        {
            "page_number": chunk.get("page_number"),
            "section": chunk.get("section"),
            "content": _clean_text(chunk.get("content"), 900),
        }
        for chunk in chunks[:MAX_SNIPPETS]
    ]
    return {
        "id": temp_id,
        "source_type": "upload",
        "title": title or filename,
        "filename": filename,
        "file_type": file_type,
        "status": "ready",
        "summary": _clean_text(" ".join(str(page.get("content") or "") for page in pages[:2]), 900),
        "snippets": snippets,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }


async def upload_temp_document(file_contents: bytes, filename: str) -> dict[str, Any]:
    max_size_bytes = settings.MAX_UPLOAD_MB * 1024 * 1024
    if len(file_contents) > max_size_bytes:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail={"code": "FILE_TOO_LARGE", "message": f"File quá lớn. Vui lòng chọn file dưới {settings.MAX_UPLOAD_MB}MB."},
        )
    try:
        pages, parsed_file_type = await parse_document(file_contents, filename)
    except UnsupportedDocumentType as exc:
        raise HTTPException(status_code=400, detail={"code": "UNSUPPORTED_FILE", "message": str(exc)}) from exc
    except EmptyDocumentText as exc:
        raise HTTPException(status_code=400, detail={"code": "EMPTY_DOCUMENT", "message": str(exc)}) from exc

    chunks = chunk_text(pages)
    if not chunks:
        raise HTTPException(status_code=400, detail={"code": "EMPTY_DOCUMENT", "message": "Không trích xuất được đoạn văn bản đủ dài để phân tích."})

    temp_id = f"temp_{uuid4().hex}"
    document = _normalize_temp_document(temp_id, filename, parsed_file_type or get_file_type(filename), chunks, pages)
    TEMP_DOCUMENTS[temp_id] = {**document, "chunks": chunks, "pages": pages}
    return document


def _load_system_document(document_id: str) -> dict[str, Any]:
    try:
        doc_resp = (
            supabase.table("system_documents")
            .select("id, title, filename, file_type, summary, category, tags, is_vector_ready, mime_type")
            .eq("id", document_id)
            .single()
            .execute()
        )
        chunks_resp = (
            supabase.table("system_document_chunks")
            .select("id, content, page_start, page_end")
            .eq("document_id", document_id)
            .limit(40)
            .execute()
        )
    except Exception as exc:
        logger.exception("Load System Library document for cross-analysis failed")
        raise HTTPException(status_code=500, detail={"code": "INTERNAL_ERROR", "message": "Không thể đọc tài liệu hệ thống."}) from exc

    row, error = _supabase_response_data(doc_resp)
    if error or not row:
        raise HTTPException(status_code=404, detail={"code": "DOC_NOT_FOUND", "message": "Không tìm thấy tài liệu hệ thống."})
    chunk_rows, chunk_error = _supabase_response_data(chunks_resp)
    if chunk_error:
        raise HTTPException(status_code=500, detail={"code": "CHUNKS_UNAVAILABLE", "message": "Không thể đọc chunks của tài liệu hệ thống."})

    chunks = [
        {
            "id": chunk.get("id"),
            "content": chunk.get("content") or "",
            "page_number": chunk.get("page_start") or 1,
            "page_start": chunk.get("page_start"),
            "page_end": chunk.get("page_end"),
            "section": "System Library",
        }
        for chunk in (chunk_rows or [])
        if chunk.get("content")
    ]
    if not chunks and row.get("summary"):
        chunks = [{"content": row.get("summary"), "page_number": 1, "section": "Summary"}]
    if not chunks:
        raise HTTPException(status_code=400, detail={"code": "NO_TEXT_CONTEXT", "message": "Tài liệu hệ thống chưa có nội dung/chunks để phân tích."})

    return {
        "id": str(row.get("id")),
        "source_type": "system_library",
        "title": row.get("title") or row.get("filename") or "Tài liệu hệ thống",
        "filename": row.get("filename") or "",
        "file_type": row.get("file_type") or "FILE",
        "summary": row.get("summary") or _clean_text(chunks[0].get("content"), 900),
        "snippets": [
            {"page_number": chunk.get("page_number"), "section": chunk.get("section"), "content": _clean_text(chunk.get("content"), 900)}
            for chunk in chunks[:MAX_SNIPPETS]
        ],
        "chunks": chunks,
    }


def resolve_document(ref: dict[str, Any]) -> dict[str, Any]:
    source_type = ref.get("source_type")
    document_id = str(ref.get("id") or "")
    if source_type == "upload":
        document = TEMP_DOCUMENTS.get(document_id)
        if not document:
            raise HTTPException(status_code=404, detail={"code": "TEMP_DOC_NOT_FOUND", "message": "File upload tạm không còn tồn tại. Vui lòng upload lại."})
        return document
    if source_type == "system_library":
        return _load_system_document(document_id)
    raise HTTPException(status_code=400, detail={"code": "INVALID_DOCUMENT_SOURCE", "message": "Nguồn tài liệu không hợp lệ."})


def _selected_criteria(criteria: list[str] | None) -> list[dict[str, str]]:
    selected = [key for key in (criteria or []) if key in CRITERIA_CATALOG]
    if not selected:
        selected = list(CRITERIA_CATALOG.keys())
    return [{"key": key, **CRITERIA_CATALOG[key]} for key in selected]


def _context_block(label: str, document: dict[str, Any]) -> str:
    context = _document_preview(document.get("chunks") or [])
    return f"{label}: {document.get('title')} ({document.get('filename')})\nNguồn: {document.get('source_type')}\nTóm tắt: {document.get('summary') or ''}\nĐoạn trích:\n{context}"


def _extract_json_object(text: str) -> dict[str, Any]:
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}", text or "", re.DOTALL)
        if match:
            try:
                return json.loads(match.group(0))
            except json.JSONDecodeError:
                pass
    raise HTTPException(status_code=502, detail={"code": "LLM_JSON_PARSE_FAILED", "message": "AI không trả về JSON hợp lệ. Vui lòng thử lại."})


async def _llm_json(system_prompt: str, user_prompt: str) -> dict[str, Any]:
    try:
        response = await client.chat.completions.create(
            model=GROQ_MODEL,
            messages=[{"role": "system", "content": system_prompt}, {"role": "user", "content": user_prompt}],
            temperature=0.2,
            response_format={"type": "json_object"},
        )
    except Exception as exc:
        logger.exception("Cross-analysis LLM call failed")
        raise HTTPException(status_code=502, detail={"code": "LLM_FAILED", "message": "Không thể gọi AI để phân tích hai tài liệu."}) from exc
    return _extract_json_object(response.choices[0].message.content or "{}")




def _coerce_score(value: Any) -> float | None:
    try:
        score = float(value)
    except (TypeError, ValueError):
        return None
    if not 0 <= score <= 1:
        return None
    return score


def _valid_citation_scores(citations: list[dict[str, Any]] | None) -> list[float]:
    scores: list[float] = []
    for citation in citations or []:
        if not isinstance(citation, dict):
            continue
        has_title = bool(_clean_text(citation.get("document_title") or citation.get("title") or citation.get("filename")))
        has_location = citation.get("page_start") or citation.get("page_end") or citation.get("page") or citation.get("page_number") or citation.get("location")
        score = _coerce_score(citation.get("score") if citation.get("score") is not None else citation.get("similarity"))
        if has_title and has_location and score is not None:
            scores.append(score)
    return scores


def _confidence_from_citations(citations: list[dict[str, Any]] | None) -> tuple[float | None, dict[str, Any]]:
    scores = _valid_citation_scores(citations)
    if not scores:
        return None, {"citation_count": 0, "average_retrieval_score": None, "basis": "missing_retrieval_scores"}
    average_score = sum(scores) / len(scores)
    return round(average_score, 4), {"citation_count": len(scores), "average_retrieval_score": round(average_score, 4), "basis": "valid_citation_retrieval_scores"}


def _fallback_criterion_label(criterion: str) -> str:
    return _clean_text(str(criterion or "").replace("_", " ")).title()


def _normalize_comparison_table(rows: list[Any], selected: list[dict[str, str]]) -> list[dict[str, Any]]:
    label_by_key = {item["key"]: item["label"] for item in selected}
    normalized = []
    for row in rows or []:
        if not isinstance(row, dict):
            continue
        criterion = _clean_text(row.get("criterion"))
        criterion_key = criterion if criterion in CRITERIA_CATALOG else next((key for key, item in CRITERIA_CATALOG.items() if criterion == item["label"]), criterion)
        citations = row.get("citations") if isinstance(row.get("citations"), list) else []
        confidence, confidence_basis = _confidence_from_citations(citations)
        normalized.append({
            **row,
            "criterion": criterion_key,
            "criterion_label": label_by_key.get(criterion_key) or CRITERIA_CATALOG.get(criterion_key, {}).get("label") or _fallback_criterion_label(criterion_key),
            "confidence": confidence,
            "confidence_basis": confidence_basis,
        })
    return normalized

def _citation_seed(doc_a: dict[str, Any], doc_b: dict[str, Any]) -> list[dict[str, Any]]:
    citations = []
    for label, doc in (("A", doc_a), ("B", doc_b)):
        for index, snippet in enumerate(doc.get("snippets") or [], start=1):
            citations.append({
                "document": label,
                "document_id": doc.get("id"),
                "title": doc.get("title"),
                "page": snippet.get("page_number"),
                "snippet": snippet.get("content"),
                "citation_index": f"{label}{index}",
            })
    return citations


async def compare_documents(document_a_ref: dict[str, Any], document_b_ref: dict[str, Any], criteria: list[str] | None) -> dict[str, Any]:
    doc_a = resolve_document(document_a_ref)
    doc_b = resolve_document(document_b_ref)
    if doc_a.get("source_type") == doc_b.get("source_type") and str(doc_a.get("id")) == str(doc_b.get("id")):
        raise HTTPException(status_code=400, detail={"code": "SAME_DOCUMENT", "message": "Vui lòng chọn hai tài liệu khác nhau để so sánh."})
    selected = _selected_criteria(criteria)
    criteria_text = "\n".join(f"- {item['key']}: {item['label']} — {item['subquestions']}" for item in selected)
    payload = await _llm_json(
        "Bạn là chuyên gia phản biện học thuật. Chỉ trả về JSON hợp lệ, không markdown.",
        f"""
So sánh hai tài liệu theo các tiêu chí đã chọn. Không bịa dữ kiện; nếu thiếu thông tin hãy ghi rõ "Không thấy trong trích đoạn" và giảm confidence.

Tiêu chí:
{criteria_text}

{_context_block('Tài liệu A', doc_a)}

{_context_block('Tài liệu B', doc_b)}

Trả JSON dạng:
{{"comparison_table":[{{"criterion":"...","document_a":"...","document_b":"...","analysis":"...","confidence":0.0,"citations":[]}}],"summary":"...","warnings":[]}}
""".strip(),
    )
    return {
        "comparison_table": _normalize_comparison_table(payload.get("comparison_table") or [], selected),
        "summary": payload.get("summary") or "",
        "warnings": payload.get("warnings") or [],
        "citations": payload.get("citations") or _citation_seed(doc_a, doc_b),
        "documents": {"a": _public_document(doc_a), "b": _public_document(doc_b)},
    }


def _public_document(document: dict[str, Any]) -> dict[str, Any]:
    return {key: document.get(key) for key in ["id", "source_type", "title", "filename", "file_type", "summary", "snippets", "status", "created_at"]}




def get_document_preview(document_id: str) -> dict[str, Any]:
    document_id = str(document_id or "")
    document = TEMP_DOCUMENTS.get(document_id) if document_id.startswith("temp_") else _load_system_document(document_id)
    chunks = document.get("chunks") or []
    extracted_text = "\n\n".join(str(chunk.get("content") or "").strip() for chunk in chunks if chunk.get("content"))
    return {
        **_public_document(document),
        "preview_text": extracted_text[:MAX_CONTEXT_CHARS_PER_DOC],
        "extracted_text": extracted_text[:MAX_CONTEXT_CHARS_PER_DOC],
    }


async def detect_conflicts(document_a_ref: dict[str, Any], document_b_ref: dict[str, Any]) -> dict[str, Any]:
    doc_a = resolve_document(document_a_ref)
    doc_b = resolve_document(document_b_ref)
    payload = await _llm_json(
        "Bạn là reviewer khó tính, tìm mâu thuẫn logic giữa hai tài liệu. Chỉ trả JSON hợp lệ.",
        f"""
Phân tích các điểm mâu thuẫn giữa hai tài liệu. Nếu không có mâu thuẫn đáng kể, trả conflicts rỗng và message rõ ràng.

{_context_block('Tài liệu A', doc_a)}

{_context_block('Tài liệu B', doc_b)}

Trả JSON dạng:
{{"conflicts":[{{"topic":"...","document_a_claim":"...","document_b_claim":"...","conflict_level":"low|medium|high","explanation":"...","citations":[]}}],"message":"..."}}
""".strip(),
    )
    return {"conflicts": payload.get("conflicts") or [], "message": payload.get("message") or "Không tìm thấy mâu thuẫn đáng kể trong phạm vi trích đoạn.", "citations": payload.get("citations") or _citation_seed(doc_a, doc_b)}


async def synthesize_documents(document_a_ref: dict[str, Any], document_b_ref: dict[str, Any]) -> dict[str, Any]:
    doc_a = resolve_document(document_a_ref)
    doc_b = resolve_document(document_b_ref)
    payload = await _llm_json(
        "Bạn là chuyên gia tổng hợp tri thức. Chỉ trả JSON hợp lệ.",
        f"""
Hợp nhất tri thức từ hai tài liệu thành bản nháp thống nhất, giữ điểm mạnh của cả hai và nêu nguồn ý tưởng A/B.

{_context_block('Tài liệu A', doc_a)}

{_context_block('Tài liệu B', doc_b)}

Trả JSON dạng:
{{"synthesis":"...","key_points":[],"keep_from_a":[],"keep_from_b":[],"citations":[]}}
""".strip(),
    )
    return {"synthesis": payload.get("synthesis") or "", "key_points": payload.get("key_points") or [], "keep_from_a": payload.get("keep_from_a") or [], "keep_from_b": payload.get("keep_from_b") or [], "citations": payload.get("citations") or _citation_seed(doc_a, doc_b)}


async def chat_about_documents(document_a_ref: dict[str, Any], document_b_ref: dict[str, Any], message: str, chat_history: list[dict[str, str]] | None = None) -> dict[str, Any]:
    doc_a = resolve_document(document_a_ref)
    doc_b = resolve_document(document_b_ref)
    history = "\n".join(f"{item.get('role')}: {item.get('content')}" for item in (chat_history or [])[-6:])
    try:
        response = await client.chat.completions.create(
            model=GROQ_MODEL,
            messages=[
                {"role": "system", "content": "Bạn trả lời câu hỏi chỉ dựa trên hai tài liệu A/B đang so sánh. Khi dùng thông tin từ tài liệu, ghi rõ [A] hoặc [B]."},
                {"role": "user", "content": f"{_context_block('Tài liệu A', doc_a)}\n\n{_context_block('Tài liệu B', doc_b)}\n\nLịch sử:\n{history}\n\nCâu hỏi: {message}"},
            ],
            temperature=0.25,
        )
    except Exception as exc:
        logger.exception("Cross-analysis chat LLM call failed")
        raise HTTPException(status_code=502, detail={"code": "LLM_FAILED", "message": "Không thể gọi AI để trả lời chat so sánh."}) from exc
    return {"answer": response.choices[0].message.content or "", "citations": _citation_seed(doc_a, doc_b)}
