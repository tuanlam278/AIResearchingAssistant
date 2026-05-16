# 📋 API Contract — AI Research Assistant

> **Quy tắc:** File này là nguồn sự thật duy nhất giữa Frontend và Backend.
> Mọi thay đổi API phải cập nhật file này trước, sau đó mới code.

---

## Base URL

| Môi trường | URL |
|------------|-----|
| Development | `http://localhost:8000` |
| Production | `https://<your-app>.onrender.com` |

---

## Định dạng chung

### Request Headers
```
Content-Type: application/json        (với JSON request)
Content-Type: multipart/form-data     (với file upload)
Authorization: Bearer <access_token>  (BẮT BUỘC với mọi endpoint trừ /api/auth/*)
```

### Response thành công
```json
{
  "success": true,
  "data": { ... }
}
```

### Response lỗi
```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Mô tả lỗi cho user"
  }
}
```

### Error Codes

| Code | HTTP Status | Mô tả |
|------|------------|-------|
| `UNAUTHORIZED` | 401 | Chưa đăng nhập hoặc token hết hạn |
| `EMAIL_TAKEN` | 409 | Email đã được đăng ký |
| `INVALID_CREDENTIALS` | 401 | Sai email hoặc mật khẩu |
| `FILE_TOO_LARGE` | 413 | File vượt quá 20MB |
| `INVALID_FILE_TYPE` | 415 | Chỉ chấp nhận PDF |
| `PARSE_FAILED` | 422 | Không thể đọc nội dung PDF |
| `DOC_NOT_FOUND` | 404 | Không tìm thấy tài liệu |
| `EMBED_FAILED` | 500 | Lỗi khi gọi Gemini Embedding |
| `LLM_FAILED` | 500 | Lỗi khi gọi Gemini Flash |
| `INTERNAL_ERROR` | 500 | Lỗi server không xác định |

---

## Endpoints — Auth (không cần token)

---

### A1. Đăng ký

**`POST /api/auth/register`**

#### Request Body
```json
{
  "email": "user@example.com",
  "password": "matkhau123"
}
```

#### Response `200 OK`
```json
{
  "success": true,
  "data": {
    "user_id": "uuid-v4-string",
    "email": "user@example.com"
  }
}
```

> Sau khi đăng ký thành công, FE chuyển sang trang Login để user đăng nhập.

---

### A2. Đăng nhập

**`POST /api/auth/login`**

#### Request Body
```json
{
  "email": "user@example.com",
  "password": "matkhau123"
}
```

#### Response `200 OK`
```json
{
  "success": true,
  "data": {
    "access_token": "eyJhbGciOiJIUzI1NiIs...",
    "token_type": "bearer",
    "user": {
      "user_id": "uuid-v4-string",
      "email": "user@example.com"
    }
  }
}
```

> FE lưu `access_token` vào React Context (không dùng localStorage). Gắn vào mọi request tiếp theo qua header `Authorization`.

---

### A3. Đăng xuất

**`POST /api/auth/logout`** *(cần token)*

#### Response `200 OK`
```json
{
  "success": true,
  "data": { "message": "Đăng xuất thành công" }
}
```

> FE xóa token khỏi state và redirect về trang Login.

---

## Endpoints — Documents *(cần token)*

---

### 1. Upload tài liệu

**`POST /api/documents/upload`**

Upload file PDF, hệ thống sẽ tự động parse → chunk → embed → lưu vào Supabase.
Tài liệu sẽ gắn với user đang đăng nhập — user khác không thấy được.

#### Request
```
Content-Type: multipart/form-data
Authorization: Bearer <access_token>

file: <PDF file, max 20MB>
```

#### Response `200 OK`
```json
{
  "success": true,
  "data": {
    "doc_id": "uuid-v4-string",
    "filename": "attention_is_all_you_need.pdf",
    "chunk_count": 42,
    "page_count": 15,
    "created_at": "2024-01-15T10:30:00Z",
    "status": "ready"
  }
}
```

---

### 2. Lấy danh sách tài liệu

**`GET /api/documents`**

> Chỉ trả về tài liệu của user đang đăng nhập.

#### Response `200 OK`
```json
{
  "success": true,
  "data": {
    "documents": [
      {
        "doc_id": "uuid-v4-string",
        "filename": "attention_is_all_you_need.pdf",
        "page_count": 15,
        "chunk_count": 42,
        "created_at": "2024-01-15T10:30:00Z"
      }
    ],
    "total": 1
  }
}
```

---

### 3. Xóa tài liệu

**`DELETE /api/documents/{doc_id}`**

> Chỉ xóa được tài liệu của chính mình. Xóa tài liệu của người khác trả về `DOC_NOT_FOUND`.

#### Response `200 OK`
```json
{
  "success": true,
  "data": {
    "doc_id": "uuid-v4-string",
    "deleted": true
  }
}
```

---

### 4. Hỏi đáp (non-streaming)

**`POST /api/chat/ask`**

#### Request Body
```json
{
  "doc_id": "uuid-v4-string",
  "question": "Transformer model hoạt động như thế nào?",
  "chat_history": [
    { "role": "user", "content": "Paper này nói về cái gì?" },
    { "role": "assistant", "content": "Paper này giới thiệu kiến trúc Transformer..." }
  ]
}
```

#### Response `200 OK`
```json
{
  "success": true,
  "data": {
    "answer": "Transformer sử dụng cơ chế Self-Attention để...",
    "sources": [
      { "chunk_id": "uuid", "content": "We propose...", "page": 2, "score": 0.92 },
      { "chunk_id": "uuid", "content": "An attention function...", "page": 3, "score": 0.87 }
    ],
    "tokens_used": 1240
  }
}
```

---

### 5. Hỏi đáp (streaming — recommended)

**`POST /api/chat/ask/stream`**

Trả về Server-Sent Events (SSE) để hiển thị từng token như ChatGPT.

#### Request Body
Giống endpoint `/ask` ở trên.

#### Response — SSE stream
```
Content-Type: text/event-stream

data: {"type": "sources", "sources": [...]}
data: {"type": "token", "content": "Transformer"}
data: {"type": "token", "content": " sử dụng"}
data: {"type": "done", "tokens_used": 1240}
```

#### Lưu ý FE:
```javascript
// EventSource không hỗ trợ custom header → dùng fetch() thay thế
fetch('/api/chat/ask/stream', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`   // gắn token ở đây
  },
  body: JSON.stringify({ doc_id, question, chat_history })
})
```

---

### 6. Tóm tắt tài liệu

**`POST /api/documents/{doc_id}/summarize`**

#### Response `200 OK`
```json
{
  "success": true,
  "data": {
    "summary": "Paper này đề xuất kiến trúc Transformer...",
    "key_contributions": [
      "Cơ chế Self-Attention thay thế RNN/CNN",
      "Multi-Head Attention cho phép học đa chiều"
    ],
    "doc_id": "uuid-v4-string"
  }
}
```

---

### 7. Health check *(không cần token)*

**`GET /api/health`**

```json
{ "status": "ok", "version": "1.0.0" }
```

---

## Data Models

### User
```typescript
interface User {
  user_id: string;
  email: string;
}
```

### Document
```typescript
interface Document {
  doc_id: string;
  filename: string;
  page_count: number;
  chunk_count: number;
  created_at: string;     // ISO 8601
}
```

### Source
```typescript
interface Source {
  chunk_id: string;
  content: string;
  page: number;
  score: number;          // Cosine similarity, 0.0 – 1.0
}
```

### ChatMessage
```typescript
interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}
```

---

## Giới hạn

| Tham số | Giới hạn |
|---------|----------|
| `password` length | Tối thiểu 6 ký tự |
| File size | 20 MB |
| File type | PDF only |
| `question` length | 1000 ký tự |
| `chat_history` length | Tối đa 10 turns (20 messages) |
| Top-k chunks retrieval | 5 chunks |
| Max documents per user | 20 documents |
