# Backend — AI Researching Assistant

Backend là dịch vụ **FastAPI** cung cấp API cho xác thực, quản lý notebook/workspace, upload và index tài liệu RAG, chat, ghi chú, research sessions, thư viện hệ thống, phân tích chéo và Academic Lens.

## Vai trò của backend

- Xác thực email/mật khẩu qua Supabase Auth và Google Identity Services qua backend verification.
- Quản lý profile, avatar, đổi mật khẩu, email 2FA, preferences và xuất/xóa dữ liệu người dùng.
- Nhận upload PDF/DOCX/TXT/MD, parse nội dung, chunk, embed và lưu metadata/vector vào Supabase.
- Cung cấp RAG chat non-streaming và SSE streaming với nguồn trích dẫn.
- Lưu research sessions, messages, notes; xuất DOCX; tạo flashcards/quiz/test bằng Groq.
- Quản lý System Library cho user và admin.
- Cung cấp Cross Analysis và Academic Lens APIs.

## Yêu cầu

- Python 3.10+
- Supabase project đã cấu hình bảng/RPC/storage theo các file SQL trong `../docs/sql`
- Google API key cho Gemini embedding/LLM/vision
- Groq API key nếu dùng flashcards/quiz/test
- SMTP nếu dùng OTP/quên mật khẩu/email 2FA thật

## Cài đặt và chạy local

```bash
cd backend
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env
uvicorn app.main:app --reload
```

- API: `http://localhost:8000`
- Swagger/OpenAPI: `http://localhost:8000/docs`
- Health check: `GET /api/health`

## Biến môi trường

Các biến mẫu nằm trong `.env.example`.

| Biến | Mục đích |
| --- | --- |
| `GOOGLE_API_KEY` | Gemini embedding, RAG generation và vision/OCR fallback |
| `VISION_MODEL` | Model vision đọc từ `.env` (ví dụ `gemini-3.1-flash-lite`); bắt buộc cho Academic Lens vision/OCR fallback |
| `GROQ_API_KEY` | Tạo flashcards, quiz và test |
| `GROQ_FLASHCARD_MODEL` | Model Groq cho học liệu, mặc định `llama-3.1-8b-instant` |
| `SUPABASE_URL` | URL Supabase project |
| `SUPABASE_SERVICE_KEY` | Service role key, chỉ dùng server-side |
| `SUPABASE_ANON_KEY` | Anon key cho một số auth flow |
| `CORS_ORIGINS` | Danh sách frontend origin được phép gọi API |
| `MAX_UPLOAD_MB` | Giới hạn dung lượng upload |
| `RAG_RELEVANCE_THRESHOLD`, `TOP_K_CHUNKS`, `MIN_SIMILARITY` | Cấu hình retrieval/RAG |
| `GOOGLE_CLIENT_ID` | Google OAuth web client ID cho Google login/linking |
| `JWT_SECRET_KEY` | Secret ký session token nội bộ |
| `APP_ENV`, `ENABLE_DEV_AUTH_BYPASS` | Điều khiển bypass/dev auth safety |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` | Gửi email OTP/quên mật khẩu/2FA |
| `AVATAR_STORAGE_BUCKET` | Bucket lưu avatar |
| `SYSTEM_LIBRARY_ADMIN_EMAIL`, `SYSTEM_LIBRARY_ADMIN_PASSWORD`, `SYSTEM_LIBRARY_STORAGE_BUCKET` | Admin và storage cho system library |

> Không commit key thật. `SUPABASE_SERVICE_KEY`, `JWT_SECRET_KEY`, `GOOGLE_API_KEY`, `GROQ_API_KEY` và SMTP password phải được cấu hình bằng secret manager ở production.

## Cấu trúc chính

```text
app/
├── main.py                     # Tạo FastAPI app, CORS, đăng ký routers
├── config.py                   # Pydantic Settings đọc .env
├── dependencies.py             # Dependency xác thực user hiện tại
├── db/
│   └── supabase_client.py      # Supabase client dùng chung
├── models/
│   └── schemas.py              # Pydantic schemas
├── routers/
│   ├── auth.py                 # Register/login/me/logout/google/password reset
│   ├── profile.py              # Profile, avatar, password, 2FA, Google linking
│   ├── notebooks.py            # CRUD notebook, upload, link system docs
│   ├── documents.py            # List/delete/summarize documents
│   ├── chat.py                 # RAG ask + SSE stream
│   ├── notes.py                # Workspace/session notes
│   ├── workspaces.py           # Workspace document summary
│   ├── research_sessions.py    # Sessions, messages, export, study assets
│   ├── system_library.py       # User-facing system library
│   ├── admin.py                # Admin system library import/delete
│   ├── cross_analysis.py       # Compare/conflicts/synthesis/chat
│   └── academic_lens.py        # Document/web/vision chat + notepad
└── services/
    ├── document_parser.py      # Dispatch PDF/DOCX/TXT/MD parser
    ├── pdf_parser.py           # PDF text extraction + OCR fallback
    ├── chunker.py              # Chunk tài liệu
    ├── embedder.py             # Gemini embeddings
    ├── retriever.py            # Supabase pgvector retrieval
    ├── llm.py                  # Gemini generation/RAG response
    ├── groq_service.py         # Flashcards/quiz/test
    ├── vision_service.py       # Vision tasks cho Academic Lens
    ├── email_service.py        # SMTP email
    └── *_service.py            # Business logic cho auth/profile/system library/etc.
```

## API groups chính

| Nhóm | Prefix | Chức năng |
| --- | --- | --- |
| Auth | `/api/auth` | register, login, me, logout, Google login, password reset OTP |
| Profile | `/api/profile` | profile, avatar, đổi mật khẩu, email 2FA, Google linking, preferences, export/delete account |
| Notebooks | `/api/notebooks` | CRUD notebook, upload tài liệu, list documents, link system document |
| Documents | `/api/documents` | list, delete, summarize document |
| Chat | `/api/chat` | `POST /ask`, `POST /ask/stream` |
| Workspaces | `/api/workspaces` | document summary, research sessions, notes |
| Research Sessions | `/api/research-sessions` | session metadata, messages, notes, DOCX export, flashcards/quiz/test |
| System Library | `/api/system-library` | list/search/download/bookmark tài liệu hệ thống |
| Admin | `/api/admin/system-library` | import/list/delete tài liệu hệ thống |
| Cross Analysis | `/api/cross-analysis` | upload, compare, conflicts, synthesis, chat, preview |
| Academic Lens | `/api/academic-lens` | upload/preview, document chat, web chat, vision chat, web context, notepad |

## File upload và RAG

- Endpoint upload notebook: `POST /api/notebooks/{notebook_id}/upload` với multipart field `files`.
- Định dạng được index: `.pdf`, `.docx`, `.txt`, `.md`.
- `.doc` và `.rtf` được nhận diện nhưng trả lỗi hướng dẫn chuyển đổi vì chưa hỗ trợ index trực tiếp.
- Backend kiểm tra dung lượng, trùng tên trong cùng notebook, parse nội dung, chunk, embed và lưu vào Supabase.
- Query RAG dùng `notebook_id`, `question`, `chat_history`, tùy chọn `selected_document_ids` và `research_session_id`.

## Supabase cần chuẩn bị

- Bật extension `vector`.
- Tạo các bảng chính: profiles, notebooks, documents, document_chunks, notes, research sessions/messages, system library, password reset OTPs.
- Tạo RPC match chunks/search tương ứng.
- Tạo storage buckets cho avatar và system documents nếu dùng các tính năng đó.
- Tham khảo các script SQL trong `../docs/sql`.

## Kiểm thử

```bash
cd backend
python -m pytest
```

Hiện repo có test cho Groq service trong `tests/test_groq_service.py`. Khi thay đổi parser/chunker/retriever/LLM, nên bổ sung test cho luồng RAG tương ứng.

## Ghi chú phát triển

- Không bọc import bằng `try/except`; dependency thiếu nên được phát hiện rõ khi chạy môi trường.
- Giữ response thành công theo format `{ "success": true, "data": ... }` và lỗi theo `detail`/`error` hiện có để frontend normalize được.
- Khi thêm API mới, cập nhật `../docs/api_contract.md` và `frontend/src/services/api.js` nếu UI cần gọi.


## Supabase Storage buckets

Create these **private** buckets in Supabase Dashboard > Storage > Buckets, or run `docs/sql/supabase_storage_buckets.sql` with admin/service-role privileges:

- `NOTEBOOK_STORAGE_BUCKET` / `INDEXING_STORAGE_BUCKET` (example: `notebook-sources`): durable source files for ResearchWorkspace notebook indexing.
- `SYSTEM_LIBRARY_STORAGE_BUCKET` (example: `system-documents`): original files for curated/system library documents.
- `COMMUNITY_LIBRARY_STORAGE_BUCKET` (usually same as system library bucket): user/community library uploads.
- `AVATAR_STORAGE_BUCKET` (example: `avatars`): profile avatars.

The backend uploads/downloads these objects with `SUPABASE_SERVICE_ROLE_KEY`/`SUPABASE_SERVICE_KEY`, so the buckets should remain private and do not need public read policies. If `INDEXING_STORAGE_BUCKET` is missing or points to a non-existent bucket, ResearchWorkspace upload returns a storage warning and indexes only via temporary in-process payload.
