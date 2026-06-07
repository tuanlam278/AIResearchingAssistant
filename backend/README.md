# Backend — AI Researching Assistant

Backend là dịch vụ **FastAPI** cung cấp API cho xác thực, profile, notebook/workspace, upload/index tài liệu RAG, chat streaming, notes, research sessions, System Library, Cross Analysis và Academic Lens. Backend dùng Supabase cho Auth/Database/Storage, pgvector cho retrieval, Google Gemini cho embedding/RAG, Groq cho học liệu, và Vision OCR chỉ khi được bật cấu hình.

## Vai trò của backend

- Xác thực email/mật khẩu qua Supabase Auth và Google Identity Services qua backend verification.
- Quản lý profile, avatar, đổi mật khẩu, email 2FA, preferences, Google linking và export/xóa dữ liệu.
- Nhận upload PDF/DOCX/TXT/MD, parse nội dung học thuật, chunk, embed và lưu vector/metadata vào Supabase.
- Trích xuất cấu trúc tài liệu: page-level Markdown, block metadata, bảng Markdown, công thức LaTeX theo quy ước khi parser/Vision đọc được.
- Cung cấp RAG chat non-streaming và SSE streaming với citations, diagnostics và selected document scope.
- Lưu research sessions/messages/notes; xuất DOCX; tạo flashcards/quiz/test bằng Groq.
- Quản lý System Library user/admin và copy vector tài liệu hệ thống vào notebook.
- Cung cấp Cross Analysis và Academic Lens APIs.
- Chống nghẽn mạng khi background indexing bằng batch insert nhỏ, Supabase timeout dài hơn và retry/backoff cho lỗi socket transient.

## Yêu cầu

- Python 3.10+
- Supabase project đã cấu hình bảng/RPC/storage theo các file SQL trong `../docs/sql`
- Google API key cho Gemini embedding/RAG; Vision chỉ cần nếu bật OCR/Academic Lens vision
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

## Biến môi trường chính

Các biến mẫu nằm trong `.env.example`.

| Biến | Mục đích |
| --- | --- |
| `GOOGLE_API_KEY` | Gemini embedding, RAG generation và Vision nếu bật |
| `VISION_MODEL` | Model vision đọc từ `.env`; cần cho Academic Lens vision/PDF OCR fallback |
| `ENABLE_PDF_VISION_FALLBACK` | Mặc định `false`; chỉ khi `true` mới fallback Vision cho PDF local extraction thất bại |
| `ENABLE_ADVANCED_TABLE_EXTRACTION` | Cờ dự phòng cho extractor nâng cao optional; `pdfplumber` local vẫn được ưu tiên |
| `ENABLE_MATH_OCR`, `MATH_OCR_PROVIDER` | Math OCR optional, mặc định tắt |
| `MATHPIX_APP_ID`, `MATHPIX_APP_KEY` | Chỉ dùng nếu chủ động bật provider Mathpix |
| `GROQ_API_KEY`, `GROQ_FLASHCARD_MODEL` | Tạo flashcards, quiz và test |
| `SUPABASE_URL` | URL Supabase project |
| `SUPABASE_SERVICE_KEY` / `SUPABASE_SERVICE_ROLE_KEY` | Service role key, chỉ dùng server-side |
| `SUPABASE_ANON_KEY` | Anon key cho một số auth flow |
| `SUPABASE_REQUEST_TIMEOUT_SECONDS` | Timeout PostgREST/Supabase client, mặc định dài hơn để tránh timeout khi indexing |
| `SUPABASE_STORAGE_TIMEOUT_SECONDS` | Timeout storage upload/download |
| `SUPABASE_FUNCTION_TIMEOUT_SECONDS` | Timeout Supabase functions nếu dùng |
| `SUPABASE_RETRY_ATTEMPTS`, `SUPABASE_RETRY_BASE_DELAY_SECONDS` | Retry/backoff cho lỗi mạng transient như `WinError 10035` |
| `INDEX_INSERT_BATCH_SIZE` | Batch insert metadata/pages/blocks |
| `SUPABASE_VECTOR_INSERT_BATCH_SIZE` | Batch insert chunks/vector; nên nhỏ khi mạng yếu |
| `NOTEBOOK_STORAGE_BUCKET`, `INDEXING_STORAGE_BUCKET` | Source files cho notebook indexing |
| `SYSTEM_LIBRARY_STORAGE_BUCKET`, `COMMUNITY_LIBRARY_STORAGE_BUCKET` | Source files cho System/Community Library |
| `AVATAR_STORAGE_BUCKET` | Bucket avatar |
| `CORS_ORIGINS` | Frontend origins được phép gọi API |
| `MAX_UPLOAD_MB` | Giới hạn dung lượng upload |
| `RAG_RELEVANCE_THRESHOLD`, `TOP_K_CHUNKS`, `MIN_SIMILARITY` | Retrieval/RAG |
| `GOOGLE_CLIENT_ID`, `JWT_SECRET_KEY` | Google login/linking và token nội bộ |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` | Email OTP/quên mật khẩu/2FA |

> Không commit key thật. Production nên dùng secret manager cho service-role key, JWT secret, Google/Groq keys và SMTP password.

## Cấu trúc chính

```text
app/
├── main.py                         # FastAPI app, CORS, routers, workers startup
├── config.py                       # Pydantic Settings đọc .env
├── dependencies.py                 # Dependency xác thực user hiện tại
├── db/
│   ├── supabase_client.py          # Supabase client, httpx timeout/limits
│   └── supabase_retry.py           # Retry/backoff wrapper cho lỗi socket/network
├── models/
│   └── schemas.py                  # Pydantic schemas
├── routers/
│   ├── auth.py                     # Register/login/me/logout/google/password reset
│   ├── profile.py                  # Profile, avatar, password, 2FA, Google linking
│   ├── notebooks.py                # CRUD notebook, upload, link system docs
│   ├── documents.py                # List/delete/summarize documents
│   ├── chat.py                     # RAG ask + SSE stream
│   ├── notes.py                    # Workspace/session notes
│   ├── research_sessions.py        # Sessions, messages, export, study assets
│   ├── system_library.py           # User-facing system library
│   ├── admin.py                    # Admin system library import/delete
│   ├── cross_analysis.py           # Compare/conflicts/synthesis/chat
│   ├── academic_lens.py            # Document/web/vision chat + notepad
│   ├── indexing.py                 # Indexing job APIs
│   └── generation.py               # Generation job APIs
└── services/
    ├── document_parser.py          # Dispatch PDF/DOCX/TXT/MD parser
    ├── document_structure_service.py # DocumentBlock + page/block helpers
    ├── pdf_parser.py               # PyMuPDF + pdfplumber + opt-in Vision fallback
    ├── pdf_table_extractor.py      # pdfplumber table → Markdown table
    ├── math_ocr_service.py         # Optional Math OCR config guard
    ├── chunker.py                  # Chunk Markdown/page/block metadata
    ├── embedder.py                 # Gemini embeddings
    ├── retriever.py                # Supabase pgvector retrieval
    ├── llm.py                      # Gemini generation/RAG response
    ├── groq_service.py             # Flashcards/quiz/test
    ├── vision_service.py           # Academic Lens image analysis
    ├── indexing_jobs.py            # Durable/background indexing jobs
    ├── generation_jobs.py          # Durable generation jobs
    └── *_service.py                # Business logic cho profile/library/cross-analysis/etc.
```

## API groups chính

| Nhóm | Prefix | Chức năng |
| --- | --- | --- |
| Auth | `/api/auth` | register, login, me, logout, Google login, password reset OTP |
| Profile | `/api/profile` | profile, avatar, đổi mật khẩu, email 2FA, Google linking, preferences, export/delete account |
| Notebooks | `/api/notebooks` | CRUD notebook, upload tài liệu, list documents, link system document |
| Documents | `/api/documents` | list, delete, summarize document |
| Chat | `/api/chat` | `POST /ask`, `POST /ask/stream` |
| Workspaces | `/api/workspaces` | document summary, workspace utilities |
| Research Sessions | `/api/research-sessions` | session metadata, messages, notes, DOCX export, flashcards/quiz/test |
| System Library | `/api/system-library` | list/search/download/bookmark tài liệu hệ thống |
| Admin | `/api/admin/system-library` | import/list/delete tài liệu hệ thống |
| Cross Analysis | `/api/cross-analysis` | upload, compare, conflicts, synthesis, chat, preview |
| Academic Lens | `/api/academic-lens` | upload/preview, document chat, web chat, vision chat, web context, notepad |
| Indexing/Generation | `/api/indexing`, `/api/generation` | trạng thái jobs nền |

## File upload, structured parsing và RAG

- Endpoint upload notebook: `POST /api/notebooks/{notebook_id}/upload` với multipart field `files`.
- Định dạng được index: `.pdf`, `.docx`, `.txt`, `.md`.
- `.doc` và `.rtf` trả lỗi hướng dẫn chuyển đổi vì chưa hỗ trợ index trực tiếp.
- PDF text-native đi qua pipeline local-first:
  1. PyMuPDF đọc text block và bbox.
  2. `pdfplumber` detect/extract bảng và chuyển thành Markdown table hợp lệ.
  3. Text trùng vùng bảng được bỏ bớt để giảm duplicate.
  4. Page Markdown + blocks được chunk/embed.
- DOCX đọc paragraph và table thành blocks; TXT/MD được convert sang block structure đơn giản.
- Vision OCR PDF chỉ chạy khi `ENABLE_PDF_VISION_FALLBACK=true`; nếu tắt, backend không tự gọi Vision cho mọi trang PDF.
- Chunk metadata gồm page range, section, block types, block ids, contains table/equation và Markdown snippet nếu schema hỗ trợ.

## Supabase cần chuẩn bị

- Bật extension `vector`.
- Tạo các bảng chính: profiles, notebooks, documents, document_chunks, notes, research sessions/messages, system library, password reset OTPs.
- Tạo RPC match chunks/search tương ứng.
- Chạy `../docs/sql/structured_document_markdown.sql` nếu muốn lưu `document_pages`, `document_blocks`, `system_document_pages`, `system_document_blocks` và metadata chunk mở rộng.
- Chạy SQL durable jobs nếu dùng indexing/generation workers.
- Tạo private storage buckets hoặc chạy `../docs/sql/supabase_storage_buckets.sql`.

## Supabase Storage buckets

Create these **private** buckets in Supabase Dashboard > Storage > Buckets, or run `../docs/sql/supabase_storage_buckets.sql` with admin/service-role privileges:

- `NOTEBOOK_STORAGE_BUCKET` / `INDEXING_STORAGE_BUCKET` (example: `notebook-sources`): durable source files for Research Workspace notebook indexing.
- `SYSTEM_LIBRARY_STORAGE_BUCKET` (example: `system-documents`): original files for curated/system library documents.
- `COMMUNITY_LIBRARY_STORAGE_BUCKET` (usually same as system library bucket): user/community library uploads.
- `AVATAR_STORAGE_BUCKET` (example: `avatars`): profile avatars.

The backend uploads/downloads these objects with service-role credentials, so buckets should remain private and do not need public read policies. If `INDEXING_STORAGE_BUCKET` is missing or points to a non-existent bucket, upload can return a storage warning and index only via temporary in-process payload.

## Kiểm thử

```bash
cd backend
python -m compileall app
pytest -q
```

Khi thay đổi parser/chunker/retriever/LLM, nên bổ sung smoke test cho parse → chunk → embed mock và test citation metadata.

## Ghi chú phát triển

- Không bọc import bằng `try/except`; dependency thiếu nên được phát hiện rõ khi chạy môi trường.
- Không hardcode model/API key; dùng `.env` và `Settings`.
- Không tự động gọi Vision/Mathpix/LLM nền nếu user chưa upload/chạy pipeline hoặc chưa bật cấu hình.
- Giữ response thành công theo format `{ "success": true, "data": ... }` và lỗi theo `detail`/`error` hiện có để frontend normalize được.
- Khi thêm API mới, cập nhật `../docs/api_contract.md` và `frontend/src/services/api.js` nếu UI cần gọi.
- Với indexing tài liệu lớn trên mạng yếu/Windows, ưu tiên giảm `SUPABASE_VECTOR_INSERT_BATCH_SIZE` trước khi tăng concurrency.
