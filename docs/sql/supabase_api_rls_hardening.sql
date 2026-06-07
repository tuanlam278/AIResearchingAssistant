-- Supabase API/RLS hardening for projects where:
--   1) API > Automatically expose new tables = OFF
--   2) API > Enable automatic RLS = ON
--
-- Run this after the base schema SQL files. It makes PostgREST/API access
-- explicit instead of relying on Supabase's automatic table exposure grants, and
-- it adds RLS policies for the public tables created by docs/sql/*.sql.
-- Backend code uses the service-role key, so service_role receives full grants;
-- authenticated users receive only the grants that are further constrained by
-- the RLS policies below. Password reset OTPs and durable worker queues remain
-- service-role only.

-- Schema/routine/table visibility for PostgREST when automatic exposure is off.
grant usage on schema public to anon, authenticated, service_role;
grant usage on schema storage to service_role;

grant all privileges on all tables in schema public to service_role;
grant all privileges on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;

-- If this script is executed by the same owner that will create future tables,
-- these defaults keep future migrations service-role visible even when
-- "Automatically expose new tables" stays disabled. Re-run this file after any
-- migration that is executed by a different owner.
alter default privileges in schema public grant all privileges on tables to service_role;
alter default privileges in schema public grant all privileges on sequences to service_role;
alter default privileges in schema public grant execute on functions to service_role;

-- App-facing tables that are safe to expose to signed-in clients through RLS.
-- Some deployments enable only a subset of features, so grant table privileges
-- dynamically and skip optional tables that do not exist yet.
do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'profiles',
    'users',
    'notebooks',
    'documents',
    'document_chunks',
    'notes',
    'research_sessions',
    'research_session_messages',
    'document_intelligence',
    'document_pages',
    'document_blocks',
    'academic_lens_sessions',
    'academic_lens_messages',
    'academic_lens_notes',
    'academic_lens_web_contexts',
    'system_documents',
    'system_document_chunks',
    'system_document_bookmarks',
    'system_document_votes',
    'system_document_pages',
    'system_document_blocks',
    'user_activity_logs'
  ]
  loop
    if to_regclass(format('public.%I', table_name)) is not null then
      execute format('grant select, insert, update, delete on table public.%I to authenticated', table_name);
    end if;
  end loop;
end $$;

grant usage, select on all sequences in schema public to authenticated;
-- Only user-facing RPCs should be executable by browser roles. Do not grant all
-- routines because admin-only SECURITY DEFINER helpers may live in public.
do $$
begin
  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'match_system_documents'
      and p.pronargs = 3
  ) then
    execute 'grant execute on function public.match_system_documents(vector, integer, double precision) to authenticated';
  end if;
end $$;

-- Sensitive/backend-only tables. Keep them unavailable to browser roles even if
-- someone later adds permissive RLS by mistake.
do $$
declare
  table_name text;
begin
  foreach table_name in array array['password_reset_otps', 'indexing_jobs', 'generation_jobs']
  loop
    if to_regclass(format('public.%I', table_name)) is not null then
      execute format('revoke all privileges on table public.%I from anon, authenticated', table_name);
    end if;
  end loop;
end $$;

-- Automatic RLS may already have enabled these tables; these statements make the
-- expected state explicit and idempotent.
alter table if exists public.profiles enable row level security;
alter table if exists public.users enable row level security;
alter table if exists public.notebooks enable row level security;
alter table if exists public.documents enable row level security;
alter table if exists public.document_chunks enable row level security;
alter table if exists public.notes enable row level security;
alter table if exists public.research_sessions enable row level security;
alter table if exists public.research_session_messages enable row level security;
alter table if exists public.document_intelligence enable row level security;
alter table if exists public.document_pages enable row level security;
alter table if exists public.document_blocks enable row level security;
alter table if exists public.academic_lens_sessions enable row level security;
alter table if exists public.academic_lens_messages enable row level security;
alter table if exists public.academic_lens_notes enable row level security;
alter table if exists public.academic_lens_web_contexts enable row level security;
alter table if exists public.system_documents enable row level security;
alter table if exists public.system_document_chunks enable row level security;
alter table if exists public.system_document_bookmarks enable row level security;
alter table if exists public.system_document_votes enable row level security;
alter table if exists public.system_document_pages enable row level security;
alter table if exists public.system_document_blocks enable row level security;
alter table if exists public.user_activity_logs enable row level security;
alter table if exists public.password_reset_otps enable row level security;
alter table if exists public.indexing_jobs enable row level security;
alter table if exists public.generation_jobs enable row level security;

-- Profiles/users: users can read and maintain their own row. Admin management is
-- handled by the backend service-role client.
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
end $$;

-- Notebook workspace ownership chain.
do $$
begin
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
      using (exists (
        select 1 from public.documents d join public.notebooks n on n.id = d.notebook_id
        where d.id = document_id and n.user_id = auth.uid()
      ))
      with check (exists (
        select 1 from public.documents d join public.notebooks n on n.id = d.notebook_id
        where d.id = document_id and n.user_id = auth.uid()
      ));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'notes' and policyname = 'Users manage own notes') then
    create policy "Users manage own notes" on public.notes for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
  end if;
end $$;

-- Research sessions belong to notebooks; messages belong to sessions.
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'research_sessions' and policyname = 'Users manage sessions in own notebooks') then
    create policy "Users manage sessions in own notebooks" on public.research_sessions for all
      using (exists (select 1 from public.notebooks n where n.id = notebook_id and n.user_id = auth.uid()))
      with check (exists (select 1 from public.notebooks n where n.id = notebook_id and n.user_id = auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'research_session_messages' and policyname = 'Users manage messages in own sessions') then
    create policy "Users manage messages in own sessions" on public.research_session_messages for all
      using (exists (
        select 1 from public.research_sessions rs join public.notebooks n on n.id = rs.notebook_id
        where rs.id = research_session_id and n.user_id = auth.uid()
      ))
      with check (exists (
        select 1 from public.research_sessions rs join public.notebooks n on n.id = rs.notebook_id
        where rs.id = research_session_id and n.user_id = auth.uid()
      ));
  end if;
end $$;

-- Document intelligence and structured extraction metadata follow document ownership.
do $$
begin
  if to_regclass('public.document_intelligence') is not null and not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'document_intelligence' and policyname = 'Users access intelligence for own documents') then
    create policy "Users access intelligence for own documents" on public.document_intelligence for all
      using (exists (
        select 1 from public.documents d join public.notebooks n on n.id = d.notebook_id
        where d.id = document_id and n.user_id = auth.uid()
      ))
      with check (exists (
        select 1 from public.documents d join public.notebooks n on n.id = d.notebook_id
        where d.id = document_id and n.user_id = auth.uid()
      ));
  end if;
  if to_regclass('public.document_pages') is not null and not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'document_pages' and policyname = 'Users access pages for own documents') then
    create policy "Users access pages for own documents" on public.document_pages for all
      using (exists (
        select 1 from public.documents d join public.notebooks n on n.id = d.notebook_id
        where d.id = document_id and n.user_id = auth.uid()
      ))
      with check (exists (
        select 1 from public.documents d join public.notebooks n on n.id = d.notebook_id
        where d.id = document_id and n.user_id = auth.uid()
      ));
  end if;
  if to_regclass('public.document_blocks') is not null and not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'document_blocks' and policyname = 'Users access blocks for own documents') then
    create policy "Users access blocks for own documents" on public.document_blocks for all
      using (exists (
        select 1 from public.documents d join public.notebooks n on n.id = d.notebook_id
        where d.id = document_id and n.user_id = auth.uid()
      ))
      with check (exists (
        select 1 from public.documents d join public.notebooks n on n.id = d.notebook_id
        where d.id = document_id and n.user_id = auth.uid()
      ));
  end if;
end $$;

-- Academic Lens standalone state is keyed directly by user_id, except messages
-- inherit ownership from their session.
do $$
begin
  if to_regclass('public.academic_lens_sessions') is not null and not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'academic_lens_sessions' and policyname = 'Users manage own academic lens sessions') then
    create policy "Users manage own academic lens sessions" on public.academic_lens_sessions for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
  end if;
  if to_regclass('public.academic_lens_messages') is not null and not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'academic_lens_messages' and policyname = 'Users manage own academic lens messages') then
    create policy "Users manage own academic lens messages" on public.academic_lens_messages for all
      using (exists (select 1 from public.academic_lens_sessions s where s.id = session_id and s.user_id = auth.uid()))
      with check (exists (select 1 from public.academic_lens_sessions s where s.id = session_id and s.user_id = auth.uid()));
  end if;
  if to_regclass('public.academic_lens_notes') is not null and not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'academic_lens_notes' and policyname = 'Users manage own academic lens notes') then
    create policy "Users manage own academic lens notes" on public.academic_lens_notes for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
  end if;
  if to_regclass('public.academic_lens_web_contexts') is not null and not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'academic_lens_web_contexts' and policyname = 'Users manage own academic lens web contexts') then
    create policy "Users manage own academic lens web contexts" on public.academic_lens_web_contexts for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
  end if;
end $$;

-- Public/System Library. Users may read published library metadata and own votes
-- or bookmarks. Upload/moderation remains backend service-role controlled.
do $$
begin
  if to_regclass('public.system_documents') is not null and not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'system_documents' and policyname = 'Users read published library documents') then
    create policy "Users read published library documents" on public.system_documents for select using (status = 'PUBLISHED');
  end if;
  if to_regclass('public.system_document_chunks') is not null and not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'system_document_chunks' and policyname = 'Users read chunks for published library documents') then
    create policy "Users read chunks for published library documents" on public.system_document_chunks for select
      using (exists (select 1 from public.system_documents d where d.id = document_id and d.status = 'PUBLISHED'));
  end if;
  if to_regclass('public.system_document_pages') is not null and not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'system_document_pages' and policyname = 'Users read pages for published library documents') then
    create policy "Users read pages for published library documents" on public.system_document_pages for select
      using (exists (select 1 from public.system_documents d where d.id = document_id and d.status = 'PUBLISHED'));
  end if;
  if to_regclass('public.system_document_blocks') is not null and not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'system_document_blocks' and policyname = 'Users read blocks for published library documents') then
    create policy "Users read blocks for published library documents" on public.system_document_blocks for select
      using (exists (select 1 from public.system_documents d where d.id = document_id and d.status = 'PUBLISHED'));
  end if;
  if to_regclass('public.system_document_bookmarks') is not null and not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'system_document_bookmarks' and policyname = 'Users manage own system bookmarks') then
    create policy "Users manage own system bookmarks" on public.system_document_bookmarks for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
  end if;
  if to_regclass('public.system_document_votes') is not null and not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'system_document_votes' and policyname = 'Users read document votes') then
    create policy "Users read document votes" on public.system_document_votes for select using (true);
  end if;
  if to_regclass('public.system_document_votes') is not null and not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'system_document_votes' and policyname = 'Users manage own document votes') then
    create policy "Users manage own document votes" on public.system_document_votes for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
  end if;
end $$;

-- Activity logs are user-scoped for reads/inserts. Mutating historical logs is
-- intentionally left to the service role.
do $$
begin
  if to_regclass('public.user_activity_logs') is not null and not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'user_activity_logs' and policyname = 'Users read own activity logs') then
    create policy "Users read own activity logs" on public.user_activity_logs for select using (auth.uid() = user_id);
  end if;
  if to_regclass('public.user_activity_logs') is not null and not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'user_activity_logs' and policyname = 'Users insert own activity logs') then
    create policy "Users insert own activity logs" on public.user_activity_logs for insert with check (auth.uid() = user_id);
  end if;
end $$;

-- No anon/authenticated policies are created for password_reset_otps,
-- indexing_jobs, or generation_jobs. They stay RLS-protected and service-role
-- only, which matches backend usage.
