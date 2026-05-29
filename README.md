# 🔬 AI Research Assistant

Hệ thống hỗ trợ đọc và phân tích tài liệu học thuật sử dụng RAG (Retrieval-Augmented Generation), tổ chức tài liệu theo **Notebooks**.

## 🏗️ Kiến trúc hệ thống

```
PDF Upload ──► FastAPI ──► Parse & Chunk ──► Gemini Embedding ──► Supabase (pgvector)
                                                                         │
User Question ──► FastAPI ──► Gemini Embedding ──► Vector Search ────────┘
                                                         │
                                              Top-k Chunks + Prompt
                                                         │
                                               Gemini 2.5 Flash ──► Answer + Sources
```

## 📁 Cấu trúc dự án

```
AIResearchingAssistant/
├── backend/          # FastAPI backend
├── frontend/         # React + Vite frontend
├── README.md
├── api_contract.md
└── architecture.md
```

## 🚀 Tech Stack

| Layer | Công cụ |
|-------|---------|
| Backend | FastAPI + Python |
| Frontend | React + Vite + Tailwind CSS |
| PDF Parse | PyMuPDF + Gemini Vision (OCR fallback cho scanned PDF) |
| Chunking | LangChain RecursiveCharacterTextSplitter + tiktoken |
| Embedding | Google `gemini-embedding-001` (768 dims) |
| Vector DB | Supabase + pgvector |
| LLM | Gemini 2.5 Flash |
| Deploy BE | Render |
| Deploy FE | Vercel |

## 📋 Tài liệu

- [API Contract](./api_contract.md)
- [Architecture](./architecture.md)

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

## 🗺️ Luồng sử dụng chính

1. Đăng ký / Đăng nhập
2. Tạo **Notebook** (nhóm tài liệu theo chủ đề)
3. Upload **nhiều PDF/DOCX/TXT/MD** vào notebook
4. Đặt câu hỏi — hệ thống tìm kiếm trên **toàn bộ tài liệu trong notebook**
5. Nhận câu trả lời kèm nguồn trích dẫn

### Recent feature additions

- Upload supports PDF, DOCX, TXT and MD for RAG indexing. Legacy `.doc` and `.rtf` uploads are rejected with clear conversion guidance.
- Research sessions can be exported as DOCX via `GET /api/research-sessions/{session_id}/export.docx`.
- Flashcards are generated with Groq through `POST /api/research-sessions/{session_id}/flashcards/generate` and require `GROQ_API_KEY` plus optional `GROQ_FLASHCARD_MODEL`.
