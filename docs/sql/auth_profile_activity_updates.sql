-- Auth/Profile/Security/Activity updates.
-- Run in Supabase SQL editor after existing profile/auth migrations.

CREATE TABLE IF NOT EXISTS public.password_reset_otps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  otp_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_password_reset_otps_email
ON public.password_reset_otps(email);

ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE,
ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ NULL,
ADD COLUMN IF NOT EXISTS disabled_at TIMESTAMPTZ NULL;

-- The current app schema uses display_name as the username/nickname field.
CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_display_name_unique
ON public.profiles (LOWER(display_name))
WHERE display_name IS NOT NULL AND BTRIM(display_name) <> '';

CREATE TABLE IF NOT EXISTS public.user_activity_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  feature_name TEXT NOT NULL,
  action_type TEXT NOT NULL,
  document_id UUID NULL,
  document_name TEXT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_activity_logs_user_created
ON public.user_activity_logs(user_id, created_at DESC);
