-- Adds optional columns used by the unified System / Community / Internet library UI.
-- Existing legacy table name stays unchanged to avoid risky renames.
alter table if exists public.system_documents
  add column if not exists status_reason text,
  add column if not exists admin_feedback text,
  add column if not exists processing_status text default 'published',
  add column if not exists copyright_confirmed boolean default false,
  add column if not exists authors text[] default '{}',
  add column if not exists year integer,
  add column if not exists venue text,
  add column if not exists open_access_pdf_url text,
  add column if not exists metadata_only boolean default false;

create index if not exists idx_system_documents_source_status
  on public.system_documents (source_type, status, created_at desc);
create index if not exists idx_system_documents_doi
  on public.system_documents (doi)
  where doi is not null;
create index if not exists idx_system_documents_year
  on public.system_documents (year)
  where year is not null;
