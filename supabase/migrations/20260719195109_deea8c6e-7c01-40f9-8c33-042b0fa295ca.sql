-- Phase 1 call lifecycle repair.

-- 1. Extend the allowed status values.
ALTER TABLE public.calls DROP CONSTRAINT IF EXISTS calls_status_check;
ALTER TABLE public.calls ADD CONSTRAINT calls_status_check CHECK (
  status = ANY (ARRAY[
    'scheduled'::text,
    'context_loading'::text,
    'connecting'::text,
    'in_progress'::text,
    'quote_captured'::text,
    'negotiating'::text,
    'ending'::text,
    'processing'::text,
    'completed'::text,
    'failed'::text,
    'needs_review'::text
  ])
);

-- 2. New tracking columns.
ALTER TABLE public.calls
  ADD COLUMN IF NOT EXISTS transcript_source text
    CHECK (transcript_source IS NULL OR transcript_source IN ('webhook','fallback','none')),
  ADD COLUMN IF NOT EXISTS transcript_pending boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS session_ended_at timestamptz,
  ADD COLUMN IF NOT EXISTS finalize_idempotency_key text;

CREATE UNIQUE INDEX IF NOT EXISTS calls_finalize_idempotency_key_uniq
  ON public.calls(finalize_idempotency_key)
  WHERE finalize_idempotency_key IS NOT NULL;

-- 3. Rewrite state-transition guard.
CREATE OR REPLACE FUNCTION public.enforce_call_state_transitions()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  allowed boolean := false;
BEGIN
  IF TG_OP = 'INSERT' THEN
    RETURN NEW;
  END IF;
  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;

  allowed := CASE OLD.status
    WHEN 'scheduled'       THEN NEW.status IN ('context_loading','connecting','in_progress','failed','needs_review')
    WHEN 'context_loading' THEN NEW.status IN ('connecting','in_progress','failed','needs_review')
    WHEN 'connecting'      THEN NEW.status IN ('in_progress','failed','needs_review','ending')
    WHEN 'in_progress'     THEN NEW.status IN ('quote_captured','negotiating','ending','failed','needs_review')
    WHEN 'quote_captured'  THEN NEW.status IN ('negotiating','ending','failed','needs_review')
    WHEN 'negotiating'     THEN NEW.status IN ('quote_captured','ending','failed','needs_review')
    WHEN 'ending'          THEN NEW.status IN ('processing','failed','needs_review')
    WHEN 'processing'      THEN NEW.status IN ('completed','needs_review','failed')
    WHEN 'completed'       THEN NEW.status IN ('needs_review')
    WHEN 'failed'          THEN NEW.status IN ('needs_review')
    WHEN 'needs_review'    THEN NEW.status IN ('completed','failed')
    ELSE false
  END;

  IF NEW.status = 'completed' THEN
    IF NEW.final_outcome IS NULL OR NEW.reconciled_at IS NULL THEN
      RAISE EXCEPTION 'call % cannot become completed without final_outcome and reconciled_at', NEW.id;
    END IF;
    IF NEW.webhook_received_at IS NULL AND (NEW.transcript_source IS NULL OR NEW.transcript_source = 'none') THEN
      RAISE EXCEPTION 'call % cannot become completed without a transcript source (webhook or fallback)', NEW.id;
    END IF;
  END IF;

  IF NOT allowed THEN
    RAISE EXCEPTION 'invalid call state transition: % -> %', OLD.status, NEW.status
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$function$;
