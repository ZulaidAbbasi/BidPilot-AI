ALTER TABLE public.quotes ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.calls ADD COLUMN IF NOT EXISTS call_mode text;
CREATE INDEX IF NOT EXISTS idx_quotes_leverage_quote_id ON public.quotes ((metadata->>'leverage_quote_id')) WHERE metadata->>'leverage_quote_id' IS NOT NULL;