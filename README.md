# 🔬 AI Researching Assistant

AI Researching Assistant là ứng dụng web hỗ trợ quản lý tài liệu học thuật, đọc hiểu tài liệu bằng RAG, ghi chú, phân tích chéo tài liệu và tạo học liệu tự động. Dự án hiện gồm **FastAPI backend**, **React/Vite frontend** và **Supabase + pgvector** làm lớp dữ liệu, xác thực, storage và tìm kiếm vector.

## Tính năng hiện có

- **Xác thực & hồ sơ**: đăng ký/đăng nhập email, Google Identity Services, quên mật khẩu OTP email, hồ sơ cá nhân, avatar, đổi mật khẩu, email 2FA, preferences, export/xóa tài khoản.
- **Notebook / Research Workspace**: tạo workspace, upload tài liệu, chọn tài liệu để hỏi RAG, lưu phiên nghiên cứu, ghi chú, export DOCX và tạo flashcards/quiz/test.
- **Upload & indexing tài liệu**: hỗ trợ PDF, DOCX, TXT, MD; `.doc`/`.rtf` được nhận diện nhưng trả hướng dẫn chuyển đổi.
- **Structured academic parsing**: PDF được đọc local-first bằng PyMuPDF; bảng PDF text-native được ưu tiên trích xuất bằng `pdfplumber` thành Markdown table; output page/block có metadata `page`, `block_type`, `section`, `source`.
- **Vision OCR opt-in**: Gemini Vision chỉ fallback cho PDF scan/khó đọc khi bật cấu hình rõ ràng; prompt OCR chuẩn hóa Markdown, bảng và công thức LaTeX.
- **RAG Chat & citations**: hỏi đáp theo notebook/tài liệu đã chọn, hỗ trợ non-streaming và SSE streaming, citations có page/section/block type/snippet; bấm nguồn trong Research Workspace mở panel/modal nguồn bên phải.
- **System Library**: thư viện tài liệu dùng chung, tìm kiếm/lọc, bookmark, tải xuống, liên kết tài liệu hệ thống vào notebook; admin có thể import/xóa tài liệu.
- **Cross Analysis**: upload/khai thác nhiều tài liệu để so sánh, tìm mâu thuẫn, tổng hợp và chat theo nhóm tài liệu.
- **Academic Lens**: xem trước tài liệu, Document AI, Global Web Chat, vision chat từ ảnh/crop, web context và notepad.
- **Vận hành ổn định hơn với Supabase**: batch insert vector nhỏ hơn, timeout dài hơn và retry/backoff cho lỗi socket/network transient trong background indexing.

## Kiến trúc tổng quan

```text
Frontend React/Vite
  ├─ Auth, Profile, Notebooks, Research Workspace, Notes
  ├─ System Library, Cross Analysis, Academic Lens
  └─ src/services/api.js → FastAPI API

FastAPI Backend
  ├─ Routers: auth, profile, notebooks, documents, chat, notes, workspaces,
  │           research_sessions, system_library, admin, cross_analysis,
  │           academic_lens, indexing, generation
  ├─ Services: document parser/structure, pdf table extraction, chunker,
  │           embedder, retriever, LLM, Groq, Vision, email, JWT
  └─ Supabase client + retry/backoff wrapper

Supabase
  ├─ Auth + profiles
  ├─ notebooks, documents, document_chunks, document_pages, document_blocks
  ├─ notes, research sessions/messages, indexing/generation jobs
  ├─ system library tables + system_document_chunks/pages/blocks
  ├─ private Storage buckets
  └─ pgvector RPC for semantic search
```

## Luồng RAG chính

```text
Upload PDF/DOCX/TXT/MD
  → FastAPI validate file, dung lượng, trùng tên
  → Persist source file vào Supabase Storage nếu bucket được cấu hình
  → Parse local-first:
      PDF: PyMuPDF text blocks + pdfplumber tables → structured Markdown
      DOCX: paragraph/table extraction → structured Markdown
      TXT/MD: decode text → block structure
      Vision OCR: chỉ fallback nếu ENABLE_PDF_VISION_FALLBACK=true
  → Chunk theo Markdown/page/block metadata
  → Embed bằng Google gemini-embedding-001
  → Insert documents/chunks/pages/blocks vào Supabase với batch nhỏ + retry

User hỏi trong notebook/session
  → Embed câu hỏi
  → Supabase RPC match_chunks theo notebook và tài liệu được chọn
  → Build prompt từ top-k chunks + history
  → LLM sinh câu trả lời
  → Trả answer + citations/page/block metadata
  → Frontend cho phép bấm nguồn để mở panel/modal nguồn
```

## Công nghệ sử dụng

| Lớp | Công nghệ |
| --- | --- |
| Frontend | React 18, Vite 5, React Router, Axios, react-markdown, lucide-react |
| Backend | FastAPI, Uvicorn, Pydantic Settings, python-multipart |
| Parse tài liệu | PyMuPDF, `pdfplumber`, python-docx, Pillow, Gemini Vision opt-in fallback |
| Structured extraction | `document_pages`, `document_blocks`, Markdown table, LaTeX convention |
| Chunking | LangChain text splitters, tiktoken fallback |
| Embedding | Google `gemini-embedding-001` |
| LLM/RAG | Gemini qua `google-genai` |
| Flashcards/Quiz/Test | Groq |
| Database/Auth/Storage | Supabase, pgvector, private Storage buckets |
| Email | SMTP cho OTP/quên mật khẩu/2FA |

## Cấu trúc thư mục

```text
AIResearchingAssistant/
├── backend/                 # FastAPI API, services, routers, tests
│   ├── app/
│   │   ├── db/              # Supabase client + retry helper
│   │   ├── routers/
│   │   └── services/        # Parser, structured extraction, RAG, jobs
│   ├── tests/
│   ├── .env.example
│   ├── requirements.txt
│   └── README.md
├── frontend/                # React + Vite UI
│   ├── src/
│   ├── .env.example
│   ├── package.json
│   └── README.md
├── docs/                    # SQL, API contract, architecture, guides
│   ├── sql/
│   ├── api_contract.md
│   └── architecture.md
└── README.md
```

## Chạy nhanh ở môi trường development

### 1) Backend

```bash
cd backend
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env
uvicorn app.main:app --reload
```

API mặc định chạy tại `http://localhost:8000`, OpenAPI docs tại `http://localhost:8000/docs`.

### 2) Frontend

```bash
cd frontend
npm install
cp .env.example .env
npm run dev
```

Frontend mặc định chạy tại `http://localhost:5173` và gọi backend qua `VITE_API_URL`.

## Biến môi trường quan trọng

### Backend (`backend/.env`)

- `GOOGLE_API_KEY`: dùng cho Gemini embedding/RAG generation và Vision nếu bật.
- `VISION_MODEL`: model Vision đọc từ `.env`; không hardcode trong code.
- `ENABLE_PDF_VISION_FALLBACK`: mặc định `false`; chỉ bật nếu chấp nhận gọi Vision cho PDF local extraction không đọc được.
- `ENABLE_MATH_OCR`, `MATH_OCR_PROVIDER`, `MATHPIX_APP_ID`, `MATHPIX_APP_KEY`: Math OCR optional, mặc định tắt.
- `GROQ_API_KEY`, `GROQ_FLASHCARD_MODEL`: tạo flashcards, quiz và test.
- `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`/`SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`: kết nối Supabase.
- `NOTEBOOK_STORAGE_BUCKET`, `INDEXING_STORAGE_BUCKET`, `SYSTEM_LIBRARY_STORAGE_BUCKET`, `COMMUNITY_LIBRARY_STORAGE_BUCKET`, `AVATAR_STORAGE_BUCKET`: storage private buckets.
- `INDEX_INSERT_BATCH_SIZE`, `SUPABASE_VECTOR_INSERT_BATCH_SIZE`: giới hạn batch insert để tránh nghẽn socket khi indexing.
- `SUPABASE_REQUEST_TIMEOUT_SECONDS`, `SUPABASE_STORAGE_TIMEOUT_SECONDS`, `SUPABASE_RETRY_ATTEMPTS`, `SUPABASE_RETRY_BASE_DELAY_SECONDS`: timeout/retry cho Supabase SDK.
- `CORS_ORIGINS`, `GOOGLE_CLIENT_ID`, `JWT_SECRET_KEY`, `SMTP_*`, `MAX_UPLOAD_MB`, `RAG_*`, `TOP_K_CHUNKS`, `MIN_SIMILARITY`.

### Frontend (`frontend/.env`)

- `VITE_API_URL`: base URL của FastAPI backend.
- `VITE_MAX_UPLOAD_MB`: giới hạn upload hiển thị trên UI, nên khớp backend.
- `VITE_GOOGLE_CLIENT_ID`: Google Identity Services OAuth Client ID.
- `VITE_STREAM_TYPEWRITER_INTERVAL_MS`, `VITE_STREAM_TYPEWRITER_CHARS_PER_TICK`: tốc độ hiệu ứng streaming trong Research Workspace.

## Supabase cần chuẩn bị

Chạy các SQL trong `docs/sql` tương ứng với tính năng cần dùng. Các nhóm quan trọng:

- Bảng core: profiles, notebooks, documents, notes, research sessions/messages.
- Vector: `document_chunks`, `system_document_chunks`, extension `vector`, RPC `match_chunks`/system search.
- Structured extraction: `docs/sql/structured_document_markdown.sql` để tạo `document_pages`, `document_blocks`, `system_document_pages`, `system_document_blocks` và thêm metadata chunk.
- Durable jobs: `docs/sql/indexing_jobs.sql` và generation jobs nếu dùng worker nền.
- API/RLS hardening: nếu tắt **Automatically expose new tables** và bật **Enable automatic RLS**, chạy `docs/sql/supabase_api_rls_hardening.sql` sau các schema migration để cấp quyền PostgREST rõ ràng và áp RLS policies cho các bảng bị ảnh hưởng.
- Storage buckets: `docs/sql/supabase_storage_buckets.sql` hoặc tạo thủ công private buckets trong Dashboard.

## Tài liệu liên quan

- [Backend README](./backend/README.md)
- [Frontend README](./frontend/README.md)
- [API Contract](./docs/api_contract.md)
- [Global Web Chat API Guide](./docs/global_web_chat_api_guide.md)
- [Architecture](./docs/architecture.md)
- [System Library Import Guide](./docs/system_library_import_guide.md)
- SQL trong [`docs/sql`](./docs/sql)

## Ghi chú vận hành

- Không commit `.env`, service role key, JWT secret, SMTP password hoặc API key thật.
- Vision OCR và Math OCR đều là opt-in; không bật nếu không muốn phát sinh chi phí API ngoài upload/indexing chủ động.
- Bucket Supabase nên để private; backend truy cập bằng service role key.
- Nếu `INDEXING_STORAGE_BUCKET` thiếu hoặc không tồn tại, Research Workspace upload có thể trả storage warning và chỉ index bằng payload tạm trong tiến trình.
- Khi background indexing tài liệu lớn, giảm `SUPABASE_VECTOR_INSERT_BATCH_SIZE` nếu vẫn gặp nghẽn socket hoặc timeout mạng.
