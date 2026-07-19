
-- 1. Draft: revision, provenance, conflicts
ALTER TABLE public.job_spec_drafts
  ADD COLUMN IF NOT EXISTS revision integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS field_provenance jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS conflicts jsonb NOT NULL DEFAULT '[]'::jsonb;

-- 2. Intake sessions
CREATE TABLE IF NOT EXISTS public.intake_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  negotiation_id uuid NOT NULL REFERENCES public.negotiations(id) ON DELETE CASCADE,
  draft_id uuid NOT NULL REFERENCES public.job_spec_drafts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  conversation_id text,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','completed','abandoned','failed')),
  transcript jsonb NOT NULL DEFAULT '[]'::jsonb,
  recording_url text,
  captured_fields jsonb NOT NULL DEFAULT '[]'::jsonb,
  unresolved_fields jsonb NOT NULL DEFAULT '[]'::jsonb,
  summary text,
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_intake_sessions_negotiation ON public.intake_sessions(negotiation_id);
CREATE INDEX IF NOT EXISTS idx_intake_sessions_user ON public.intake_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_intake_sessions_conversation ON public.intake_sessions(conversation_id);

GRANT SELECT ON public.intake_sessions TO authenticated;
GRANT ALL ON public.intake_sessions TO service_role;
ALTER TABLE public.intake_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners can view their intake sessions"
  ON public.intake_sessions FOR SELECT TO authenticated
  USING (user_id = auth.uid() AND public.user_owns_negotiation(negotiation_id));

CREATE TRIGGER update_intake_sessions_updated_at
  BEFORE UPDATE ON public.intake_sessions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 3. Intake tool tokens (service-role only)
CREATE TABLE IF NOT EXISTS public.intake_tool_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.intake_sessions(id) ON DELETE CASCADE,
  negotiation_id uuid NOT NULL REFERENCES public.negotiations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_intake_tokens_session ON public.intake_tool_tokens(session_id);
CREATE INDEX IF NOT EXISTS idx_intake_tokens_expires ON public.intake_tool_tokens(expires_at);

GRANT ALL ON public.intake_tool_tokens TO service_role;
ALTER TABLE public.intake_tool_tokens ENABLE ROW LEVEL SECURITY;
-- No policies: only service_role touches this table.
