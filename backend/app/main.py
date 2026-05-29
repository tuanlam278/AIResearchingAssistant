from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.routers import documents, chat, auth, notebooks, notes, workspaces, research_sessions, system_library, admin
from app.config import settings

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
)

app.include_router(auth.router)
app.include_router(notebooks.router, prefix="/api/notebooks", tags=["notebooks"])
app.include_router(documents.router, prefix="/api/documents", tags=["documents"])
app.include_router(chat.router, prefix="/api/chat", tags=["chat"])
app.include_router(notes.router, prefix="/api", tags=["notes"])
app.include_router(workspaces.router, prefix="/api/workspaces", tags=["workspaces"])
app.include_router(research_sessions.router, prefix="/api", tags=["research-sessions"])
app.include_router(system_library.router, prefix="/api/system-library", tags=["system-library"])
app.include_router(admin.router)


@app.get("/api/health")
def health_check():
    return {"status": "ok", "version": "2.0.0"}