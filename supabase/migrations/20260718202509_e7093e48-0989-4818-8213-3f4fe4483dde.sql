
-- Track who confirmed each version.
ALTER TABLE public.job_specs
  ADD COLUMN IF NOT EXISTS confirmed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

-- Only confirmed rows should exist in job_specs going forward, and only the
-- server-side confirmation function (service_role) may write them. Drop
-- authenticated write policies so clients cannot bypass server-side logic
-- (hashing, versioning, workflow update, event log).
DROP POLICY IF EXISTS "Owners insert job_specs" ON public.job_specs;
DROP POLICY IF EXISTS "Owners update job_specs" ON public.job_specs;
DROP POLICY IF EXISTS "Owners delete job_specs" ON public.job_specs;
-- SELECT policy stays: owners can read their own specifications.

-- Immutability: once a row is confirmed, no update or delete is allowed
-- through any role (including service_role). This guarantees confirmed
-- specifications are a permanent, hash-locked record.
CREATE OR REPLACE FUNCTION public.enforce_job_spec_immutability()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.confirmed IS TRUE THEN
      RAISE EXCEPTION 'confirmed job_specs are immutable (id=%)', OLD.id
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    IF OLD.confirmed IS TRUE THEN
      RAISE EXCEPTION 'confirmed job_specs cannot be deleted (id=%)', OLD.id
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS job_specs_immutable ON public.job_specs;
CREATE TRIGGER job_specs_immutable
  BEFORE UPDATE OR DELETE ON public.job_specs
  FOR EACH ROW EXECUTE FUNCTION public.enforce_job_spec_immutability();
