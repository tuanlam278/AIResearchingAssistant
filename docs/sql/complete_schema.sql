-- AI Researching Assistant complete Supabase schema.
-- Run this file once in the Supabase SQL editor on a fresh project.
-- Assumptions: API > Automatically expose new tables may be ON, and automatic RLS may be ON.
-- This script is still explicit about extensions, grants, RLS, policies, indexes, RPCs, and storage buckets.

create extension if not exists vector;

-- -----------------------------------------------------------------------------
-- Auth/profile tables
-- -----------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text unique not null,
  role text not null default 'user',
  avatar_url text,
  full_name text,
  display_name text,
  gender text check (gender is null or gender in ('male', 'female', 'other', 'prefer_not_to_say')),
  date_of_birth date,
  google_id text unique,
  google_email text,
  google_avatar_url text,
  auth_provider text,
  email_2fa_enabled boolean not null default false,
  is_active boolean not null default true,
  deleted_at timestamptz,
  disabled_at timestamptz,
  preferred_theme text not null default 'system' check (preferred_theme in ('light', 'dark', 'system')),
  preferred_language text not null default 'vi' check (preferred_language in ('vi', 'en')),
  password_login_enabled boolean not null default false,
  default_password_must_change boolean not null default false,
  can_upload_library_documents boolean not null default true,
  can_publish_documents boolean not null default true,
  publish_blocked_reason text,
  publish_blocked_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index if not exists idx_profiles_google_id on public.profiles(google_id) where google_id is not null;
create index if not exists idx_profiles_email on public.profiles(email);
create index if not exists idx_profiles_email_lower on public.profiles(lower(email));
create unique index if not exists idx_profiles_display_name_unique
  on public.profiles (lower(display_name))
  where display_name is not null and btrim(display_name) <> '';

-- Optional legacy public.users compatibility when a project already has it.
alter table if exists public.users add column if not exists role text not null default 'user';
alter table if exists public.users add column if not exists can_upload_library_documents boolean not null default true;
alter table if exists public.users add column if not exists can_publish_documents boolean not null default true;
alter table if exists public.users add column if not exists publish_blocked_reason text;
alter table if exists public.users add column if not exists publish_blocked_at timestamptz;

do $$
begin
  if to_regclass('public.users') is not null
     and not exists (select 1 from pg_constraint where conname = 'users_role_check') then
    alter table public.users add constraint users_role_check check (role in ('user', 'admin'));
  end if;
end $$;

create table if not exists public.password_reset_otps (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  otp_hash text not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  attempts integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists idx_password_reset_otps_email on public.password_reset_otps(email);

create table if not exists public.user_activity_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  feature_name text not null,
  action_type text not null,
  document_id uuid,
  document_name text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_user_activity_logs_user_created
  on public.user_activity_logs(user_id, created_at desc);

-- -----------------------------------------------------------------------------
-- Core notebook/document/note schema
-- -----------------------------------------------------------------------------
create table if not exists public.notebooks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  is_starred boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_notebooks_user_starred_created
  on public.notebooks(user_id, is_starred desc, created_at desc);

create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  notebook_id uuid not null references public.notebooks(id) on delete cascade,
  filename text not null,
  file_type text,
  page_count integer not null default 0,
  chunk_count integer not null default 0,
  status text not null default 'ready',
  processing_status text,
  processing_error text,
  is_vector_ready boolean not null default false,
  citation_threshold double precision not null default 0,
  tags text[] not null default '{}',
  source_type text not null default 'user_document',
  source_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists idx_documents_notebook_filename_lower
  on public.documents(notebook_id, lower(trim(filename)));
create index if not exists idx_documents_notebook_created
  on public.documents(notebook_id, created_at desc);
create index if not exists idx_documents_source
  on public.documents(source_type, source_id);

create table if not exists public.document_chunks (
  id uuid primary key default gen_random_uuid(),
  doc_id uuid not null references public.documents(id) on delete cascade,
  notebook_id uuid not null references public.notebooks(id) on delete cascade,
  section text not null default 'Unknown',
  content text not null,
  page_number integer,
  page_start integer,
  page_end integer,
  chunk_index integer,
  markdown text,
  block_types jsonb not null default '[]'::jsonb,
  block_ids jsonb not null default '[]'::jsonb,
  contains_table boolean not null default false,
  contains_equation boolean not null default false,
  embedding vector(768),
  created_at timestamptz not null default now()
);

create index if not exists idx_document_chunks_notebook_doc_index
  on public.document_chunks(notebook_id, doc_id, chunk_index);
create index if not exists idx_document_chunks_doc_id
  on public.document_chunks(doc_id);
create index if not exists idx_document_chunks_embedding
  on public.document_chunks using hnsw (embedding vector_cosine_ops);

create table if not exists public.notes (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.notebooks(id) on delete cascade,
  title text not null,
  content text not null,
  citations jsonb not null default '[]'::jsonb,
  source_message_id text,
  research_session_id uuid,
  note_type text not null default 'text',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_notes_workspace_updated on public.notes(workspace_id, updated_at desc);

create table if not exists public.research_sessions (
  id uuid primary key default gen_random_uuid(),
  notebook_id uuid not null references public.notebooks(id) on delete cascade,
  title text not null,
  selected_document_ids jsonb not null default '[]'::jsonb,
  is_starred boolean not null default false,
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

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'notes_research_session_id_fkey') then
    alter table public.notes
      add constraint notes_research_session_id_fkey
      foreign key (research_session_id) references public.research_sessions(id) on delete set null
      not valid;
  end if;

  begin
    alter table public.notes validate constraint notes_research_session_id_fkey;
  exception when others then
    null;
  end;
end $$;

create index if not exists idx_research_sessions_notebook_id
  on public.research_sessions(notebook_id, created_at desc);
create index if not exists idx_research_sessions_notebook_starred_created
  on public.research_sessions(notebook_id, is_starred desc, created_at desc);
create index if not exists idx_research_session_messages_session_id
  on public.research_session_messages(research_session_id, created_at asc);
create index if not exists idx_notes_research_session_id
  on public.notes(research_session_id, updated_at desc);

create table if not exists public.document_pages (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  page integer not null,
  markdown text not null default '',
  plain_text text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.document_blocks (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  page integer not null,
  block_index integer not null,
  block_type text not null default 'unknown',
  section text,
  markdown text not null default '',
  plain_text text not null default '',
  bbox jsonb,
  confidence double precision,
  source text not null default 'unknown',
  created_at timestamptz not null default now()
);

create index if not exists idx_document_pages_document_page on public.document_pages(document_id, page);
create index if not exists idx_document_blocks_document_page on public.document_blocks(document_id, page, block_index);
create index if not exists idx_document_blocks_type on public.document_blocks(block_type);

create table if not exists public.document_intelligence (
  document_id uuid primary key references public.documents(id) on delete cascade,
  notebook_id uuid references public.notebooks(id) on delete cascade,
  summary text,
  outline jsonb not null default '[]'::jsonb,
  section_summaries jsonb not null default '[]'::jsonb,
  key_terms jsonb not null default '[]'::jsonb,
  citation_candidates jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists document_intelligence_notebook_idx on public.document_intelligence(notebook_id);

-- -----------------------------------------------------------------------------
-- Academic Lens persistence
-- -----------------------------------------------------------------------------
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
  session_id uuid references public.academic_lens_sessions(id) on delete set null,
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
  session_id uuid references public.academic_lens_sessions(id) on delete cascade,
  document_id text,
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

-- -----------------------------------------------------------------------------
-- System/community library
-- -----------------------------------------------------------------------------
create table if not exists public.system_documents (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  filename text not null,
  file_type text,
  storage_path text,
  download_url text,
  file_size bigint,
  mime_type text,
  category text,
  description text,
  tags text[] not null default '{}',
  summary text,
  page_count integer,
  word_count integer,
  is_vector_ready boolean not null default false,
  created_by uuid,
  source_type text not null default 'SYSTEM_UPLOAD',
  status text not null default 'PUBLISHED',
  status_reason text,
  admin_feedback text,
  processing_status text default 'published',
  copyright_confirmed boolean default false,
  authors text[] default '{}',
  year integer,
  venue text,
  open_access_pdf_url text,
  metadata_only boolean default false,
  peer_review_status text not null default 'UNKNOWN',
  access_type text not null default 'UNKNOWN',
  review_type text not null default 'UNKNOWN',
  has_pdf boolean not null default false,
  has_code boolean not null default false,
  has_data boolean not null default false,
  citation_count integer not null default 0,
  citation_threshold double precision not null default 0,
  vote_avg numeric(3,2) not null default 0,
  vote_count integer not null default 0,
  download_count integer not null default 0,
  uploader_name text,
  doi text,
  external_url text,
  ai_research_methodology text,
  ai_readability_level text,
  ai_estimated_reading_time_minutes integer,
  ai_empirical_evidence text,
  ai_outcome_stance text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'system_documents_source_type_check') then
    alter table public.system_documents add constraint system_documents_source_type_check check (source_type in ('USER_UPLOAD', 'SYSTEM_UPLOAD', 'INTERNET'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'system_documents_status_check') then
    alter table public.system_documents add constraint system_documents_status_check check (status in ('PUBLISHED', 'PENDING_REVIEW', 'HIDDEN', 'REJECTED', 'DELETED', 'NEEDS_CHANGES', 'PROCESSING'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'system_documents_peer_review_check') then
    alter table public.system_documents add constraint system_documents_peer_review_check check (peer_review_status in ('PEER_REVIEWED', 'PREPRINT', 'UNKNOWN'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'system_documents_access_type_check') then
    alter table public.system_documents add constraint system_documents_access_type_check check (access_type in ('OPEN_ACCESS', 'FREE_TO_READ', 'INSTITUTIONAL_ACCESS', 'UNKNOWN'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'system_documents_review_type_check') then
    alter table public.system_documents add constraint system_documents_review_type_check check (review_type in ('RESEARCH_ARTICLE', 'REVIEW', 'SYSTEMATIC_REVIEW', 'META_ANALYSIS', 'EDITORIAL', 'UNKNOWN'));
  end if;
end $$;

create table if not exists public.system_document_chunks (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.system_documents(id) on delete cascade,
  content text not null,
  page_start integer,
  page_end integer,
  markdown text,
  block_types jsonb not null default '[]'::jsonb,
  block_ids jsonb not null default '[]'::jsonb,
  contains_table boolean not null default false,
  contains_equation boolean not null default false,
  embedding vector(768),
  created_at timestamptz not null default now()
);

create table if not exists public.system_document_bookmarks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  document_id uuid not null references public.system_documents(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique(user_id, document_id)
);

create table if not exists public.system_document_votes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  document_id uuid not null references public.system_documents(id) on delete cascade,
  rating integer not null check (rating between 1 and 5),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, document_id)
);

create table if not exists public.system_document_pages (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.system_documents(id) on delete cascade,
  page integer not null,
  markdown text not null default '',
  plain_text text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.system_document_blocks (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.system_documents(id) on delete cascade,
  page integer not null,
  block_index integer not null,
  block_type text not null default 'unknown',
  section text,
  markdown text not null default '',
  plain_text text not null default '',
  bbox jsonb,
  confidence double precision,
  source text not null default 'unknown',
  created_at timestamptz not null default now()
);

create index if not exists idx_system_documents_category on public.system_documents(category);
create index if not exists idx_system_documents_vector_ready on public.system_documents(is_vector_ready);
create index if not exists idx_system_documents_tags on public.system_documents using gin(tags);
create index if not exists idx_system_documents_public on public.system_documents(status, source_type, created_at desc);
create index if not exists idx_system_documents_vote on public.system_documents(vote_avg desc, vote_count desc);
create index if not exists idx_system_documents_citation on public.system_documents(citation_count desc);
create index if not exists idx_system_documents_download on public.system_documents(download_count desc);
create index if not exists idx_system_documents_source_status on public.system_documents(source_type, status, created_at desc);
create index if not exists idx_system_documents_doi on public.system_documents(doi) where doi is not null;
create index if not exists idx_system_documents_year on public.system_documents(year) where year is not null;
create index if not exists idx_system_document_bookmarks_user on public.system_document_bookmarks(user_id);
create index if not exists idx_system_document_chunks_document on public.system_document_chunks(document_id);
create index if not exists idx_system_document_chunks_embedding on public.system_document_chunks using ivfflat (embedding vector_cosine_ops) with (lists = 100);
create index if not exists idx_system_document_votes_document on public.system_document_votes(document_id);
create index if not exists idx_system_document_pages_document_page on public.system_document_pages(document_id, page);
create index if not exists idx_system_document_blocks_document_page on public.system_document_blocks(document_id, page, block_index);
create index if not exists idx_system_document_blocks_type on public.system_document_blocks(block_type);

-- -----------------------------------------------------------------------------
-- Durable background jobs
-- -----------------------------------------------------------------------------
create table if not exists public.indexing_jobs (
  id uuid primary key default gen_random_uuid(),
  job_type text not null,
  resource_id uuid,
  user_id uuid,
  status text not null default 'queued' check (status in ('queued','running','retrying','succeeded','failed','cancelled')),
  stage text not null default 'queued',
  progress integer not null default 0 check (progress >= 0 and progress <= 100),
  payload jsonb not null default '{}'::jsonb,
  result jsonb not null default '{}'::jsonb,
  error_message text,
  attempt_count integer not null default 0,
  max_attempts integer not null default 3,
  locked_by text,
  locked_until timestamptz,
  run_after timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.generation_jobs (
  id uuid primary key default gen_random_uuid(),
  job_type text not null,
  resource_id uuid,
  user_id uuid,
  status text not null default 'queued' check (status in ('queued','running','retrying','succeeded','failed','cancelled')),
  stage text not null default 'queued',
  progress integer not null default 0 check (progress >= 0 and progress <= 100),
  payload jsonb not null default '{}'::jsonb,
  result jsonb not null default '{}'::jsonb,
  error_message text,
  attempt_count integer not null default 0,
  max_attempts integer not null default 2,
  locked_by text,
  locked_until timestamptz,
  run_after timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists indexing_jobs_status_run_after_idx on public.indexing_jobs(status, run_after, created_at);
create index if not exists indexing_jobs_resource_idx on public.indexing_jobs(resource_id, job_type);
create index if not exists indexing_jobs_user_idx on public.indexing_jobs(user_id, created_at desc);
create index if not exists generation_jobs_status_run_after_idx on public.generation_jobs(status, run_after, created_at);
create index if not exists generation_jobs_resource_idx on public.generation_jobs(resource_id, job_type);
create index if not exists generation_jobs_user_idx on public.generation_jobs(user_id, created_at desc);

-- -----------------------------------------------------------------------------
-- Shared triggers/RPCs
-- -----------------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.touch_document_intelligence_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.touch_indexing_jobs_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.touch_generation_jobs_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_notebooks_updated_at on public.notebooks;
create trigger trg_notebooks_updated_at before update on public.notebooks for each row execute function public.touch_updated_at();
drop trigger if exists trg_documents_updated_at on public.documents;
create trigger trg_documents_updated_at before update on public.documents for each row execute function public.touch_updated_at();
drop trigger if exists trg_notes_updated_at on public.notes;
create trigger trg_notes_updated_at before update on public.notes for each row execute function public.touch_updated_at();
drop trigger if exists trg_research_sessions_updated_at on public.research_sessions;
create trigger trg_research_sessions_updated_at before update on public.research_sessions for each row execute function public.touch_updated_at();
drop trigger if exists trg_document_intelligence_updated_at on public.document_intelligence;
create trigger trg_document_intelligence_updated_at before update on public.document_intelligence for each row execute function public.touch_document_intelligence_updated_at();
drop trigger if exists trg_system_documents_updated_at on public.system_documents;
create trigger trg_system_documents_updated_at before update on public.system_documents for each row execute function public.touch_updated_at();
drop trigger if exists trg_system_document_votes_updated_at on public.system_document_votes;
create trigger trg_system_document_votes_updated_at before update on public.system_document_votes for each row execute function public.touch_updated_at();
drop trigger if exists trg_indexing_jobs_updated_at on public.indexing_jobs;
create trigger trg_indexing_jobs_updated_at before update on public.indexing_jobs for each row execute function public.touch_indexing_jobs_updated_at();
drop trigger if exists trg_generation_jobs_updated_at on public.generation_jobs;
create trigger trg_generation_jobs_updated_at before update on public.generation_jobs for each row execute function public.touch_generation_jobs_updated_at();

create or replace function public.match_chunks(
  query_embedding vector(768),
  target_notebook_id uuid,
  match_count int default 5,
  match_threshold float default 0.0
)
returns table (
  id uuid,
  section text,
  content text,
  page_number integer,
  page_start integer,
  page_end integer,
  doc_id uuid,
  chunk_index integer,
  markdown text,
  block_types jsonb,
  block_ids jsonb,
  contains_table boolean,
  contains_equation boolean,
  similarity float
)
language sql stable
as $$
  select
    dc.id,
    dc.section,
    dc.content,
    dc.page_number,
    dc.page_start,
    dc.page_end,
    dc.doc_id,
    dc.chunk_index,
    dc.markdown,
    dc.block_types,
    dc.block_ids,
    dc.contains_table,
    dc.contains_equation,
    1 - (dc.embedding <=> query_embedding) as similarity
  from public.document_chunks dc
  where dc.notebook_id = target_notebook_id
    and dc.embedding is not null
    and 1 - (dc.embedding <=> query_embedding) >= match_threshold
  order by dc.embedding <=> query_embedding
  limit match_count;
$$;

create or replace function public.match_system_documents(
  query_embedding vector(768),
  match_count int default 20,
  match_threshold float default 0
)
returns table (
  id uuid,
  document_id uuid,
  title text,
  similarity float
)
language sql stable
as $$
  with ranked_chunks as (
    select
      d.id,
      d.id as document_id,
      d.title,
      max(1 - (c.embedding <=> query_embedding)) as similarity
    from public.system_document_chunks c
    join public.system_documents d on d.id = c.document_id
    where c.embedding is not null
      and d.status = 'PUBLISHED'
    group by d.id, d.title
  )
  select id, document_id, title, similarity
  from ranked_chunks
  where similarity >= match_threshold
  order by similarity desc
  limit match_count;
$$;

create or replace function public.set_user_publish_permission(
  target_user_id uuid,
  can_publish boolean,
  blocked_reason text default null
)
returns table (
  user_id uuid,
  can_publish_documents boolean,
  publish_blocked_reason text,
  publish_blocked_at timestamptz,
  hidden_documents integer
)
language plpgsql
security definer
as $$
declare
  blocked_at_value timestamptz;
  hidden_count integer := 0;
begin
  if can_publish then
    blocked_at_value := null;
    update public.profiles
       set can_publish_documents = true,
           can_upload_library_documents = true,
           publish_blocked_reason = null,
           publish_blocked_at = null
     where id = target_user_id;

    if to_regclass('public.users') is not null then
      execute 'update public.users set can_publish_documents = true, can_upload_library_documents = true, publish_blocked_reason = null, publish_blocked_at = null where id = $1'
      using target_user_id;
    end if;
  else
    blocked_at_value := now();
    update public.profiles
       set can_publish_documents = false,
           can_upload_library_documents = false,
           publish_blocked_reason = blocked_reason,
           publish_blocked_at = blocked_at_value
     where id = target_user_id;

    if to_regclass('public.users') is not null then
      execute 'update public.users set can_publish_documents = false, can_upload_library_documents = false, publish_blocked_reason = $2, publish_blocked_at = $3 where id = $1'
      using target_user_id, blocked_reason, blocked_at_value;
    end if;

    update public.system_documents
       set status = 'HIDDEN',
           status_reason = coalesce(blocked_reason, 'Publish permission blocked by admin')
     where created_by = target_user_id
       and source_type = 'USER_UPLOAD'
       and status = 'PUBLISHED';

    get diagnostics hidden_count = row_count;
  end if;

  return query select target_user_id, can_publish, case when can_publish then null else blocked_reason end, blocked_at_value, hidden_count;
end;
$$;

-- -----------------------------------------------------------------------------
-- Storage buckets
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values
  ('notebook-sources', 'notebook-sources', false),
  ('system-documents', 'system-documents', false),
  ('avatars', 'avatars', true)
on conflict (id) do update set
  name = excluded.name,
  public = excluded.public;

-- -----------------------------------------------------------------------------
-- Grants and RLS policies
-- -----------------------------------------------------------------------------
grant usage on schema public to anon, authenticated, service_role;
grant usage on schema storage to service_role;
grant all privileges on all tables in schema public to service_role;
grant all privileges on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;
alter default privileges in schema public grant all privileges on tables to service_role;
alter default privileges in schema public grant all privileges on sequences to service_role;
alter default privileges in schema public grant execute on functions to service_role;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'profiles', 'users', 'notebooks', 'documents', 'document_chunks', 'notes',
    'research_sessions', 'research_session_messages', 'document_intelligence',
    'document_pages', 'document_blocks', 'academic_lens_sessions',
    'academic_lens_messages', 'academic_lens_notes', 'academic_lens_web_contexts',
    'system_documents', 'system_document_chunks', 'system_document_bookmarks',
    'system_document_votes', 'system_document_pages', 'system_document_blocks',
    'user_activity_logs'
  ] loop
    if to_regclass(format('public.%I', table_name)) is not null then
      execute format('grant select, insert, update, delete on table public.%I to authenticated', table_name);
    end if;
  end loop;
end $$;

grant usage, select on all sequences in schema public to authenticated;
grant execute on function public.match_chunks(vector, uuid, integer, double precision) to authenticated;
grant execute on function public.match_system_documents(vector, integer, double precision) to authenticated;
revoke all privileges on table public.password_reset_otps from anon, authenticated;
revoke all privileges on table public.indexing_jobs from anon, authenticated;
revoke all privileges on table public.generation_jobs from anon, authenticated;

alter table public.profiles enable row level security;
alter table if exists public.users enable row level security;
alter table public.notebooks enable row level security;
alter table public.documents enable row level security;
alter table public.document_chunks enable row level security;
alter table public.notes enable row level security;
alter table public.research_sessions enable row level security;
alter table public.research_session_messages enable row level security;
alter table public.document_intelligence enable row level security;
alter table public.document_pages enable row level security;
alter table public.document_blocks enable row level security;
alter table public.academic_lens_sessions enable row level security;
alter table public.academic_lens_messages enable row level security;
alter table public.academic_lens_notes enable row level security;
alter table public.academic_lens_web_contexts enable row level security;
alter table public.system_documents enable row level security;
alter table public.system_document_chunks enable row level security;
alter table public.system_document_bookmarks enable row level security;
alter table public.system_document_votes enable row level security;
alter table public.system_document_pages enable row level security;
alter table public.system_document_blocks enable row level security;
alter table public.user_activity_logs enable row level security;
alter table public.password_reset_otps enable row level security;
alter table public.indexing_jobs enable row level security;
alter table public.generation_jobs enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'profiles' and policyname = 'Profiles are readable by owner') then
    create policy "Profiles are readable by owner" on public.profiles for select using (auth.uid() = id);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'profiles' and policyname = 'Profiles are insertable by owner') then
    create policy "Profiles are insertable by owner" on public.profiles for insert with check (auth.uid() = id);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'profiles' and policyname = 'Profiles are updatable by owner') then
    create policy "Profiles are updatable by owner" on public.profiles for update using (auth.uid() = id) with check (auth.uid() = id);
  end if;

  if to_regclass('public.users') is not null then
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'users' and policyname = 'Users rows are readable by owner') then
      create policy "Users rows are readable by owner" on public.users for select using (auth.uid() = id);
    end if;
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'users' and policyname = 'Users rows are insertable by owner') then
      create policy "Users rows are insertable by owner" on public.users for insert with check (auth.uid() = id);
    end if;
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'users' and policyname = 'Users rows are updatable by owner') then
      create policy "Users rows are updatable by owner" on public.users for update using (auth.uid() = id) with check (auth.uid() = id);
    end if;
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'notebooks' and policyname = 'Users manage own notebooks') then
    create policy "Users manage own notebooks" on public.notebooks for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'documents' and policyname = 'Users manage documents in own notebooks') then
    create policy "Users manage documents in own notebooks" on public.documents for all
      using (exists (select 1 from public.notebooks n where n.id = notebook_id and n.user_id = auth.uid()))
      with check (exists (select 1 from public.notebooks n where n.id = notebook_id and n.user_id = auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'document_chunks' and policyname = 'Users access chunks in own notebooks') then
    create policy "Users access chunks in own notebooks" on public.document_chunks for all
      using (exists (select 1 from public.notebooks n where n.id = notebook_id and n.user_id = auth.uid()))
      with check (exists (select 1 from public.notebooks n where n.id = notebook_id and n.user_id = auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'notes' and policyname = 'Users manage own notes') then
    create policy "Users manage own notes" on public.notes for all
      using (exists (select 1 from public.notebooks n where n.id = workspace_id and n.user_id = auth.uid()))
      with check (exists (select 1 from public.notebooks n where n.id = workspace_id and n.user_id = auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'research_sessions' and policyname = 'Users manage sessions in own notebooks') then
    create policy "Users manage sessions in own notebooks" on public.research_sessions for all
      using (exists (select 1 from public.notebooks n where n.id = notebook_id and n.user_id = auth.uid()))
      with check (exists (select 1 from public.notebooks n where n.id = notebook_id and n.user_id = auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'research_session_messages' and policyname = 'Users manage messages in own sessions') then
    create policy "Users manage messages in own sessions" on public.research_session_messages for all
      using (exists (select 1 from public.research_sessions rs join public.notebooks n on n.id = rs.notebook_id where rs.id = research_session_id and n.user_id = auth.uid()))
      with check (exists (select 1 from public.research_sessions rs join public.notebooks n on n.id = rs.notebook_id where rs.id = research_session_id and n.user_id = auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'document_intelligence' and policyname = 'Users access intelligence for own documents') then
    create policy "Users access intelligence for own documents" on public.document_intelligence for all
      using (exists (select 1 from public.documents d join public.notebooks n on n.id = d.notebook_id where d.id = document_id and n.user_id = auth.uid()))
      with check (exists (select 1 from public.documents d join public.notebooks n on n.id = d.notebook_id where d.id = document_id and n.user_id = auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'document_pages' and policyname = 'Users access pages for own documents') then
    create policy "Users access pages for own documents" on public.document_pages for all
      using (exists (select 1 from public.documents d join public.notebooks n on n.id = d.notebook_id where d.id = document_id and n.user_id = auth.uid()))
      with check (exists (select 1 from public.documents d join public.notebooks n on n.id = d.notebook_id where d.id = document_id and n.user_id = auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'document_blocks' and policyname = 'Users access blocks for own documents') then
    create policy "Users access blocks for own documents" on public.document_blocks for all
      using (exists (select 1 from public.documents d join public.notebooks n on n.id = d.notebook_id where d.id = document_id and n.user_id = auth.uid()))
      with check (exists (select 1 from public.documents d join public.notebooks n on n.id = d.notebook_id where d.id = document_id and n.user_id = auth.uid()));
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'academic_lens_sessions' and policyname = 'Users manage own academic lens sessions') then
    create policy "Users manage own academic lens sessions" on public.academic_lens_sessions for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'academic_lens_messages' and policyname = 'Users manage own academic lens messages') then
    create policy "Users manage own academic lens messages" on public.academic_lens_messages for all
      using (exists (select 1 from public.academic_lens_sessions s where s.id = session_id and s.user_id = auth.uid()))
      with check (exists (select 1 from public.academic_lens_sessions s where s.id = session_id and s.user_id = auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'academic_lens_notes' and policyname = 'Users manage own academic lens notes') then
    create policy "Users manage own academic lens notes" on public.academic_lens_notes for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'academic_lens_web_contexts' and policyname = 'Users manage own academic lens web contexts') then
    create policy "Users manage own academic lens web contexts" on public.academic_lens_web_contexts for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'system_documents' and policyname = 'Users read published library documents') then
    create policy "Users read published library documents" on public.system_documents for select using (status = 'PUBLISHED');
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'system_document_chunks' and policyname = 'Users read chunks for published library documents') then
    create policy "Users read chunks for published library documents" on public.system_document_chunks for select
      using (exists (select 1 from public.system_documents d where d.id = document_id and d.status = 'PUBLISHED'));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'system_document_pages' and policyname = 'Users read pages for published library documents') then
    create policy "Users read pages for published library documents" on public.system_document_pages for select
      using (exists (select 1 from public.system_documents d where d.id = document_id and d.status = 'PUBLISHED'));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'system_document_blocks' and policyname = 'Users read blocks for published library documents') then
    create policy "Users read blocks for published library documents" on public.system_document_blocks for select
      using (exists (select 1 from public.system_documents d where d.id = document_id and d.status = 'PUBLISHED'));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'system_document_bookmarks' and policyname = 'Users manage own system bookmarks') then
    create policy "Users manage own system bookmarks" on public.system_document_bookmarks for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'system_document_votes' and policyname = 'Users read document votes') then
    create policy "Users read document votes" on public.system_document_votes for select using (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'system_document_votes' and policyname = 'Users manage own document votes') then
    create policy "Users manage own document votes" on public.system_document_votes for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'user_activity_logs' and policyname = 'Users read own activity logs') then
    create policy "Users read own activity logs" on public.user_activity_logs for select using (auth.uid() = user_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'user_activity_logs' and policyname = 'Users insert own activity logs') then
    create policy "Users insert own activity logs" on public.user_activity_logs for insert with check (auth.uid() = user_id);
  end if;
end $$;

-- No anon/authenticated policies are intentionally created for password_reset_otps,
-- indexing_jobs, or generation_jobs. They stay service-role only.

-- Refresh PostgREST/Supabase API schema cache so newly-created tables are routable immediately.
select pg_notify('pgrst', 'reload schema');
