-- Academic Lens persistence: notes, reading sessions, chat history, and managed web contexts.
-- Run in Supabase SQL editor before relying on DB-backed Academic Lens state.

create table if not exists public.academic_lens_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  document_id text not null,
  title text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.academic_lens_messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.academic_lens_sessions(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null default '',
  citations jsonb not null default '[]'::jsonb,
  attachments jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.academic_lens_notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  document_id text not null,
  session_id uuid null references public.academic_lens_sessions(id) on delete set null,
  content text not null default '',
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists academic_lens_notes_user_document_session_idx
  on public.academic_lens_notes(user_id, document_id, coalesce(session_id, '00000000-0000-0000-0000-000000000000'::uuid));

create table if not exists public.academic_lens_web_contexts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  session_id uuid null references public.academic_lens_sessions(id) on delete cascade,
  document_id text null,
  title text,
  url text,
  content text not null,
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists academic_lens_sessions_user_document_idx on public.academic_lens_sessions(user_id, document_id, updated_at desc);
create index if not exists academic_lens_messages_session_idx on public.academic_lens_messages(session_id, created_at asc);
create index if not exists academic_lens_web_contexts_user_session_idx on public.academic_lens_web_contexts(user_id, session_id, created_at desc);
create index if not exists academic_lens_web_contexts_user_document_idx on public.academic_lens_web_contexts(user_id, document_id, created_at desc);
