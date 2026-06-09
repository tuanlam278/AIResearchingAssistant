"""Helpers for preserving uploaded filenames across multipart/client encodings."""
from __future__ import annotations

import re
import unicodedata


def normalize_upload_filename(filename: str | None, fallback: str = "uploaded-document") -> str:
    """Return a display-safe filename, repairing common UTF-8-as-latin1 mojibake.

    Some browser/proxy multipart paths expose non-ASCII names like Vietnamese text
    as latin1-decoded bytes. Re-decoding those bytes as UTF-8 restores names such
    as ``Tài liệu.pdf`` before extension checks, parsing, and DB metadata writes.
    """

    value = str(filename or "").strip().replace("\x00", "")
    if not value:
        return fallback

    repaired = value
    if any(ch in value for ch in ("Ã", "Â", "Ä", "Æ", "�")):
        try:
            repaired = value.encode("latin1").decode("utf-8")
        except (UnicodeEncodeError, UnicodeDecodeError):
            repaired = value

    normalized = unicodedata.normalize("NFC", repaired).strip().replace("\x00", "")
    return normalized or fallback


def storage_safe_filename(filename: str | None, fallback: str = "document") -> str:
    """Return an ASCII object-key-safe filename for Supabase Storage.

    Supabase Storage rejects some unicode object keys with `InvalidKey`. Keep the
    human-readable name in database metadata, but use this slug for bucket paths.
    """

    value = normalize_upload_filename(filename, fallback=fallback)
    value = value.replace("/", " ").replace("\\", " ").strip(" .")
    if not value:
        value = fallback

    stem, dot, ext = value.rpartition(".")
    if not stem:
        stem, ext = value, ""
    ext = ext.lower() if dot and ext else ""

    ascii_stem = unicodedata.normalize("NFKD", stem).encode("ascii", "ignore").decode("ascii")
    ascii_stem = re.sub(r"[^A-Za-z0-9._-]+", "-", ascii_stem).strip(".-_")
    ascii_stem = re.sub(r"-+", "-", ascii_stem) or fallback

    ascii_ext = re.sub(r"[^A-Za-z0-9]+", "", ext)[:16]
    return f"{ascii_stem[:160]}.{ascii_ext}" if ascii_ext else ascii_stem[:180]
