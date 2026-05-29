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
