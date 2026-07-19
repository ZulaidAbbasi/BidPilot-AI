CREATE OR REPLACE FUNCTION public._test_wipe_negotiation(_negotiation_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  ALTER TABLE public.job_specs DISABLE TRIGGER job_specs_immutable;
  DELETE FROM public.negotiations WHERE id = _negotiation_id;
  ALTER TABLE public.job_specs ENABLE TRIGGER job_specs_immutable;
EXCEPTION WHEN OTHERS THEN
  ALTER TABLE public.job_specs ENABLE TRIGGER job_specs_immutable;
  RAISE;
END;
$$;