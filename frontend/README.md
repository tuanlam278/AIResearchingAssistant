# Frontend — AI Researching Assistant

Frontend là ứng dụng **React + Vite** cho AI Researching Assistant. UI hiện hỗ trợ xác thực, trang chủ, notebook/workspace, research chat, research sessions, notes, system library, admin import, cross analysis, academic lens và profile.

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

| Lệnh              | Mục đích             |
| ----------------- | -------------------- |
| `npm run dev`     | Chạy Vite dev server |
| `npm run build`   | Build production     |
| `npm run preview` | Preview bản build    |

## Biến môi trường

| Biến                    | Mục đích                                                                 |
| ----------------------- | ------------------------------------------------------------------------ |
| `VITE_API_URL`          | Base URL của FastAPI backend                                             |
| `VITE_MAX_UPLOAD_MB`    | Giới hạn upload hiển thị trên frontend, nên khớp `MAX_UPLOAD_MB` backend |
| `VITE_GOOGLE_CLIENT_ID` | Google Identity Services OAuth Client ID                                 |

## Tech stack

| Thư viện       | Dùng để                                 |
| -------------- | --------------------------------------- |
| React 18       | UI components                           |
| Vite 5         | Dev server/build tool                   |
| React Router 6 | Routing và protected routes             |
| Axios          | HTTP client cho API JSON/multipart/blob |
| Tailwind CSS   | Styling utility-first                   |
| react-markdown | Render markdown trong chat/answers      |
| lucide-react   | Icon set                                |

## Cấu trúc chính

```text
src/
├── main.jsx                       # Mount React app
├── App.jsx                        # Route tree, ProtectedRoute, AdminRoute
├── index.css                      # Tailwind/global styles
├── context/
│   └── AuthContext.jsx            # Token/user context, persist localStorage
├── layouts/
│   └── AppShell.jsx               # Layout sau đăng nhập
├── services/
│   └── api.js                     # Toàn bộ API calls + error/timeout/SSE helpers
├── components/
│   ├── layout/LeftSidebar.jsx
│   ├── ChatBox.jsx
│   ├── DocumentUploader.jsx
│   ├── DocumentList.jsx
│   ├── SourceCard.jsx
│   ├── system-library/*
│   └── academic-lens/*
└── pages/
    ├── LoginPage.jsx
    ├── RegisterPage.jsx
    ├── ForgotPasswordPage.jsx
    ├── HomePage.jsx
    ├── Notebookspage.jsx
    ├── Notebookpage.jsx
    ├── ResearchPage.jsx
    ├── SystemLibraryPage.jsx
    ├── AdminPage.jsx
    ├── CrossAnalysisPage.jsx
    ├── AcademicLensPage.jsx
    └── ProfilePage.jsx
```

## Routing hiện tại

| Route                    | Page                 | Ghi chú                                          |
| ------------------------ | -------------------- | ------------------------------------------------ |
| `/login`                 | `LoginPage`          | Public                                           |
| `/register`              | `RegisterPage`       | Public                                           |
| `/forgot-password`       | `ForgotPasswordPage` | Public                                           |
| `/`                      | redirect `/home`     | Cần đăng nhập                                    |
| `/home`                  | `HomePage`           | Dashboard/trang chủ sau đăng nhập                |
| `/notebook`              | `Notebookspage`      | Danh sách notebook/workspace                     |
| `/notebooks/:notebookId` | `Notebookpage`       | Chi tiết notebook, upload/list tài liệu          |
| `/research/:notebookId`  | `ResearchPage`       | RAG chat, sessions, notes, export/tạo học liệu   |
| `/academic-lens`         | `AcademicLensPage`   | Document/web/vision chat + notepad               |
| `/cross-analysis`        | `CrossAnalysisPage`  | So sánh, mâu thuẫn, tổng hợp, chat tài liệu      |
| `/system-library`        | `SystemLibraryPage`  | Thư viện hệ thống, search/bookmark/download/link |
| `/profile`               | `ProfilePage`        | Hồ sơ, avatar, password, 2FA, Google linking     |
| `/admin`                 | `AdminPage`          | Chỉ user có `role === 'admin'`                   |
| `*`                      | redirect `/home`     | Fallback                                         |

## API service

Tất cả request nên đi qua `src/services/api.js` để dùng chung base URL, auth header, timeout, error normalization, blob download và SSE parsing.

Các nhóm hàm chính trong `api`:

- Auth: `login`, `register`, `me`, `logout`, `loginWithGoogle`, password reset OTP.
- Profile: `getProfile`, `updateProfile`, `uploadAvatar`, `changePassword`, email 2FA, Google connect/disconnect, preferences, export/delete account.
- Notebooks/documents: CRUD notebook, upload tài liệu, list/delete documents, link system document.
- Notes và research sessions: notes theo workspace/session, tạo/sửa/xóa session, messages, export DOCX, generate flashcards/quiz/test.
- System library/admin: list/search/bookmark/download/import/delete.
- Cross analysis: upload, compare, conflicts, synthesis, chat, preview.
- Academic Lens: upload/preview, document chat, web chat, vision chat, web context, save notepad.
- Chat: `sendResearchQuery`, `streamResearchQuery`, `sendWorkspaceMessage`.

## Auth state

`AuthContext` lưu `token`, `user`, `isReady` và các hàm `loginContext`, `logoutContext`, `updateUserContext`. Token và user được persist trong `localStorage` bằng keys:

- `ai-research-access-token`
- `ai-research-user`

Protected routes redirect về `/login` khi chưa có token. Admin route yêu cầu `user.role === 'admin'`.

## Luồng người dùng chính

1. Đăng ký/đăng nhập hoặc Google login.
2. Vào Home hoặc danh sách notebook.
3. Tạo notebook/workspace và upload PDF/DOCX/TXT/MD.
4. Backend index tài liệu; frontend có thể tạo document summary.
5. Vào Research để hỏi đáp RAG, tạo/lưu research sessions, notes, export DOCX hoặc sinh flashcards/quiz/test.
6. Dùng System Library để tìm tài liệu chung và liên kết vào notebook.
7. Dùng Cross Analysis khi cần so sánh nhiều tài liệu độc lập.
8. Dùng Academic Lens để đọc tài liệu, chat theo context web/vision và ghi notepad.

## Quy ước phát triển

- Không gọi `fetch`/`axios` trực tiếp trong page/component nếu API đó đã hoặc nên được gom vào `services/api.js`.
- Khi thêm route mới, cập nhật `App.jsx`, sidebar/navigation liên quan và README này nếu là tính năng người dùng.
- Khi thêm biến môi trường frontend, cập nhật `.env.example` và README này.
- Giữ error message thân thiện với người dùng; ưu tiên dùng error đã được normalize từ `api.js`.
