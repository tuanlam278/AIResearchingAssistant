# 🏗️ Architecture — AI Research Assistant

## RAG Pipeline

### Indexing Flow (khi upload PDF)
```
[User] ──upload PDF──► [Frontend]
                           │
                     multipart/form-data
                           │
                       [FastAPI]
                           │
                    ┌──────┴──────┐
                    │  PDF Parser │  ← pdfplumber
                    └──────┬──────┘
                           │ raw text + metadata (page numbers)
                    ┌──────┴──────┐
                    │   Chunker   │  ← RecursiveTextSplitter (chunk_size=500, overlap=50)
                    └──────┬──────┘
                           │ list of chunks
                    ┌──────┴──────┐
                    │  Embedder   │  ← Google text-embedding-004 (768 dims)
                    └──────┬──────┘
                           │ vectors
                    ┌──────┴──────┐
                    │  Supabase   │  ← pgvector, lưu content + embedding + metadata
                    └─────────────┘
```

### Query Flow (khi user hỏi)
```
[User types question]
        │
   [Frontend]
        │
   POST /api/chat/ask/stream
        │
   [FastAPI]
        │
   ┌────┴────┐
   │ Embedder│  ← Embed câu hỏi với text-embedding-004
   └────┬────┘
        │ query_vector
   ┌────┴────────────┐
   │ Vector Search   │  ← cosine similarity trong Supabase, lấy top-5 chunks
   └────┬────────────┘
        │ top-k chunks + scores
   ┌────┴──────────────┐
   │ Prompt Builder    │  ← Ghép system prompt + chunks + chat_history + question
   └────┬──────────────┘
        │ full prompt
   ┌────┴──────────┐
   │ Gemini Flash  │  ← Stream response
   └────┬──────────┘
        │ SSE tokens
   [Frontend] ← hiển thị từng token + sources
```

## Supabase Schema

```sql
-- Bật extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Bảng lưu thông tin tài liệu
CREATE TABLE documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  filename TEXT NOT NULL,
  page_count INTEGER,
  chunk_count INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Bảng lưu chunks và embeddings
CREATE TABLE document_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_id UUID REFERENCES documents(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  page_number INTEGER,
  chunk_index INTEGER,
  embedding VECTOR(768),  -- text-embedding-004 = 768 dims
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index để tăng tốc vector search
CREATE INDEX ON document_chunks
USING ivfflat (embedding vector_cosine_ops)
WITH (lists = 100);

-- Function để search (gọi từ Python)
CREATE OR REPLACE FUNCTION match_chunks(
  query_embedding VECTOR(768),
  target_doc_id UUID,
  match_count INT DEFAULT 5
)
RETURNS TABLE (
  id UUID,
  content TEXT,
  page_number INTEGER,
  similarity FLOAT
)
LANGUAGE SQL AS $$
  SELECT id, content, page_number,
    1 - (embedding <=> query_embedding) AS similarity
  FROM document_chunks
  WHERE doc_id = target_doc_id
  ORDER BY embedding <=> query_embedding
  LIMIT match_count;
$$;
```

## Chunking Strategy

```
chunk_size    = 500 tokens  (≈ 1-2 đoạn văn)
chunk_overlap = 50 tokens   (giữ context giữa các chunk)
```

Lý do: Chunk nhỏ → embedding chính xác hơn, overlap → tránh mất context ở ranh giới chunk.

## Prompt Template

```
System:
Bạn là trợ lý nghiên cứu AI. Trả lời câu hỏi dựa trên các đoạn trích sau từ tài liệu.
Nếu không tìm thấy câu trả lời trong tài liệu, hãy nói rõ điều đó.
Trả lời ngắn gọn, chính xác, có trích dẫn trang khi cần.

Các đoạn trích liên quan:
[CHUNK 1 - Trang 3] {content}
[CHUNK 2 - Trang 5] {content}
...

Lịch sử hội thoại:
{chat_history}

Câu hỏi: {question}
```

## Environment Variables

### Backend (.env)
```
GOOGLE_API_KEY=          # Google AI Studio
SUPABASE_URL=            # Project URL từ Supabase dashboard
SUPABASE_SERVICE_KEY=    # service_role key (không phải anon key)
CORS_ORIGINS=http://localhost:5173,https://your-app.vercel.app
```

### Frontend (.env)
```
VITE_API_URL=http://localhost:8000   # dev
# VITE_API_URL=https://your-app.onrender.com  # prod
```
