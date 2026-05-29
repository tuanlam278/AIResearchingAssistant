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
                                    │  PDF Parser  │  ← PyMuPDF (text extraction)
                                    │              │  ← Gemini Vision (OCR fallback
                                    └──────┬──────┘     cho scanned/garbled PDF)
                                           │ raw text + metadata (page numbers)
                                    ┌──────┴──────┐
                                    │   Chunker    │  ← LangChain RecursiveCharacterTextSplitter
                                    └──────┬──────┘   ← tiktoken cl100k_base tokenizer
                                           │ list of chunks
                                    ┌──────┴──────┐
                                    │   Embedder   │  ← Google gemini-embedding-001
                                    └──────┬──────┘
                                           │ vectors (768 dims)
                                    ┌──────┴──────┐
                                    │  Supabase    │  ← lưu kèm notebook_id + doc_id
                                    └─────────────┘

Mỗi file xử lý độc lập — file lỗi không ảnh hưởng file khác trong cùng batch.
```

### Query Flow (khi user hỏi — hiện tại dùng non-streaming)
```
[User hỏi] ──► [Frontend] ──► POST /api/chat/ask + JWT token
                                         │ { notebook_id, question, chat_history }
                                     [FastAPI] verify token
                                         │
                                    ┌────┴────┐
                                    │ Embedder│  ← Embed câu hỏi (gemini-embedding-001)
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
                                    │  Gemini 2.5 Flash│  ← blocking response
                                    └────┬────────────┘
                                         │ { answer, sources, tokens_used }
                                    [Frontend] hiển thị kết quả
```

> **Streaming (SSE):** Backend đã implement endpoint `POST /api/chat/ask/stream`,
> trả về từng token qua Server-Sent Events. Frontend chưa tích hợp streaming — đang dùng non-streaming.


### Post-upload Summary Flow

```
[Upload PDFs thành công]
        │
        ▼
[Frontend NotebookPage]
        │ POST /api/workspaces/{workspace_id}/documents/summary/generate
        ▼
[FastAPI] lấy documents + document_chunks theo workspace/notebook
        │
        ▼
[LLM service hiện có] tạo summary từng tài liệu, tổng quan chung, suggested_questions
        │
        ▼
[Summary Panel] hiển thị trước khi user vào ChatBox
```

Không có left sidebar document list trong flow này; suggested question chỉ fill input khi vào Chat.

---

## Supabase Schema

```sql
CREATE EXTENSION IF NOT EXISTS vector;

-- BẢNG NOTEBOOKS
CREATE TABLE notebooks (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE notebooks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user sees own notebooks"
ON notebooks FOR ALL
USING (auth.uid() = user_id);

GRANT ALL ON public.notebooks TO anon, authenticated, service_role;

-- BẢNG DOCUMENTS

CREATE TABLE documents (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  notebook_id   UUID REFERENCES notebooks(id) ON DELETE CASCADE,
  filename      TEXT NOT NULL,
  page_count    INTEGER,
  chunk_count   INTEGER,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user sees own documents"
ON documents FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM notebooks
    WHERE notebooks.id = documents.notebook_id
    AND notebooks.user_id = auth.uid()
  )
);

GRANT ALL ON public.documents TO anon, authenticated, service_role;

-- BẢNG CHUNKS + EMBEDDINGS (Đã tích hợp sẵn cột section)

CREATE TABLE document_chunks (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_id       UUID REFERENCES documents(id) ON DELETE CASCADE,
  notebook_id  UUID REFERENCES notebooks(id) ON DELETE CASCADE,
  section      TEXT DEFAULT 'Unknown', -- Bổ sung thêm cột section ở đây
  content      TEXT NOT NULL,
  page_number  INTEGER,
  chunk_index  INTEGER,
  embedding    VECTOR(768),
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE document_chunks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user sees own chunks"
ON document_chunks FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM notebooks
    WHERE notebooks.id = document_chunks.notebook_id
    AND notebooks.user_id = auth.uid()
  )
);

CREATE INDEX ON document_chunks 
USING hnsw (embedding vector_cosine_ops);

GRANT ALL ON public.document_chunks TO anon, authenticated, service_role;


-- BẢNG NOTES

CREATE TABLE notes (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      UUID REFERENCES notebooks(id) ON DELETE CASCADE,
  title             TEXT NOT NULL,
  content           TEXT NOT NULL,
  citations         JSONB DEFAULT '[]'::jsonb,
  source_message_id TEXT,
  note_type         TEXT DEFAULT 'text',
  metadata          JSONB DEFAULT '{}'::jsonb,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user sees own notes"
ON notes FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM notebooks
    WHERE notebooks.id = notes.workspace_id
    AND notebooks.user_id = auth.uid()
  )
);

GRANT ALL ON public.notes TO anon, authenticated, service_role;

-- FUNCTION: match_chunks (Đã cập nhật trả về section)

CREATE OR REPLACE FUNCTION match_chunks(
  query_embedding   VECTOR(768),
  target_notebook_id UUID,
  match_count       INT DEFAULT 5,
  match_threshold   FLOAT DEFAULT 0.0
)
RETURNS TABLE (
  id UUID, 
  section TEXT, 
  content TEXT, 
  page_number INTEGER, 
  doc_id UUID, 
  similarity FLOAT
)
LANGUAGE SQL AS $$
  SELECT
    dc.id,
    dc.section,     -- Trả về metadata section
    dc.content,
    dc.page_number,
    dc.doc_id,
    1 - (dc.embedding <=> query_embedding) AS similarity
  FROM document_chunks dc
  WHERE dc.notebook_id = target_notebook_id
    AND 1 - (dc.embedding <=> query_embedding) >= match_threshold
  ORDER BY dc.embedding <=> query_embedding
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
min_chunk_size = 30 tokens   (bỏ qua chunk quá ngắn: header, số trang, caption lẻ)
Splitter: LangChain RecursiveCharacterTextSplitter
```

---

## Prompt Template

```
Bạn là trợ lý nghiên cứu AI, giúp người dùng hiểu tài liệu học thuật.
Trả lời câu hỏi dựa trên các đoạn trích sau từ tài liệu.
Nếu không tìm thấy câu trả lời trong tài liệu, hãy nói rõ "Tôi không tìm thấy thông tin này trong tài liệu".
Trả lời bằng ngôn ngữ của câu hỏi (tiếng Việt hoặc tiếng Anh).

--- Đoạn trích từ tài liệu ---
[Trang 3] {content}
[Trang 5] {content}
...

--- Lịch sử hội thoại ---
{chat_history}   ← tối đa 10 turns gần nhất (20 messages)

--- Câu hỏi ---
{question}

--- Trả lời ---
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