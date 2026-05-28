# Backend — AI Research Assistant

FastAPI backend cho hệ thống RAG (Retrieval-Augmented Generation) với xác thực người dùng qua Supabase Auth. Version 2.0.0.

## Cài đặt

```bash
cd backend
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env
# → Điền GOOGLE_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_KEY, SUPABASE_ANON_KEY vào .env
```

## Biến môi trường

| Biến | Mô tả |
|------|-------|
| `GOOGLE_API_KEY` | API key từ [Google AI Studio](https://aistudio.google.com/app/apikey) |
| `SUPABASE_URL` | URL project Supabase |
| `SUPABASE_SERVICE_KEY` | Service role key (dùng cho server-side, KHÔNG dùng anon) |
| `SUPABASE_ANON_KEY` | Anon key (dùng riêng cho Supabase Auth sign-in/sign-up) |
| `CORS_ORIGINS` | Danh sách origin được phép, mặc định `["http://localhost:5173"]` |

## Chạy server

```bash
uvicorn app.main:app --reload
# API docs: http://localhost:8000/docs
```

## Cấu trúc

```
app/
├── main.py              # FastAPI app, CORS, router registration
├── config.py            # Env vars (Pydantic Settings), constants
├── dependencies.py      # get_current_user — verify JWT, inject user_id
├── routers/
│   ├── auth.py          # POST /api/auth/register, /login, /logout
│   ├── notebooks.py     # CRUD notebooks + upload/list docs trong notebook
│   ├── documents.py     # Upload/list/delete document (legacy, standalone)
│   └── chat.py          # POST /api/chat/ask, /api/chat/ask/stream
├── services/
│   ├── pdf_parser.py    # Parse PDF → list pages (dùng PyMuPDF + Gemini Vision)
│   ├── chunker.py       # Chunk pages → chunks (LangChain text splitter)
│   ├── embedder.py      # Google gemini-embedding-001 (768 chiều)
│   ├── retriever.py     # Vector search Supabase pgvector theo notebook_id
│   └── llm.py           # Gemini 2.5 Flash — generation + streaming
├── models/
│   └── schemas.py       # Pydantic schemas (auth, notebook, document, chat)
└── db/
    └── supabase_client.py
```

## API Endpoints

### Auth — `/api/auth`

| Method | Path | Mô tả |
|--------|------|-------|
| POST | `/api/auth/register` | Đăng ký tài khoản mới |
| POST | `/api/auth/login` | Đăng nhập, nhận `access_token` |
| POST | `/api/auth/logout` | Đăng xuất (cần Bearer token) |

### Notebooks — `/api/notebooks`

| Method | Path | Mô tả |
|--------|------|-------|
| POST | `/api/notebooks` | Tạo notebook mới |
| GET | `/api/notebooks` | Lấy danh sách notebooks của user |
| DELETE | `/api/notebooks/{notebook_id}` | Xóa notebook (cascade xóa toàn bộ documents + chunks) |
| POST | `/api/notebooks/{notebook_id}/upload` | Upload nhiều file PDF vào notebook |
| GET | `/api/notebooks/{notebook_id}/documents` | Lấy danh sách documents trong notebook |

### Documents — `/api/documents`

| Method | Path | Mô tả |
|--------|------|-------|
| POST | `/api/documents/upload` | Upload một file PDF (standalone) |
| GET | `/api/documents` | Lấy danh sách documents của user |
| DELETE | `/api/documents/{doc_id}` | Xóa document |

### Chat — `/api/chat`

| Method | Path | Mô tả |
|--------|------|-------|
| POST | `/api/chat/ask` | Hỏi đáp RAG (non-streaming), nhận JSON |
| POST | `/api/chat/ask/stream` | Hỏi đáp RAG (SSE streaming), trả `text/event-stream` |

Request body cho `/ask` và `/ask/stream`:
```json
{
  "notebook_id": "uuid-của-notebook",
  "question": "Câu hỏi của bạn",
  "chat_history": [
    { "role": "user", "content": "..." },
    { "role": "assistant", "content": "..." }
  ]
}
```

## Pipeline RAG

```
PDF upload → parse_pdf (PyMuPDF + Gemini Vision)
          → chunk_text (LangChain splitter, size=500, overlap=50)
          → embed_chunks (gemini-embedding-001, 768 chiều)
          → lưu vào Supabase (documents + document_chunks)

Chat /ask → embed_query
          → retrieve_chunks (Supabase RPC match_chunks theo notebook_id, top_k=5)
          → generate_answer (gemini-2.5-flash)
          → trả JSON / SSE stream
```

## Cách dùng auth trong endpoint mới

Mọi endpoint cần đăng nhập đều thêm `Depends(get_current_user)`:

```python
from app.dependencies import get_current_user

@router.get("/something")
async def something(user=Depends(get_current_user)):
    user_id = user["id"]    # UUID của user đang đăng nhập
    email   = user["email"]
```

Nếu token thiếu hoặc hết hạn, FastAPI tự trả về `401 UNAUTHORIZED`.

## Phân công BE

| File | Người | Mô tả |
|------|-------|-------|
| `routers/auth.py` | Gia Phú | Register, login, logout qua Supabase Auth |
| `services/pdf_parser.py` | Gia Phú | Parse PDF → list pages (PyMuPDF + Gemini Vision) |
| `services/chunker.py` | Gia Phú | Chunk text với overlap (LangChain) |
| `routers/documents.py` | Gia Phú | Upload + list + delete document standalone |
| `dependencies.py` | Gia Phú | Verify JWT token, inject user vào endpoint |
| `routers/notebooks.py` | Gia Phú | CRUD notebook + upload/list docs trong notebook |
| `services/embedder.py` | Đức Tâm | gemini-embedding-001, batch embed |
| `services/retriever.py` | Đức Tâm | Vector search Supabase theo notebook_id |
| `services/llm.py` | Đức Tâm | Gemini 2.5 Flash generation + streaming |
| `routers/chat.py` | Đức Tâm | Chat endpoints (ask + ask/stream) với auth |

## Supabase Setup

Cần có các bảng và function sau trong Supabase:

- **`notebooks`** — `id`, `user_id`, `name`, `created_at`
- **`documents`** — `id`, `notebook_id`, `filename`, `page_count`, `chunk_count`, `created_at`
- **`document_chunks`** — `id`, `doc_id`, `notebook_id`, `content`, `page_number`, `chunk_index`, `embedding vector(768)`
- **RPC `match_chunks`** — nhận `query_embedding`, `target_notebook_id`, `match_count`; trả về chunks sắp xếp theo cosine similarity

> Xem SQL đầy đủ trong `docs/architecture.md` (nếu có).