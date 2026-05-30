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

## Google login / Google account linking

This app verifies Google Identity Services ID tokens in the FastAPI backend and then issues an app-owned session token. It does **not** require enabling the Supabase Google/OIDC provider for the `/api/auth/google` backend flow.

Required configuration:

1. Create an OAuth 2.0 Web Client in Google Cloud Console.
2. Add authorized JavaScript origins, for example:
   - `http://localhost:5173`
   - your production frontend URL
3. Set the same client ID in both environments:
   - frontend: `VITE_GOOGLE_CLIENT_ID=<google-web-client-id>`
   - backend: `GOOGLE_CLIENT_ID=<google-web-client-id>`
4. Generate a strong backend session secret and set `JWT_SECRET_KEY` in the backend environment. Do not hardcode or commit the real value.
5. Run `docs/sql/profile_google_auth.sql` in Supabase SQL editor so `profiles.google_id` is unique and the optional `google_email` / `google_avatar_url` fields exist.

If you intentionally switch back to Supabase Auth provider based Google sign-in, also enable Google in Supabase Dashboard → Authentication → Providers, enter the Google Client ID/Secret, and add the Supabase callback URL (`https://<project-ref>.supabase.co/auth/v1/callback`) to Google Cloud OAuth redirect URIs. Otherwise Supabase may return: `Provider (issuer "https://accounts.google.com") is not enabled`.
