# 🏗️ Architecture — AI Research Assistant

## RAG Pipeline

### Indexing Flow (khi upload PDF)
```
[User đã đăng nhập] ──upload PDF──► [Frontend]
                                          │
                                    multipart/form-data + JWT token
                                          │
                                      [FastAPI]
                                          │ verify token → lấy user_id
                                    ┌─────┴──────┐
                                    │ PDF Parser  │  ← pdfplumber
                                    └─────┬──────┘
                                          │ raw text + metadata (page numbers)
                                    ┌─────┴──────┐
                                    │   Chunker   │  ← RecursiveTextSplitter
                                    └─────┬──────┘
                                          │ list of chunks
                                    ┌─────┴──────┐
                                    │  Embedder   │  ← Google text-embedding-004
                                    └─────┬──────┘
                                          │ vectors
                                    ┌─────┴──────┐
                                    │  Supabase   │  ← lưu kèm user_id
                                    └────────────┘
```

### Query Flow (khi user hỏi)
```
[User hỏi] ──► [Frontend] ──► POST /api/chat/ask/stream + JWT token
                                        │
                                    [FastAPI] verify token → lấy user_id
                                        │
                                   ┌────┴────┐
                                   │ Embedder│  ← Embed câu hỏi
                                   └────┬────┘
                                        │ query_vector
                                   ┌────┴──────────────┐
                                   │  Vector Search     │  ← filter theo user_id
                                   └────┬──────────────┘
                                        │ top-5 chunks
                                   ┌────┴──────────────┐
                                   │  Prompt Builder    │
                                   └────┬──────────────┘
                                        │
                                   ┌────┴──────────┐
                                   │  Gemini Flash  │  ← stream response
                                   └────┬──────────┘
                                        │ SSE tokens
                                   [Frontend] hiển thị từng token
```

---

## Supabase Schema

```sql
-- Bật extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Bảng tài liệu — gắn với user qua user_id
CREATE TABLE documents (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  filename    TEXT NOT NULL,
  page_count  INTEGER,
  chunk_count INTEGER,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Bảng chunks + embeddings
CREATE TABLE document_chunks (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_id      UUID REFERENCES documents(id) ON DELETE CASCADE,
  content     TEXT NOT NULL,
  page_number INTEGER,
  chunk_index INTEGER,
  embedding   VECTOR(768),   -- text-embedding-004 = 768 dims
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Index tăng tốc vector search
CREATE INDEX ON document_chunks
USING ivfflat (embedding vector_cosine_ops)
WITH (lists = 100);

-- Row Level Security: user chỉ thấy tài liệu của mình
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user sees own documents"
ON documents FOR ALL
USING (auth.uid() = user_id);

-- document_chunks kế thừa quyền qua foreign key, không cần RLS riêng

-- Function vector search (backend gọi qua supabase.rpc)
CREATE OR REPLACE FUNCTION match_chunks(
  query_embedding  VECTOR(768),
  target_doc_id    UUID,
  match_count      INT DEFAULT 5
)
RETURNS TABLE (id UUID, content TEXT, page_number INTEGER, similarity FLOAT)
LANGUAGE SQL AS $$
  SELECT id, content, page_number,
    1 - (embedding <=> query_embedding) AS similarity
  FROM document_chunks
  WHERE doc_id = target_doc_id
  ORDER BY embedding <=> query_embedding
  LIMIT match_count;
$$;
```

---

## Auth Flow

```
[Register]
FE gửi email + password
    → BE gọi supabase.auth.sign_up()
    → Supabase tạo user trong auth.users
    → BE trả về user_id + email

[Login]
FE gửi email + password
    → BE gọi supabase.auth.sign_in_with_password()
    → Supabase trả về JWT access_token
    → BE forward token về FE
    → FE lưu token trong React Context

[Mọi request tiếp theo]
FE gắn header: Authorization: Bearer <token>
    → BE verify token qua supabase.auth.get_user(token)
    → Lấy user_id từ token để filter data
```

---

## Chunking Strategy

```
chunk_size    = 500 tokens   (khoảng 1–2 đoạn văn)
chunk_overlap = 50 tokens    (giữ context tại ranh giới chunk)
```

---

## Prompt Template

```
System:
Bạn là trợ lý nghiên cứu AI, giúp người dùng hiểu tài liệu học thuật.
Trả lời câu hỏi dựa trên các đoạn trích sau từ tài liệu.
Nếu không tìm thấy câu trả lời trong tài liệu, hãy nói rõ điều đó.
Trả lời bằng ngôn ngữ của câu hỏi (tiếng Việt hoặc tiếng Anh).

--- Đoạn trích ---
[Trang 3] {content}
[Trang 5] {content}
...

--- Lịch sử hội thoại ---
{chat_history}

--- Câu hỏi ---
{question}
```

---

## Environment Variables

### Backend (.env)
```
GOOGLE_API_KEY=           # Google AI Studio
SUPABASE_URL=             # Project URL từ Supabase dashboard
SUPABASE_SERVICE_KEY=     # service_role key (không phải anon key)
CORS_ORIGINS=http://localhost:5173,https://your-app.vercel.app
```

### Frontend (.env)
```
VITE_API_URL=http://localhost:8000
```
