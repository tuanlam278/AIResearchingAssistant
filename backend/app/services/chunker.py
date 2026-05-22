# app/services/chunker.py

from typing import Any, Dict, List

from langchain.text_splitter import RecursiveCharacterTextSplitter

# Fixed chunking configuration
CHUNK_SIZE = 500
CHUNK_OVERLAP = 50


def chunk_text(pages: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Split parsed PDF pages into semantic chunks using
    LangChain RecursiveCharacterTextSplitter.

    Chunking strategy:
    - chunk_size = 500
    - chunk_overlap = 50

    Input format:
        [
            {
                "page_number": int,
                "content": str
            },
            ...
        ]

    Output format:
        [
            {
                "chunk_index": int,
                "page_number": int,
                "content": str
            },
            ...
        ]

    Notes:
    - chunk_index is global across the entire document
    - page_number metadata is preserved for every chunk
    - empty pages are skipped safely
    - whitespace-only chunks are ignored

    Args:
        pages: Parsed PDF pages.

    Returns:
        Flattened list of chunk dictionaries.
    """

    splitter = RecursiveCharacterTextSplitter(
        chunk_size=CHUNK_SIZE,
        chunk_overlap=CHUNK_OVERLAP,
        separators=["\n\n", "\n", " ", ""],
    )

    chunks: List[Dict[str, Any]] = []
    chunk_index = 0

    for page in pages:
        page_number = int(page.get("page_number", 0))
        content = str(page.get("content", "")).strip()

        # Skip empty pages
        if not content:
            continue

        page_chunks = splitter.split_text(content)

        for chunk in page_chunks:
            cleaned_chunk = chunk.strip()

            # Skip empty chunk after cleaning
            if not cleaned_chunk:
                continue

            chunks.append(
                {
                    "chunk_index": chunk_index,
                    "page_number": page_number,
                    "content": cleaned_chunk,
                }
            )

            chunk_index += 1

    return chunks


