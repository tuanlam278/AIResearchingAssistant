from __future__ import annotations

import logging
from typing import Any

from app.services.document_structure_service import DocumentBlock, normalize_plain_text

logger = logging.getLogger(__name__)


def _clean_cell(value: Any) -> str:
    text = " ".join(str(value or "").replace("\r", "\n").split())
    return text.replace("|", "\\|").strip()


def _row_has_content(row: list[Any]) -> bool:
    return any(str(cell or "").strip() for cell in row)


def _is_probable_header(row: list[str]) -> bool:
    if not row or not any(row):
        return False
    non_empty = [cell for cell in row if cell]
    alpha = sum(1 for cell in non_empty if any(ch.isalpha() for ch in cell))
    return bool(non_empty and alpha >= max(1, len(non_empty) // 2))


def table_to_markdown(table: list[list[Any]]) -> str:
    rows = [[_clean_cell(cell) for cell in row] for row in table if _row_has_content(row)]
    if not rows:
        return ""
    width = max(len(row) for row in rows)
    rows = [row + [""] * (width - len(row)) for row in rows]
    if _is_probable_header(rows[0]):
        header = rows[0]
        body = rows[1:]
    else:
        header = [f"Column {index}" for index in range(1, width + 1)]
        body = rows
    sep = ["---"] * width
    markdown_rows = ["| " + " | ".join(header) + " |", "| " + " | ".join(sep) + " |"]
    markdown_rows.extend("| " + " | ".join(row) + " |" for row in body)
    return "\n".join(markdown_rows).strip()


def extract_tables_with_pdfplumber(file_bytes: bytes) -> dict[int, list[DocumentBlock]]:
    """Extract text-native PDF tables locally. Never raises to callers."""
    try:
        import io
        import pdfplumber
    except ImportError:
        logger.warning("pdfplumber is not installed; PDF table extraction will use text-only parsing.")
        return {}

    tables_by_page: dict[int, list[DocumentBlock]] = {}
    try:
        with pdfplumber.open(io.BytesIO(file_bytes)) as pdf:
            for page_number, page in enumerate(pdf.pages, start=1):
                page_blocks: list[DocumentBlock] = []
                try:
                    table_objects = page.find_tables() or []
                except Exception as exc:
                    logger.warning("pdfplumber table detection failed on page %s: %s", page_number, exc)
                    table_objects = []
                for table_obj in table_objects:
                    try:
                        raw_table = table_obj.extract() or []
                        markdown = table_to_markdown(raw_table)
                        if not markdown:
                            continue
                        bbox = [float(v) for v in table_obj.bbox] if getattr(table_obj, "bbox", None) else None
                        page_blocks.append(
                            DocumentBlock(
                                page=page_number,
                                block_index=0,
                                block_type="table",
                                section=None,
                                markdown=markdown,
                                text=normalize_plain_text(markdown),
                                bbox=bbox,
                                confidence=None,
                                source="pdfplumber",
                            )
                        )
                    except Exception as exc:
                        logger.warning("pdfplumber table extraction failed on page %s: %s", page_number, exc)
                if page_blocks:
                    tables_by_page[page_number] = page_blocks
    except Exception as exc:
        logger.warning("pdfplumber could not open PDF for table extraction: %s", exc)
    return tables_by_page
