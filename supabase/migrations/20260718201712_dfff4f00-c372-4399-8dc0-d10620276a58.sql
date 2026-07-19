CREATE TABLE public.job_spec_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  negotiation_id uuid NOT NULL UNIQUE REFERENCES public.negotiations(id) ON DELETE CASCADE,
  specification jsonb NOT NULL DEFAULT '{}'::jsonb,
  completion_percent integer NOT NULL DEFAULT 0 CHECK (completion_percent BETWEEN 0 AND 100),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_job_spec_drafts_negotiation ON public.job_spec_drafts(negotiation_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.job_spec_drafts TO authenticated;
GRANT ALL ON public.job_spec_drafts TO service_role;

ALTER TABLE public.job_spec_drafts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners can view their draft"
  ON public.job_spec_drafts FOR SELECT TO authenticated
  USING (public.user_owns_negotiation(negotiation_id));

CREATE POLICY "Owners can insert their draft"
  ON public.job_spec_drafts FOR INSERT TO authenticated
  WITH CHECK (public.user_owns_negotiation(negotiation_id));

CREATE POLICY "Owners can update their draft"
  ON public.job_spec_drafts FOR UPDATE TO authenticated
  USING (public.user_owns_negotiation(negotiation_id))
  WITH CHECK (public.user_owns_negotiation(negotiation_id));

CREATE POLICY "Owners can delete their draft"
  ON public.job_spec_drafts FOR DELETE TO authenticated
  USING (public.user_owns_negotiation(negotiation_id));

CREATE TRIGGER update_job_spec_drafts_updated_at
  BEFORE UPDATE ON public.job_spec_drafts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
