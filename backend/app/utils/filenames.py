"""Helpers for preserving uploaded filenames across multipart/client encodings."""
from __future__ import annotations

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
