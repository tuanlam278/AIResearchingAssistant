# Backend — AI Research Assistant (FastAPI)

Phiên bản: 2.0.0

README này mô tả chi tiết backend của ứng dụng AI Research Assistant — một dịch vụ FastAPI triển khai mô hình RAG (Retrieval-Augmented Generation) kết hợp Supabase cho lưu trữ, xác thực và tìm kiếm vector.

**Mục tiêu**: cho phép người dùng upload tài liệu (PDF) vào "notebooks", tách nội dung thành các chunk, nhúng (embed) bằng embedding model, lưu vector vào Supabase, rồi trả lời câu hỏi bằng cách kết hợp truy vấn vector và generation từ LLM.

---

**Yêu cầu**
- Python 3.10+ (khuyến nghị)
- Một môi trường ảo (venv / virtualenv / conda)
- Supabase project (có pgvector và các bảng cần thiết)
- API key cho Google / Gemini nếu sử dụng Gemini API

Xem `requirements.txt` để biết các thư viện Python cần thiết.

---

## Cài đặt nhanh

```bash
cd backend
python -m venv .venv
# Windows
.venv\\Scripts\\activate
# macOS / Linux
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
# Sửa file .env với các biến cấu hình cần thiết (xem phía dưới)
```

---

## Biến môi trường (bắt buộc / quan trọng)

- `GOOGLE_API_KEY` — (nếu dùng) API key cho Google/Gemini.
- `SUPABASE_URL` — URL của project Supabase.
- `SUPABASE_SERVICE_KEY` — Service Role Key (chỉ dùng server-side).
- `SUPABASE_ANON_KEY` — Public anon key (dùng cho client-side auth flows nếu cần).
- `CORS_ORIGINS` — Danh sách origin được phép truy cập API (mặc định: `["http://localhost:5173"]`).
- Các biến cấu hình khác có thể nằm trong `app/config.py` (ví dụ: chunk size, top_k, v.v.).

Lưu ý: Không commit `SUPABASE_SERVICE_KEY` hoặc các key nhạy cảm vào git.

---

## Chạy server (phát triển)

```bash
uvicorn app.main:app --reload
# Sau đó mở: http://localhost:8000/docs
```

---

## Kiến trúc thư mục chính

```
backend/app/
├── main.py            # Tạo FastAPI app, CORS, đăng ký router
├── config.py          # Pydantic Settings + cấu hình chung
├── dependencies.py    # get_current_user — xác thực JWT từ Supabase
├── db/
│   └── supabase_client.py  # Wrapper cho Supabase (client, RPC)
├── models/
│   └── schemas.py     # Pydantic schemas (auth, notebook, document, chat)
├── routers/
│   ├── auth.py        # Đăng ký / đăng nhập / đăng xuất
│   ├── notebooks.py   # CRUD notebook, upload file vào notebook
│   ├── documents.py   # Upload / list / delete tài liệu standalone
│   └── chat.py        # Endpoint hỏi đáp (non-stream + stream)
└── services/
    ├── pdf_parser.py  # Parse PDF → pages (PyMuPDF + tùy biến)
    ├── chunker.py     # Chia trang thành chunk (size, overlap)
    ├── embedder.py    # Gọi embedding model (gemini-embedding-001 hoặc tương đương)
    ├── retriever.py   # Tìm kiếm vector trong Supabase (RPC match_chunks)
    └── llm.py         # Generation + streaming từ LLM (Gemini/other)
```

---

## API chính (tổng quan)

1) Auth — `/api/auth`
- `POST /api/auth/register` — đăng ký tài khoản mới.
- `POST /api/auth/login` — đăng nhập, trả `access_token`.
- `POST /api/auth/logout` — đăng xuất (yêu cầu Bearer token).

2) Notebooks — `/api/notebooks` (cần auth)
- `POST /api/notebooks` — tạo notebook mới.
- `GET /api/notebooks` — lấy danh sách notebooks của user.
- `DELETE /api/notebooks/{notebook_id}` — xóa notebook (kèm xóa document + chunk liên quan).
- `POST /api/notebooks/{notebook_id}/upload` — upload nhiều PDF vào một notebook.
- `GET /api/notebooks/{notebook_id}/documents` — liệt kê documents trong notebook.

3) Documents — `/api/documents` (dạng standalone)
- `POST /api/documents/upload` — upload một file PDF (không gắn notebook).
- `GET /api/documents` — lấy danh sách documents của user.
- `DELETE /api/documents/{doc_id}` — xóa document.

4) Chat — `/api/chat` (RAG)
- `POST /api/chat/ask` — trả về JSON với câu trả lời (non-streaming).
- `POST /api/chat/ask/stream` — SSE stream trả token/text từng phần (`text/event-stream`).

Request body mẫu cho `/ask` và `/ask/stream`:

```json
{
  "notebook_id": "<uuid-notebook>",
  "question": "Nội dung câu hỏi",
  "chat_history": [
    { "role": "user", "content": "..." },
    { "role": "assistant", "content": "..." }
  ]
}
```

---

## Luồng xử lý RAG (tóm tắt)

1. Người dùng upload file PDF vào một `notebook`.
2. `pdf_parser` tách PDF thành các trang / khối văn bản thô.
3. `chunker` chia văn bản thành các chunk (ví dụ size=500, overlap=50).
4. `embedder` gọi embedding model (ví dụ `gemini-embedding-001`) để tạo vector (dimension 768).
5. Lưu metadata document và chunk (kèm embedding vector) vào Supabase (`documents`, `document_chunks`).
6. Khi người dùng gửi câu hỏi: embed query → gọi RPC `match_chunks` trên Supabase để lấy top-k chunks theo cosine similarity → kết hợp chunks và chat_history làm prompt cho LLM → sinh câu trả lời và trả về (JSON hoặc SSE stream).

---

## Supabase — bảng và RPC cần thiết

Các bảng/field tối thiểu (ví dụ):

- `notebooks`: `id (uuid)`, `user_id`, `name`, `created_at`.
- `documents`: `id`, `notebook_id`, `filename`, `page_count`, `chunk_count`, `created_at`.
- `document_chunks`: `id`, `doc_id`, `notebook_id`, `content`, `page_number`, `chunk_index`, `embedding vector(768)`, `created_at`.

- RPC `match_chunks(query_embedding, target_notebook_id, match_count)` — trả về các chunk đã match sắp xếp theo similarity.

Chi tiết SQL / migration có thể đặt trong `docs/architecture.md` nếu cần.

---

## Cách sử dụng auth trong code

Các endpoint cần xác thực đều dùng dependency `get_current_user` từ `app.dependencies`: hàm này xác minh JWT (Supabase) và inject thông tin user vào handler.

Ví dụ:

```python
from app.dependencies import get_current_user

@router.get("/protected")
async def protected(user=Depends(get_current_user)):
    user_id = user["user_id"]
    return {"user_id": user_id}
```

Nếu token thiếu hoặc không hợp lệ, endpoint trả `401 Unauthorized` tự động.

---

## Ghi chú dành cho developer

- File cấu hình trung tâm: `app/config.py`.
- Khuyến nghị: dùng batch embedding (nếu nhiều chunk) để tối ưu tốc độ và chi phí.
- Kiểm thử: chạy unit test cho `chunker` và `retriever` trước khi deploy.
- Tối ưu: cân nhắc sao lưu vector hoặc dùng Supabase Edge Functions cho một số xử lý nặng.

---

## Phân công (hiện tại)

- `routers/auth.py`, `services/pdf_parser.py`, `services/chunker.py`, `routers/documents.py`, `dependencies.py`, `routers/notebooks.py` — Gia Phú
- `services/embedder.py`, `services/retriever.py`, `services/llm.py`, `routers/chat.py` — Đức Tâm

---

## Contributing

- Fork repo, tạo branch feature, gửi PR mô tả rõ thay đổi.
- Kiểm tra biến môi trường và chạy QA cho pipeline RAG khi thay đổi `embedder`/`retriever`/`llm`.

---

## License

Đặt license phù hợp với dự án (nếu cần) — ví dụ MIT / Apache-2.0.

---

Nếu bạn muốn, tôi có thể:
- Dịch README sang tiếng Anh.
- Thêm phần hướng dẫn chạy trên Docker / production.
- Thêm script migration SQL mẫu cho Supabase.

Cảm ơn — README đã cập nhật tại [backend/README.md](backend/README.md).