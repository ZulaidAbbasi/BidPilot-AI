
-- Extend calls status set and add finalization fields
ALTER TABLE public.calls
  ADD COLUMN IF NOT EXISTS final_outcome text,
  ADD COLUMN IF NOT EXISTS outcome_finalized_at timestamptz,
  ADD COLUMN IF NOT EXISTS verified_savings_amount numeric(14,2),
  ADD COLUMN IF NOT EXISTS verified_price_changed boolean,
  ADD COLUMN IF NOT EXISTS verified_terms_changed boolean,
  ADD COLUMN IF NOT EXISTS needs_review boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS reconciled_at timestamptz;

-- Replace status CHECK constraint (drop existing loosely then add ours)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'calls_status_check') THEN
    ALTER TABLE public.calls DROP CONSTRAINT calls_status_check;
  END IF;
END $$;

ALTER TABLE public.calls ADD CONSTRAINT calls_status_check CHECK (
  status IN ('scheduled','context_loading','in_progress','quote_captured','negotiating','completed','failed','needs_review')
);

ALTER TABLE public.calls ADD CONSTRAINT calls_final_outcome_check CHECK (
  final_outcome IS NULL OR final_outcome IN (
    'quote_received','callback_requested','refused','unavailable','disconnected',
    'wrong_number','negotiation_completed','negotiation_failed'
  )
);

-- ============ call_webhook_events ============
CREATE TABLE IF NOT EXISTS public.call_webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  call_id uuid REFERENCES public.calls(id) ON DELETE SET NULL,
  negotiation_id uuid REFERENCES public.negotiations(id) ON DELETE SET NULL,
  conversation_id text,
  event_type text NOT NULL,
  event_hash text NOT NULL UNIQUE,
  external_event_id text,
  signature_valid boolean NOT NULL,
  processing_status text NOT NULL DEFAULT 'received'
    CHECK (processing_status IN ('received','processing','completed','failed')),
  retry_count integer NOT NULL DEFAULT 0,
  error_code text,
  error_message text,
  payload jsonb NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cwe_call_id ON public.call_webhook_events(call_id);
CREATE INDEX IF NOT EXISTS idx_cwe_conversation ON public.call_webhook_events(conversation_id);
CREATE INDEX IF NOT EXISTS idx_cwe_status ON public.call_webhook_events(processing_status);

GRANT SELECT ON public.call_webhook_events TO authenticated;
GRANT ALL ON public.call_webhook_events TO service_role;
ALTER TABLE public.call_webhook_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owners can read webhook events"
  ON public.call_webhook_events FOR SELECT TO authenticated
  USING (negotiation_id IS NOT NULL AND public.user_owns_negotiation(negotiation_id));

-- ============ call_transcripts ============
CREATE TABLE IF NOT EXISTS public.call_transcripts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  call_id uuid NOT NULL REFERENCES public.calls(id) ON DELETE CASCADE,
  negotiation_id uuid NOT NULL REFERENCES public.negotiations(id) ON DELETE CASCADE,
  conversation_id text,
  speaker text NOT NULL CHECK (speaker IN ('agent','user','provider','system','tool')),
  text text NOT NULL,
  started_at_ms integer,
  ended_at_ms integer,
  sequence_number integer NOT NULL,
  source text NOT NULL DEFAULT 'elevenlabs',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (call_id, sequence_number)
);
CREATE INDEX IF NOT EXISTS idx_ct_call_seq ON public.call_transcripts(call_id, sequence_number);

GRANT SELECT ON public.call_transcripts TO authenticated;
GRANT ALL ON public.call_transcripts TO service_role;
ALTER TABLE public.call_transcripts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owners can read transcripts"
  ON public.call_transcripts FOR SELECT TO authenticated
  USING (public.user_owns_negotiation(negotiation_id));

-- ============ call_recordings ============
CREATE TABLE IF NOT EXISTS public.call_recordings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  call_id uuid NOT NULL REFERENCES public.calls(id) ON DELETE CASCADE,
  negotiation_id uuid NOT NULL REFERENCES public.negotiations(id) ON DELETE CASCADE,
  conversation_id text,
  provider_reference text NOT NULL,
  duration_seconds integer,
  status text NOT NULL DEFAULT 'available' CHECK (status IN ('pending','available','failed','deleted')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (call_id, provider_reference)
);
CREATE INDEX IF NOT EXISTS idx_cr_call ON public.call_recordings(call_id);

-- No direct SELECT to authenticated: recordings served via signed server fn only.
GRANT ALL ON public.call_recordings TO service_role;
ALTER TABLE public.call_recordings ENABLE ROW LEVEL SECURITY;
-- (no policies = locked to service_role, intentional)

-- ============ quote_evidence ============
CREATE TABLE IF NOT EXISTS public.quote_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  negotiation_id uuid NOT NULL REFERENCES public.negotiations(id) ON DELETE CASCADE,
  quote_id uuid NOT NULL REFERENCES public.quotes(id) ON DELETE CASCADE,
  quote_line_item_id uuid REFERENCES public.quote_line_items(id) ON DELETE CASCADE,
  transcript_id uuid REFERENCES public.call_transcripts(id) ON DELETE SET NULL,
  evidence_type text NOT NULL CHECK (evidence_type IN (
    'price','line_item','term','condition','commitment','disclaimer','other'
  )),
  support_status text NOT NULL CHECK (support_status IN (
    'supported','unsupported','contradictory','missing_evidence'
  )),
  extracted_text text,
  timestamp_ms integer,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_qe_quote ON public.quote_evidence(quote_id);
CREATE INDEX IF NOT EXISTS idx_qe_line ON public.quote_evidence(quote_line_item_id);

GRANT SELECT ON public.quote_evidence TO authenticated;
GRANT ALL ON public.quote_evidence TO service_role;
ALTER TABLE public.quote_evidence ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owners can read evidence"
  ON public.quote_evidence FOR SELECT TO authenticated
  USING (public.user_owns_negotiation(negotiation_id));

-- ============ Call state transition validation ============
CREATE OR REPLACE FUNCTION public.enforce_call_state_transitions()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  allowed boolean := false;
BEGIN
  IF TG_OP = 'INSERT' THEN
    RETURN NEW;
  END IF;
  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;
  -- Valid transitions
  allowed := CASE OLD.status
    WHEN 'scheduled'       THEN NEW.status IN ('context_loading','in_progress','failed','needs_review')
    WHEN 'context_loading' THEN NEW.status IN ('in_progress','failed','needs_review')
    WHEN 'in_progress'     THEN NEW.status IN ('quote_captured','negotiating','completed','failed','needs_review')
    WHEN 'quote_captured'  THEN NEW.status IN ('negotiating','completed','failed','needs_review')
    WHEN 'negotiating'     THEN NEW.status IN ('quote_captured','completed','failed','needs_review')
    WHEN 'completed'       THEN NEW.status IN ('needs_review')
    WHEN 'failed'          THEN NEW.status IN ('needs_review')
    WHEN 'needs_review'    THEN NEW.status IN ('completed','failed')
    ELSE false
  END;

  IF NEW.status = 'completed' THEN
    IF NEW.final_outcome IS NULL OR NEW.webhook_received_at IS NULL OR NEW.reconciled_at IS NULL THEN
      RAISE EXCEPTION 'call % cannot become completed without final_outcome, webhook, and reconciliation', NEW.id;
    END IF;
  END IF;

  IF NOT allowed THEN
    RAISE EXCEPTION 'invalid call state transition: % -> %', OLD.status, NEW.status
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_call_state_transitions ON public.calls;
CREATE TRIGGER trg_call_state_transitions
  BEFORE UPDATE ON public.calls
  FOR EACH ROW EXECUTE FUNCTION public.enforce_call_state_transitions();
