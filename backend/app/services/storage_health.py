"""Supabase Storage configuration checks used at startup and by upload flows."""
from __future__ import annotations

import logging
from typing import Iterable

from app.config import settings
from app.db.supabase_client import supabase

logger = logging.getLogger(__name__)


def configured_storage_buckets() -> dict[str, str]:
    return {
        "notebook_source": settings.NOTEBOOK_STORAGE_BUCKET,
        "indexing_storage": settings.INDEXING_STORAGE_BUCKET,
        "system_library": settings.SYSTEM_LIBRARY_STORAGE_BUCKET,
        "community_library": settings.COMMUNITY_LIBRARY_STORAGE_BUCKET,
        "avatar": settings.AVATAR_STORAGE_BUCKET,
    }


def _bucket_name(bucket: object) -> str:
    if isinstance(bucket, dict):
        return str(bucket.get("name") or bucket.get("id") or "")
    return str(getattr(bucket, "name", None) or getattr(bucket, "id", None) or "")


def check_supabase_storage_buckets(required_roles: Iterable[str] = ("notebook_source", "indexing_storage")) -> None:
    """Log missing Supabase buckets without failing application startup."""
    configured = configured_storage_buckets()
    missing_config = [role for role in required_roles if not configured.get(role)]
    if missing_config:
        logger.warning("Supabase Storage bucket env missing for roles: %s", ", ".join(missing_config))

    names_to_check = sorted({configured[role] for role in required_roles if configured.get(role)})
    if not names_to_check:
        return

    try:
        buckets = supabase.storage.list_buckets()
        existing = {_bucket_name(bucket) for bucket in (buckets or [])}
    except Exception as exc:
        logger.warning("Could not verify Supabase Storage buckets at startup: %s", exc)
        return

    for bucket in names_to_check:
        if bucket not in existing:
            logger.warning(
                "Supabase Storage bucket %r is configured but does not exist. Create it as a private bucket or update NOTEBOOK_STORAGE_BUCKET/INDEXING_STORAGE_BUCKET.",
                bucket,
            )
