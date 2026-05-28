# Frontend — AI Research Assistant

React + Vite frontend với xác thực người dùng và quản lý notebook.

## Cài đặt

```bash
cd frontend
npm install
cp .env.example .env
# Sửa VITE_API_URL nếu backend chạy cổng khác
npm run dev
# → http://localhost:5173
```

## Tech stack

| Thư viện | Phiên bản | Dùng để |
|---|---|---|
| `react` | ^18.3.1 | UI |
| `react-router-dom` | ^6.26.1 | Routing |
| `axios` | ^1.7.7 | HTTP calls |
| `react-markdown` | ^9.0.1 | Render markdown trong chat |
| `lucide-react` | ^0.400.0 | Icons |
| `tailwindcss` | ^3.4.17 | Utility CSS |
| `vite` | ^5.4.2 | Build tool |

## Cấu trúc

```
src/
├── App.jsx                        # Routing (public + protected routes)
├── context/
│   └── AuthContext.jsx            # Lưu token + user, chia sẻ toàn app
├── pages/
│   ├── LoginPage.jsx              # Form đăng nhập
│   ├── RegisterPage.jsx           # Form đăng ký
│   ├── HomePage.jsx               # Trang chủ (upload + danh sách tài liệu)
│   ├── Notebookspage.jsx          # Danh sách notebooks của user
│   ├── Notebookpage.jsx           # Chi tiết notebook: documents + upload
│   └── ResearchPage.jsx           # Trang hỏi đáp (chat với AI)
├── components/
│   ├── DocumentUploader.jsx       # Upload PDF với progress bar
│   ├── DocumentList.jsx           # Danh sách tài liệu + xóa
│   ├── ChatBox.jsx                # Chat UI
│   └── SourceCard.jsx             # Hiển thị nguồn tham khảo
└── services/
    └── api.js                     # Tất cả HTTP calls tới backend
```

## Routing

```
/login                → LoginPage          (public)
/register             → RegisterPage       (public)
/                     → HomePage           (cần đăng nhập)
/notebooks/:notebookId → Notebookpage      (cần đăng nhập)
/research/:docId      → ResearchPage       (cần đăng nhập)
```

Nếu chưa đăng nhập mà truy cập route cần auth → redirect về `/login`.  
Mọi route không khớp → redirect về `/`.

## Phân công

| File | Người | Mô tả |
|------|-------|-------|
| `context/AuthContext.jsx` | Minh Tiến | Lưu token + user + isReady, cung cấp cho toàn app |
| `pages/LoginPage.jsx` | Minh Tiến | Form login, gọi `api.login()`, lưu token vào Context |
| `pages/RegisterPage.jsx` | Minh Tiến | Form register, redirect sang Login sau khi thành công |
| `pages/HomePage.jsx` | Minh Tiến | Upload + danh sách tài liệu, nút logout |
| `pages/Notebookspage.jsx` | Minh Tiến | Danh sách notebooks, tạo mới, điều hướng vào notebook |
| `pages/Notebookpage.jsx` | Minh Tiến | Chi tiết notebook: upload tài liệu, xem documents, vào ResearchPage |
| `components/DocumentUploader.jsx` | Minh Tiến | Drag-drop, progress bar |
| `components/DocumentList.jsx` | Minh Tiến | List + delete |
| `services/api.js` (auth + notebooks + documents) | Minh Tiến | login, register, logout, getNotebooks, createNotebook, deleteNotebook, getNotebookDocuments, uploadDocuments, deleteDocument |
| `pages/ResearchPage.jsx` | Thanh Tùng | Trang hỏi đáp với AI |
| `components/ChatBox.jsx` | Thanh Tùng | Chat UI |
| `components/SourceCard.jsx` | Thanh Tùng | Hiển thị nguồn tham khảo |
| `services/api.js` (chat) | Thanh Tùng | sendResearchQuery |

## Quản lý token

Token lưu trong **React Context**, không dùng `localStorage`:

```javascript
// context/AuthContext.jsx
const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [token, setToken] = useState(null);
  const [user, setUser]   = useState(null);
  const [isReady, setIsReady] = useState(false);

  const loginContext = (newToken, userData) => {
    setToken(newToken);
    setUser(userData);
    setIsReady(true);
  };

  const logoutContext = () => {
    setToken(null);
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ token, user, isReady, loginContext, logoutContext }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
```

Lấy token trong component:

```javascript
const { token } = useAuth();
```

## API Service

Tất cả HTTP calls đi qua `services/api.js` (dùng `axios`). Backend mặc định tại `http://localhost:8000` (cấu hình qua `VITE_API_URL`).

```javascript
import { api } from '../services/api';

// Auth
api.login(email, password)
api.register(email, password)
api.logout(token)

// Notebooks
api.getNotebooks(token)
api.createNotebook(name, token)
api.deleteNotebook(notebookId, token)

// Documents trong notebook
api.getNotebookDocuments(notebookId, token)
api.uploadDocuments(notebookId, files, token, onProgress)
api.deleteDocument(docId, token)

// Chat
api.sendResearchQuery({ notebookId, question, chatHistory }, token)
```

Lỗi từ API luôn có format `{ error: { code, message } }` — hiển thị `error.message` cho user.

## Quy tắc

1. Không gọi `fetch`/`axios` trực tiếp trong component — dùng `services/api.js`
2. Token chỉ sống trong React Context, không ghi vào `localStorage`
3. Mọi error từ API đều có format `{ error: { code, message } }` — hiển thị `error.message` cho user