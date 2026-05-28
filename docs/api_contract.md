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
| `EMAIL_NOT_CONFIRMED` | 401 | Email chưa được xác nhận qua Supabase |
| `INVALID_CREDENTIALS` | 401 | Sai email hoặc mật khẩu |
| `FILE_TOO_LARGE` | 413 | File vượt quá 20MB |
| `INVALID_FILE_TYPE` | 415 | Chỉ chấp nhận PDF |
| `PARSE_FAILED` | 422 | Không thể đọc nội dung PDF |
| `DOC_NOT_FOUND` | 404 | Không tìm thấy tài liệu hoặc notebook |
| `EMBED_FAILED` | 500 | Lỗi khi gọi Gemini Embedding |
| `LLM_FAILED` | 500 | Lỗi khi gọi Gemini Flash |
| `NOT_IMPLEMENTED` | 501 | Tính năng chưa được hỗ trợ |
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

## Endpoints — Notebooks *(cần token)*

Notebooks là đơn vị tổ chức tài liệu. Mỗi notebook chứa nhiều PDF. Câu hỏi được trả lời dựa trên toàn bộ tài liệu trong notebook.

---

### N1. Tạo notebook

**`POST /api/notebooks`**

#### Request Body
```json
{
  "name": "Transformer Papers"
}
```

#### Response `200 OK`
```json
{
  "success": true,
  "data": {
    "notebook_id": "uuid-v4-string",
    "name": "Transformer Papers",
    "created_at": "2024-01-15T10:30:00Z"
  }
}
```

---

### N2. Lấy danh sách notebooks

**`GET /api/notebooks`**

> Chỉ trả về notebooks của user đang đăng nhập, sắp xếp mới nhất trước.

#### Response `200 OK`
```json
{
  "success": true,
  "data": {
    "notebooks": [
      {
        "notebook_id": "uuid-v4-string",
        "name": "Transformer Papers",
        "created_at": "2024-01-15T10:30:00Z"
      }
    ],
    "total": 1
  }
}
```

---

### N3. Xóa notebook

**`DELETE /api/notebooks/{notebook_id}`**

> Cascade xóa toàn bộ documents và chunks bên trong. Chỉ xóa được notebook của chính mình.

#### Response `200 OK`
```json
{
  "success": true,
  "data": {
    "notebook_id": "uuid-v4-string",
    "deleted": true
  }
}
```

---

### N4. Upload tài liệu vào notebook

**`POST /api/notebooks/{notebook_id}/upload`**

Upload **nhiều file PDF** cùng lúc. Mỗi file được parse → chunk → embed → lưu vào Supabase độc lập.

#### Request
```
Content-Type: multipart/form-data
Authorization: Bearer <access_token>

files: <PDF file 1, max 20MB>
files: <PDF file 2, max 20MB>
...
```

> Field name là `files` (số nhiều), hỗ trợ nhiều file trong một request.

#### Response `200 OK`
```json
{
  "success": true,
  "data": {
    "uploaded": [
      {
        "filename": "attention_is_all_you_need.pdf",
        "doc_id": "uuid-v4-string",
        "page_count": 15,
        "chunk_count": 42,
        "created_at": "2024-01-15T10:30:00Z",
        "status": "ready"
      }
    ],
    "failed": [
      {
        "filename": "corrupted.pdf",
        "status": "error",
        "error": "PARSE_FAILED"
      }
    ],
    "total": 2
  }
}
```

> Upload từng phần thất bại không làm hỏng cả batch — các file thành công vẫn được lưu.

---

### N5. Lấy danh sách tài liệu trong notebook

**`GET /api/notebooks/{notebook_id}/documents`**

> Trả về tài liệu sắp xếp theo thứ tự upload (cũ nhất trước).

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

## Endpoints — Documents *(cần token)*

---

### D1. Xóa tài liệu

**`DELETE /api/documents/{doc_id}`**

> Xóa một file cụ thể trong notebook. Cascade xóa các chunks liên quan.

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

### D2. Tóm tắt tài liệu *(chưa hỗ trợ)*

**`POST /api/documents/{doc_id}/summarize`**

> **Trạng thái:** Chưa được implement — endpoint trả về `501 NOT_IMPLEMENTED`.

---

## Endpoints — Chat *(cần token)*

---

### C1. Hỏi đáp (non-streaming)

**`POST /api/chat/ask`**

> Tìm kiếm trên **toàn bộ tài liệu trong notebook** (không giới hạn 1 file).

#### Request Body
```json
{
  "notebook_id": "uuid-v4-string",
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

### C2. Hỏi đáp (streaming — recommended)

**`POST /api/chat/ask/stream`**

Trả về Server-Sent Events (SSE) để hiển thị từng token như ChatGPT.

#### Request Body
Giống endpoint `/ask` ở trên (dùng `notebook_id`).

#### Response — SSE stream
```
Content-Type: text/event-stream

data: {"type": "sources", "sources": [...]}
data: {"type": "token", "content": "Transformer"}
data: {"type": "token", "content": " sử dụng"}
data: {"type": "done"}
data: {"type": "error", "code": "LLM_FAILED", "message": "..."}
```

> Nếu xảy ra lỗi trong quá trình stream, BE gửi event `type: "error"` rồi kết thúc stream (không throw HTTP error).

#### Lưu ý FE:
```javascript
// EventSource không hỗ trợ custom header → dùng fetch() thay thế
fetch('/api/chat/ask/stream', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`
  },
  body: JSON.stringify({ notebook_id, question, chat_history })
})
```

---

### H1. Health check *(không cần token)*

**`GET /api/health`**

```json
{ "status": "ok", "version": "2.0.0" }
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

### Notebook
```typescript
interface Notebook {
  notebook_id: string;
  name: string;
  created_at: string;   // ISO 8601
}
```

### Document
```typescript
interface Document {
  doc_id: string;
  filename: string;
  page_count: number;
  chunk_count: number;
  created_at: string;   // ISO 8601
}
```

### Source
```typescript
interface Source {
  chunk_id: string;
  content: string;
  page: number;
  score: number;        // Cosine similarity, 0.0 – 1.0
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
| `notebook name` length | 1 – 200 ký tự |
| File size | 20 MB |
| File type | PDF only |
| `question` length | 1000 ký tự |
| `chat_history` length | Tối đa 20 messages (10 turns) |
| Top-k chunks retrieval | 5 chunks |
| Min similarity threshold | 0.5 (cosine) |