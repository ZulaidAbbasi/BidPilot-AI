# Phase 1 — Live call state, transcript evidence, idempotency

Scope locked to sections 1, 2, 3, 9. Existing call `b204bf26…` is preserved as-is.

## Root causes confirmed from the DB

- Post-call webhook never landed for that call → `webhook_received_at` is NULL, no `call_webhook_events`, no `call_transcripts`. Every material claim reconciled to `missing_evidence` and the UI legitimately shows "webhook pending" — but it also shows "Reconciled" because reconciliation ran on an empty transcript.
- `finalize_call_outcome` fired twice (19:27:23 and 19:27:35). No `(call_id, conversation_id)` idempotency key.
- `call_ended_client` fires 15 s AFTER `CALL_FINALIZED`. Finalize does not drive `ending → processing`; the UI stays LIVE until the operator hits End.
- Outcome events land as `agent_events`; the control room panel renders those as if they were transcript utterances because there are no real transcript rows to display.

## What Phase 1 ships

### Migration 1 — call state machine

- Extend `calls.status` allowed values to add `connecting`, `ending`, `processing`. Keep `in_progress`, `completed`, `failed`, `needs_review`, `scheduled`, `context_loading`, `quote_captured`, `negotiating`.
- Rewrite `enforce_call_state_transitions()` to enforce:
  `scheduled → connecting → in_progress → ending → processing → { completed | needs_review | failed }`
  plus current in-flight transitions (`quote_captured`, `negotiating` fold into `in_progress`).
- Terminal states (`completed | needs_review | failed`) require `final_outcome`, `reconciled_at`, and either `webhook_received_at` or `transcript_source='fallback'` — enforced in the trigger.
- Add columns: `transcript_source text CHECK (transcript_source IN ('webhook','fallback','none'))`, `transcript_pending boolean default false`, `session_ended_at timestamptz`, `finalize_idempotency_key text unique`.
- Unique partial index on `(id) where status='in_progress'` per negotiation to prevent duplicate active sessions.

### Finalize + end session (backend)

- `finalize-call-outcome` becomes idempotent on `finalize_idempotency_key = sha256(call_id || conversation_id)`. Duplicate calls return the original result without a second `CALL_FINALIZED` event.
- On successful finalize: transition `in_progress → ending`, persist complete `provider_commitments / unresolved_questions / red_flags / changed_terms` arrays (already done for the arrays; this turn re-verifies they store even when empty rather than being dropped).
- New server function `endCallSession({ callId, conversationId })`: called by the client exactly once after the ElevenLabs SDK confirms disconnect. Transitions `ending → processing`, stamps `session_ended_at`.
- Reconciliation is the only path that transitions `processing → { completed | needs_review | failed }`. It runs after webhook OR fallback transcript persists. Re-entrant / idempotent by design (already deletes+reinserts evidence).
- Post-call webhook stamps `transcript_source='webhook'`. Fallback transcript fetch stamps `transcript_source='fallback'`. If neither yields text within retry window, `transcript_source='none'` and the call terminates as `needs_review`.

### Control Room UI

- Split the center panel into two tabs:
  - **Transcript** — reads `call_transcripts` ordered by `sequence_number`; shows speaker, text, timestamp; empty-state "Awaiting transcript from ElevenLabs post-call webhook"; auto-scroll on new rows.
  - **Tool activity** — reads `agent_events` for the call; renders `QUOTE_CAPTURED`, `QUOTE_LINE_ITEM_SAVED`, `CALL_FINALIZED`, `CALL_RECONCILED` with distinct iconography. No transcript-styled bubbles.
- Live badge is derived from `calls.status IN ('connecting','in_progress','ending')` AND active SDK session, not local React state alone. On terminal status the badge is replaced by the outcome pill.
- Start button disabled while `status IN ('connecting','in_progress','ending','processing')`. Guards against double-click and duplicate sessions.
- Post-call status strip renders three truthful chips:
  - Webhook: `pending` / `received` / `not received (fallback used)`
  - Transcript: `awaiting` / `webhook` / `fallback` / `none`
  - Reconciliation: `pending` / `reconciled` / `needs review`
  Never both "webhook pending" and "reconciled".

### Tests

- Vitest: reducer for the client-side call state machine — every legal and every illegal transition.
- Server: idempotent finalize (double-invoke returns same row, one `CALL_FINALIZED` event, one `ending` transition).
- Server: end-session transitions `ending → processing`; second call is a no-op.
- Server: reconciliation on empty transcript sets `needs_review`, not `completed`.
- Existing 43 unit + 17 security tests must stay green.

## What Phase 1 explicitly does NOT touch

- Line-item / deposit / quote-stage schema (Phase 2).
- Evidence span columns and transcript-anchored excerpts (Phase 2).
- Coverage-gap tracking (Phase 2).
- The existing broken call's records — kept as historical audit evidence.

## Files to change

- `supabase/migrations/…_call_lifecycle_phase1.sql` (new)
- `src/routes/api/public/elevenlabs/tools/finalize-call-outcome.ts` (idempotency + status → ending)
- `src/routes/api/public/elevenlabs/post-call.ts` (stamp transcript_source, clear transcript_pending)
- `src/lib/call-lifecycle.functions.ts` (new — `endCallSession`, `pollCallStatus`)
- `src/lib/persist-call-reconciliation.server.ts` (terminal transition only from `processing`)
- `src/components/app/control-room/control-room.tsx` + `src/components/app/call/*` (Transcript/Tool tabs, derived LIVE, post-call strip)
- `src/lib/call-state.ts` (new — client reducer + tests)
- `src/lib/call-state.test.ts` (new)

## Deliverable at end of Phase 1

Format, lint, typecheck, build, unit tests, security tests all green. A fresh synthetic call fixture proves: finalize is idempotent, LIVE clears within one tick of session end, transcript panel is empty until the webhook arrives, reconciliation cannot mark a transcript-less call as `completed`.
