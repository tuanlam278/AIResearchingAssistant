"""User activity logging helpers."""
from __future__ import annotations

from typing import Any
from uuid import UUID

from app.db.supabase_client import supabase


def _supabase_response_data(resp: Any):
    if isinstance(resp, dict):
        return resp.get("data"), resp.get("error")
    return getattr(resp, "data", None), getattr(resp, "error", None)


def _uuid_or_none(value: Any) -> str | None:
    try:
        return str(UUID(str(value)))
    except (TypeError, ValueError):
        return None


def log_user_activity(
    user_id: str,
    feature_name: str,
    action_type: str,
    document_id: str | None = None,
    document_name: str | None = None,
    metadata: dict[str, Any] | None = None,
) -> None:
    """Best-effort insert into user_activity_logs without breaking primary flows."""
    if not user_id:
        return

    activity_user_id = _uuid_or_none(user_id)
    if not activity_user_id:
        print(f"ACTIVITY LOG SKIPPED: invalid user_id {user_id}")
        return

    payload = {
        "user_id": activity_user_id,
        "feature_name": feature_name,
        "action_type": action_type,
        "document_id": _uuid_or_none(document_id),
        "document_name": document_name,
        "metadata": metadata or {},
    }
    try:
        resp = supabase.table("user_activity_logs").insert(payload).execute()
        _, error = _supabase_response_data(resp)
        if error:
            print(f"ACTIVITY LOG INSERT ERROR: {error}")
    except Exception as exc:
        print(f"ACTIVITY LOG INSERT FAILED: {exc}")
