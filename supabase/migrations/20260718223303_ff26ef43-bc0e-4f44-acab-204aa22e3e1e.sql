
-- QUOTES
CREATE TABLE public.quotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  negotiation_id uuid NOT NULL REFERENCES public.negotiations(id) ON DELETE CASCADE,
  provider_id uuid NOT NULL REFERENCES public.providers(id) ON DELETE CASCADE,
  call_id uuid REFERENCES public.calls(id) ON DELETE SET NULL,
  previous_quote_id uuid REFERENCES public.quotes(id) ON DELETE SET NULL,
  quote_stage text NOT NULL CHECK (quote_stage IN ('INITIAL','REVISED','FINAL')),
  currency text NOT NULL DEFAULT 'USD' CHECK (char_length(currency) = 3),
  total_amount numeric(12,2) CHECK (total_amount IS NULL OR total_amount >= 0),
  low_amount numeric(12,2) CHECK (low_amount IS NULL OR low_amount >= 0),
  high_amount numeric(12,2) CHECK (high_amount IS NULL OR high_amount >= 0),
  estimate_type text CHECK (estimate_type IS NULL OR estimate_type IN ('binding','non_binding','not_to_exceed','hourly','flat','range','unknown')),
  valid_until date,
  deposit_amount numeric(12,2) CHECK (deposit_amount IS NULL OR deposit_amount >= 0),
  deposit_refundable boolean,
  terms text,
  included_services jsonb NOT NULL DEFAULT '[]'::jsonb,
  excluded_services jsonb NOT NULL DEFAULT '[]'::jsonb,
  price_change_conditions text,
  spec_version integer NOT NULL,
  spec_hash text NOT NULL,
  verification_status text NOT NULL DEFAULT 'unverified' CHECK (verification_status IN ('unverified','verified','flagged','rejected')),
  captured_at timestamptz NOT NULL DEFAULT now(),
  external_ref text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT quotes_range_ok CHECK (
    (low_amount IS NULL OR high_amount IS NULL OR low_amount <= high_amount)
    AND (low_amount IS NULL OR total_amount IS NULL OR low_amount <= total_amount)
    AND (high_amount IS NULL OR total_amount IS NULL OR total_amount <= high_amount)
  ),
  CONSTRAINT quotes_provider_call_unique UNIQUE (call_id, provider_id, external_ref)
);

CREATE INDEX quotes_negotiation_idx ON public.quotes(negotiation_id, captured_at DESC);
CREATE INDEX quotes_provider_idx ON public.quotes(provider_id);
CREATE INDEX quotes_call_idx ON public.quotes(call_id);

GRANT SELECT ON public.quotes TO authenticated;
GRANT ALL ON public.quotes TO service_role;

ALTER TABLE public.quotes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners can read their quotes" ON public.quotes
  FOR SELECT TO authenticated
  USING (public.user_owns_negotiation(negotiation_id));

CREATE TRIGGER update_quotes_updated_at
  BEFORE UPDATE ON public.quotes
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- QUOTE LINE ITEMS
CREATE TABLE public.quote_line_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id uuid NOT NULL REFERENCES public.quotes(id) ON DELETE CASCADE,
  category text NOT NULL CHECK (category IN (
    'labor','transport','packing','materials','fuel','stairs','long_carry',
    'heavy_item','storage','insurance','deposit','surcharge','discount','tax','other'
  )),
  label text NOT NULL CHECK (char_length(label) BETWEEN 1 AND 200),
  amount numeric(12,2) CHECK (amount IS NULL OR amount >= 0),
  currency text NOT NULL DEFAULT 'USD' CHECK (char_length(currency) = 3),
  quantity numeric(10,2) CHECK (quantity IS NULL OR quantity >= 0),
  unit text CHECK (unit IS NULL OR char_length(unit) <= 40),
  included boolean NOT NULL DEFAULT true,
  conditional boolean NOT NULL DEFAULT false,
  condition_text text,
  provider_words text,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  idempotency_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT quote_line_items_idem_unique UNIQUE (quote_id, idempotency_key)
);

CREATE INDEX quote_line_items_quote_idx ON public.quote_line_items(quote_id);

GRANT SELECT ON public.quote_line_items TO authenticated;
GRANT ALL ON public.quote_line_items TO service_role;

ALTER TABLE public.quote_line_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners can read their quote line items" ON public.quote_line_items
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.quotes q
    WHERE q.id = quote_line_items.quote_id
      AND public.user_owns_negotiation(q.negotiation_id)
  ));
