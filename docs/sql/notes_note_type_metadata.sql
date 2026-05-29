-- Add structured note support for quiz/test/flashcards saved from the Research page.
ALTER TABLE public.notes ADD COLUMN IF NOT EXISTS note_type TEXT DEFAULT 'text';
ALTER TABLE public.notes ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;


-- Bind notes to the Research Session / chat history they were created from.
-- SET NULL preserves old notes if a session/history is deleted.
ALTER TABLE public.notes ADD COLUMN IF NOT EXISTS research_session_id UUID NULL REFERENCES public.research_sessions(id) ON DELETE SET NULL;
ALTER TABLE public.notes ADD COLUMN IF NOT EXISTS source_message_id TEXT NULL;
CREATE INDEX IF NOT EXISTS idx_notes_research_session_id ON public.notes(research_session_id, updated_at DESC);
