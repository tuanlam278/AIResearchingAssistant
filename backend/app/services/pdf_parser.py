#Ver 1
# services/pdf_parser.py
from typing import List, Dict
import io
import pdfplumber


def parse_pdf(file_bytes: bytes) -> List[Dict]:
    """
    Parse a PDF from bytes and return a list of pages with retained page numbers.

    Args:
        file_bytes: Raw bytes of the PDF file.

    Returns:
        List of dicts in the format:
            [{"page_number": int, "content": str}, ...]
        Page numbers are 1-based to match typical PDF page numbering.
    """
    pages: List[Dict] = []

    with pdfplumber.open(io.BytesIO(file_bytes)) as pdf:
        for i, page in enumerate(pdf.pages, start=1):
            try:
                text = page.extract_text() or ""
            except Exception:
                # If extraction fails for a page, record empty content but keep page number
                text = ""
            # Normalize whitespace: strip leading/trailing and preserve internal spacing
            content = text.strip()
            pages.append({"page_number": i, "content": content})

    return pages
