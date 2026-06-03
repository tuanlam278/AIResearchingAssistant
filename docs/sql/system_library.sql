-- System Library schema for admin-managed documents.
-- Apply in Supabase after pgvector is enabled. Old Free/Pro/VIP fields can remain
-- in existing databases as deprecated columns, but the app no longer reads them.

create extension if not exists vector;

alter table if exists public.users
  add column if not exists role text not null default 'user';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'users_role_check') then
    alter table public.users add constraint users_role_check check (role in ('user', 'admin'));
  end if;
exception when undefined_table then
  null;
end $$;

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
  tags text[] not null default '{}',
  summary text,
  page_count integer,
  word_count integer,
  is_vector_ready boolean not null default false,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.system_documents
  add column if not exists storage_path text,
  add column if not exists download_url text,
  add column if not exists file_size bigint,
  add column if not exists mime_type text,
  add column if not exists category text,
  add column if not exists description text,
  add column if not exists summary text,
  add column if not exists created_by uuid;

-- Deprecated compatibility columns from the previous plan-gated design. Keep them
-- if already present, but do not use them in API/UI anymore:
-- access_level, is_vip, is_pro, required_plan, difficulty_level, subject_area, ai_summary.

create table if not exists public.system_document_chunks (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.system_documents(id) on delete cascade,
  content text not null,
  page_start integer,
  page_end integer,
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

alter table public.documents
  add column if not exists source_type text not null default 'user_document',
  add column if not exists source_id uuid;

create index if not exists idx_system_documents_category on public.system_documents(category);
create index if not exists idx_system_documents_vector_ready on public.system_documents(is_vector_ready);
create index if not exists idx_system_documents_tags on public.system_documents using gin(tags);
create index if not exists idx_system_document_bookmarks_user on public.system_document_bookmarks(user_id);
create index if not exists idx_system_document_chunks_document on public.system_document_chunks(document_id);
create index if not exists idx_system_document_chunks_embedding on public.system_document_chunks using ivfflat (embedding vector_cosine_ops) with (lists = 100);
create index if not exists idx_documents_source on public.documents(source_type, source_id);

-- Create this private bucket in Supabase Storage if it does not exist already.
-- The backend uses SUPABASE_SERVICE_KEY to upload/download originals and never exposes it.
insert into storage.buckets (id, name, public)
values ('system-documents', 'system-documents', false)
on conflict (id) do nothing;

alter table public.system_documents enable row level security;
alter table public.system_document_bookmarks enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'system_documents' and policyname = 'Users can read system documents') then
    create policy "Users can read system documents"
      on public.system_documents for select
      using (true);
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'system_document_bookmarks' and policyname = 'Users can read own system bookmarks') then
    create policy "Users can read own system bookmarks"
      on public.system_document_bookmarks for select
      using (auth.uid() = user_id);
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'system_document_bookmarks' and policyname = 'Users can insert own system bookmarks') then
    create policy "Users can insert own system bookmarks"
      on public.system_document_bookmarks for insert
      with check (auth.uid() = user_id);
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'system_document_bookmarks' and policyname = 'Users can delete own system bookmarks') then
    create policy "Users can delete own system bookmarks"
      on public.system_document_bookmarks for delete
      using (auth.uid() = user_id);
  end if;
end $$;

create or replace function public.set_system_documents_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_system_documents_updated_at on public.system_documents;
create trigger trg_system_documents_updated_at
before update on public.system_documents
for each row execute function public.set_system_documents_updated_at();

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
    group by d.id, d.title
  )
  select id, document_id, title, similarity
  from ranked_chunks
  where similarity >= match_threshold
  order by similarity desc
  limit match_count;
$$;

-- Community Library + Paper Internet Search extensions.
alter table if exists public.profiles
  add column if not exists can_upload_library_documents boolean not null default true;

alter table if exists public.users
  add column if not exists can_upload_library_documents boolean not null default true;

alter table public.system_documents
  add column if not exists source_type text not null default 'SYSTEM_UPLOAD',
  add column if not exists status text not null default 'PUBLISHED',
  add column if not exists peer_review_status text not null default 'UNKNOWN',
  add column if not exists access_type text not null default 'UNKNOWN',
  add column if not exists review_type text not null default 'UNKNOWN',
  add column if not exists has_pdf boolean not null default false,
  add column if not exists has_code boolean not null default false,
  add column if not exists has_data boolean not null default false,
  add column if not exists citation_count integer not null default 0,
  add column if not exists vote_avg numeric(3,2) not null default 0,
  add column if not exists vote_count integer not null default 0,
  add column if not exists download_count integer not null default 0,
  add column if not exists uploader_name text,
  add column if not exists doi text,
  add column if not exists external_url text,
  add column if not exists ai_research_methodology text,
  add column if not exists ai_readability_level text,
  add column if not exists ai_estimated_reading_time_minutes integer,
  add column if not exists ai_empirical_evidence text,
  add column if not exists ai_outcome_stance text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'system_documents_source_type_check') then
    alter table public.system_documents add constraint system_documents_source_type_check check (source_type in ('USER_UPLOAD', 'SYSTEM_UPLOAD', 'INTERNET'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'system_documents_status_check') then
    alter table public.system_documents add constraint system_documents_status_check check (status in ('PUBLISHED', 'PENDING_REVIEW', 'HIDDEN', 'REJECTED', 'DELETED'));
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

create table if not exists public.system_document_votes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  document_id uuid not null references public.system_documents(id) on delete cascade,
  rating integer not null check (rating between 1 and 5),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, document_id)
);

create index if not exists idx_system_documents_public on public.system_documents(status, source_type, created_at desc);
create index if not exists idx_system_documents_vote on public.system_documents(vote_avg desc, vote_count desc);
create index if not exists idx_system_documents_citation on public.system_documents(citation_count desc);
create index if not exists idx_system_documents_download on public.system_documents(download_count desc);
create index if not exists idx_system_document_votes_document on public.system_document_votes(document_id);

alter table public.system_document_votes enable row level security;

do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'system_documents' and policyname = 'Users can read system documents') then
    drop policy "Users can read system documents" on public.system_documents;
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'system_documents' and policyname = 'Users can read published community documents') then
    create policy "Users can read published community documents"
      on public.system_documents for select
      using (status = 'PUBLISHED');
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'system_document_votes' and policyname = 'Users can read document votes') then
    create policy "Users can read document votes" on public.system_document_votes for select using (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'system_document_votes' and policyname = 'Users can upsert own document votes') then
    create policy "Users can upsert own document votes" on public.system_document_votes for insert with check (auth.uid() = user_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'system_document_votes' and policyname = 'Users can update own document votes') then
    create policy "Users can update own document votes" on public.system_document_votes for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
  end if;
end $$;

create or replace function public.set_system_document_votes_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_system_document_votes_updated_at on public.system_document_votes;
create trigger trg_system_document_votes_updated_at
before update on public.system_document_votes
for each row execute function public.set_system_document_votes_updated_at();

-- Publish permission controls (replaces simple published/upload booleans).
alter table if exists public.profiles
  add column if not exists can_publish_documents boolean not null default true,
  add column if not exists publish_blocked_reason text,
  add column if not exists publish_blocked_at timestamptz;

alter table if exists public.users
  add column if not exists can_publish_documents boolean not null default true,
  add column if not exists publish_blocked_reason text,
  add column if not exists publish_blocked_at timestamptz;

alter table public.system_documents
  add column if not exists status_reason text;

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

    update public.users
       set can_publish_documents = true,
           can_upload_library_documents = true,
           publish_blocked_reason = null,
           publish_blocked_at = null
     where id = target_user_id;
  else
    blocked_at_value := now();

    update public.profiles
       set can_publish_documents = false,
           can_upload_library_documents = false,
           publish_blocked_reason = blocked_reason,
           publish_blocked_at = blocked_at_value
     where id = target_user_id;

    update public.users
       set can_publish_documents = false,
           can_upload_library_documents = false,
           publish_blocked_reason = blocked_reason,
           publish_blocked_at = blocked_at_value
     where id = target_user_id;

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

-- Citation threshold defaults for document indexing/retrieval metadata.
alter table public.system_documents
  add column if not exists citation_threshold double precision not null default 0;

alter table if exists public.documents
  add column if not exists citation_threshold double precision not null default 0,
  add column if not exists tags text[] not null default '{}';
