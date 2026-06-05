"""Shared generation job queue for flashcards, quizzes, summaries, and reports."""

from __future__ import annotations

import asyncio
import json
import logging
import socket
from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import uuid4

from app.db.supabase_client import supabase
from app.services.embedder import embed_query
from app.services.groq_service import generate_flashcards_from_context, generate_quiz_from_context
from app.services.llm import generate_workspace_summary
from app.services.observability import emit_metric, metric_timer
from app.services.retriever import OUT_OF_SCOPE_WARNING, retrieve_rag_context

logger = logging.getLogger(__name__)
TERMINAL_STATUSES = {"succeeded", "failed", "cancelled"}
WORKER_ID = f"{socket.gethostname()}:{uuid4().hex[:8]}"
_DB_AVAILABLE: bool | None = None
_MEMORY_JOBS: dict[str, dict[str, Any]] = {}
_WORKER_TASK: asyncio.Task | None = None


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _response_data(resp: Any) -> tuple[Any, Any]:
    if isinstance(resp, dict):
        return resp.get("data"), resp.get("error")
    return getattr(resp, "data", None), getattr(resp, "error", None)


def _normalize(row: dict[str, Any]) -> dict[str, Any]:
    payload = row.get("payload") or {}
    result = row.get("result") or {}
    if isinstance(payload, str):
        try: payload = json.loads(payload)
        except json.JSONDecodeError: payload = {}
    if isinstance(result, str):
        try: result = json.loads(result)
        except json.JSONDecodeError: result = {}
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


async def create_generation_job(*, job_type: str, resource_id: str | None, payload: dict[str, Any], user_id: str | None = None, max_attempts: int = 2) -> dict[str, Any]:
    global _DB_AVAILABLE
    row = {"job_type": job_type, "resource_id": resource_id, "user_id": user_id, "status": "queued", "stage": "queued", "progress": 0, "payload": payload, "max_attempts": max_attempts}
    if _DB_AVAILABLE is not False:
        try:
            resp = await asyncio.to_thread(lambda: supabase.table("generation_jobs").insert(row).execute())
            rows, error = _response_data(resp)
            if error or not rows:
                raise RuntimeError(error or "generation_jobs insert returned no rows")
            _DB_AVAILABLE = True
            return _normalize(rows[0])
        except Exception as exc:
            _DB_AVAILABLE = False
            logger.warning("generation_jobs table unavailable; using memory fallback: %s", exc)
    return _memory_job(job_type, resource_id, payload, user_id, max_attempts)


async def get_generation_job(job_id: str) -> dict[str, Any] | None:
    if _DB_AVAILABLE is not False:
        try:
            resp = await asyncio.to_thread(lambda: supabase.table("generation_jobs").select("*").eq("id", job_id).limit(1).execute())
            rows, error = _response_data(resp)
            if not error and rows:
                return _normalize(rows[0])
        except Exception:
            pass
    row = _MEMORY_JOBS.get(str(job_id))
    return _normalize(row) if row else None


async def update_generation_job(job_id: str, updates: dict[str, Any]) -> dict[str, Any] | None:
    updates = {key: value for key, value in updates.items() if value is not None}
    updates.setdefault("updated_at", _now())
    if updates.get("status") in TERMINAL_STATUSES:
        updates.setdefault("completed_at", _now())
        updates.setdefault("progress", 100 if updates.get("status") == "succeeded" else int(updates.get("progress") or 0))
    if _DB_AVAILABLE is not False:
        try:
            resp = await asyncio.to_thread(lambda: supabase.table("generation_jobs").update(updates).eq("id", job_id).execute())
            rows, error = _response_data(resp)
            if not error and rows:
                return _normalize(rows[0])
        except Exception:
            pass
    row = _MEMORY_JOBS.get(str(job_id))
    if row:
        row.update(updates)
        return _normalize(row)
    return None


async def report_generation_progress(job_id: str, *, stage: str, progress: int, message: str | None = None) -> None:
    await update_generation_job(job_id, {"status": "running", "stage": stage, "progress": max(0, min(100, int(progress))), "error_message": message})


def context_from_chunks(rows: list[dict]) -> str:
    return "\n\n".join(f"[Trang {row.get('page_number') or '?'} - {row.get('section') or 'Unknown'}] {row.get('content') or ''}" for row in rows if row.get("content"))


async def load_generation_context(*, notebook_id: str, selected_document_ids: list[str], rag_query: str) -> tuple[str, str | None, dict[str, Any]]:
    with metric_timer("generation.retrieval", notebook_id=notebook_id, selected_doc_count=len(selected_document_ids)) as metric:
        query_vector = await embed_query(rag_query)
        retrieval = await retrieve_rag_context(query_vector, notebook_id, selected_document_ids)
        rows = retrieval.chunks
        metric["final_context_count"] = len(rows)
        metric["top_score"] = retrieval.top_score
        metric["out_of_scope"] = retrieval.is_out_of_scope
    if not rows:
        raise RuntimeError("Không tìm thấy nội dung tài liệu để tạo nội dung học tập.")
    return context_from_chunks(rows), OUT_OF_SCOPE_WARNING if retrieval.is_out_of_scope else None, {"chunks_used": len(rows), "top_score": retrieval.top_score, "is_out_of_scope": retrieval.is_out_of_scope}


def _load_workspace_documents(workspace_id: str, document_ids: list[str]) -> list[dict[str, Any]]:
    query = supabase.table("documents").select("id, filename, page_count, chunk_count").eq("notebook_id", workspace_id)
    if document_ids:
        query = query.in_("id", document_ids)
    resp = query.execute()
    rows, error = _response_data(resp)
    if error:
        raise RuntimeError(error)
    return rows or []


def _load_workspace_chunks(workspace_id: str, doc_ids: list[str]) -> dict[str, list[dict]]:
    if not doc_ids:
        return {}
    resp = supabase.table("document_chunks").select("doc_id, content, page_number, chunk_index, section").eq("notebook_id", workspace_id).in_("doc_id", doc_ids).order("chunk_index", desc=False).execute()
    rows, error = _response_data(resp)
    if error:
        raise RuntimeError(error)
    grouped = {doc_id: [] for doc_id in doc_ids}
    for row in rows or []:
        grouped.setdefault(str(row.get("doc_id")), []).append(row)
    return grouped


async def _run_flashcards(job: dict[str, Any]) -> dict[str, Any]:
    payload = job.get("payload") or {}
    await report_generation_progress(job["id"], stage="retrieving", progress=20, message="Đang tải ngữ cảnh RAG")
    context, warning, diagnostics = await load_generation_context(notebook_id=payload["notebook_id"], selected_document_ids=payload["selected_document_ids"], rag_query=payload["rag_query"])
    await report_generation_progress(job["id"], stage="generating", progress=70, message="Đang tạo flashcards")
    with metric_timer("generation.flashcards", session_id=payload.get("session_id"), count=payload.get("count")):
        flashcards = await generate_flashcards_from_context(context, int(payload.get("count") or 5))
    return {"flashcards": flashcards, "warning": warning, "diagnostics": diagnostics}


async def _run_quiz(job: dict[str, Any]) -> dict[str, Any]:
    payload = job.get("payload") or {}
    await report_generation_progress(job["id"], stage="retrieving", progress=20, message="Đang tải ngữ cảnh RAG")
    context, warning, diagnostics = await load_generation_context(notebook_id=payload["notebook_id"], selected_document_ids=payload["selected_document_ids"], rag_query=payload["rag_query"])
    await report_generation_progress(job["id"], stage="generating", progress=70, message="Đang tạo quiz")
    with metric_timer("generation.quiz", session_id=payload.get("session_id"), count=payload.get("count"), question_type=payload.get("question_type")):
        questions = await generate_quiz_from_context(context, int(payload.get("count") or 3), str(payload.get("question_type") or "mixed"))
    return {"quiz": {"questions": questions}, "questions": questions, "warning": warning, "diagnostics": diagnostics}


async def _run_workspace_summary(job: dict[str, Any]) -> dict[str, Any]:
    payload = job.get("payload") or {}
    workspace_id = str(payload.get("workspace_id") or job.get("resource_id"))
    await report_generation_progress(job["id"], stage="loading", progress=20, message="Đang tải chunks tài liệu")
    docs = await asyncio.to_thread(_load_workspace_documents, workspace_id, [str(x) for x in payload.get("document_ids") or []])
    chunks_by_doc = await asyncio.to_thread(_load_workspace_chunks, workspace_id, [str(row["id"]) for row in docs])
    documents_for_llm = [{"id": row["id"], "filename": row.get("filename"), "page_count": row.get("page_count") or 0, "chunk_count": row.get("chunk_count") or 0, "chunks": chunks_by_doc.get(str(row["id"]), [])[:12]} for row in docs]
    await report_generation_progress(job["id"], stage="generating", progress=70, message="Đang tạo summary workspace")
    with metric_timer("generation.workspace_summary", workspace_id=workspace_id, doc_count=len(docs)):
        summary = await generate_workspace_summary(documents_for_llm)
    return summary


async def _handle(job: dict[str, Any]) -> dict[str, Any]:
    if job.get("job_type") == "flashcards":
        return await _run_flashcards(job)
    if job.get("job_type") == "quiz":
        return await _run_quiz(job)
    if job.get("job_type") == "workspace_summary":
        return await _run_workspace_summary(job)
    raise RuntimeError(f"Unsupported generation job type: {job.get('job_type')}")


async def _claim_next() -> dict[str, Any] | None:
    now = _now()
    lock_until = (datetime.now(timezone.utc) + timedelta(minutes=15)).isoformat()
    if _DB_AVAILABLE is not False:
        try:
            resp = await asyncio.to_thread(lambda: supabase.table("generation_jobs").select("*").in_("status", ["queued", "retrying"]).lte("run_after", now).order("created_at", desc=False).limit(1).execute())
            rows, error = _response_data(resp)
            if not error and rows:
                job = _normalize(rows[0])
                update_resp = await asyncio.to_thread(lambda: supabase.table("generation_jobs").update({"status": "running", "locked_by": WORKER_ID, "locked_until": lock_until, "started_at": job.get("started_at") or now, "attempt_count": int(job.get("attempt_count") or 0) + 1}).eq("id", job["id"]).in_("status", ["queued", "retrying"]).execute())
                updated, update_error = _response_data(update_resp)
                if not update_error and updated:
                    return _normalize(updated[0])
        except Exception:
            pass
    for row in _MEMORY_JOBS.values():
        if row.get("status") in {"queued", "retrying"}:
            row.update({"status": "running", "locked_by": WORKER_ID, "locked_until": lock_until, "started_at": row.get("started_at") or now, "attempt_count": int(row.get("attempt_count") or 0) + 1})
            return _normalize(row)
    return None


async def process_one_generation_job() -> bool:
    job = await _claim_next()
    if not job:
        return False
    try:
        result = await _handle(job)
        await update_generation_job(job["id"], {"status": "succeeded", "stage": "done", "progress": 100, "result": result, "error_message": None, "locked_by": None, "locked_until": None})
        emit_metric("generation.completed", job_id=job["id"], job_type=job.get("job_type"), resource_id=job.get("resource_id"))
    except Exception as exc:
        logger.exception("Generation job %s failed", job.get("id"))
        attempts = int(job.get("attempt_count") or 1)
        max_attempts = int(job.get("max_attempts") or 2)
        if attempts < max_attempts:
            await update_generation_job(job["id"], {"status": "retrying", "stage": "retrying", "error_message": str(exc), "run_after": (datetime.now(timezone.utc) + timedelta(seconds=min(180, 2 ** attempts * 5))).isoformat(), "locked_by": None, "locked_until": None})
        else:
            await update_generation_job(job["id"], {"status": "failed", "stage": "failed", "error_message": str(exc), "locked_by": None, "locked_until": None})
    return True


async def generation_worker_loop(poll_interval: float = 1.5) -> None:
    while True:
        try:
            processed = await process_one_generation_job()
            if not processed:
                await asyncio.sleep(poll_interval)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Generation worker loop error")
            await asyncio.sleep(poll_interval)


def start_generation_worker() -> asyncio.Task:
    global _WORKER_TASK
    if _WORKER_TASK and not _WORKER_TASK.done():
        return _WORKER_TASK
    _WORKER_TASK = asyncio.create_task(generation_worker_loop())
    return _WORKER_TASK


async def stop_generation_worker() -> None:
    global _WORKER_TASK
    if _WORKER_TASK and not _WORKER_TASK.done():
        _WORKER_TASK.cancel()
        try:
            await _WORKER_TASK
        except asyncio.CancelledError:
            pass
    _WORKER_TASK = None
