
-- ============ negotiations ============
CREATE TABLE public.negotiations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL,
  vertical text NOT NULL DEFAULT 'moving',
  workflow_status text NOT NULL DEFAULT 'DRAFT',
  origin_address text,
  destination_address text,
  moving_date date,
  bedroom_count integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX negotiations_user_id_idx ON public.negotiations(user_id);
CREATE INDEX negotiations_workflow_status_idx ON public.negotiations(workflow_status);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.negotiations TO authenticated;
GRANT ALL ON public.negotiations TO service_role;
ALTER TABLE public.negotiations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owners select their negotiations"
  ON public.negotiations FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
CREATE POLICY "Owners insert their negotiations"
  ON public.negotiations FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Owners update their negotiations"
  ON public.negotiations FOR UPDATE TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Owners delete their negotiations"
  ON public.negotiations FOR DELETE TO authenticated
  USING (auth.uid() = user_id);
CREATE TRIGGER negotiations_set_updated_at
  BEFORE UPDATE ON public.negotiations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Ownership helper (SECURITY DEFINER avoids RLS recursion on child tables).
CREATE OR REPLACE FUNCTION public.user_owns_negotiation(_negotiation_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.negotiations
    WHERE id = _negotiation_id AND user_id = auth.uid()
  )
$$;
REVOKE EXECUTE ON FUNCTION public.user_owns_negotiation(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.user_owns_negotiation(uuid) TO authenticated;

-- ============ job_specs ============
CREATE TABLE public.job_specs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  negotiation_id uuid NOT NULL REFERENCES public.negotiations(id) ON DELETE CASCADE,
  version integer NOT NULL DEFAULT 1,
  specification jsonb NOT NULL DEFAULT '{}'::jsonb,
  specification_hash text,
  confirmed boolean NOT NULL DEFAULT false,
  confirmed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (negotiation_id, version)
);
CREATE INDEX job_specs_negotiation_id_idx ON public.job_specs(negotiation_id);
CREATE INDEX job_specs_hash_idx ON public.job_specs(specification_hash);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.job_specs TO authenticated;
GRANT ALL ON public.job_specs TO service_role;
ALTER TABLE public.job_specs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owners select job_specs"
  ON public.job_specs FOR SELECT TO authenticated
  USING (public.user_owns_negotiation(negotiation_id));
CREATE POLICY "Owners insert job_specs"
  ON public.job_specs FOR INSERT TO authenticated
  WITH CHECK (public.user_owns_negotiation(negotiation_id));
CREATE POLICY "Owners update job_specs"
  ON public.job_specs FOR UPDATE TO authenticated
  USING (public.user_owns_negotiation(negotiation_id))
  WITH CHECK (public.user_owns_negotiation(negotiation_id));
CREATE POLICY "Owners delete job_specs"
  ON public.job_specs FOR DELETE TO authenticated
  USING (public.user_owns_negotiation(negotiation_id));

-- ============ providers ============
CREATE TABLE public.providers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  negotiation_id uuid NOT NULL REFERENCES public.negotiations(id) ON DELETE CASCADE,
  name text NOT NULL,
  phone text,
  website text,
  location text,
  source text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX providers_negotiation_id_idx ON public.providers(negotiation_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.providers TO authenticated;
GRANT ALL ON public.providers TO service_role;
ALTER TABLE public.providers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owners select providers"
  ON public.providers FOR SELECT TO authenticated
  USING (public.user_owns_negotiation(negotiation_id));
CREATE POLICY "Owners insert providers"
  ON public.providers FOR INSERT TO authenticated
  WITH CHECK (public.user_owns_negotiation(negotiation_id));
CREATE POLICY "Owners update providers"
  ON public.providers FOR UPDATE TO authenticated
  USING (public.user_owns_negotiation(negotiation_id))
  WITH CHECK (public.user_owns_negotiation(negotiation_id));
CREATE POLICY "Owners delete providers"
  ON public.providers FOR DELETE TO authenticated
  USING (public.user_owns_negotiation(negotiation_id));
CREATE TRIGGER providers_set_updated_at
  BEFORE UPDATE ON public.providers
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============ calls ============
CREATE TABLE public.calls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  negotiation_id uuid NOT NULL REFERENCES public.negotiations(id) ON DELETE CASCADE,
  provider_id uuid REFERENCES public.providers(id) ON DELETE SET NULL,
  agent_type text,
  external_call_id text,
  status text,
  outcome text,
  recording_url text,
  transcript_text text,
  job_spec_version integer,
  job_spec_hash text,
  started_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX calls_negotiation_id_idx ON public.calls(negotiation_id);
CREATE INDEX calls_provider_id_idx ON public.calls(provider_id);
CREATE INDEX calls_external_call_id_idx ON public.calls(external_call_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.calls TO authenticated;
GRANT ALL ON public.calls TO service_role;
ALTER TABLE public.calls ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owners select calls"
  ON public.calls FOR SELECT TO authenticated
  USING (public.user_owns_negotiation(negotiation_id));
CREATE POLICY "Owners insert calls"
  ON public.calls FOR INSERT TO authenticated
  WITH CHECK (public.user_owns_negotiation(negotiation_id));
CREATE POLICY "Owners update calls"
  ON public.calls FOR UPDATE TO authenticated
  USING (public.user_owns_negotiation(negotiation_id))
  WITH CHECK (public.user_owns_negotiation(negotiation_id));
CREATE POLICY "Owners delete calls"
  ON public.calls FOR DELETE TO authenticated
  USING (public.user_owns_negotiation(negotiation_id));

-- ============ agent_events ============
CREATE TABLE public.agent_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  negotiation_id uuid NOT NULL REFERENCES public.negotiations(id) ON DELETE CASCADE,
  call_id uuid REFERENCES public.calls(id) ON DELETE SET NULL,
  agent_name text,
  event_type text,
  event_status text,
  summary text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX agent_events_negotiation_id_idx ON public.agent_events(negotiation_id);
CREATE INDEX agent_events_call_id_idx ON public.agent_events(call_id);
CREATE INDEX agent_events_created_at_idx ON public.agent_events(created_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.agent_events TO authenticated;
GRANT ALL ON public.agent_events TO service_role;
ALTER TABLE public.agent_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owners select agent_events"
  ON public.agent_events FOR SELECT TO authenticated
  USING (public.user_owns_negotiation(negotiation_id));
CREATE POLICY "Owners insert agent_events"
  ON public.agent_events FOR INSERT TO authenticated
  WITH CHECK (public.user_owns_negotiation(negotiation_id));
CREATE POLICY "Owners update agent_events"
  ON public.agent_events FOR UPDATE TO authenticated
  USING (public.user_owns_negotiation(negotiation_id))
  WITH CHECK (public.user_owns_negotiation(negotiation_id));
CREATE POLICY "Owners delete agent_events"
  ON public.agent_events FOR DELETE TO authenticated
  USING (public.user_owns_negotiation(negotiation_id));
