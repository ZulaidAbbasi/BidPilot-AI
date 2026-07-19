-- Hardening migration for BidPilot AI.
-- 1) Defensively remove any leftover RLS test users if present.
-- 2) Enforce canonical workflow_status set on negotiations.
-- 3) Prevent moving_date in the past on insert and on updates that touch the column.
-- 4) Enforce calls.provider_id must belong to the same negotiation as the call.

-- 1) Defensive cleanup of any lingering RLS test users (cascades to profiles/negotiations).
DELETE FROM auth.users WHERE email IN ('rls_test_a@example.com', 'rls_test_b@example.com');

-- 2) Canonical workflow status CHECK constraint.
-- Normalize any legacy statuses before applying the constraint.
UPDATE public.negotiations SET workflow_status = 'DRAFT'
  WHERE workflow_status IS NULL
     OR workflow_status NOT IN (
       'DRAFT','INTAKE_IN_PROGRESS','AWAITING_CONFIRMATION','SPEC_CONFIRMED',
       'CALLING_PROVIDERS','QUOTES_RECEIVED','AUDITING_QUOTES','CLARIFICATION_REQUIRED',
       'READY_TO_NEGOTIATE','AWAITING_HUMAN_APPROVAL','NEGOTIATING',
       'NEGOTIATION_COMPLETE','REPORT_READY','FAILED'
     );

ALTER TABLE public.negotiations
  DROP CONSTRAINT IF EXISTS negotiations_workflow_status_check;

ALTER TABLE public.negotiations
  ADD CONSTRAINT negotiations_workflow_status_check
  CHECK (workflow_status IN (
    'DRAFT','INTAKE_IN_PROGRESS','AWAITING_CONFIRMATION','SPEC_CONFIRMED',
    'CALLING_PROVIDERS','QUOTES_RECEIVED','AUDITING_QUOTES','CLARIFICATION_REQUIRED',
    'READY_TO_NEGOTIATE','AWAITING_HUMAN_APPROVAL','NEGOTIATING',
    'NEGOTIATION_COMPLETE','REPORT_READY','FAILED'
  ));

-- 3) Trigger enforcing moving_date is not in the past (time-dependent → trigger, not CHECK).
CREATE OR REPLACE FUNCTION public.enforce_moving_date_not_past()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.moving_date IS NOT NULL AND NEW.moving_date < CURRENT_DATE THEN
    -- Allow historical rows to remain if only unrelated columns change.
    IF TG_OP = 'UPDATE' AND OLD.moving_date IS NOT DISTINCT FROM NEW.moving_date THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'moving_date cannot be in the past (got %)', NEW.moving_date
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS negotiations_moving_date_not_past ON public.negotiations;
CREATE TRIGGER negotiations_moving_date_not_past
  BEFORE INSERT OR UPDATE OF moving_date ON public.negotiations
  FOR EACH ROW EXECUTE FUNCTION public.enforce_moving_date_not_past();

-- 4) Trigger enforcing calls.provider_id belongs to the same negotiation as the call.
CREATE OR REPLACE FUNCTION public.enforce_call_provider_matches_negotiation()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_neg uuid;
BEGIN
  IF NEW.provider_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT negotiation_id INTO v_neg FROM public.providers WHERE id = NEW.provider_id;
  IF v_neg IS NULL OR v_neg <> NEW.negotiation_id THEN
    RAISE EXCEPTION 'calls.provider_id % does not belong to negotiation %',
      NEW.provider_id, NEW.negotiation_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS calls_provider_belongs_to_negotiation ON public.calls;
CREATE TRIGGER calls_provider_belongs_to_negotiation
  BEFORE INSERT OR UPDATE OF provider_id, negotiation_id ON public.calls
  FOR EACH ROW EXECUTE FUNCTION public.enforce_call_provider_matches_negotiation();
