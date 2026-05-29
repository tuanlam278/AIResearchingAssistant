import io
import logging
from pathlib import Path
from typing import Any, Dict, List


from app.services.pdf_parser import parse_pdf

logger = logging.getLogger(__name__)

SUPPORTED_TEXT_EXTENSIONS = {".pdf", ".docx", ".txt", ".md"}
ACCEPTED_UPLOAD_EXTENSIONS = SUPPORTED_TEXT_EXTENSIONS | {".doc", ".rtf"}


class UnsupportedDocumentType(ValueError):
    """Raised when the uploaded file type is intentionally not indexed."""


class EmptyDocumentText(ValueError):
    """Raised when parsing succeeds but no useful text is extracted."""


def get_file_extension(filename: str | None) -> str:
    return Path(filename or "").suffix.lower()


def get_file_type(filename: str | None) -> str:
    ext = get_file_extension(filename)
    return ext.lstrip(".") or "unknown"


def validate_research_file(filename: str | None) -> str:
    ext = get_file_extension(filename)
    if ext not in ACCEPTED_UPLOAD_EXTENSIONS:
        raise UnsupportedDocumentType("Định dạng file chưa được hỗ trợ. Vui lòng upload PDF, DOCX, TXT hoặc MD.")
    if ext == ".doc":
        raise UnsupportedDocumentType("File .doc cũ chưa được hỗ trợ. Vui lòng chuyển sang .docx hoặc PDF.")
    if ext == ".rtf":
        raise UnsupportedDocumentType("File .rtf chưa được hỗ trợ. Vui lòng chuyển sang DOCX, PDF, TXT hoặc MD.")
    return ext


def _ensure_non_empty(pages: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    text = "\n".join(str(page.get("content") or "").strip() for page in pages).strip()
    if not text:
        raise EmptyDocumentText("Không đọc được nội dung văn bản từ file này.")
    return pages


def _decode_text(contents: bytes) -> str:
    for encoding in ("utf-8", "utf-8-sig", "cp1258", "latin-1"):
        try:
            return contents.decode(encoding)
        except UnicodeDecodeError:
            continue
    return contents.decode("utf-8", errors="replace")


def _parse_text(contents: bytes) -> List[Dict[str, Any]]:
    text = _decode_text(contents).replace("\r\n", "\n").replace("\r", "\n").strip()
    return _ensure_non_empty([{"page_number": 1, "content": text}])


def _parse_docx(contents: bytes) -> List[Dict[str, Any]]:
    try:
        from docx import Document as DocxDocument
    except ImportError as exc:
        raise UnsupportedDocumentType("Máy chủ chưa cài python-docx để đọc DOCX.") from exc
    document = DocxDocument(io.BytesIO(contents))
    blocks: list[str] = []
    for paragraph in document.paragraphs:
        value = paragraph.text.strip()
        if value:
            blocks.append(value)
    for table in document.tables:
        for row in table.rows:
            cells = [cell.text.strip() for cell in row.cells if cell.text and cell.text.strip()]
            if cells:
                blocks.append(" | ".join(cells))
    return _ensure_non_empty([{"page_number": 1, "content": "\n\n".join(blocks)}])


async def parse_document(contents: bytes, filename: str | None) -> tuple[List[Dict[str, Any]], str]:
    """Parse a supported research document into chunker-compatible page dictionaries."""
    ext = validate_research_file(filename)
    if ext == ".pdf":
        return _ensure_non_empty(await parse_pdf(contents)), "pdf"
    if ext == ".docx":
        return _parse_docx(contents), "docx"
    if ext in {".txt", ".md"}:
        return _parse_text(contents), ext.lstrip(".")
    raise UnsupportedDocumentType("Định dạng file chưa được hỗ trợ. Vui lòng upload PDF, DOCX, TXT hoặc MD.")
