# Frontend — AI Research Assistant

React + Vite frontend với xác thực người dùng.

## Cài đặt

```bash
cd frontend
npm install
cp .env.example .env
# Sửa VITE_API_URL nếu backend chạy cổng khác
npm run dev
# → http://localhost:5173
```

## Cấu trúc

```
src/
├── App.jsx                      # Routing (public + protected routes)
├── context/
│   └── AuthContext.jsx          # Lưu token + user, chia sẻ toàn app  ← FE1
├── pages/
│   ├── LoginPage.jsx            # Form đăng nhập                       ← FE1
│   ├── RegisterPage.jsx         # Form đăng ký                         ← FE1
│   ├── HomePage.jsx             # Upload + danh sách tài liệu          ← FE1
│   └── ResearchPage.jsx         # Trang hỏi đáp                        ← FE2
├── components/
│   ├── DocumentUploader.jsx     # Upload PDF với progress bar           ← FE1
│   ├── DocumentList.jsx         # Danh sách tài liệu + xóa             ← FE1
│   ├── ChatBox.jsx              # Chat với streaming                    ← FE2
│   └── SourceCard.jsx           # Hiển thị nguồn tham khảo             ← FE2
└── services/
    └── api.js                   # Tất cả HTTP calls tới backend         ← FE1 + FE2
```

## Phân công FE

| File | Người | Mô tả |
|------|-------|-------|
| `context/AuthContext.jsx` | Minh Tiến | Lưu token + user, cung cấp cho toàn app |
| `pages/LoginPage.jsx` | Minh Tiến | Form login, gọi `api.login()`, lưu token vào Context |
| `pages/RegisterPage.jsx` | Minh Tiến | Form register, redirect sang Login sau khi thành công |
| `pages/HomePage.jsx` | Minh Tiến | Upload + danh sách tài liệu, nút logout |
| `components/DocumentUploader.jsx` | Minh Tiến | Drag-drop, progress bar |
| `components/DocumentList.jsx` | Minh Tiến | List + delete |
| `services/api.js` (auth + documents) | Minh Tiến | login, register, upload, getDocuments, delete |
| `pages/ResearchPage.jsx` | Thanh Tùng | Trang nghiên cứu |
| `components/ChatBox.jsx` | Thanh Tùng | Streaming chat UI |
| `components/SourceCard.jsx` | Thanh Tùng | Hiển thị nguồn |
| `services/api.js` (chat) | Thanh Tùng | askQuestion, askQuestionStream |

## Quản lý token

Token lưu trong **React Context**, không dùng `localStorage`:

```javascript
// context/AuthContext.jsx — FE1 tạo
const AuthContext = createContext()

export function AuthProvider({ children }) {
  const [token, setToken] = useState(null)
  const [user, setUser]   = useState(null)

  const login = (data) => {
    setToken(data.access_token)
    setUser(data.user)
  }

  const logout = () => {
    setToken(null)
    setUser(null)
  }

  return (
    <AuthContext.Provider value={{ token, user, login, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
```

Token lấy ra và gắn vào request:

```javascript
// Trong api.js, FE2 dùng khi gọi streaming
const { token } = useAuth()
fetch('/api/chat/ask/stream', {
  headers: { 'Authorization': `Bearer ${token}` }
})
```

## Routing

```
/             → LoginPage       (public)
/register     → RegisterPage    (public)
/home         → HomePage        (cần đăng nhập)
/research/:id → ResearchPage    (cần đăng nhập)
```

Nếu chưa đăng nhập mà truy cập route cần auth → redirect về `/`.

## Quy tắc

1. Không gọi `fetch`/`axios` trực tiếp trong component — dùng `services/api.js`
2. Token chỉ sống trong React Context, không ghi vào `localStorage`
3. Mọi error từ API đều có format `{ error: { code, message } }` — hiển thị `error.message` cho user
4. Streaming dùng `askQuestionStream` với `fetch()`, không dùng `EventSource` (vì EventSource không hỗ trợ custom header)
