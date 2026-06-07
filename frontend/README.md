# Frontend — AI Researching Assistant

Frontend là ứng dụng **React + Vite** cho AI Researching Assistant. UI hiện hỗ trợ xác thực, Home dashboard, Notebook/Research Workspace, RAG chat streaming, citations/source panel, notes, research sessions, System Library, admin import, Cross Analysis, Academic Lens và Profile.

## Chạy local

```bash
cd frontend
npm install
cp .env.example .env
npm run dev
```

- App mặc định: `http://localhost:5173`
- Backend mặc định: `http://localhost:8000` qua `VITE_API_URL`

## Scripts

| Lệnh | Mục đích |
| --- | --- |
| `npm run dev` | Chạy Vite dev server |
| `npm run build` | Build production |
| `npm run preview` | Preview bản build |

## Biến môi trường

| Biến | Mục đích |
| --- | --- |
| `VITE_API_URL` | Base URL của FastAPI backend |
| `VITE_MAX_UPLOAD_MB` | Giới hạn upload hiển thị trên frontend, nên khớp `MAX_UPLOAD_MB` backend |
| `VITE_GOOGLE_CLIENT_ID` | Google Identity Services OAuth Client ID |
| `VITE_STREAM_TYPEWRITER_INTERVAL_MS` | Delay hiệu ứng typewriter khi stream câu trả lời |
| `VITE_STREAM_TYPEWRITER_CHARS_PER_TICK` | Số ký tự hiển thị mỗi tick khi stream |

## Tech stack

| Thư viện | Dùng để |
| --- | --- |
| React 18 | UI components |
| Vite 5 | Dev server/build tool |
| React Router 6 | Routing và protected routes |
| Axios | HTTP client cho API JSON/multipart/blob |
| react-markdown | Render markdown trong chat/answers và citations |
| lucide-react | Icon set |
| Tailwind CSS/global CSS | Styling utility và style nội tuyến theo page |

## Cấu trúc chính

```text
src/
├── main.jsx                         # Mount React app
├── App.jsx                          # Route tree, ProtectedRoute, AdminRoute
├── index.css                        # Tailwind/global styles
├── context/
│   └── AuthContext.jsx              # Token/user context, persist localStorage
├── layouts/
│   └── AppShell.jsx                 # Layout sau đăng nhập
├── services/
│   └── api.js                       # API calls, auth header, errors, timeout, SSE helpers
├── components/
│   ├── layout/LeftSidebar.jsx
│   ├── ChatBox.jsx
│   ├── DocumentUploader.jsx
│   ├── DocumentList.jsx
│   ├── SourceCard.jsx
│   ├── system-library/*
│   └── academic-lens/*              # Academic Lens chat/viewer/citation UI
└── pages/
    ├── LoginPage.jsx
    ├── RegisterPage.jsx
    ├── ForgotPasswordPage.jsx
    ├── HomePage.jsx
    ├── Notebookspage.jsx
    ├── Notebookpage.jsx             # Wrapper sang ResearchWorkspace
    ├── ResearchPage.jsx             # Wrapper sang ResearchWorkspace
    ├── ResearchWorkspace.jsx        # Notebook workspace: docs, chat, notes, sources, sessions
    ├── SystemLibraryPage.jsx
    ├── AdminPage.jsx
    ├── CrossAnalysisPage.jsx
    ├── AcademicLensPage.jsx
    └── ProfilePage.jsx
```

## Routing hiện tại

| Route | Page | Ghi chú |
| --- | --- | --- |
| `/login` | `LoginPage` | Public |
| `/register` | `RegisterPage` | Public |
| `/forgot-password` | `ForgotPasswordPage` | Public |
| `/` | redirect `/home` | Cần đăng nhập |
| `/home` | `HomePage` | Dashboard/trang chủ sau đăng nhập |
| `/notebook` | `Notebookspage` | Danh sách notebook/workspace |
| `/notebooks/:notebookId` | `Notebookpage` → `ResearchWorkspace` | Workspace đầy đủ cho notebook |
| `/research/:notebookId` | `ResearchPage` → `ResearchWorkspace` | Alias workspace/RAG chat |
| `/academic-lens` | `AcademicLensPage` | Document/web/vision chat + notepad |
| `/cross-analysis` | `CrossAnalysisPage` | So sánh, mâu thuẫn, tổng hợp, chat tài liệu |
| `/system-library` | `SystemLibraryPage` | Thư viện hệ thống, search/bookmark/download/link |
| `/profile` | `ProfilePage` | Hồ sơ, avatar, password, 2FA, Google linking |
| `/admin` | `AdminPage` | Chỉ user có `role === 'admin'` |
| `*` | redirect `/home` | Fallback |

## API service

Tất cả request nên đi qua `src/services/api.js` để dùng chung base URL, auth header, timeout, error normalization, blob download và SSE parsing.

Các nhóm hàm chính trong `api`:

- Auth: `login`, `register`, `me`, `logout`, `loginWithGoogle`, password reset OTP.
- Profile: `getProfile`, `updateProfile`, `uploadAvatar`, `changePassword`, email 2FA, Google connect/disconnect, preferences, export/delete account.
- Notebooks/documents: CRUD notebook, queued upload/indexing, list/delete documents, link system document.
- Research Workspace: `streamResearchQuery`, session messages, citations/source diagnostics, export DOCX.
- Notes và study assets: notes theo workspace/session, flashcards, quiz, test.
- System Library/admin: list/search/bookmark/download/import/delete/link.
- Cross Analysis: upload, compare, conflicts, synthesis, chat, preview.
- Academic Lens: upload/preview, document chat, web chat, vision chat, web context, save notepad.

## UI chính theo tính năng

### Research Workspace

`ResearchWorkspace.jsx` là màn hình notebook chính hiện tại:

- Panel trái: tài liệu, upload/indexing status, chọn tài liệu, quick tools.
- Panel giữa: RAG chat, streaming answer, mode chặt chẽ/khám phá, citations inline.
- Panel phải: notes, sources, sessions.
- Khi user bấm citation `[n]` trong câu trả lời hoặc nút **Nguồn**, UI mở tab **Nguồn** bên phải và hiển thị modal chi tiết nguồn với page/section/score/chunk/snippet/Markdown nếu backend trả metadata.
- Sources panel không gọi API mới khi hover/click citation; nó dùng citations đã có trong response.

### Academic Lens

- Document AI chat theo tài liệu hiện tại.
- Global Web Chat dùng web search provider backend nếu được cấu hình.
- Vision chat cho ảnh/crop; prompt có thể yêu cầu giải thích biểu đồ, trích xuất bảng hoặc chuyển công thức sang LaTeX.
- Citation popover hiển thị block type/source khi backend trả metadata.

### System Library / Admin

- User có thể search/filter/bookmark/download/link tài liệu hệ thống vào notebook.
- Admin có thể upload/import tài liệu hệ thống; backend parse/index theo cùng pipeline structured extraction.

## Auth state

`AuthContext` lưu `token`, `user`, `isReady` và các hàm `loginContext`, `logoutContext`, `updateUserContext`. Token và user được persist trong `localStorage` bằng keys:

- `ai-research-access-token`
- `ai-research-user`

Protected routes redirect về `/login` khi chưa có token. Admin route yêu cầu `user.role === 'admin'`.

## Luồng người dùng chính

1. Đăng ký/đăng nhập hoặc Google login.
2. Vào Home hoặc danh sách notebook.
3. Tạo notebook/workspace và upload PDF/DOCX/TXT/MD.
4. Backend index tài liệu; UI hiển thị trạng thái upload/indexing.
5. Vào Research Workspace để hỏi đáp RAG, bấm nguồn để kiểm chứng, lưu notes, export DOCX hoặc sinh flashcards/quiz/test.
6. Dùng System Library để tìm tài liệu chung và liên kết vào notebook.
7. Dùng Cross Analysis khi cần so sánh nhiều tài liệu độc lập.
8. Dùng Academic Lens để đọc tài liệu, chat theo document/web/vision và ghi notepad.

## Quy ước phát triển

- Không gọi `fetch`/`axios` trực tiếp trong page/component nếu API đó đã hoặc nên được gom vào `services/api.js`.
- Khi thêm route mới, cập nhật `App.jsx`, sidebar/navigation liên quan và README này nếu là tính năng người dùng.
- Khi thêm biến môi trường frontend, cập nhật `.env.example` và README này.
- Giữ error message thân thiện với người dùng; ưu tiên dùng error đã được normalize từ `api.js`.
- Với citation/source UI, ưu tiên tái sử dụng metadata có sẵn trong response; không gọi API mới khi hover.

## Build kiểm tra

```bash
npm run build
```

Build hiện có thể cảnh báo chunk JS lớn do app nhiều màn hình; đây là cảnh báo tối ưu bundle, không phải lỗi build.
