# Backend — AI Research Assistant

FastAPI backend cho hệ thống RAG với xác thực người dùng qua Supabase Auth.

## Cài đặt

```bash
cd backend
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env
# → Điền GOOGLE_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_KEY vào .env
```

## Chạy server

```bash
uvicorn app.main:app --reload
# API docs: http://localhost:8000/docs
```

## Cấu trúc

```
app/
├── main.py              # FastAPI app, CORS, router registration
├── config.py            # Env vars, constants
├── dependencies.py      # get_current_user — verify JWT, inject user_id
├── routers/
│   ├── auth.py          # POST /register, /login, /logout         ← BE1
│   ├── documents.py     # POST /upload, GET /, DELETE /{id}       ← BE1
│   └── chat.py          # POST /ask, POST /ask/stream             ← BE2
├── services/
│   ├── pdf_parser.py    # Parse PDF → pages                       ← BE1
│   ├── chunker.py       # Chunk pages → chunks                    ← BE1
│   ├── embedder.py      # Google text-embedding-004               ← BE2
│   ├── retriever.py     # Vector search Supabase                  ← BE2
│   └── llm.py           # Gemini 1.5 Flash generation             ← BE2
├── models/
│   └── schemas.py       # Pydantic schemas (auth + documents + chat)
└── db/
    └── supabase_client.py
```

## Phân công BE

| File | Người | Mô tả |
|------|-------|-------|
| `routers/auth.py` | Gia Phú | Register, login, logout qua Supabase Auth |
| `services/pdf_parser.py` | Gia Phú | Parse PDF → list pages |
| `services/chunker.py` | Gia Phú | Chunk text với overlap |
| `routers/documents.py` | Gia Phú | Upload + list + delete, gắn user_id |
| `dependencies.py` | Gia Phú | Verify JWT token, inject user vào endpoint |
| `services/embedder.py` | Đức Tâm | Gemini text-embedding-004 |
| `services/retriever.py` | Đức Tâm | Vector search trong Supabase |
| `services/llm.py` | Đức Tâm | Gemini Flash generation + streaming |
| `routers/chat.py` | Đức Tâm | Chat endpoints với auth |

## Cách dùng auth trong endpoint mới

Mọi endpoint cần đăng nhập đều thêm `Depends(get_current_user)`:

```python
from app.dependencies import get_current_user

@router.get("/something")
async def something(user=Depends(get_current_user)):
    user_id = user["id"]    # UUID của user đang đăng nhập
    email   = user["email"]
```

Nếu token thiếu hoặc hết hạn, FastAPI tự trả về `401 UNAUTHORIZED` mà không cần tự xử lý.

## Supabase Setup

Chạy SQL trong Supabase SQL Editor (xem đầy đủ trong `docs/architecture.md`):