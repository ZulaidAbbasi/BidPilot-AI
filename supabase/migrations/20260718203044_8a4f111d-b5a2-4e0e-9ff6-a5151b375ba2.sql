
ALTER TABLE public.calls
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS webhook_received_at timestamptz,
  ADD COLUMN IF NOT EXISTS failure_reason text;

-- Prevent duplicate external_call_id per negotiation (idempotent webhook match).
CREATE UNIQUE INDEX IF NOT EXISTS calls_negotiation_external_call_uidx
  ON public.calls (negotiation_id, external_call_id)
  WHERE external_call_id IS NOT NULL;
