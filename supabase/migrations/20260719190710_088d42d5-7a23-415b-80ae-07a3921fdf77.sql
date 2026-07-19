
ALTER TABLE public.intake_sessions
  ADD COLUMN IF NOT EXISTS webhook_received_at timestamptz,
  ADD COLUMN IF NOT EXISTS post_processing_status text NOT NULL DEFAULT 'pending'
    CHECK (post_processing_status IN ('pending','processing','completed','failed','skipped'));

ALTER TABLE public.intake_sessions DROP CONSTRAINT IF EXISTS intake_sessions_status_check;
ALTER TABLE public.intake_sessions
  ADD CONSTRAINT intake_sessions_status_check
  CHECK (status IN ('active','completed','abandoned','failed','interrupted'));

CREATE TABLE IF NOT EXISTS public.intake_webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid REFERENCES public.intake_sessions(id) ON DELETE CASCADE,
  negotiation_id uuid REFERENCES public.negotiations(id) ON DELETE CASCADE,
  conversation_id text,
  event_type text NOT NULL,
  event_hash text NOT NULL UNIQUE,
  external_event_id text,
  signature_valid boolean NOT NULL DEFAULT false,
  processing_status text NOT NULL DEFAULT 'processing'
    CHECK (processing_status IN ('processing','completed','failed','ignored')),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_code text,
  error_message text,
  processed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.intake_webhook_events TO service_role;
ALTER TABLE public.intake_webhook_events ENABLE ROW LEVEL SECURITY;
-- Intentionally no policies: service_role only.

CREATE INDEX IF NOT EXISTS idx_intake_webhook_events_session
  ON public.intake_webhook_events(session_id);
CREATE INDEX IF NOT EXISTS idx_intake_webhook_events_conversation
  ON public.intake_webhook_events(conversation_id);
