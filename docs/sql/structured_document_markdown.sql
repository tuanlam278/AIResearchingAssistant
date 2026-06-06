-- Structured academic document extraction metadata for notebook and System Library RAG.
-- Safe to run multiple times. Keeps existing flat chunk content intact.

create table if not exists public.document_pages (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null,
  page integer not null,
  markdown text not null default '',
  plain_text text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.document_blocks (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null,
  page integer not null,
  block_index integer not null,
  block_type text not null default 'unknown',
  section text null,
  markdown text not null default '',
  plain_text text not null default '',
  bbox jsonb null,
  confidence double precision null,
  source text not null default 'unknown',
  created_at timestamptz not null default now()
);

create index if not exists idx_document_pages_document_page on public.document_pages(document_id, page);
create index if not exists idx_document_blocks_document_page on public.document_blocks(document_id, page, block_index);
create index if not exists idx_document_blocks_type on public.document_blocks(block_type);

alter table public.document_chunks
  add column if not exists page_start integer,
  add column if not exists page_end integer,
  add column if not exists markdown text,
  add column if not exists block_types jsonb not null default '[]'::jsonb,
  add column if not exists block_ids jsonb not null default '[]'::jsonb,
  add column if not exists contains_table boolean not null default false,
  add column if not exists contains_equation boolean not null default false;

create table if not exists public.system_document_pages (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null,
  page integer not null,
  markdown text not null default '',
  plain_text text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.system_document_blocks (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null,
  page integer not null,
  block_index integer not null,
  block_type text not null default 'unknown',
  section text null,
  markdown text not null default '',
  plain_text text not null default '',
  bbox jsonb null,
  confidence double precision null,
  source text not null default 'unknown',
  created_at timestamptz not null default now()
);

create index if not exists idx_system_document_pages_document_page on public.system_document_pages(document_id, page);
create index if not exists idx_system_document_blocks_document_page on public.system_document_blocks(document_id, page, block_index);
create index if not exists idx_system_document_blocks_type on public.system_document_blocks(block_type);

alter table public.system_document_chunks
  add column if not exists markdown text,
  add column if not exists block_types jsonb not null default '[]'::jsonb,
  add column if not exists block_ids jsonb not null default '[]'::jsonb,
  add column if not exists contains_table boolean not null default false,
  add column if not exists contains_equation boolean not null default false;
