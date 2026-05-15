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
| `FILE_TOO_LARGE` | 413 | File vượt quá 20MB |
| `INVALID_FILE_TYPE` | 415 | Chỉ chấp nhận PDF |
| `PARSE_FAILED` | 422 | Không thể đọc nội dung PDF |
| `DOC_NOT_FOUND` | 404 | Không tìm thấy tài liệu |
| `EMBED_FAILED` | 500 | Lỗi khi gọi Gemini Embedding |
| `LLM_FAILED` | 500 | Lỗi khi gọi Gemini Flash |
| `INTERNAL_ERROR` | 500 | Lỗi server không xác định |

---

## Endpoints

---

### 1. Upload tài liệu

**`POST /api/documents/upload`**

Upload file PDF, hệ thống sẽ tự động parse → chunk → embed → lưu vào Supabase.

#### Request
```
Content-Type: multipart/form-data

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

#### Notes
- Frontend hiển thị progress bar trong lúc chờ (có thể mất 5–15 giây)
- `status: "ready"` nghĩa là đã embed xong, có thể hỏi được

---

### 2. Lấy danh sách tài liệu

**`GET /api/documents`**

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
    {
      "role": "user",
      "content": "Paper này nói về cái gì?"
    },
    {
      "role": "assistant",
      "content": "Paper này giới thiệu kiến trúc Transformer..."
    }
  ]
}
```
> `chat_history` là optional, dùng để giữ context hội thoại. Gửi [] nếu không có.

#### Response `200 OK`
```json
{
  "success": true,
  "data": {
    "answer": "Transformer sử dụng cơ chế Self-Attention để...",
    "sources": [
      {
        "chunk_id": "uuid",
        "content": "We propose a new simple network architecture, the Transformer...",
        "page": 2,
        "score": 0.92
      },
      {
        "chunk_id": "uuid",
        "content": "An attention function can be described as mapping a query...",
        "page": 3,
        "score": 0.87
      }
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

data: {"type": "token", "content": " sử"}

data: {"type": "token", "content": " dụng"}

data: {"type": "done", "tokens_used": 1240}
```

#### Thứ tự events:
1. `sources` — gửi trước để FE hiển thị nguồn tham khảo ngay
2. `token` — từng token của câu trả lời
3. `done` — kết thúc stream

#### Frontend xử lý SSE:
```javascript
const eventSource = new EventSource(url);
eventSource.onmessage = (e) => {
  const data = JSON.parse(e.data);
  if (data.type === 'token') appendToken(data.content);
  if (data.type === 'sources') showSources(data.sources);
  if (data.type === 'done') eventSource.close();
};
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
      "Multi-Head Attention cho phép học đa chiều",
      "Positional Encoding để giữ thông tin vị trí"
    ],
    "doc_id": "uuid-v4-string"
  }
}
```

---

### 7. Health check

**`GET /api/health`**

```json
{
  "status": "ok",
  "version": "1.0.0"
}
```

---

## Data Models

### Document
```typescript
interface Document {
  doc_id: string;         // UUID
  filename: string;
  page_count: number;
  chunk_count: number;
  created_at: string;     // ISO 8601
}
```

### Source (chunk trả về khi trả lời)
```typescript
interface Source {
  chunk_id: string;
  content: string;        // Nội dung đoạn văn gốc
  page: number;           // Trang trong PDF
  score: number;          // Cosine similarity score, 0.0 – 1.0
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
| File size | 20 MB |
| File type | PDF only |
| `question` length | 1000 ký tự |
| `chat_history` length | Tối đa 10 turns (20 messages) |
| Top-k chunks retrieval | 5 chunks |
| Max documents | 20 documents |
