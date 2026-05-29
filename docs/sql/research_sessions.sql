-- Research session history for notebook chat.
-- Run in Supabase SQL editor before using persisted session history.

create table if not exists public.research_sessions (
  id uuid primary key default gen_random_uuid(),
  notebook_id uuid not null references public.notebooks(id) on delete cascade,
  title text not null,
  selected_document_ids jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.research_session_messages (
  id uuid primary key default gen_random_uuid(),
  research_session_id uuid not null references public.research_sessions(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  citations jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_research_sessions_notebook_id
  on public.research_sessions(notebook_id, created_at desc);

create index if not exists idx_research_session_messages_session_id
  on public.research_session_messages(research_session_id, created_at asc);

create unique index if not exists idx_documents_notebook_filename_lower
  on public.documents(notebook_id, lower(trim(filename)));
