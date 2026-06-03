"""Cross-document analysis service for comparing two uploaded or System Library documents."""

from __future__ import annotations

import asyncio
import json
import logging
import math
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
from app.services.embedder import embed_query

logger = logging.getLogger(__name__)

TEMP_DOCUMENTS: dict[str, dict[str, Any]] = {}
MAX_CONTEXT_CHARS_PER_DOC = 14000
MAX_SNIPPETS = 8
EVIDENCE_TOP_K = 4
SESSION_STORE: dict[str, dict[str, Any]] = {}

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
    "contribution": {"label": "Đóng góp chính", "subquestions": "Đóng góp, giá trị mới và phạm vi ảnh hưởng của tài liệu."},
    "clarity": {"label": "Độ rõ ràng", "subquestions": "Cấu trúc trình bày, độ dễ hiểu và mức độ giải thích đủ chi tiết."},
    "relevance": {"label": "Mức độ liên quan", "subquestions": "Mức độ phù hợp với mục tiêu đọc/nghiên cứu của người dùng."},
    "practical_value": {"label": "Giá trị thực tiễn", "subquestions": "Khả năng áp dụng, tính hữu ích và tác động trong thực tế."},
    "dependencies": {"label": "Phụ thuộc kỹ thuật", "subquestions": "Thư viện, dữ liệu, hạ tầng, mô hình hoặc điều kiện phụ thuộc."},
    "deployment_risk": {"label": "Rủi ro triển khai", "subquestions": "Rủi ro vận hành, bảo mật, độ ổn định và giới hạn production."},
    "scalability": {"label": "Khả năng mở rộng", "subquestions": "Mở rộng dữ liệu, người dùng, compute, hệ thống và vận hành."},
    "cost": {"label": "Chi phí", "subquestions": "Chi phí tính toán, dữ liệu, vận hành, nhân lực và hạ tầng."},
    "research_gap": {"label": "Khoảng trống nghiên cứu", "subquestions": "Khoảng trống tài liệu nêu ra và cách nó định vị trong literature."},
    "assumptions": {"label": "Giả định", "subquestions": "Giả định nghiên cứu, giả định dữ liệu/mô hình và điều kiện áp dụng."},
    "disagreement": {"label": "Điểm bất đồng", "subquestions": "Nhận định, kết quả hoặc giả thuyết khác nhau giữa hai tài liệu."},
    "future_work": {"label": "Hướng nghiên cứu tiếp theo", "subquestions": "Future work, mở rộng thí nghiệm và câu hỏi còn bỏ ngỏ."},
}

CRITERION_QUERIES = {
    "problem_motivation": ["problem motivation research objective assumption contribution", "vấn đề nghiên cứu động lực mục tiêu giả định đóng góp"],
    "methodology": ["method algorithm architecture approach model technique", "phương pháp thuật toán kiến trúc cách tiếp cận mô hình kỹ thuật"],
    "datasets_experiments": ["dataset experiment baseline metric evaluation setup", "dữ liệu thí nghiệm baseline chỉ số đánh giá thiết lập"],
    "datasets_experimental_setup": ["dataset experiment baseline metric evaluation setup", "dữ liệu thí nghiệm baseline chỉ số đánh giá thiết lập"],
    "results_tradeoffs": ["result accuracy performance ablation latency trade-off", "kết quả độ chính xác hiệu năng đánh đổi ablation tốc độ"],
    "scalability_limitations": ["scalability limitation future work deployment risk", "khả năng mở rộng hạn chế hướng nghiên cứu triển khai rủi ro"],
    "contribution": ["contribution novelty impact value", "đóng góp tính mới tác động giá trị"],
    "clarity": ["clarity explanation structure readable", "rõ ràng giải thích cấu trúc dễ hiểu"],
    "relevance": ["relevance objective scope topic", "liên quan mục tiêu phạm vi chủ đề"],
    "practical_value": ["practical value application usefulness", "giá trị thực tiễn ứng dụng hữu ích"],
    "limitations": ["limitation weakness threat validity", "hạn chế điểm yếu rủi ro độ tin cậy"],
    "complexity": ["complexity computation resource memory latency", "độ phức tạp tính toán tài nguyên bộ nhớ độ trễ"],
    "dependencies": ["dependency requirement library model infrastructure", "phụ thuộc yêu cầu thư viện mô hình hạ tầng"],
    "deployment_risk": ["deployment risk production security reliability", "triển khai rủi ro production bảo mật ổn định"],
    "scalability": ["scalability scale throughput users data", "khả năng mở rộng quy mô thông lượng người dùng dữ liệu"],
    "cost": ["cost compute price resource operation", "chi phí tính toán giá tài nguyên vận hành"],
    "research_gap": ["research gap open problem prior work", "khoảng trống nghiên cứu vấn đề mở công trình trước"],
    "novelty": ["novelty new contribution difference", "tính mới đóng góp khác biệt"],
    "assumptions": ["assumption premise condition setting", "giả định tiền đề điều kiện thiết lập"],
    "disagreement": ["disagreement contradiction conflict inconsistent", "bất đồng mâu thuẫn trái ngược không nhất quán"],
    "future_work": ["future work extension next research", "hướng nghiên cứu tiếp theo mở rộng tương lai"],
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
            .select("id, content, page_start, page_end, embedding")
            .eq("document_id", document_id)
            .limit(500)
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



def _parse_vector(value: Any) -> list[float] | None:
    if value is None:
        return None
    if isinstance(value, list):
        try:
            return [float(item) for item in value]
        except (TypeError, ValueError):
            return None
    text = str(value).strip()
    if not text:
        return None
    try:
        parsed = json.loads(text)
        if isinstance(parsed, list):
            return [float(item) for item in parsed]
    except Exception:
        return None
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
    hits = sum(1 for term in set(terms) if term in content)
    density = min(0.25, sum(content.count(term) for term in set(terms)) / max(len(content.split()), 1))
    return max(0.0, min(1.0, (hits / max(len(set(terms)), 1)) * 0.75 + density))


def _criterion_query(criterion: dict[str, str]) -> str:
    key = criterion.get("key") or ""
    queries = CRITERION_QUERIES.get(key) or []
    return " ".join([*queries, criterion.get("label") or "", criterion.get("subquestions") or ""]).strip()


def _normalize_evidence(document: dict[str, Any], chunk: dict[str, Any], score: float | None) -> dict[str, Any] | None:
    snippet = _clean_text(chunk.get("content"), 900)
    page = chunk.get("page_number") or chunk.get("page_start") or chunk.get("page")
    if not snippet or page in (None, "") or score is None:
        return None
    try:
        numeric_page = int(page)
    except (TypeError, ValueError):
        numeric_page = page
    return {
        "document_id": str(document.get("id") or ""),
        "document_title": document.get("title") or document.get("filename") or "Tài liệu",
        "page": numeric_page,
        "section": chunk.get("section") or "Không rõ section",
        "snippet": snippet,
        "score": round(max(0.0, min(float(score), 1.0)), 4),
    }


async def retrieve_evidence_for_criterion(document_ref: dict[str, Any] | dict[str, str], criterion: dict[str, str] | str, top_k: int = EVIDENCE_TOP_K) -> list[dict[str, Any]]:
    """Retrieve per-criterion evidence without fabricating citations.

    System-library chunks may have pgvector embeddings, so we embed the criterion query and
    rank locally by cosine similarity. Uploaded temp docs do not persist embeddings; for those
    we use keyword scoring over extracted chunks as an explicit fallback.
    """
    document = document_ref if isinstance(document_ref, dict) and document_ref.get("chunks") else resolve_document(document_ref)  # type: ignore[arg-type]
    if isinstance(criterion, str):
        criterion_obj = {"key": criterion, **CRITERIA_CATALOG.get(criterion, {"label": _fallback_criterion_label(criterion), "subquestions": criterion})}
    else:
        criterion_obj = criterion
    query = _criterion_query(criterion_obj)
    chunks = [chunk for chunk in (document.get("chunks") or []) if _clean_text(chunk.get("content"))]
    if not chunks:
        return []

    query_vector: list[float] | None = None
    if document.get("source_type") == "system_library" and any(chunk.get("embedding") for chunk in chunks):
        try:
            query_vector = await embed_query(query)
        except Exception as exc:
            logger.info("Cross-analysis criterion embedding unavailable; falling back to keyword ranking: %s", exc)

    ranked: list[tuple[float, dict[str, Any]]] = []
    for chunk in chunks:
        score = _cosine_similarity(query_vector, _parse_vector(chunk.get("embedding"))) if query_vector else None
        if score is None:
            score = _keyword_score(chunk.get("content") or "", query)
        if score > 0:
            ranked.append((score, chunk))

    ranked.sort(key=lambda item: item[0], reverse=True)
    evidence: list[dict[str, Any]] = []
    seen = set()
    for score, chunk in ranked:
        normalized = _normalize_evidence(document, chunk, score)
        if not normalized:
            continue
        dedupe_key = (normalized["page"], normalized["snippet"][:120])
        if dedupe_key in seen:
            continue
        seen.add(dedupe_key)
        evidence.append(normalized)
        if len(evidence) >= top_k:
            break
    return evidence


def _confidence_from_evidence(evidence_a: list[dict[str, Any]], evidence_b: list[dict[str, Any]]) -> tuple[float | None, dict[str, Any]]:
    valid_a = [item for item in evidence_a if _coerce_score(item.get("score")) is not None and item.get("snippet") and item.get("page") is not None]
    valid_b = [item for item in evidence_b if _coerce_score(item.get("score")) is not None and item.get("snippet") and item.get("page") is not None]
    scores = [_coerce_score(item.get("score")) for item in [*valid_a, *valid_b]]
    scores = [score for score in scores if score is not None]
    warnings: list[str] = []
    if not valid_a:
        warnings.append("Không tìm thấy đoạn trực tiếp trong tài liệu A.")
    if not valid_b:
        warnings.append("Không tìm thấy đoạn trực tiếp trong tài liệu B.")
    if not valid_a and not valid_b:
        return None, {"reason": "Không tìm thấy đủ bằng chứng từ hai tài liệu.", "evidence_count_a": 0, "evidence_count_b": 0, "avg_score": None, "warnings": warnings}
    if not scores:
        return None, {"reason": "Có đoạn liên quan nhưng không có điểm truy xuất hợp lệ.", "evidence_count_a": len(valid_a), "evidence_count_b": len(valid_b), "avg_score": None, "warnings": warnings}
    avg_score = sum(scores) / len(scores)
    if not valid_a or not valid_b:
        confidence = min(avg_score, 0.45)
        reason = "Chỉ tìm thấy bằng chứng từ một tài liệu nên độ tin cậy bị giới hạn."
    else:
        balance_factor = min(len(valid_a), len(valid_b)) / max(len(valid_a), len(valid_b), 1)
        count_factor = min((len(valid_a) + len(valid_b)) / (EVIDENCE_TOP_K * 2), 1)
        confidence = avg_score * (0.75 + 0.15 * balance_factor + 0.10 * count_factor)
        reason = "Có bằng chứng từ cả hai tài liệu với điểm truy xuất phù hợp."
        if len(valid_a) == 1 or len(valid_b) == 1:
            warnings.append("Chỉ có 1 đoạn hỗ trợ ở một phía; nên đọc lại nguồn.")
    return round(max(0.0, min(confidence, 1.0)), 4), {"reason": reason, "evidence_count_a": len(valid_a), "evidence_count_b": len(valid_b), "avg_score": round(avg_score, 4), "warnings": warnings}


def _infer_language(document: dict[str, Any]) -> str:
    text = _clean_text((document.get("summary") or "") + " " + _document_preview(document.get("chunks") or [])[:2000]).lower()
    vi_marks = len(re.findall(r"[àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ]", text))
    en_words = len(re.findall(r"\b(the|and|of|for|with|method|result|study|paper)\b", text))
    return "vi" if vi_marks > max(3, en_words // 2) else "en"


def _doc_kind(document: dict[str, Any]) -> str:
    title = _clean_text(f"{document.get('title')} {document.get('filename')} {document.get('file_type')}").lower()
    preview = _document_preview(document.get("chunks") or [])[:5000].lower()
    haystack = f"{title} {preview}"
    if any(word in haystack for word in ["slide", "ppt", "powerpoint"]):
        return "slide"
    if any(word in haystack for word in ["proposal", "đề cương"]):
        return "proposal"
    if any(word in haystack for word in ["report", "báo cáo"]):
        return "report"
    if any(word in haystack for word in ["abstract", "method", "references", "doi", "journal", "conference"]):
        return "paper"
    return "document"


def _topic_terms(document: dict[str, Any]) -> set[str]:
    text = _clean_text(f"{document.get('title')} {document.get('summary')} {_document_preview(document.get('chunks') or [])[:2500]}").lower()
    stop = {"the", "and", "for", "with", "this", "that", "from", "document", "paper", "nghiên", "cứu", "phương", "pháp", "trong", "các", "một", "những", "tài", "liệu"}
    return {term for term in re.split(r"\W+", text) if len(term) >= 5 and term not in stop}


def _preflight_check(doc_a: dict[str, Any], doc_b: dict[str, Any], selected: list[dict[str, str]], evidence_map: dict[str, dict[str, list[dict[str, Any]]]] | None = None) -> dict[str, Any]:
    warnings: list[str] = []
    chunks_a = [c for c in doc_a.get("chunks") or [] if _clean_text(c.get("content"))]
    chunks_b = [c for c in doc_b.get("chunks") or [] if _clean_text(c.get("content"))]
    if len(chunks_a) < 3:
        warnings.append("Tài liệu A có ít nội dung trích xuất, kết quả có thể kém tin cậy.")
    if len(chunks_b) < 3:
        warnings.append("Tài liệu B có ít nội dung trích xuất, kết quả có thể kém tin cậy.")
    lang_a, lang_b = _infer_language(doc_a), _infer_language(doc_b)
    if lang_a != lang_b:
        warnings.append("Hai tài liệu có vẻ khác ngôn ngữ; diễn giải so sánh có thể lệch ngữ cảnh.")
    kind_a, kind_b = _doc_kind(doc_a), _doc_kind(doc_b)
    if kind_a != kind_b and "document" not in {kind_a, kind_b}:
        warnings.append(f"Hai tài liệu có vẻ không cùng loại: A là {kind_a}, B là {kind_b}.")
    terms_a, terms_b = _topic_terms(doc_a), _topic_terms(doc_b)
    if terms_a and terms_b and len(terms_a & terms_b) / max(min(len(terms_a), len(terms_b)), 1) < 0.08:
        warnings.append("Hai tài liệu có vẻ khác chủ đề/lĩnh vực; nên xem kết quả như gợi ý đối chiếu sơ bộ.")
    if evidence_map:
        missing = [item.get("label") or item.get("key") for item in selected if not evidence_map.get(item["key"], {}).get("a") or not evidence_map.get(item["key"], {}).get("b")]
        if missing:
            warnings.append("Một số tiêu chí chưa có đủ chunks ở cả hai tài liệu: " + ", ".join(missing[:4]) + ("…" if len(missing) > 4 else ""))
    return {"warnings": warnings, "can_compare": bool(chunks_a and chunks_b)}

def _selected_criteria(criteria: list[str] | None) -> list[dict[str, str]]:
    selected: list[dict[str, str]] = []
    raw_items = criteria or []
    for raw in raw_items:
        key = _clean_text(str(raw or ""))
        if not key:
            continue
        if key in CRITERIA_CATALOG:
            selected.append({"key": key, **CRITERIA_CATALOG[key]})
        else:
            label = _fallback_criterion_label(key)
            selected.append({"key": key, "label": label, "subquestions": key})
    if not selected:
        default_keys = ["problem_motivation", "methodology", "datasets_experimental_setup", "results_tradeoffs", "scalability_limitations"]
        selected = [{"key": key, **CRITERIA_CATALOG[key]} for key in default_keys]
    return selected


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
    evidence_map: dict[str, dict[str, list[dict[str, Any]]]] = {}
    for criterion in selected:
        evidence_a, evidence_b = await asyncio.gather(
            retrieve_evidence_for_criterion(doc_a, criterion),
            retrieve_evidence_for_criterion(doc_b, criterion),
        )
        evidence_map[criterion["key"]] = {"a": evidence_a, "b": evidence_b}

    preflight = _preflight_check(doc_a, doc_b, selected, evidence_map)
    if not preflight.get("can_compare"):
        return {
            "comparison_table": [],
            "summary": "Không đủ nội dung/chunks để đối chiếu hai tài liệu.",
            "quick_conclusion": {
                "summary": "Không đủ dữ liệu để so sánh sâu.",
                "similarities": [],
                "key_differences": [],
                "notable_conflicts": [],
                "recommended_reading_order": "Cần bổ sung/tải lại tài liệu có text trích xuất được.",
                "needs_verification": preflight.get("warnings") or [],
            },
            "warnings": preflight.get("warnings") or [],
            "preflight": preflight,
            "citations": [],
            "documents": {"a": _public_document(doc_a), "b": _public_document(doc_b)},
        }

    criteria_payload = []
    for item in selected:
        key = item["key"]
        evidence_a = evidence_map.get(key, {}).get("a", [])
        evidence_b = evidence_map.get(key, {}).get("b", [])
        confidence, confidence_basis = _confidence_from_evidence(evidence_a, evidence_b)
        criteria_payload.append({
            "criterion": key,
            "criterion_label": item.get("label") or _fallback_criterion_label(key),
            "subquestions": item.get("subquestions") or "",
            "evidence_a": evidence_a,
            "evidence_b": evidence_b,
            "computed_confidence": confidence,
            "confidence_basis": confidence_basis,
        })

    payload = await _llm_json(
        "Bạn là chuyên gia phản biện học thuật. Chỉ trả JSON hợp lệ, không markdown. Không tạo citation/bằng chứng mới; chỉ diễn giải từ evidence đã cung cấp.",
        f"""
So sánh hai tài liệu theo từng tiêu chí dựa DUY NHẤT trên evidence_a/evidence_b đã truy xuất. Nếu một phía thiếu evidence, ghi rõ thiếu thông tin. Không tự bịa trang, citation hoặc điểm score.

Tài liệu A: {doc_a.get('title')} ({doc_a.get('filename')})
Tài liệu B: {doc_b.get('title')} ({doc_b.get('filename')})
Preflight warnings: {json.dumps(preflight.get('warnings') or [], ensure_ascii=False)}

Criteria/evidence JSON:
{json.dumps(criteria_payload, ensure_ascii=False)}

Trả JSON dạng:
{{
  "comparison_table": [
    {{"criterion":"methodology","document_a":"nhận định ngắn từ evidence A hoặc thiếu thông tin","document_b":"nhận định ngắn từ evidence B hoặc thiếu thông tin","analysis":"nhận xét đối chiếu","status":"similar|different|conflict|missing_information|needs_review"}}
  ],
  "summary":"tóm tắt ngắn",
  "quick_conclusion":{{"summary":"...","similarities":[],"key_differences":[],"notable_conflicts":[],"recommended_reading_order":"...","needs_verification":[]}},
  "warnings":[]
}}
""".strip(),
    )

    llm_rows = payload.get("comparison_table") if isinstance(payload.get("comparison_table"), list) else []
    llm_by_key: dict[str, dict[str, Any]] = {}
    for row in llm_rows:
        if not isinstance(row, dict):
            continue
        key = _clean_text(row.get("criterion"))
        llm_by_key[key] = row

    comparison_table: list[dict[str, Any]] = []
    allowed_status = {"similar", "different", "conflict", "missing_information", "needs_review"}
    for item in criteria_payload:
        key = item["criterion"]
        row = llm_by_key.get(key) or next((value for value in llm_rows if isinstance(value, dict) and value.get("criterion_label") == item["criterion_label"]), {})
        confidence = item["computed_confidence"]
        confidence_basis = item["confidence_basis"]
        status_value = row.get("status") if isinstance(row, dict) else None
        if status_value not in allowed_status:
            status_value = "missing_information" if confidence is None or confidence < 0.45 else "needs_review"
        comparison_table.append({
            "criterion": key,
            "criterion_label": item["criterion_label"],
            "document_a": _clean_text(row.get("document_a") if isinstance(row, dict) else "", 1200) or ("Không tìm thấy bằng chứng trực tiếp." if not item["evidence_a"] else "Có bằng chứng liên quan; cần đọc snippet để diễn giải."),
            "document_b": _clean_text(row.get("document_b") if isinstance(row, dict) else "", 1200) or ("Không tìm thấy bằng chứng trực tiếp." if not item["evidence_b"] else "Có bằng chứng liên quan; cần đọc snippet để diễn giải."),
            "analysis": _clean_text(row.get("analysis") if isinstance(row, dict) else "", 1600) or confidence_basis.get("reason"),
            "evidence_a": item["evidence_a"],
            "evidence_b": item["evidence_b"],
            "confidence": confidence,
            "confidence_basis": confidence_basis,
            "status": status_value,
        })

    quick_conclusion = payload.get("quick_conclusion") if isinstance(payload.get("quick_conclusion"), dict) else {}
    if not quick_conclusion:
        needs = [row["criterion_label"] for row in comparison_table if row["status"] in {"missing_information", "needs_review"}]
        quick_conclusion = {
            "summary": payload.get("summary") or "Đã đối chiếu hai tài liệu theo các tiêu chí đã chọn với bằng chứng theo từng dòng.",
            "similarities": [row["criterion_label"] for row in comparison_table if row["status"] == "similar"][:3],
            "key_differences": [row["criterion_label"] for row in comparison_table if row["status"] == "different"][:3],
            "notable_conflicts": [row["criterion_label"] for row in comparison_table if row["status"] == "conflict"][:3],
            "recommended_reading_order": "Ưu tiên đọc tài liệu có evidence/confidence cao hơn ở tiêu chí quan trọng nhất với mục tiêu của bạn.",
            "needs_verification": needs[:5],
        }

    return {
        "comparison_table": comparison_table,
        "summary": payload.get("summary") or quick_conclusion.get("summary") or "",
        "quick_conclusion": quick_conclusion,
        "warnings": [*(preflight.get("warnings") or []), *(payload.get("warnings") or [])],
        "preflight": preflight,
        "citations": [],
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


async def chat_about_documents(document_a_ref: dict[str, Any], document_b_ref: dict[str, Any], message: str, chat_history: list[dict[str, str]] | None = None, selected_row: dict[str, Any] | None = None) -> dict[str, Any]:
    doc_a = resolve_document(document_a_ref)
    doc_b = resolve_document(document_b_ref)
    history = "\n".join(f"{item.get('role')}: {item.get('content')}" for item in (chat_history or [])[-6:])
    row_context = ""
    if selected_row:
        row_context = "\n\nDòng đang được hỏi (ưu tiên ngữ cảnh này, chỉ dùng evidence_a/evidence_b có sẵn):\n" + json.dumps(selected_row, ensure_ascii=False)[:9000]
    try:
        response = await client.chat.completions.create(
            model=GROQ_MODEL,
            messages=[
                {"role": "system", "content": "Bạn trả lời câu hỏi chỉ dựa trên hai tài liệu A/B đang so sánh. Khi dùng thông tin từ tài liệu, ghi rõ [A] hoặc [B]."},
                {"role": "user", "content": f"{_context_block('Tài liệu A', doc_a)}\n\n{_context_block('Tài liệu B', doc_b)}{row_context}\n\nLịch sử:\n{history}\n\nCâu hỏi: {message}"},
            ],
            temperature=0.25,
        )
    except Exception as exc:
        logger.exception("Cross-analysis chat LLM call failed")
        raise HTTPException(status_code=502, detail={"code": "LLM_FAILED", "message": "Không thể gọi AI để trả lời chat so sánh."}) from exc
    return {"answer": response.choices[0].message.content or "", "citations": _citation_seed(doc_a, doc_b)}



def _user_id(user: dict[str, Any] | str | None) -> str | None:
    if isinstance(user, str):
        return user
    if not isinstance(user, dict):
        return None
    return str(user.get("id") or user.get("sub") or user.get("user_id") or "") or None


def _session_public(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": row.get("id"),
        "user_id": row.get("user_id"),
        "title": row.get("title"),
        "document_a_ref": row.get("document_a_ref"),
        "document_b_ref": row.get("document_b_ref"),
        "selected_preset": row.get("selected_preset"),
        "selected_criteria": row.get("selected_criteria") or [],
        "comparison_result": row.get("comparison_result"),
        "chat_history": row.get("chat_history") or [],
        "created_at": row.get("created_at"),
        "updated_at": row.get("updated_at"),
    }


def create_cross_analysis_session(payload: dict[str, Any], user: dict[str, Any] | None = None) -> dict[str, Any]:
    now = datetime.now(timezone.utc).isoformat()
    user_id = _user_id(user)
    row = {
        "id": str(uuid4()),
        "user_id": user_id,
        "title": _clean_text(payload.get("title"), 200) or "Phiên đối chiếu tài liệu",
        "document_a_ref": payload.get("document_a_ref") or payload.get("document_a"),
        "document_b_ref": payload.get("document_b_ref") or payload.get("document_b"),
        "selected_preset": payload.get("selected_preset") or "custom",
        "selected_criteria": payload.get("selected_criteria") or payload.get("criteria") or [],
        "comparison_result": payload.get("comparison_result"),
        "chat_history": payload.get("chat_history") or [],
        "created_at": now,
        "updated_at": now,
    }
    try:
        resp = supabase.table("cross_analysis_sessions").insert(row).execute()
        data, error = _supabase_response_data(resp)
        if error:
            raise RuntimeError(error)
        saved = data[0] if isinstance(data, list) and data else row
    except Exception as exc:
        logger.info("Cross-analysis sessions table unavailable; using in-memory store: %s", exc)
        SESSION_STORE[row["id"]] = row
        saved = row
    return _session_public(saved)


def list_cross_analysis_sessions(user: dict[str, Any] | None = None) -> list[dict[str, Any]]:
    user_id = _user_id(user)
    try:
        query = supabase.table("cross_analysis_sessions").select("*").order("updated_at", desc=True).limit(30)
        if user_id:
            query = query.eq("user_id", user_id)
        resp = query.execute()
        data, error = _supabase_response_data(resp)
        if error:
            raise RuntimeError(error)
        return [_session_public(row) for row in (data or [])]
    except Exception as exc:
        logger.info("List cross-analysis sessions fallback: %s", exc)
        rows = [row for row in SESSION_STORE.values() if not user_id or row.get("user_id") == user_id]
        rows.sort(key=lambda row: row.get("updated_at") or "", reverse=True)
        return [_session_public(row) for row in rows[:30]]


def get_cross_analysis_session(session_id: str, user: dict[str, Any] | None = None) -> dict[str, Any]:
    user_id = _user_id(user)
    try:
        query = supabase.table("cross_analysis_sessions").select("*").eq("id", session_id)
        if user_id:
            query = query.eq("user_id", user_id)
        resp = query.single().execute()
        data, error = _supabase_response_data(resp)
        if error or not data:
            raise KeyError(session_id)
        return _session_public(data)
    except Exception:
        row = SESSION_STORE.get(session_id)
        if not row or (user_id and row.get("user_id") != user_id):
            raise HTTPException(status_code=404, detail={"code": "SESSION_NOT_FOUND", "message": "Không tìm thấy phiên so sánh."})
        return _session_public(row)


def update_cross_analysis_session(session_id: str, payload: dict[str, Any], user: dict[str, Any] | None = None) -> dict[str, Any]:
    allowed = {"title", "document_a_ref", "document_b_ref", "selected_preset", "selected_criteria", "comparison_result", "chat_history"}
    updates = {key: value for key, value in payload.items() if key in allowed}
    updates["updated_at"] = datetime.now(timezone.utc).isoformat()
    user_id = _user_id(user)
    try:
        query = supabase.table("cross_analysis_sessions").update(updates).eq("id", session_id)
        if user_id:
            query = query.eq("user_id", user_id)
        resp = query.execute()
        data, error = _supabase_response_data(resp)
        if error:
            raise RuntimeError(error)
        if isinstance(data, list) and data:
            return _session_public(data[0])
    except Exception as exc:
        logger.info("Update cross-analysis session fallback: %s", exc)
    row = SESSION_STORE.get(session_id)
    if not row or (user_id and row.get("user_id") != user_id):
        raise HTTPException(status_code=404, detail={"code": "SESSION_NOT_FOUND", "message": "Không tìm thấy phiên so sánh."})
    row.update(updates)
    return _session_public(row)


def delete_cross_analysis_session(session_id: str, user: dict[str, Any] | None = None) -> dict[str, Any]:
    user_id = _user_id(user)
    try:
        query = supabase.table("cross_analysis_sessions").delete().eq("id", session_id)
        if user_id:
            query = query.eq("user_id", user_id)
        query.execute()
    except Exception as exc:
        logger.info("Delete cross-analysis session fallback: %s", exc)
    row = SESSION_STORE.get(session_id)
    if row and (not user_id or row.get("user_id") == user_id):
        SESSION_STORE.pop(session_id, None)
    return {"deleted": True}
