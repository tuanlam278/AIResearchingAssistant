"""Generation job status and progress streaming endpoints."""

from __future__ import annotations

import asyncio
import json

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse

from app.dependencies import get_current_user
from app.services.generation_jobs import TERMINAL_STATUSES, get_generation_job

router = APIRouter(tags=["generation"])


def _user_id(user: dict) -> str:
    return str(user.get("id") or user.get("user_id") or "")


def _public_job(job: dict) -> dict:
    return {
        "id": job.get("id"),
        "job_type": job.get("job_type"),
        "resource_id": job.get("resource_id"),
        "status": job.get("status"),
        "stage": job.get("stage"),
        "progress": job.get("progress") or 0,
        "error_message": job.get("error_message"),
        "attempt_count": job.get("attempt_count") or 0,
        "max_attempts": job.get("max_attempts") or 0,
        "result": job.get("result") or {},
        "created_at": job.get("created_at"),
        "updated_at": job.get("updated_at"),
        "completed_at": job.get("completed_at"),
    }


def _assert_can_view(job: dict, user: dict) -> None:
    if str(user.get("role") or "user").lower() == "admin":
        return
    job_user_id = str(job.get("user_id") or "")
    if not job_user_id or job_user_id == _user_id(user):
        return
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail={"code": "JOB_NOT_FOUND", "message": "Không tìm thấy generation job."})


@router.get("/{job_id}", response_model=dict)
async def get_job_status(job_id: str, user: dict = Depends(get_current_user)):
    job = await get_generation_job(job_id)
    if not job:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail={"code": "JOB_NOT_FOUND", "message": "Không tìm thấy generation job."})
    _assert_can_view(job, user)
    return {"success": True, "data": {"job": _public_job(job)}}


@router.get("/{job_id}/stream")
async def stream_job_status(job_id: str, user: dict = Depends(get_current_user)):
    first = await get_generation_job(job_id)
    if not first:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail={"code": "JOB_NOT_FOUND", "message": "Không tìm thấy generation job."})
    _assert_can_view(first, user)

    async def events():
        last_signature = None
        while True:
            job = await get_generation_job(job_id)
            if not job:
                yield f"data: {json.dumps({'type': 'error', 'message': 'Không tìm thấy generation job.'}, ensure_ascii=False)}\n\n"
                return
            public = _public_job(job)
            signature = json.dumps(public, sort_keys=True, ensure_ascii=False)
            if signature != last_signature:
                last_signature = signature
                yield f"data: {json.dumps({'type': 'generation_progress', 'job': public, **public}, ensure_ascii=False)}\n\n"
            if public.get("status") in TERMINAL_STATUSES:
                yield f"data: {json.dumps({'type': 'done', 'job': public}, ensure_ascii=False)}\n\n"
                return
            await asyncio.sleep(1)

    return StreamingResponse(events(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})
