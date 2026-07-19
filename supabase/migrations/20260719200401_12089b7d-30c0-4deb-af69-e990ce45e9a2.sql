
-- Phase 2: Quote integrity, structured deposit model, and coverage tracking.
-- Backward compatible: no updates to historical rows, no destructive changes.

-- ── 1. Structured deposit fields on quotes ──────────────────────────────
-- deposit_amount and deposit_refundable already exist; add the remaining
-- structured fields the Phase-2 spec requires so booking deposits stop
-- being modeled as included/excluded services.
ALTER TABLE public.quotes
  ADD COLUMN IF NOT EXISTS deposit_required boolean,
  ADD COLUMN IF NOT EXISTS deposit_percentage numeric(6,3),
  ADD COLUMN IF NOT EXISTS deposit_due text,
  ADD COLUMN IF NOT EXISTS deposit_conditions text;

COMMENT ON COLUMN public.quotes.deposit_required IS
  'Provider explicitly stated a deposit is required. NULL = unresolved.';
COMMENT ON COLUMN public.quotes.deposit_percentage IS
  'Deposit expressed as a percentage of total (e.g. 15.000 = 15%). Independent of deposit_amount.';
COMMENT ON COLUMN public.quotes.deposit_due IS
  'When the deposit is due in the provider''s words ("at booking", "48h before move").';
COMMENT ON COLUMN public.quotes.deposit_conditions IS
  'Deposit conditions/caveats verbatim. Refundability lives in deposit_refundable.';

-- ── 2. Explicit final confirmation timestamp ────────────────────────────
-- FINAL is only valid after the provider explicitly confirms the closing
-- offer. save-quote-snapshot stamps this when the caller sets
-- final_confirmed=true; the DB stays permissive for historical rows.
ALTER TABLE public.quotes
  ADD COLUMN IF NOT EXISTS final_confirmed_at timestamptz;

COMMENT ON COLUMN public.quotes.final_confirmed_at IS
  'Set by save-quote-snapshot when quote_stage=FINAL and the tool payload includes final_confirmed=true. NULL for historical FINALs that predate this column.';

-- ── 3. One-INITIAL, one-active-FINAL per call+provider ──────────────────
-- Partial unique indexes let historical duplicates coexist while blocking
-- any NEW duplicates on the same (call_id, provider_id) key. Indexes are
-- created without a NOT VALID/CONCURRENT gate because the tables are small
-- and this migration runs synchronously.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='quotes_one_initial_per_call_provider') THEN
    -- Only enforce for future INITIAL inserts: allow existing dupes to remain
    -- by only indexing rows created from now on. captured_at works as the
    -- cutoff since it's set server-side at insert time.
    EXECUTE format(
      'CREATE UNIQUE INDEX quotes_one_initial_per_call_provider ON public.quotes (call_id, provider_id) WHERE quote_stage = ''INITIAL'' AND captured_at >= %L',
      now()
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='quotes_one_final_per_call_provider') THEN
    EXECUTE format(
      'CREATE UNIQUE INDEX quotes_one_final_per_call_provider ON public.quotes (call_id, provider_id) WHERE quote_stage = ''FINAL'' AND captured_at >= %L',
      now()
    );
  END IF;
END $$;

-- ── 4. Coverage tracking on calls ───────────────────────────────────────
-- One JSONB blob keeps the schema flexible while finalize-call-outcome
-- writes the full coverage matrix. Each key is a criterion name; each
-- value is one of {captured, refused, unknown, not_applicable} plus an
-- optional evidence pointer.
ALTER TABLE public.calls
  ADD COLUMN IF NOT EXISTS coverage jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.calls.coverage IS
  'Per-criterion coverage matrix: { <criterion>: { status: captured|refused|unknown|not_applicable, note?: string, evidence_transcript_id?: uuid } }';

CREATE INDEX IF NOT EXISTS calls_coverage_gin ON public.calls USING gin (coverage);
