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

Backend sử dụng FastAPI `HTTPException`, response lỗi có dạng:
```json
{
  "detail": {
    "code": "ERROR_CODE",
    "message": "Mô tả lỗi cho user"
  }
}
```

> **Lưu ý FE:** Đọc lỗi qua `err.response?.data?.detail`, không phải `err.response?.data?.error`.

### Error Codes

| Code | HTTP Status | Mô tả |
|------|------------|-------|
| `UNAUTHORIZED` | 401 | Chưa đăng nhập hoặc token hết hạn |
| `EMAIL_TAKEN` | 409 | Email đã được đăng ký |
| `EMAIL_NOT_CONFIRMED` | 401 | Email chưa được xác nhận qua Supabase |
| `INVALID_CREDENTIALS` | 401 | Sai email hoặc mật khẩu |
| `FILE_TOO_LARGE` | 413 | File vượt quá 50MB |
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

files: <PDF file 1, max 50MB>
files: <PDF file 2, max 50MB>
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

### N6. Lấy tổng quan tài liệu trong workspace/notebook

**`GET /api/workspaces/{workspace_id}/documents/summary`**

Trả metadata tài liệu đã upload. Nếu chưa generate summary, các trường summary/suggested questions có thể rỗng.

### N7. Generate tổng quan tài liệu và gợi ý câu hỏi

**`POST /api/workspaces/{workspace_id}/documents/summary/generate`**

#### Request Body
```json
{
  "document_ids": ["doc_a", "doc_b"]
}
```

#### Response `200 OK`
```json
{
  "success": true,
  "data": {
    "documents": [
      {
        "id": "doc_a",
        "filename": "paper.pdf",
        "title": "Paper title",
        "page_count": 10,
        "chunk_count": 35,
        "status": "ready",
        "summary": "Tóm tắt ngắn...",
        "key_points": ["..."],
        "suggested_questions": ["..."]
      }
    ],
    "overall_summary": "Tổng quan chung...",
    "overall_key_points": ["..."],
    "suggested_questions": ["Câu hỏi gợi ý..."]
  }
}
```

> Flow hiện tại không có left sidebar: FE hiển thị Summary Panel ngay sau upload trên trang notebook, rồi user bấm “Bắt đầu trò chuyện” hoặc chọn suggested question để vào ChatBox.

---

## Endpoints — Documents *(cần token)*

---

### D1. Xóa tài liệu

**`DELETE /api/documents/{doc_id}`**

> Xóa một file cụ thể trong notebook. Cascade xóa các chunks liên quan.
> Backend tự kiểm tra quyền sở hữu qua `document → notebook → user_id`.

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

### C1. Hỏi đáp (non-streaming) ← **Đang dùng**

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
      {
        "id": "chunk-uuid",
        "chunk_id": "chunk-uuid",
        "citation_index": 1,
        "document_id": "doc-uuid",
        "document_title": "attention_is_all_you_need.pdf",
        "page_start": 2,
        "page_end": 2,
        "snippet": "We propose...",
        "score": 0.92
      }
    ],
    "citations": [
      {
        "id": "chunk-uuid",
        "chunk_id": "chunk-uuid",
        "citation_index": 1,
        "document_id": "doc-uuid",
        "document_title": "attention_is_all_you_need.pdf",
        "page_start": 2,
        "page_end": 2,
        "snippet": "We propose...",
        "score": 0.92
      }
    ],
    "tokens_used": 1240
  }
}
```

---

### C2. Hỏi đáp (streaming) ← **Đang dùng cho Chat/RAG UX**

**`POST /api/chat/ask/stream`**

Trả về Server-Sent Events (SSE) để hiển thị từng token như ChatGPT.

#### Request Body
Giống endpoint `/ask` ở trên (dùng `notebook_id`).

#### Response — SSE stream
```
Content-Type: text/event-stream

data: {"type": "status", "status": "reading", "message": "Đang đọc tài liệu..."}
data: {"type": "status", "status": "retrieving", "message": "Đang tìm đoạn liên quan..."}
data: {"type": "sources", "sources": [...], "citations": [...]}
data: {"type": "status", "status": "generating", "message": "Đang tạo câu trả lời..."}
data: {"type": "token", "content": "Transformer"}
data: {"type": "token", "content": " sử dụng"}
data: {"type": "done"}
data: {"type": "error", "code": "LLM_FAILED", "message": "..."}
```

> Nếu xảy ra lỗi trong quá trình stream, BE gửi event `type: "error"` rồi kết thúc stream (không throw HTTP error).

#### Lưu ý FE khi implement:
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

## Endpoints — Notes *(cần token)*

Notes thuộc một workspace hiện được map với `notebook_id`. User chỉ được xem/sửa/xoá notes trong workspace/notebook của chính mình.

### NT1. Lấy danh sách ghi chú

**`GET /api/workspaces/{workspace_id}/notes`**

#### Response `200 OK`
```json
{
  "success": true,
  "data": {
    "notes": [
      {
        "id": "note-uuid",
        "workspace_id": "notebook-uuid",
        "title": "Transformer sử dụng cơ chế Self-Attention",
        "content": "Transformer sử dụng...",
        "citations": [],
        "source_message_id": "assistant-message-id",
        "created_at": "2024-01-15T10:30:00Z",
        "updated_at": "2024-01-15T10:35:00Z"
      }
    ],
    "total": 1
  }
}
```

### NT2. Tạo ghi chú từ Chat

**`POST /api/workspaces/{workspace_id}/notes`**

#### Request Body
```json
{
  "title": "Transformer sử dụng cơ chế Self-Attention",
  "content": "Transformer sử dụng...",
  "citations": [],
  "source_message_id": "assistant-message-id"
}
```

> Notes chỉ được tạo khi user bấm “Lưu vào ghi chú” trên assistant message; Studio/quick actions không tự tạo note.

### NT3. Cập nhật ghi chú

**`PATCH /api/notes/{note_id}`**

```json
{
  "title": "Tiêu đề mới",
  "content": "Nội dung đã chỉnh sửa",
  "citations": []
}
```

### NT4. Xoá ghi chú

**`DELETE /api/notes/{note_id}`**

```json
{
  "success": true,
  "data": { "note_id": "note-uuid", "deleted": true }
}
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
  id: string;
  chunk_id: string;
  citation_index: number;
  document_id?: string;
  document_title: string;
  content?: string;
  snippet: string;
  page?: number;
  page_start?: number;
  page_end?: number;
  score?: number;        // Cosine similarity, 0.0 – 1.0
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
| File size | 50 MB |
| File type | PDF only |
| `question` length | 1000 ký tự |
| `chat_history` length | Tối đa 20 messages (10 turns) |
| Top-k chunks retrieval | 5 chunks |
| Min similarity threshold | 0.5 (cosine) |