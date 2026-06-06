-- Supabase Storage buckets required by AI Researching Assistant.
-- Run in Supabase SQL editor with a service-role/admin account, or create the
-- same private buckets manually in Storage > Buckets.

insert into storage.buckets (id, name, public)
values
  ('notebook-sources', 'notebook-sources', false),
  ('system-documents', 'system-documents', false),
  ('avatars', 'avatars', false)
on conflict (id) do nothing;

-- Keep notebook source files private. The backend uses the service role key for
-- uploads/downloads during indexing, so no broad public policy is required.
