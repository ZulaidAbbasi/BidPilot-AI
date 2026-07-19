-- Service-role-only test-cleanup helper.
-- The job_specs immutability trigger correctly blocks deletion of confirmed
-- specs, which also cascades onto negotiations → job_specs deletion during
-- test cleanup. This SECURITY DEFINER helper is the ONLY sanctioned bypass:
-- it briefly disables the trigger while deleting a specific negotiation and
-- restores it immediately. EXECUTE is restricted to service_role.

CREATE OR REPLACE FUNCTION public._test_wipe_negotiation(_negotiation_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  ALTER TABLE public.job_specs DISABLE TRIGGER enforce_job_spec_immutability_trg;
  DELETE FROM public.negotiations WHERE id = _negotiation_id;
  ALTER TABLE public.job_specs ENABLE TRIGGER enforce_job_spec_immutability_trg;
EXCEPTION WHEN OTHERS THEN
  ALTER TABLE public.job_specs ENABLE TRIGGER enforce_job_spec_immutability_trg;
  RAISE;
END;
$$;

REVOKE EXECUTE ON FUNCTION public._test_wipe_negotiation(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._test_wipe_negotiation(uuid) TO service_role;