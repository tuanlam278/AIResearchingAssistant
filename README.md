# 🔬 AI Research Assistant

Hệ thống hỗ trợ đọc và phân tích tài liệu học thuật sử dụng RAG (Retrieval-Augmented Generation).

## 🏗️ Kiến trúc hệ thống

```
PDF Upload ──► FastAPI ──► Parse & Chunk ──► Gemini Embedding ──► Supabase (pgvector)
                                                                         │
User Question ──► FastAPI ──► Gemini Embedding ──► Vector Search ────────┘
                                                         │
                                              Top-k Chunks + Prompt
                                                         │
                                                  Gemini Flash ──► Answer + Sources
```

## 📁 Cấu trúc dự án

```
AIResearchingAssistant/
├── backend/          # FastAPI backend (2 người)
├── frontend/         # React frontend (2 người)
└── docs/             # Tài liệu, API contract
```

## 👥 Phân công

| Người | Role | Nhiệm vụ chính |
|-------|------|----------------|
| BE 1  | Backend | PDF parsing, chunking, upload flow |
| BE 2  | Backend | Embedding, vector search, LLM generation |
| FE 1  | Frontend | Upload UI, document list, routing |
| FE 2  | Frontend | Chat UI, source display, streaming |

## 🚀 Tech Stack

| Layer | Công cụ | Free |
|-------|---------|------|
| Backend | FastAPI + Python | ✅ |
| Frontend | React + Vite | ✅ |
| PDF Parse | pdfplumber | ✅ |
| Embedding | Google text-embedding-004 | ✅ |
| Vector DB | Supabase + pgvector | ✅ |
| LLM | Gemini 1.5 Flash | ✅ |
| Deploy BE | Render | ✅ |
| Deploy FE | Vercel | ✅ |

## 📋 Tài liệu

- [API Contract](./docs/api_contract.md)
- [Architecture](./docs/architecture.md)
- [Backend README](./backend/README.md)
- [Frontend README](./frontend/README.md)

## ⚙️ Setup nhanh

```bash
# Backend
cd backend
cp .env.example .env   # Điền API keys
pip install -r requirements.txt
uvicorn app.main:app --reload

# Frontend
cd frontend
cp .env.example .env   # Điền VITE_API_URL
npm install
npm run dev
```
