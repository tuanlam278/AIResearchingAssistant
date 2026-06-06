from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.routers import documents, chat, auth, notebooks, notes, workspaces, research_sessions, system_library, admin, cross_analysis, academic_lens, profile, indexing, generation
from app.config import settings
from app.services.storage_health import check_supabase_storage_buckets

app = FastAPI(
    title="AI Research Assistant API",
    version="2.0.0",
    docs_url="/docs",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Content-Disposition", "Content-Type"],
)

app.include_router(auth.router)
app.include_router(profile.router)
app.include_router(notebooks.router, prefix="/api/notebooks", tags=["notebooks"])
app.include_router(documents.router, prefix="/api/documents", tags=["documents"])
app.include_router(chat.router, prefix="/api/chat", tags=["chat"])
app.include_router(notes.router, prefix="/api", tags=["notes"])
app.include_router(workspaces.router, prefix="/api/workspaces", tags=["workspaces"])
app.include_router(research_sessions.router, prefix="/api", tags=["research-sessions"])
app.include_router(system_library.router, prefix="/api/system-library", tags=["system-library"])
app.include_router(cross_analysis.router, prefix="/api/cross-analysis", tags=["cross-analysis"])
app.include_router(academic_lens.router, prefix="/api/academic-lens", tags=["academic-lens"])
app.include_router(indexing.router, prefix="/api/indexing-jobs", tags=["indexing"])
app.include_router(generation.router, prefix="/api/generation-jobs", tags=["generation"])
app.include_router(admin.router)


@app.get("/api/health")
def health_check():
    return {"status": "ok", "version": "2.0.0"}

@app.on_event("startup")
async def start_background_workers():
    check_supabase_storage_buckets()
    if settings.VISION_MODEL:
        import logging
        logging.getLogger(__name__).info("Configured VISION_MODEL=%s", settings.VISION_MODEL)
    else:
        import logging
        logging.getLogger(__name__).warning("VISION_MODEL chưa được cấu hình; Academic Lens vision/OCR fallback sẽ bị tắt.")
    if settings.INDEXING_WORKER_ENABLED:
        from app.services.indexing_jobs import start_indexing_worker

        start_indexing_worker()
    if settings.GENERATION_WORKER_ENABLED:
        from app.services.generation_jobs import start_generation_worker

        start_generation_worker()


@app.on_event("shutdown")
async def stop_background_workers():
    from app.services.indexing_jobs import stop_indexing_worker
    from app.services.generation_jobs import stop_generation_worker

    await stop_indexing_worker()
    await stop_generation_worker()
