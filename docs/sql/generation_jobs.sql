-- Durable jobs for long-running generation tasks (flashcards, quizzes, summaries, reports).
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

create index if not exists generation_jobs_status_run_after_idx on public.generation_jobs (status, run_after, created_at);
create index if not exists generation_jobs_resource_idx on public.generation_jobs (resource_id, job_type);
create index if not exists generation_jobs_user_idx on public.generation_jobs (user_id, created_at desc);

create or replace function public.touch_generation_jobs_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_generation_jobs_updated_at on public.generation_jobs;
create trigger trg_generation_jobs_updated_at
before update on public.generation_jobs
for each row execute function public.touch_generation_jobs_updated_at();
