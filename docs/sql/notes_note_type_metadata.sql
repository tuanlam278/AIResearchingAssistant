-- Add structured note support for quiz/test/flashcards saved from the Research page.
ALTER TABLE public.notes ADD COLUMN IF NOT EXISTS note_type TEXT DEFAULT 'text';
ALTER TABLE public.notes ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;
