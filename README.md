# 🔬 AI Researching Assistant

AI Researching Assistant là ứng dụng web hỗ trợ quản lý tài liệu học thuật, đọc hiểu tài liệu bằng RAG, ghi chú và tạo học liệu tự động. Dự án hiện gồm **FastAPI backend**, **React/Vite frontend** và **Supabase** làm lớp dữ liệu, xác thực, lưu metadata và tìm kiếm vector với pgvector.

## Tính năng hiện có

- **Xác thực người dùng**: đăng ký, đăng nhập email/mật khẩu, đăng nhập Google Identity Services, đăng xuất và quên mật khẩu bằng OTP email.
- **Hồ sơ cá nhân**: cập nhật thông tin, avatar, đổi mật khẩu, bật/tắt email 2FA, liên kết/hủy liên kết Google, tùy chỉnh preferences, xuất dữ liệu và xóa tài khoản.
- **Notebook / Workspace**: tạo, sửa, xóa notebook; mỗi notebook đóng vai trò workspace chứa tài liệu, phiên nghiên cứu và ghi chú.
- **Upload tài liệu RAG**: hỗ trợ PDF, DOCX, TXT và MD; `.doc`/`.rtf` bị từ chối với hướng dẫn chuyển đổi rõ ràng.
- **RAG Chat**: hỏi đáp trên toàn notebook hoặc một tập tài liệu đã chọn; hỗ trợ non-streaming và SSE streaming.
- **Research Sessions**: lưu phiên nghiên cứu, lịch sử chat, notes, xuất DOCX, tạo flashcards, quiz và test bằng Groq.
- **System Library**: thư viện tài liệu dùng chung, tìm kiếm/lọc, bookmark, tải xuống, liên kết tài liệu hệ thống vào notebook; có màn hình admin import/xóa tài liệu.
- **Cross Analysis**: upload tài liệu để so sánh, tìm mâu thuẫn, tổng hợp và chat theo nhóm tài liệu.
- **Academic Lens**: xem trước tài liệu, chat theo tài liệu, chat web context, vision chat từ ảnh/crop và notepad.

## Kiến trúc tổng quan

```text
Frontend React/Vite
  ├─ Auth, Profile, Notebooks, Research Sessions, Notes
  ├─ System Library, Cross Analysis, Academic Lens
  └─ axios/fetch → FastAPI API

FastAPI Backend
  ├─ Routers: auth, profile, notebooks, documents, chat, notes, workspaces,
  │           research_sessions, system_library, admin, cross_analysis, academic_lens
  ├─ Services: parser, chunker, embedder, retriever, llm, Groq, Vision, email, JWT
  └─ Supabase client

Supabase
  ├─ Auth + profiles
  ├─ notebooks, documents, document_chunks, notes, research sessions
  ├─ system library tables + storage buckets
  └─ pgvector RPC for semantic search
```

## Luồng RAG chính

```text
Upload PDF/DOCX/TXT/MD
  → FastAPI validate file, kiểm tra trùng tên và giới hạn dung lượng
  → Parse tài liệu (PyMuPDF/Gemini Vision cho PDF, python-docx cho DOCX, decode text cho TXT/MD)
  → Chunk nội dung bằng LangChain text splitter
  → Embed bằng Google gemini-embedding-001
  → Lưu documents + document_chunks vào Supabase/pgvector

User hỏi trong notebook/session
  → Embed câu hỏi
  → Supabase RPC match_chunks theo notebook và tài liệu được chọn
  → Build prompt từ top-k chunks + chat history
  → Gemini sinh câu trả lời
  → Trả answer, sources/citations, suggested prompts và lưu message nếu có research_session_id
```

## Công nghệ sử dụng

| Lớp | Công nghệ |
| --- | --- |
| Frontend | React 18, Vite 5, React Router, Tailwind CSS, Axios, react-markdown, lucide-react |
| Backend | FastAPI, Uvicorn, Pydantic Settings, python-multipart |
| Parse tài liệu | PyMuPDF, python-docx, Gemini Vision fallback cho PDF scan/khó đọc |
| Chunking | LangChain text splitters, tiktoken |
| Embedding | Google `gemini-embedding-001` |
| LLM/RAG | Gemini qua `google-genai` |
| Flashcards/Quiz/Test | Groq |
| Database/Auth/Storage | Supabase, pgvector, Storage buckets |
| Email | SMTP cho OTP/quên mật khẩu/2FA |

## Cấu trúc thư mục

```text
AIResearchingAssistant/
├── backend/                 # FastAPI API, services, routers, tests
│   ├── app/
│   ├── tests/
│   ├── .env.example
│   ├── requirements.txt
│   └── README.md
├── frontend/                # React + Vite UI
│   ├── src/
│   ├── .env.example
│   ├── package.json
│   └── README.md
├── docs/                    # SQL, API contract, architecture, import guide
│   ├── api_contract.md
│   ├── architecture.md
│   └── sql/
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

- `GOOGLE_API_KEY`: dùng cho Gemini embedding/LLM/vision.
- `VISION_MODEL`: model OCR/vision fallback, mặc định `gemini-1.5-flash`.
- `GROQ_API_KEY`, `GROQ_FLASHCARD_MODEL`: tạo flashcards, quiz và test.
- `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `SUPABASE_ANON_KEY`: kết nối Supabase.
- `CORS_ORIGINS`: danh sách frontend origins được phép gọi API.
- `GOOGLE_CLIENT_ID`: client ID Google Identity Services, phải khớp frontend.
- `JWT_SECRET_KEY`: secret ký session token nội bộ cho Google login backend flow.
- `SMTP_*`: gửi OTP/quên mật khẩu/email 2FA.
- `MAX_UPLOAD_MB`: giới hạn dung lượng upload.
- `SYSTEM_LIBRARY_ADMIN_EMAIL`, `SYSTEM_LIBRARY_ADMIN_PASSWORD`, `SYSTEM_LIBRARY_STORAGE_BUCKET`: cấu hình admin/system library.
- `AVATAR_STORAGE_BUCKET`: bucket lưu avatar.

### Frontend (`frontend/.env`)

- `VITE_API_URL`: base URL của FastAPI backend.
- `VITE_MAX_UPLOAD_MB`: giới hạn upload hiển thị trên UI, nên khớp backend.
- `VITE_GOOGLE_CLIENT_ID`: Google Identity Services OAuth Client ID.

## Tài liệu liên quan

- [Backend README](./backend/README.md)
- [Frontend README](./frontend/README.md)
- [API Contract](./docs/api_contract.md)
- [Architecture](./docs/architecture.md)
- [System Library Import Guide](./docs/system_library_import_guide.md)
- SQL trong [`docs/sql`](./docs/sql)

## Ghi chú vận hành

- Không commit `.env`, service role key, JWT secret, SMTP password hoặc API key thật.
- Chạy các file SQL trong `docs/sql` tương ứng với tính năng Supabase trước khi dùng đầy đủ profile, notes, research sessions và system library.
- Nếu dùng Google login theo backend flow hiện tại, chỉ cần Google Identity Services ID token được backend verify; không bắt buộc bật Supabase Google provider cho endpoint `/api/auth/google`.
