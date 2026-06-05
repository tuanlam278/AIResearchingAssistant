-- Precomputed document summaries, reading maps, terms, and citation candidates.
create table if not exists public.document_intelligence (
  document_id uuid primary key references public.documents(id) on delete cascade,
  notebook_id uuid,
  summary text,
  outline jsonb not null default '[]'::jsonb,
  section_summaries jsonb not null default '[]'::jsonb,
  key_terms jsonb not null default '[]'::jsonb,
  citation_candidates jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists document_intelligence_notebook_idx on public.document_intelligence (notebook_id);

create or replace function public.touch_document_intelligence_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_document_intelligence_updated_at on public.document_intelligence;
create trigger trg_document_intelligence_updated_at
before update on public.document_intelligence
for each row execute function public.touch_document_intelligence_updated_at();
