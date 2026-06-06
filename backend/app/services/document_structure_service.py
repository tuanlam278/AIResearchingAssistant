from __future__ import annotations

import re
from dataclasses import asdict, dataclass
from typing import Any, Iterable, Literal

BlockType = Literal["paragraph", "table", "equation", "figure_caption", "heading", "unknown"]
BlockSource = Literal["pymupdf", "pdfplumber", "camelot", "vision", "math_ocr", "docx", "text"]


@dataclass(slots=True)
class DocumentBlock:
    page: int
    block_index: int
    block_type: BlockType
    markdown: str
    text: str
    section: str | None = None
    bbox: list[float] | None = None
    confidence: float | None = None
    source: BlockSource | str = "pymupdf"
    document_id: str | None = None

    def to_dict(self) -> dict[str, Any]:
        payload = asdict(self)
        if self.document_id is None:
            payload.pop("document_id", None)
        return payload


_HEADING_RE = re.compile(
    r"^(?:[0-9]+(?:\.[0-9]+)*\s+|[IVX]+\.\s*)?"
    r"(abstract|introduction|related\s+work|literature\s+review|methodology|methods?|"
    r"proposed\s+(?:method|architecture|system)|experiments?|evaluation|results?|discussion|"
    r"conclusion|references|appendix)\b",
    re.IGNORECASE,
)
_CAPTION_RE = re.compile(r"^(fig(?:ure)?|table)\s*\d+\s*[:.\-]", re.IGNORECASE)
_EQUATION_HINT_RE = re.compile(r"(\\[a-zA-Z]+|\$\$?|[∑∫√∞≈≠≤≥±×÷∂∇]|\b(?:arg\s*max|arg\s*min)\b|[A-Za-z0-9)]\s*=\s*[-+*/^A-Za-z0-9(])")


def normalize_plain_text(markdown: str) -> str:
    """Keep readable text for embeddings while preserving non-fake math/table content."""
    text = str(markdown or "")
    text = text.replace("$$", " ").replace("$", " ")
    text = re.sub(r"^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$", " ", text, flags=re.MULTILINE)
    text = text.replace("|", " ")
    text = re.sub(r"[ \t]+", " ", text)
    return re.sub(r"\n{3,}", "\n\n", text).strip()


def classify_markdown_block(markdown: str) -> BlockType:
    value = str(markdown or "").strip()
    if not value:
        return "unknown"
    first_line = next((line.strip() for line in value.splitlines() if line.strip()), "")
    if first_line.startswith("#") or (_HEADING_RE.match(first_line) and len(first_line.split()) <= 12):
        return "heading"
    if _looks_like_markdown_table(value):
        return "table"
    if value.startswith("$$") or value.endswith("$$") or (len(value.splitlines()) <= 4 and _EQUATION_HINT_RE.search(value)):
        return "equation"
    if _CAPTION_RE.match(first_line):
        return "figure_caption"
    return "paragraph"


def _looks_like_markdown_table(value: str) -> bool:
    lines = [line.strip() for line in value.splitlines() if line.strip()]
    if len(lines) < 2:
        return False
    pipe_lines = [line for line in lines if "|" in line]
    if len(pipe_lines) < 2:
        return False
    return any(re.search(r"\|?\s*:?-{3,}:?\s*\|", line) for line in pipe_lines[:3])


def blocks_to_page_markdown(blocks: Iterable[DocumentBlock]) -> str:
    return "\n\n".join(block.markdown.strip() for block in blocks if block.markdown and block.markdown.strip()).strip()


def blocks_to_page(page: int, blocks: list[DocumentBlock]) -> dict[str, Any]:
    markdown = blocks_to_page_markdown(blocks)
    return {
        "page_number": page,
        "page": page,
        "content": markdown,
        "markdown": markdown,
        "plain_text": normalize_plain_text(markdown),
        "blocks": [block.to_dict() for block in blocks],
    }


def build_blocks_from_markdown(page: int, markdown: str, *, source: str = "text", section: str | None = None) -> list[DocumentBlock]:
    """Best-effort block structure for legacy flat parsers and Vision Markdown."""
    parts = [part.strip() for part in re.split(r"\n\s*\n", str(markdown or "")) if part.strip()]
    blocks: list[DocumentBlock] = []
    current_section = section
    for part in parts:
        block_type = classify_markdown_block(part)
        if block_type == "heading":
            current_section = part.lstrip("#").strip()[:180]
        blocks.append(
            DocumentBlock(
                page=page,
                block_index=len(blocks),
                block_type=block_type,
                section=current_section,
                markdown=part,
                text=normalize_plain_text(part),
                bbox=None,
                confidence=None,
                source=source,
            )
        )
    return blocks


def structure_flat_pages(pages: list[dict[str, Any]], *, source: str = "text") -> list[dict[str, Any]]:
    structured: list[dict[str, Any]] = []
    current_section: str | None = None
    for index, page in enumerate(pages, start=1):
        page_number = int(page.get("page_number") or page.get("page") or index)
        markdown = str(page.get("markdown") or page.get("content") or "").strip()
        blocks = build_blocks_from_markdown(page_number, markdown, source=str(page.get("source") or source), section=current_section)
        if blocks:
            current_section = blocks[-1].section
        structured.append(blocks_to_page(page_number, blocks))
    return structured


def page_blocks(pages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for page in pages:
        for block in page.get("blocks") or []:
            rows.append(block)
    return rows
