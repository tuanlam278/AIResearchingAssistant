# 🏗️ Architecture — AI Research Assistant

## RAG Pipeline

### Indexing Flow (khi upload PDF vào notebook)
```
[User đã đăng nhập] ──upload PDFs──► [Frontend]
                                           │
                           multipart/form-data (field: "files") + JWT token
                                           │
                               POST /api/notebooks/{notebook_id}/upload
                                           │
                                       [FastAPI]
                                           │ verify token → lấy user_id
                                           │ kiểm tra notebook thuộc user
                                    ┌──────┴──────┐
                                    │  PDF Parser  │  ← pdfplumber + PyMuPDF
                                    └──────┬──────┘
                                           │ raw text + metadata (page numbers)
                                    ┌──────┴──────┐
                                    │   Chunker    │  ← LangChain RecursiveCharacterTextSplitter
                                    └──────┬──────┘   ← tiktoken cl100k_base tokenizer
                                           │ list of chunks
                                    ┌──────┴──────┐
                                    │   Embedder   │  ← Google text-embedding-004
                                    └──────┬──────┘
                                           │ vectors (768 dims)
                                    ┌──────┴──────┐
                                    │  Supabase    │  ← lưu kèm notebook_id + doc_id
                                    └─────────────┘

Mỗi file xử lý độc lập — file lỗi không ảnh hưởng file khác trong cùng batch.
```

### Query Flow (khi user hỏi)
```
[User hỏi] ──► [Frontend] ──► POST /api/chat/ask/stream + JWT token
                                         │ { notebook_id, question, chat_history }
                                     [FastAPI] verify token
                                         │
                                    ┌────┴────┐
                                    │ Embedder│  ← Embed câu hỏi (text-embedding-004)
                                    └────┬────┘
                                         │ query_vector (768 dims)
                                    ┌────┴──────────────────┐
                                    │   Vector Search (RPC)  │  ← filter theo notebook_id
                                    └────┬──────────────────┘   ← top-5, min similarity 0.5
                                         │ top-k chunks (từ nhiều docs trong notebook)
                                    ┌────┴──────────────┐
                                    │   Prompt Builder   │
                                    └────┬──────────────┘
                                         │
                                    ┌────┴────────────┐
                                    │  Gemini 2.5 Flash│  ← stream response
                                    └────┬────────────┘
                                         │ SSE tokens
                                    [Frontend] hiển thị từng token
```

---

## Supabase Schema

```sql
-- Bật extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Bảng notebooks — gắn với user
CREATE TABLE notebooks (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Bảng tài liệu — gắn với notebook
CREATE TABLE documents (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  notebook_id UUID REFERENCES notebooks(id) ON DELETE CASCADE,
  filename    TEXT NOT NULL,
  page_count  INTEGER,
  chunk_count INTEGER,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Bảng chunks + embeddings — gắn với doc và notebook
CREATE TABLE document_chunks (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_id      UUID REFERENCES documents(id) ON DELETE CASCADE,
  notebook_id UUID REFERENCES notebooks(id) ON DELETE CASCADE,  -- index nhanh
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

-- Row Level Security
ALTER TABLE notebooks ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user sees own notebooks"
ON notebooks FOR ALL
USING (auth.uid() = user_id);

-- Cấp quyền truy cập cho API Backend
GRANT ALL ON public.notebooks TO anon, authenticated, service_role;
GRANT ALL ON public.documents TO anon, authenticated, service_role;
GRANT ALL ON public.document_chunks TO anon, authenticated, service_role;

-- Function vector search theo notebook_id (backend gọi qua supabase.rpc)
CREATE OR REPLACE FUNCTION match_chunks(
  query_embedding    VECTOR(768),
  target_notebook_id UUID,
  match_count        INT DEFAULT 5
)
RETURNS TABLE (id UUID, content TEXT, page_number INTEGER, doc_id UUID, similarity FLOAT)
LANGUAGE SQL AS $$
  SELECT id, content, page_number, doc_id,
    1 - (embedding <=> query_embedding) AS similarity
  FROM document_chunks
  WHERE notebook_id = target_notebook_id
  ORDER BY embedding <=> query_embedding
  LIMIT match_count;
$$;
```

---

## Auth Flow

```
[Register]
FE gửi email + password
    → BE gọi supabase.auth.sign_up() qua anon client mới (tránh session leak)
    → Supabase tạo user trong auth.users
    → BE trả về user_id + email
    → FE redirect sang trang Login

[Login]
FE gửi email + password
    → BE gọi supabase.auth.sign_in_with_password() qua anon client mới
    → Supabase trả về JWT access_token
    → BE forward token về FE
    → FE lưu token trong React Context (không dùng localStorage)

[Mọi request tiếp theo]
FE gắn header: Authorization: Bearer <token>
    → BE verify token qua supabase.auth.get_user(token)
    → Lấy user_id từ token để filter data

[Logout]
FE gọi POST /api/auth/logout
    → BE gọi supabase.auth.sign_out() (idempotent — luôn trả success)
    → FE xóa token khỏi React Context, redirect về Login
```

---

## Chunking Strategy

```
chunk_size    = 500 tokens   (cl100k_base tokenizer — khớp với GPT-4 / text-embedding)
chunk_overlap = 50 tokens    (giữ context tại ranh giới chunk)
Splitter: LangChain RecursiveCharacterTextSplitter
```

---

## Prompt Template

```
Bạn là trợ lý nghiên cứu AI, giúp người dùng hiểu tài liệu học thuật.
Trả lời câu hỏi dựa trên các đoạn trích sau từ tài liệu.
Nếu không tìm thấy câu trả lời trong tài liệu, hãy nói rõ "Tôi không tìm thấy thông tin này trong tài liệu".
Trả lời bằng ngôn ngữ của câu hỏi (tiếng Việt hoặc tiếng Anh).

--- Đoạn trích ---
[Trang 3] {content}
[Trang 5] {content}
...

--- Lịch sử hội thoại ---
{chat_history}   ← tối đa 10 turns gần nhất

--- Câu hỏi ---
{question}
```

---

## Frontend Routes

| Path | Component | Mô tả |
|------|-----------|-------|
| `/login` | `LoginPage` | Đăng nhập |
| `/register` | `RegisterPage` | Đăng ký |
| `/` | `NotebooksPage` | Danh sách notebooks (protected) |
| `/notebooks/:notebookId` | `NotebookPage` | Chi tiết notebook + upload (protected) |
| `/research/:notebookId` | `ResearchPage` | Giao diện chat / hỏi đáp (protected) |

---

## Environment Variables

### Backend (.env)
```
GOOGLE_API_KEY=           # Google AI Studio
SUPABASE_URL=             # Project URL từ Supabase dashboard
SUPABASE_SERVICE_KEY=     # service_role key (dùng cho truy vấn backend)
SUPABASE_ANON_KEY=        # anon key (dùng cho auth sign_up / sign_in)
CORS_ORIGINS=["http://localhost:5173","https://your-app.vercel.app"]
```

### Frontend (.env)
```
VITE_API_URL=http://localhost:8000
```