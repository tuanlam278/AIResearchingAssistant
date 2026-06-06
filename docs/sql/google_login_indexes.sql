-- Helpful indexes for fast Google login/profile lookup.
create unique index if not exists idx_profiles_google_id on public.profiles(google_id) where google_id is not null;
create index if not exists idx_profiles_email_lower on public.profiles(lower(email));
