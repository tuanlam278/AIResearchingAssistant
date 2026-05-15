# Frontend — AI Research Assistant

React + Vite frontend.

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
├── pages/
│   ├── HomePage.jsx         # Upload + danh sách tài liệu     ← FE1
│   └── ResearchPage.jsx     # Trang hỏi đáp                   ← FE2
├── components/
│   ├── DocumentUploader.jsx # Upload PDF với progress bar      ← FE1
│   ├── DocumentList.jsx     # Danh sách tài liệu đã upload     ← FE1
│   ├── ChatBox.jsx          # Chat với streaming               ← FE2
│   └── SourceCard.jsx       # Hiển thị nguồn tham khảo        ← FE2
├── services/
│   └── api.js               # Tất cả HTTP calls tới backend    ← FE1 + FE2
└── App.jsx                  # Routing
```

## Phân công FE

| File | Người | Mô tả |
|------|-------|-------|
| `pages/HomePage.jsx` | FE1 | Upload + danh sách |
| `components/DocumentUploader.jsx` | FE1 | Drag-drop, progress |
| `components/DocumentList.jsx` | FE1 | List + delete |
| `services/api.js` (upload, getDocuments, delete) | FE1 | API calls cho documents |
| `pages/ResearchPage.jsx` | FE2 | Trang nghiên cứu |
| `components/ChatBox.jsx` | FE2 | Streaming chat UI |
| `components/SourceCard.jsx` | FE2 | Hiển thị nguồn |
| `services/api.js` (askQuestion, askQuestionStream) | FE2 | API calls cho chat |

## Quy tắc

1. **Không** gọi `fetch`/`axios` trực tiếp trong component — dùng `src/services/api.js`
2. Mọi error từ API đều có format `{ error: { code, message } }` — hiển thị `error.message` cho user
3. Streaming dùng `askQuestionStream`, không dùng `askQuestion` (trừ fallback)
