
CREATE TABLE public.call_tool_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  call_id uuid NOT NULL REFERENCES public.calls(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX call_tool_tokens_call_id_idx ON public.call_tool_tokens(call_id);
CREATE INDEX call_tool_tokens_expires_at_idx ON public.call_tool_tokens(expires_at);

-- service-role only; no authenticated/anon grants
GRANT ALL ON public.call_tool_tokens TO service_role;

ALTER TABLE public.call_tool_tokens ENABLE ROW LEVEL SECURITY;
-- No policies: only service_role (which bypasses RLS) can touch this table.
