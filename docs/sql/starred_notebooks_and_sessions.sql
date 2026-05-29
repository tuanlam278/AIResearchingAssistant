-- Persist starred/pinned state for notebooks and research history.
-- Safe to run multiple times in Supabase SQL editor.

alter table public.notebooks
add column if not exists is_starred boolean not null default false;

alter table public.research_sessions
add column if not exists is_starred boolean not null default false;

create index if not exists idx_notebooks_user_starred_created
  on public.notebooks(user_id, is_starred desc, created_at desc);

create index if not exists idx_research_sessions_notebook_starred_created
  on public.research_sessions(notebook_id, is_starred desc, created_at desc);
