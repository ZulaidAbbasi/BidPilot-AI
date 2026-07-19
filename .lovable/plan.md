# Three-call challenge + leverage-linked negotiation

Complete the demo so a single confirmed spec drives three visibly different rehearsals (Flexible, Stonewaller, Upseller) and a fourth call that negotiates using only a real stored quote as leverage — with mismatched specs excluded and evidence saved end-to-end.

## What ships

### 1. Redefine the three provider styles

`src/lib/elevenlabs.functions.ts`
- Rename `REHEARSAL_STYLES` → `["flexible", "stonewaller", "upseller"]`.
- Rewrite `REHEARSAL_STYLE_GUIDANCE` for each style so the agent hears clear instructions AND expected outcome constraints:
  - **flexible** — itemized quote; only lower price if the customer presents specific verified leverage.
  - **stonewaller** — refuses immediate numbers, vague or "call you back". Must still exit with `callback_requested` or `declined` when it ends.
  - **upseller** — low base quote then reveals stair / long-carry / packing / deposit conditions; agent must itemize each.
- Update the meta labels in `provider-rehearsal.tsx` accordingly.

### 2. Add a NEGOTIATION call mode (leverage-linked)

`src/lib/elevenlabs.functions.ts` (`startProviderRehearsal`)
- Extend `StartInput` with `callMode: "QUOTE_GATHERING" | "NEGOTIATION"` (default `QUOTE_GATHERING`) and optional `leverageQuoteId`.
- When `callMode = "NEGOTIATION"`:
  - Load the referenced quote via service role.
  - Verify it belongs to same negotiation, has same `job_spec_hash` as the current confirmed spec (else 400 "mismatched leverage").
  - Verify the target provider is different from the leverage quote's provider.
  - Write leverage metadata onto the new call: `metadata.call_mode = "NEGOTIATION"`, `metadata.leverage_quote_id`, `metadata.leverage_provider_id`, `metadata.leverage_total`.
  - Emit dynamic variables `call_mode`, `leverage_provider_name`, `leverage_total`, `leverage_currency`, `leverage_included_summary` — agent may cite ONLY these numbers.

`src/routes/api/public/elevenlabs/tools/load-call-context.ts`
- If `call.metadata.call_mode === "NEGOTIATION"`, return `call_mode: "NEGOTIATION"` plus a single `eligible_leverage` entry sourced from the referenced quote (label + amount + currency + captured_at + provider name). Reject leverage rows whose `job_spec_hash` ≠ current spec.

### 3. Persist "before / after leverage" price

`src/routes/api/public/elevenlabs/tools/save-quote-snapshot.ts`
- On negotiation-mode calls, read `call.metadata.leverage_*` and stamp on every inserted quote row:
  - `quotes.metadata.leverage_used = true`
  - `quotes.metadata.leverage_quote_id`
  - `quotes.metadata.price_before_leverage` = the target provider's most recent quote for the same spec (its earlier INITIAL/REVISED), if any
  - `quotes.metadata.price_after_leverage` = the current row's total

*(uses existing `quotes.metadata jsonb`; no schema change.)*

### 4. Same-spec integrity view

New route `src/routes/app.negotiations.$id.integrity.tsx` (add link in negotiation shell tabs after "Quotes"):
- Query: current confirmed spec + all calls for the negotiation.
- Group calls by whether `job_spec_hash` matches; show a table:
  Provider · Style · Mode · Spec v/hash · Match badge · Outcome · Verified savings.
- Explicitly label rows with `job_spec_hash ≠ current` as **Excluded (spec mismatch)** and gray them out.
- Mismatched calls are already excluded from ranking (report.functions.ts). No behavior change — this is the transparency surface.

### 5. Rehearsal UI additions

`src/components/app/provider-rehearsal.tsx`
- Add a "Call mode" select: `Quote gathering` vs `Negotiation (with leverage)`.
- When Negotiation is chosen: list eligible quotes (same negotiation, same current spec hash, provider ≠ selected provider) and require the user to pick one before Start.
- Show a small before/after diff on the call summary when the reconciliation finishes.

### 6. Report — leverage-linked negotiation card

`src/routes/app.negotiations.$id.report.tsx`
- Add a "Leverage log" panel listing every call with `metadata.leverage_used`, showing: which competitor's quote was cited, target provider, price_before → price_after, verified savings.

### 7. Tests

`src/lib/leverage.test.ts`
- Unit test: leverage quote validation (same negotiation, same spec hash, different provider) — accepts valid, rejects each violation.
- Unit test: `price_before_leverage` selection picks the target provider's most recent same-spec quote and ignores mismatches.

Run: `bun run typecheck && bunx vitest run && bun run test:security`.

## What we deliberately do NOT do
- No forced discount, no fabricated competing offer — agent may only cite the stored `leverage_total` and the phrase saved on that quote.
- No schema changes: everything hangs off existing `calls.metadata` / `quotes.metadata` JSON.
- Outcomes remain server-verified via reconciliation; the styles only shape agent behavior.

## Proof to return
After deploy: user runs one Flexible, one Stonewaller, one Upseller call, then a Negotiation call citing the Flexible quote. The Integrity view will show four rows with identical spec version + hash; the Report's Leverage log will show the before → after price against the target provider.
