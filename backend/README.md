# Backend — AI Research Assistant

FastAPI backend cho hệ thống RAG.

## Cài đặt

```bash
cd backend
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env
# → Điền GOOGLE_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_KEY vào .env
```

## Chạy server

```bash
uvicorn app.main:app --reload
# API docs: http://localhost:8000/docs
```

## Cấu trúc

```
app/
├── main.py              # FastAPI app, CORS, router registration
├── config.py            # Env vars, constants
├── routers/
│   ├── documents.py     # POST /upload, GET /, DELETE /{id}   ← BE1
│   └── chat.py          # POST /ask, POST /ask/stream          ← BE2
├── services/
│   ├── pdf_parser.py    # Parse PDF → pages                    ← BE1
│   ├── chunker.py       # Chunk pages → chunks                 ← BE1
│   ├── embedder.py      # Google text-embedding-004            ← BE2
│   ├── retriever.py     # Vector search Supabase               ← BE2
│   └── llm.py           # Gemini 1.5 Flash generation          ← BE2
├── models/
│   └── schemas.py       # Pydantic schemas
└── db/
    └── supabase_client.py
```

## Phân công BE

| File | Người | Mô tả |
|------|-------|-------|
| `services/pdf_parser.py` | Gia Phú | Parse PDF |
| `services/chunker.py` | Gia Phú | Chunking |
| `routers/documents.py` | Gia Phú | Upload + list + delete |
| `services/embedder.py` | Đức Tâm | Gemini embedding |
| `services/retriever.py` | Đức Tâm | Vector search |
| `services/llm.py` | Đức Tâm | Gemini generation + streaming |
| `routers/chat.py` | Đức Tâm | Chat endpoints |

## Supabase Setup

Chạy SQL sau trong Supabase SQL Editor:

```sql
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  filename TEXT NOT NULL,
  page_count INTEGER,
  chunk_count INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE document_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_id UUID REFERENCES documents(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  page_number INTEGER,
  chunk_index INTEGER,
  embedding VECTOR(768),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX ON document_chunks
USING ivfflat (embedding vector_cosine_ops)
WITH (lists = 100);

CREATE OR REPLACE FUNCTION match_chunks(
  query_embedding VECTOR(768),
  target_doc_id UUID,
  match_count INT DEFAULT 5
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
