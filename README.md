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
├── backend/          # FastAPI backend
├── frontend/         # React frontend
└── docs/             # Tài liệu, API contract
```


## 🚀 Tech Stack

| Layer | Công cụ |
|-------|---------|
| Backend | FastAPI + Python |
| Frontend | React + Vite |
| PDF Parse | pdfplumber |
| Embedding | Google text-embedding-004 |
| Vector DB | Supabase + pgvector |
| LLM | Gemini 1.5 Flash |
| Deploy BE | Render |
| Deploy FE | Vercel |

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
