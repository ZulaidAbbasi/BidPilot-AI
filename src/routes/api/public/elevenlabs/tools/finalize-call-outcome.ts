/**
 * ElevenLabs agent tool — finalize_call_outcome.
 *
 * Called by the ElevenLabs agent at the end of a conversation to attach a
 * structured final outcome to a call. Authenticated with the short-lived
 * call token (X-BidPilot-Call-Token). Idempotent per (call_id, conversation_id).
 *
 * The endpoint NEVER trusts:
 *   - savings_amount from the caller  (recomputed from stored INITIAL/FINAL quotes)
 *   - price_changed                    (must be supported by stored quotes)
 *   - terms_changed                    (must be supported by transcript / quote terms)
 *
 * On success it runs quote/transcript reconciliation, writes quote_evidence,
 * updates the call to `quote_captured` / `needs_review`, and — if the post-call
 * webhook has already landed — advances the call to `completed`.
 */
import { createFileRoute } from "@tanstack/react-router";
import { createHash } from "crypto";
import { z } from "zod";

import { authorizeCallToolRequest, extractCallToken, jsonResponse } from "@/lib/call-token.server";
import { reconcile, type LineItemRow, type QuoteRow } from "@/lib/call-reconciliation.server";
import { recoverElevenLabsTranscriptForCall } from "@/lib/elevenlabs-transcript.server";
import { persistCallReconciliation } from "@/lib/persist-call-reconciliation.server";
import {
  RATE_LIMITS,
  checkInvalidAuthLimit,
  checkValidCallerLimit,
  rateLimitResponse,
} from "@/lib/rate-limit.server";
import { invalidRequestResponse } from "@/lib/tool-errors.server";

const ENDPOINT = "finalize-call-outcome";

const emptyToNull = (v: unknown) => (v === "" || v === undefined ? null : v);

const Amount = z.number().nonnegative().finite();
const OptionalAmount = z.preprocess((v) => {
  const n = emptyToNull(v);
  if (typeof n === "string" && n.trim() !== "") {
    const parsed = Number(n.replace(/[$,\s]/g, ""));
    return Number.isFinite(parsed) ? parsed : n;
  }
  return n;
}, Amount.nullable());

const OptionalBool = z.preprocess((v) => {
  if (v === "" || v == null) return undefined;
  if (typeof v === "string") {
    if (v.toLowerCase() === "true") return true;
    if (v.toLowerCase() === "false") return false;
  }
  return v;
}, z.boolean().optional());

const StringArray = z.preprocess(
  (v) => {
    if (v == null || v === "") return [];
    if (Array.isArray(v)) return v;
    if (typeof v === "string") return [v];
    return v;
  },
  z.array(z.string().max(500)).max(50),
);

const OutcomeEnum = z.preprocess(
  (v) => (typeof v === "string" ? v.trim().toLowerCase() : v),
  z.enum([
    "quote_received",
    "callback_requested",
    "refused",
    "unavailable",
    "disconnected",
    "wrong_number",
    "negotiation_completed",
    "negotiation_failed",
  ]),
);

const BodySchema = z.object({
  call_id: z.string().uuid(),
  provider_id: z.string().uuid(),
  conversation_id: z.preprocess(emptyToNull, z.string().min(1).nullable()).optional(),
  expected_spec_version: z
    .preprocess(emptyToNull, z.coerce.number().int().nonnegative().nullable())
    .optional(),
  expected_spec_hash: z.preprocess(emptyToNull, z.string().min(1).nullable()).optional(),
  outcome: OutcomeEnum,
  final_quote_external_ref: z.preprocess(emptyToNull, z.string().max(120).nullable()).optional(),
  price_changed: OptionalBool,
  initial_amount: OptionalAmount.optional(),
  final_amount: OptionalAmount.optional(),
  savings_amount: OptionalAmount.optional(),
  terms_changed: OptionalBool,
  changed_terms: StringArray.default([]),
  provider_commitments: StringArray.default([]),
  unresolved_questions: StringArray.default([]),
  red_flags: StringArray.default([]),
  callback_time: z.preprocess(emptyToNull, z.string().datetime().nullable()).optional(),
  summary: z.preprocess(emptyToNull, z.string().max(2000).nullable()).optional(),
  // Coverage matrix: each criterion → { status, note? }. Server treats
  // missing entries as "unknown" and expands unresolved_questions
  // accordingly, so the agent can send only what it actually captured.
  coverage: z
    .record(
      z.string().max(80),
      z.object({
        status: z.enum(["captured", "refused", "unknown", "not_applicable"]),
        note: z.preprocess(emptyToNull, z.string().max(600).nullable()).optional(),
      }),
    )
    .default({}),
});

// The canonical set of coverage criteria the Provider Agent must attempt to
// capture per call. Any criterion missing from `body.coverage` is treated as
// "unknown" and surfaced as an unresolved question.
const COVERAGE_CRITERIA = [
  "provider_identity",
  "route_date_availability",
  "total_or_range",
  "estimate_type",
  "labor",
  "transportation",
  "packing",
  "materials",
  "stairs",
  "long_carry",
  "fuel",
  "storage",
  "taxes",
  "heavy_specialty",
  "deposit",
  "deposit_refundability",
  "cancellation_terms",
  "quote_validity",
  "price_change_conditions",
  "written_estimate",
  "inclusions",
  "exclusions",
] as const;


function sanitize(s: string): string {
  return (
    s
      // Strip ASCII control characters (0x00-0x1f, 0x7f) from tool input before persistence.
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u001f\u007f]/g, "")
      .trim()
      .slice(0, 500)
  );
}

export const Route = createFileRoute("/api/public/elevenlabs/tools/finalize-call-outcome")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const rawToken = extractCallToken(request);
        if (!rawToken) {
          const rl = await checkInvalidAuthLimit(ENDPOINT, request, RATE_LIMITS[ENDPOINT].invalid);
          if (!rl.allowed) return rateLimitResponse(rl.retryAfter);
          return jsonResponse(401, { error: "missing_token" });
        }
        const rlValid = await checkValidCallerLimit(
          ENDPOINT,
          createHash("sha256").update(rawToken).digest("hex"),
          RATE_LIMITS[ENDPOINT].valid,
        );
        if (!rlValid.allowed) return rateLimitResponse(rlValid.retryAfter);

        let body: z.infer<typeof BodySchema>;
        try {
          body = BodySchema.parse(await request.json());
        } catch (e) {
          return invalidRequestResponse(e, ENDPOINT);
        }

        const auth = await authorizeCallToolRequest(request, {
          callId: body.call_id,
          providerId: body.provider_id,
          conversationId: body.conversation_id ?? undefined,
          expectedSpecVersion: body.expected_spec_version ?? undefined,
          expectedSpecHash: body.expected_spec_hash ?? undefined,
        });
        if (!auth.ok) {
          await checkInvalidAuthLimit(ENDPOINT, request, RATE_LIMITS[ENDPOINT].invalid);
          return auth.response;
        }
        const { call, spec } = auth.ctx;

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        // Mode-restricted outcomes: QUOTE_GATHERING must not report a
        // negotiation outcome, and NEGOTIATION must not report a bare
        // quote_received (that is a QUOTE_GATHERING success).
        const { data: callModeRow } = await supabaseAdmin
          .from("calls")
          .select("call_mode")
          .eq("id", call.id)
          .maybeSingle();
        const callMode: "QUOTE_GATHERING" | "NEGOTIATION" =
          callModeRow?.call_mode === "NEGOTIATION" ? "NEGOTIATION" : "QUOTE_GATHERING";
        const QUOTE_GATHERING_OUTCOMES = new Set([
          "quote_received",
          "callback_requested",
          "refused",
          "unavailable",
          "disconnected",
          "wrong_number",
        ]);
        const NEGOTIATION_OUTCOMES = new Set([
          "negotiation_completed",
          "negotiation_failed",
          "callback_requested",
          "refused",
          "unavailable",
          "disconnected",
          "wrong_number",
        ]);
        const allowedOutcomes =
          callMode === "NEGOTIATION" ? NEGOTIATION_OUTCOMES : QUOTE_GATHERING_OUTCOMES;
        if (!allowedOutcomes.has(body.outcome)) {
          return jsonResponse(422, {
            error: "mode_outcome_violation",
            message: `Outcome "${body.outcome}" is not permitted in ${callMode} mode.`,
          });
        }

        // Promote a REVISED quote to FINAL when the caller declares a
        // successful close (negotiation_completed / quote_received) and no
        // FINAL row exists yet. Preference order:
        //   1. Snapshot whose external_ref matches `final_quote_external_ref`.
        //   2. Latest REVISED snapshot by captured_at.
        // The agent frequently classifies the closing offer as REVISED because
        // the phrase "that is the final offer" does not force a schema change.
        const outcomeIsClose =
          body.outcome === "quote_received" || body.outcome === "negotiation_completed";
        let promotedQuoteId: string | null = null;
        if (outcomeIsClose) {
          const { data: existingFinal } = await supabaseAdmin
            .from("quotes")
            .select("id")
            .eq("call_id", call.id)
            .eq("quote_stage", "FINAL")
            .limit(1)
            .maybeSingle();
          if (!existingFinal) {
            let candidate: { id: string } | null = null;
            const ref = body.final_quote_external_ref?.trim() || null;
            if (ref) {
              const { data } = await supabaseAdmin
                .from("quotes")
                .select("id")
                .eq("call_id", call.id)
                .eq("provider_id", call.provider_id)
                .eq("external_ref", ref)
                .maybeSingle();
              candidate = data;
            }
            if (!candidate) {
              const { data } = await supabaseAdmin
                .from("quotes")
                .select("id")
                .eq("call_id", call.id)
                .eq("provider_id", call.provider_id)
                .eq("quote_stage", "REVISED")
                .order("captured_at", { ascending: false })
                .limit(1)
                .maybeSingle();
              candidate = data;
            }
            if (candidate) {
              await supabaseAdmin
                .from("quotes")
                .update({ quote_stage: "FINAL" })
                .eq("id", candidate.id);
              promotedQuoteId = candidate.id;
            }
          }
        }

        // Load stored quotes for this call (source of truth for verification).
        const { data: quotesRaw } = await supabaseAdmin
          .from("quotes")
          .select(
            "id, quote_stage, total_amount, low_amount, high_amount, deposit_amount, terms, price_change_conditions, captured_at",
          )
          .eq("call_id", call.id);
        const quotes: QuoteRow[] = (quotesRaw ?? []) as QuoteRow[];

        const quoteIds = quotes.map((q) => q.id);
        const lineItemsByQuote: Record<string, LineItemRow[]> = {};
        if (quoteIds.length) {
          const { data: liRows } = await supabaseAdmin
            .from("quote_line_items")
            .select("id, quote_id, label, amount, provider_words")
            .in("quote_id", quoteIds);
          for (const r of (liRows ?? []) as Array<LineItemRow & { quote_id: string }>) {
            (lineItemsByQuote[r.quote_id] ||= []).push({
              id: r.id,
              label: r.label,
              amount: r.amount,
              provider_words: r.provider_words,
            });
          }
        }

        // Load transcript (may be empty if webhook hasn't arrived yet).
        const loadTranscripts = async () => {
          const { data } = await supabaseAdmin
            .from("call_transcripts")
            .select("id, text, sequence_number, started_at_ms")
            .eq("call_id", call.id)
            .order("sequence_number", { ascending: true });
          return (data ?? []) as Array<{
            id: string;
            text: string;
            sequence_number: number;
            started_at_ms: number | null;
          }>;
        };
        let transcripts = await loadTranscripts();
        if (transcripts.length === 0 && call.external_call_id) {
          await recoverElevenLabsTranscriptForCall({
            callId: call.id,
            negotiationId: call.negotiation_id,
            conversationId: call.external_call_id,
          });
          transcripts = await loadTranscripts();
        }
        const { data: refreshedCall } = await supabaseAdmin
          .from("calls")
          .select("webhook_received_at")
          .eq("id", call.id)
          .maybeSingle();
        const transcriptRecovered = transcripts.length > 0;
        if (transcriptRecovered && !refreshedCall?.webhook_received_at) {
          await supabaseAdmin
            .from("calls")
            .update({
              webhook_received_at: new Date().toISOString(),
              transcript_source: "fallback",
              transcript_pending: false,
            })
            .eq("id", call.id);
        }


        const rec = reconcile(quotes, lineItemsByQuote, transcripts);

        // Server-derived verified fields.
        const verifiedPriceChanged = rec.priceChanged;

        const verifiedSavings =
          rec.initialTotal != null && rec.finalTotal != null
            ? Math.max(0, rec.initialTotal - rec.finalTotal)
            : null;

        // Terms-changed must be supported by evidence: at least one changed_term
        // string appears in transcript text, OR quote terms have changed between
        // INITIAL and FINAL quotes.
        const fullText = transcripts
          .map((t) => t.text)
          .join("\n")
          .toLowerCase();
        const initial = quotes.find((q) => q.quote_stage === "INITIAL");
        const final = quotes.find((q) => q.quote_stage === "FINAL");
        const quoteTermsDiffer =
          initial != null && final != null && (initial.terms ?? "") !== (final.terms ?? "");
        const cleanChangedTerms = body.changed_terms.map(sanitize).filter(Boolean);
        const anyTermInTranscript = cleanChangedTerms.some((t) =>
          fullText.includes(t.toLowerCase().slice(0, 40)),
        );
        const verifiedTermsChanged = quoteTermsDiffer || anyTermInTranscript;

        const validation = {
          claimed_price_changed: body.price_changed ?? null,
          verified_price_changed: verifiedPriceChanged,
          claimed_savings: body.savings_amount ?? null,
          verified_savings: verifiedSavings,
          claimed_terms_changed: body.terms_changed ?? null,
          verified_terms_changed: verifiedTermsChanged,
          contradictions: rec.contradictions,
        };

        const needsReview =
          rec.contradictions > 0 ||
          transcripts.length === 0 ||
          (body.price_changed === true && !verifiedPriceChanged) ||
          (body.savings_amount != null &&
            verifiedSavings != null &&
            Math.abs(body.savings_amount - verifiedSavings) > 0.5) ||
          (body.terms_changed === true && !verifiedTermsChanged) ||
          body.red_flags.length > 0;

        // Persist evidence (idempotent-ish: replace prior rows for this call's quotes).
        if (rec.evidence.length > 0) {
          await supabaseAdmin
            .from("quote_evidence")
            .delete()
            .in(
              "quote_id",
              quotes.map((q) => q.id),
            );
          await supabaseAdmin.from("quote_evidence").insert(
            rec.evidence.map((e) => ({
              negotiation_id: call.negotiation_id,
              quote_id: e.quote_id,
              quote_line_item_id: e.quote_line_item_id,
              transcript_id: e.transcript_id,
              evidence_type: e.evidence_type,
              support_status: e.support_status,
              extracted_text: e.extracted_text,
              timestamp_ms: e.timestamp_ms,
            })),
          );

          const priceEvidenceByQuote = new Map(
            rec.evidence
              .filter((e) => e.evidence_type === "price")
              .map((e) => [e.quote_id, e.support_status]),
          );
          await Promise.all(
            quotes.map((quote) => {
              const status = priceEvidenceByQuote.get(quote.id);
              const verification_status =
                status === "supported"
                  ? "verified"
                  : status === "contradictory"
                    ? "flagged"
                    : "unverified";
              return supabaseAdmin
                .from("quotes")
                .update({ verification_status })
                .eq("id", quote.id);
            }),
          );
        }

        // Load current call to compute allowed transition + idempotency guard.
        const { data: cur } = await supabaseAdmin
          .from("calls")
          .select("status, webhook_received_at, final_outcome, finalize_idempotency_key")
          .eq("id", call.id)
          .maybeSingle();
        const alreadyFinalized = cur?.final_outcome != null;
        const priorOutcome = cur?.final_outcome ?? null;
        const priorWasSuccess =
          priorOutcome === "quote_received" || priorOutcome === "negotiation_completed";

        // Idempotency: derive a stable key per (call_id, conversation_id, outcome).
        // A retry within the same conversation MUST NOT re-drive the state machine.
        const idempotencyKey = createHash("sha256")
          .update(`${call.id}|${body.conversation_id ?? ""}|${body.outcome}`)
          .digest("hex")
          .slice(0, 48);

        // Idempotent-retry guard: prior success should not be downgraded.
        const effectiveOutcome =
          priorWasSuccess && body.outcome === "negotiation_failed"
            ? (priorOutcome as typeof body.outcome)
            : body.outcome;
        void (effectiveOutcome === "quote_received" ||
          effectiveOutcome === "negotiation_completed");


        // Duplicate delivery of the same finalize? Return the current call state
        // without touching the FSM.
        if (cur?.finalize_idempotency_key === idempotencyKey && alreadyFinalized) {
          return jsonResponse(200, {
            ok: true,
            call_id: call.id,
            status: cur.status,
            needs_review: needsReview,
            idempotent: true,
            verified: {
              price_changed: verifiedPriceChanged,
              savings_amount: verifiedSavings,
              terms_changed: verifiedTermsChanged,
            },
            contradictions: rec.contradictions,
          });
        }

        // finalize NEVER drives the call terminal. It moves an active call into
        // `ending`. The client (endProviderRehearsal) or the post-call webhook
        // reconciler owns the transition through `processing` to the terminal
        // state, once we know for sure the audio session actually stopped.
        const activeStates = new Set([
          "scheduled",
          "context_loading",
          "connecting",
          "in_progress",
          "quote_captured",
          "negotiating",
        ]);
        const targetStatus: string = activeStates.has(cur?.status ?? "")
          ? "ending"
          : (cur?.status ?? "in_progress");

        const nowIso = new Date().toISOString();
        const { error: upErr } = await supabaseAdmin
          .from("calls")
          .update({
            final_outcome: effectiveOutcome,
            outcome_finalized_at: alreadyFinalized ? undefined : nowIso,
            verified_savings_amount: verifiedSavings,
            verified_price_changed: verifiedPriceChanged,
            verified_terms_changed: verifiedTermsChanged,
            needs_review: needsReview,
            reconciled_at: nowIso,
            status: targetStatus,
            transcript_pending: !cur?.webhook_received_at && !transcriptRecovered,
            finalize_idempotency_key: idempotencyKey,
          })
          .eq("id", call.id);
        if (upErr) {
          console.error("[finalize-call-outcome] call update failed", upErr);
          return jsonResponse(500, { error: "update_failed", detail: upErr.message });
        }


        const cleanCommitments = body.provider_commitments.map(sanitize).filter(Boolean);
        const cleanRedFlags = body.red_flags.map(sanitize).filter(Boolean);

        // Coverage: normalize + fill missing criteria as "unknown". Auto-append
        // one unresolved question per criterion that is not captured/refused/NA.
        // The tool caller can pre-populate unresolved_questions; we merge.
        const normalizedCoverage: Record<string, { status: string; note: string | null }> = {};
        for (const key of COVERAGE_CRITERIA) {
          const entry = body.coverage[key];
          normalizedCoverage[key] = {
            status: entry?.status ?? "unknown",
            note: entry?.note ?? null,
          };
        }
        const coverageGaps = COVERAGE_CRITERIA.filter(
          (k) => normalizedCoverage[k].status === "unknown",
        );
        const autoUnresolved = coverageGaps.map((k) => `Coverage gap: ${k}`);
        const cleanUnresolved = Array.from(
          new Set([...body.unresolved_questions.map(sanitize).filter(Boolean), ...autoUnresolved]),
        );

        // Persist the coverage matrix on the call row so the UI can distinguish
        // captured / refused / unknown / not_applicable per criterion.
        await supabaseAdmin
          .from("calls")
          .update({ coverage: normalizedCoverage })
          .eq("id", call.id);


        await supabaseAdmin.from("agent_events").insert({
          negotiation_id: call.negotiation_id,
          call_id: call.id,
          agent_name: "elevenlabs",
          event_type: "CALL_FINALIZED",
          event_status: needsReview ? "warning" : "success",
          summary: `Outcome ${body.outcome}${needsReview ? " (needs review)" : ""}`,
          metadata: {
            outcome: body.outcome,
            spec_version: spec.version,
            validation,
            // Counts (kept for backward compatibility with timeline summaries)
            red_flags_count: cleanRedFlags.length,
            unresolved_questions_count: cleanUnresolved.length,
            provider_commitments_count: cleanCommitments.length,
            changed_terms_count: cleanChangedTerms.length,
            // Full sanitized values — source of truth for Control Room + Final Report
            provider_commitments: cleanCommitments,
            unresolved_questions: cleanUnresolved,
            red_flags: cleanRedFlags,
            changed_terms: cleanChangedTerms,
            callback_time: body.callback_time ?? null,
            final_quote_external_ref: body.final_quote_external_ref ?? null,
            summary: body.summary ? sanitize(body.summary).slice(0, 2000) : null,
            promoted_quote_id: promotedQuoteId,
          },
        });

        // Always re-run persisted reconciliation so `verified_savings_amount`,
        // `verified_price_changed`, `verified_terms_changed`, `needs_review`,
        // and `quote_evidence` reflect the latest quotes + transcript state.
        // (Previously this only ran when the transcript was freshly
        // recovered, which left production rows with NULL savings if
        // finalize was retried after the webhook had already landed.)
        let persistedReconciliation: Awaited<ReturnType<typeof persistCallReconciliation>> | null =
          null;
        try {
          persistedReconciliation = await persistCallReconciliation(call.id);
        } catch (err) {
          console.warn("[finalize-call-outcome] reconciliation failed", err);
        }

        return jsonResponse(200, {
          ok: true,
          call_id: call.id,
          status: targetStatus,
          needs_review: needsReview,
          verified: {
            price_changed: verifiedPriceChanged,
            savings_amount: verifiedSavings,
            terms_changed: verifiedTermsChanged,
          },
          contradictions: rec.contradictions,
          reconciliation: persistedReconciliation,
        });
      },
    },
  },
});
