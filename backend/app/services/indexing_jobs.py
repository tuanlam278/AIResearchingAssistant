"""Durable indexing job queue with DB persistence and in-memory fallback."""

from __future__ import annotations

import asyncio
import json
import logging
import socket
from datetime import datetime, timedelta, timezone
from typing import Any, Awaitable, Callable
from uuid import uuid4

from app.db.supabase_client import supabase

logger = logging.getLogger(__name__)

TERMINAL_STATUSES = {"succeeded", "failed", "cancelled"}
WORKER_ID = f"{socket.gethostname()}:{uuid4().hex[:8]}"
_DB_AVAILABLE: bool | None = None
_MEMORY_JOBS: dict[str, dict[str, Any]] = {}
_WORKER_TASK: asyncio.Task | None = None

JobHandler = Callable[[dict[str, Any]], Awaitable[dict[str, Any] | None]]


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _response_data(resp: Any) -> tuple[Any, Any]:
    if isinstance(resp, dict):
        return resp.get("data"), resp.get("error")
    return getattr(resp, "data", None), getattr(resp, "error", None)


def _normalize_job(row: dict[str, Any]) -> dict[str, Any]:
    payload = row.get("payload") or {}
    result = row.get("result") or {}
    if isinstance(payload, str):
        try:
            payload = json.loads(payload)
        except json.JSONDecodeError:
            payload = {}
    if isinstance(result, str):
        try:
            result = json.loads(result)
        except json.JSONDecodeError:
            result = {}
    return {**row, "id": str(row.get("id")), "payload": payload, "result": result}


def _memory_job(job_type: str, resource_id: str | None, payload: dict[str, Any], user_id: str | None, max_attempts: int) -> dict[str, Any]:
    job_id = str(uuid4())
    row = {
        "id": job_id,
        "job_type": job_type,
        "resource_id": resource_id,
        "user_id": user_id,
        "status": "queued",
        "stage": "queued",
        "progress": 0,
        "payload": payload,
        "result": {},
        "error_message": None,
        "attempt_count": 0,
        "max_attempts": max_attempts,
        "locked_by": None,
        "locked_until": None,
        "run_after": _now(),
        "started_at": None,
        "completed_at": None,
        "created_at": _now(),
        "updated_at": _now(),
    }
    _MEMORY_JOBS[job_id] = row
    return row


def create_memory_indexing_job(
    *,
    job_type: str,
    resource_id: str | None,
    payload: dict[str, Any],
    user_id: str | None = None,
    max_attempts: int = 3,
) -> dict[str, Any]:
    """Explicit in-process fallback for payloads that cannot be persisted safely."""
    return _memory_job(job_type, resource_id, payload, user_id, max_attempts)


async def create_indexing_job(
    *,
    job_type: str,
    resource_id: str | None,
    payload: dict[str, Any],
    user_id: str | None = None,
    max_attempts: int = 3,
) -> dict[str, Any]:
    """Persist a durable indexing job; fall back to memory if the migration is not installed."""
    global _DB_AVAILABLE
    row = {
        "job_type": job_type,
        "resource_id": resource_id,
        "user_id": user_id,
        "status": "queued",
        "stage": "queued",
        "progress": 0,
        "payload": payload,
        "max_attempts": max_attempts,
    }

    if _DB_AVAILABLE is not False:
        try:
            resp = await asyncio.to_thread(lambda: supabase.table("indexing_jobs").insert(row).execute())
            rows, error = _response_data(resp)
            if error or not rows:
                raise RuntimeError(error or "indexing_jobs insert returned no rows")
            _DB_AVAILABLE = True
            return _normalize_job(rows[0])
        except Exception as exc:
            _DB_AVAILABLE = False
            logger.warning("indexing_jobs table unavailable; using in-memory fallback: %s", exc)

    return _memory_job(job_type, resource_id, payload, user_id, max_attempts)


async def get_indexing_job(job_id: str) -> dict[str, Any] | None:
    if not job_id:
        return None
    if _DB_AVAILABLE is not False:
        try:
            resp = await asyncio.to_thread(lambda: supabase.table("indexing_jobs").select("*").eq("id", job_id).limit(1).execute())
            rows, error = _response_data(resp)
            if not error and rows:
                return _normalize_job(rows[0])
        except Exception:
            pass
    row = _MEMORY_JOBS.get(str(job_id))
    return _normalize_job(row) if row else None


async def update_indexing_job(job_id: str, updates: dict[str, Any]) -> dict[str, Any] | None:
    updates = {key: value for key, value in updates.items() if value is not None}
    if not updates:
        return await get_indexing_job(job_id)
    updates.setdefault("updated_at", _now())
    if updates.get("status") in TERMINAL_STATUSES:
        updates.setdefault("completed_at", _now())
        updates.setdefault("progress", 100 if updates.get("status") == "succeeded" else int(updates.get("progress") or 0))

    if _DB_AVAILABLE is not False:
        try:
            resp = await asyncio.to_thread(lambda: supabase.table("indexing_jobs").update(updates).eq("id", job_id).execute())
            rows, error = _response_data(resp)
            if not error and rows:
                return _normalize_job(rows[0])
        except Exception as exc:
            logger.info("Could not update indexing_jobs row %s: %s", job_id, exc)

    row = _MEMORY_JOBS.get(str(job_id))
    if row:
        row.update(updates)
        return _normalize_job(row)
    return None


async def report_indexing_progress(job_id: str | None, *, stage: str, progress: int, message: str | None = None) -> None:
    if not job_id:
        return
    await update_indexing_job(
        job_id,
        {
            "status": "running",
            "stage": stage,
            "progress": max(0, min(100, int(progress))),
            "error_message": message,
        },
    )


async def claim_next_indexing_job() -> dict[str, Any] | None:
    """Claim one queued/retry job. DB path is intentionally conservative for PostgREST compatibility."""
    now_iso = _now()
    lock_until = (datetime.now(timezone.utc) + timedelta(minutes=15)).isoformat()

    if _DB_AVAILABLE is not False:
        try:
            resp = await asyncio.to_thread(
                lambda: supabase.table("indexing_jobs")
                .select("*")
                .in_("status", ["queued", "retrying"])
                .lte("run_after", now_iso)
                .order("created_at", desc=False)
                .limit(1)
                .execute()
            )
            rows, error = _response_data(resp)
            if not error and rows:
                job = _normalize_job(rows[0])
                update_resp = await asyncio.to_thread(
                    lambda: supabase.table("indexing_jobs")
                    .update(
                        {
                            "status": "running",
                            "stage": job.get("stage") or "running",
                            "locked_by": WORKER_ID,
                            "locked_until": lock_until,
                            "started_at": job.get("started_at") or now_iso,
                            "attempt_count": int(job.get("attempt_count") or 0) + 1,
                        }
                    )
                    .eq("id", job["id"])
                    .in_("status", ["queued", "retrying"])
                    .execute()
                )
                updated, update_error = _response_data(update_resp)
                if not update_error and updated:
                    return _normalize_job(updated[0])
        except Exception as exc:
            logger.info("DB job claim unavailable: %s", exc)

    for row in _MEMORY_JOBS.values():
        if row.get("status") in {"queued", "retrying"} and str(row.get("run_after") or "") <= now_iso:
            row.update(
                {
                    "status": "running",
                    "locked_by": WORKER_ID,
                    "locked_until": lock_until,
                    "started_at": row.get("started_at") or now_iso,
                    "attempt_count": int(row.get("attempt_count") or 0) + 1,
                    "updated_at": now_iso,
                }
            )
            return _normalize_job(row)
    return None


async def _handle_indexing_job(job: dict[str, Any]) -> dict[str, Any] | None:
    job_type = job.get("job_type")
    if job_type == "notebook_document":
        from app.services.indexing_service import process_notebook_indexing_job

        return await process_notebook_indexing_job(job)
    if job_type == "system_document":
        from app.services.system_library_service import process_system_document_indexing_job

        return await process_system_document_indexing_job(job)
    raise RuntimeError(f"Unsupported indexing job type: {job_type}")


async def process_one_indexing_job() -> bool:
    job = await claim_next_indexing_job()
    if not job:
        return False
    try:
        result = await _handle_indexing_job(job)
        await update_indexing_job(
            job["id"],
            {
                "status": "succeeded",
                "stage": "ready",
                "progress": 100,
                "result": result or {},
                "error_message": None,
                "locked_by": None,
                "locked_until": None,
            },
        )
    except Exception as exc:
        logger.exception("Indexing job %s failed", job.get("id"))
        attempts = int(job.get("attempt_count") or 1)
        max_attempts = int(job.get("max_attempts") or 3)
        if attempts < max_attempts:
            delay = min(300, 2 ** attempts * 5)
            await update_indexing_job(
                job["id"],
                {
                    "status": "retrying",
                    "stage": "retrying",
                    "progress": int(job.get("progress") or 0),
                    "error_message": str(exc),
                    "locked_by": None,
                    "locked_until": None,
                    "run_after": (datetime.now(timezone.utc) + timedelta(seconds=delay)).isoformat(),
                },
            )
        else:
            await update_indexing_job(
                job["id"],
                {
                    "status": "failed",
                    "stage": "failed",
                    "error_message": str(exc),
                    "locked_by": None,
                    "locked_until": None,
                },
            )
    return True


async def indexing_worker_loop(poll_interval: float = 1.5) -> None:
    while True:
        try:
            processed = await process_one_indexing_job()
            if not processed:
                await asyncio.sleep(poll_interval)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Indexing worker loop error")
            await asyncio.sleep(poll_interval)


def start_indexing_worker() -> asyncio.Task:
    global _WORKER_TASK
    if _WORKER_TASK and not _WORKER_TASK.done():
        return _WORKER_TASK
    _WORKER_TASK = asyncio.create_task(indexing_worker_loop())
    return _WORKER_TASK


async def stop_indexing_worker() -> None:
    global _WORKER_TASK
    if _WORKER_TASK and not _WORKER_TASK.done():
        _WORKER_TASK.cancel()
        try:
            await _WORKER_TASK
        except asyncio.CancelledError:
            pass
    _WORKER_TASK = None
