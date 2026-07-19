/**
 * ElevenLabs agent tool — save_quote_snapshot.
 *
 * Creates or updates a full quote for the current call. Authenticated via the
 * short-lived call token (X-BidPilot-Call-Token). Idempotent per
 * (call_id, provider_id, external_ref).
 *
 * SECURITY:
 *  - Never accepts user_id from the caller; ownership is derived server-side
 *    from the token → call → negotiation chain.
 *  - Validates spec version + hash so quotes cannot be pinned to a stale spec.
 *  - Rejects negative amounts and impossible ranges.
 */
import { createFileRoute } from "@tanstack/react-router";
import { createHash } from "crypto";
import { z } from "zod";

import { authorizeCallToolRequest, extractCallToken, jsonResponse } from "@/lib/call-token.server";
import {
  RATE_LIMITS,
  checkInvalidAuthLimit,
  checkValidCallerLimit,
  rateLimitResponse,
} from "@/lib/rate-limit.server";
import { reconcileSpokenAmount } from "@/lib/spoken-number";
import { invalidRequestResponse } from "@/lib/tool-errors.server";

const ENDPOINT = "save-quote-snapshot";

const AmountSchema = z.number().nonnegative().finite();

const emptyToNull = (value: unknown) => (value === "" || value === undefined ? null : value);

const OptionalAmountSchema = z.preprocess((value) => {
  const normalized = emptyToNull(value);
  if (typeof normalized === "string" && normalized.trim() !== "") {
    const parsed = Number(normalized.replace(/[$,\s]/g, ""));
    return Number.isFinite(parsed) ? parsed : normalized;
  }
  return normalized;
}, AmountSchema.nullable());

const OptionalBooleanSchema = z.preprocess((value) => {
  const normalized = emptyToNull(value);
  if (typeof normalized === "string") {
    if (normalized.toLowerCase() === "true") return true;
    if (normalized.toLowerCase() === "false") return false;
  }
  return normalized;
}, z.boolean().nullable());

const OptionalTextSchema = (max: number) =>
  z.preprocess(emptyToNull, z.string().max(max).nullable());

const StringArraySchema = z.preprocess(
  (value) => {
    if (value == null || value === "") return [];
    if (Array.isArray(value)) return value;
    if (typeof value === "string") return [value];
    return value;
  },
  z.array(z.string().max(200)).max(200),
);

const QuoteStageSchema = z.preprocess(
  (value) => (typeof value === "string" ? value.trim().toUpperCase() : value),
  z.enum(["INITIAL", "REVISED", "FINAL"]),
);

const EstimateTypeSchema = z.preprocess(
  (value) => {
    if (value == null || value === "") return undefined;
    if (typeof value !== "string") return value;
    return value
      .trim()
      .toLowerCase()
      .replace(/[\s-]+/g, "_");
  },
  z
    .enum(["binding", "non_binding", "not_to_exceed", "hourly", "flat", "range", "unknown"])
    .optional(),
);

const CurrencySchema = z.preprocess(
  (value) =>
    value == null || value === ""
      ? "USD"
      : typeof value === "string"
        ? value.trim().toUpperCase()
        : value,
  z.string().length(3),
);

function normalizeExternalRef(
  value: string | null | undefined,
  stage: "INITIAL" | "REVISED" | "FINAL",
) {
  const raw = (value ?? "").trim();
  if (!raw) return stage; // default to the stage token itself for stable idempotency
  return raw.slice(0, 120);
}

const BodySchema = z
  .object({
    call_id: z.string().uuid(),
    provider_id: z.string().uuid(),
    conversation_id: z.preprocess(emptyToNull, z.string().min(1).nullable()).optional(),
    expected_spec_version: z
      .preprocess(emptyToNull, z.coerce.number().int().nonnegative().nullable())
      .optional(),
    expected_spec_hash: z.preprocess(emptyToNull, z.string().min(1).nullable()).optional(),

    external_ref: z.preprocess(emptyToNull, z.string().min(1).max(120).nullable()).optional(),
    previous_quote_id: z.preprocess(emptyToNull, z.string().uuid().nullable()).optional(),
    quote_stage: QuoteStageSchema,
    currency: CurrencySchema.default("USD"),
    total_amount: OptionalAmountSchema.optional(),
    low_amount: OptionalAmountSchema.optional(),
    high_amount: OptionalAmountSchema.optional(),
    // Spoken words the provider actually used for each amount. When present,
    // the server re-parses them (see `reconcileSpokenAmount`) and overrides
    // the numeric field if the agent-extracted number looks like a
    // dropped-thousand mistranscription (e.g. "fifteen hundred" → 500).
    total_words: z.preprocess(emptyToNull, z.string().max(200).nullable()).optional(),
    low_words: z.preprocess(emptyToNull, z.string().max(200).nullable()).optional(),
    high_words: z.preprocess(emptyToNull, z.string().max(200).nullable()).optional(),
    deposit_words: z.preprocess(emptyToNull, z.string().max(200).nullable()).optional(),
    estimate_type: EstimateTypeSchema,
    valid_until: z
      .preprocess(
        (value) => {
          // Accept: null/empty → null; ISO datetime; YYYY-MM-DD; "N days" /
          // "valid for seven days" phrasings → today + N days. Anything
          // unparseable falls back to null rather than rejecting the whole
          // quote — the provider's exact wording is preserved in `terms`.
          if (value == null || value === "") return null;
          if (typeof value !== "string") return value;
          const s = value.trim();
          if (!s) return null;
          if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
          const iso = Date.parse(s);
          if (Number.isFinite(iso)) return new Date(iso).toISOString().slice(0, 10);
          const wordNums: Record<string, number> = {
            one: 1,
            two: 2,
            three: 3,
            four: 4,
            five: 5,
            six: 6,
            seven: 7,
            eight: 8,
            nine: 9,
            ten: 10,
            fourteen: 14,
            thirty: 30,
          };
          const m = s
            .toLowerCase()
            .match(
              /(\d+|one|two|three|four|five|six|seven|eight|nine|ten|fourteen|thirty)\s*(day|days|week|weeks|month|months)/,
            );
          if (m) {
            const n = Number.isFinite(Number(m[1])) ? Number(m[1]) : (wordNums[m[1]] ?? null);
            if (n != null) {
              const mult = m[2].startsWith("week") ? 7 : m[2].startsWith("month") ? 30 : 1;
              const d = new Date();
              d.setUTCDate(d.getUTCDate() + n * mult);
              return d.toISOString().slice(0, 10);
            }
          }
          return null;
        },
        z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .nullable(),
      )
      .optional(),

    deposit_amount: OptionalAmountSchema.optional(),
    deposit_refundable: OptionalBooleanSchema.optional(),
    // Structured deposit model (Phase 2). Deposits must not be modeled as
    // included/excluded services. Any field left null stays unresolved.
    deposit_required: OptionalBooleanSchema.optional(),
    deposit_percentage: z
      .preprocess(emptyToNull, z.coerce.number().min(0).max(100).nullable())
      .optional(),
    deposit_due: OptionalTextSchema(200).optional(),
    deposit_conditions: OptionalTextSchema(600).optional(),
    // FINAL requires explicit provider confirmation of the closing offer.
    // The server rejects FINAL stage snapshots without this flag.
    final_confirmed: OptionalBooleanSchema.optional(),
    terms: OptionalTextSchema(4000).optional(),
    included_services: StringArraySchema.default([]),
    excluded_services: StringArraySchema.default([]),
    price_change_conditions: OptionalTextSchema(4000).optional(),

    // Leverage tracking (NEGOTIATION mode). All optional — agent should set
    // these when citing a competing quote it saw in the call context.
    leverage_quote_id: z.preprocess(emptyToNull, z.string().uuid().nullable()).optional(),
    price_before_leverage: OptionalAmountSchema.optional(),
    price_after_leverage: OptionalAmountSchema.optional(),
    changed_terms: StringArraySchema.default([]),
    verification_status: z
      .preprocess(
        (value) =>
          value == null || value === ""
            ? "unverified"
            : typeof value === "string"
              ? value.trim().toLowerCase()
              : value,
        z.enum(["unverified", "verified", "flagged"]),
      )
      .default("unverified"),
  })
  .refine((v) => v.low_amount == null || v.high_amount == null || v.low_amount <= v.high_amount, {
    message: "low_amount must be <= high_amount",
    path: ["low_amount"],
  })
  .refine((v) => v.total_amount == null || v.low_amount == null || v.low_amount <= v.total_amount, {
    message: "low_amount must be <= total_amount",
    path: ["low_amount"],
  })
  .refine(
    (v) => v.total_amount == null || v.high_amount == null || v.total_amount <= v.high_amount,
    { message: "total_amount must be <= high_amount", path: ["total_amount"] },
  );

export const Route = createFileRoute("/api/public/elevenlabs/tools/save-quote-snapshot")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        // ── Rate limit gate ──────────────────────────────────────────────
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

        let parsed: z.infer<typeof BodySchema>;
        try {
          parsed = BodySchema.parse(await request.json());
        } catch (e) {
          return invalidRequestResponse(e, ENDPOINT);
        }

        // FINAL requires explicit confirmation. This keeps agents from
        // promoting an in-progress number to FINAL before the provider
        // closes on it.
        if (parsed.quote_stage === "FINAL" && parsed.final_confirmed !== true) {
          return jsonResponse(422, {
            error: "final_not_confirmed",
            message:
              "FINAL quote_stage requires final_confirmed=true after the provider explicitly confirms the closing offer. Save as REVISED instead.",
          });
        }


        const auth = await authorizeCallToolRequest(request, {
          callId: parsed.call_id,
          providerId: parsed.provider_id,
          conversationId: parsed.conversation_id ?? undefined,
          expectedSpecVersion: parsed.expected_spec_version ?? undefined,
          expectedSpecHash: parsed.expected_spec_hash ?? undefined,
        });

        if (!auth.ok) {
          await checkInvalidAuthLimit(ENDPOINT, request, RATE_LIMITS[ENDPOINT].invalid);
          return auth.response;
        }
        const { call, spec } = auth.ctx;

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        // Mode enforcement: fetch call_mode + bound leverage from the row
        // that startProviderRehearsal stamped at call start. Mode is decided
        // server-side; the agent cannot switch modes mid-call.
        const { data: callRow } = await supabaseAdmin
          .from("calls")
          .select("call_mode, metadata")
          .eq("id", call.id)
          .maybeSingle();
        const callMode: "QUOTE_GATHERING" | "NEGOTIATION" =
          callRow?.call_mode === "NEGOTIATION" ? "NEGOTIATION" : "QUOTE_GATHERING";
        const boundLeverageQuoteId =
          (callRow?.metadata as { leverage_quote_id?: string | null } | null)?.leverage_quote_id ??
          null;

        if (callMode === "QUOTE_GATHERING") {
          if (parsed.quote_stage !== "INITIAL") {
            return jsonResponse(422, {
              error: "mode_violation",
              message:
                "QUOTE_GATHERING mode may only save INITIAL quotes. Use NEGOTIATION mode to save REVISED or FINAL.",
            });
          }
          if (
            parsed.leverage_quote_id ||
            parsed.price_before_leverage != null ||
            parsed.price_after_leverage != null
          ) {
            return jsonResponse(422, {
              error: "mode_violation",
              message:
                "QUOTE_GATHERING mode must not reference leverage. Do not send leverage_quote_id, price_before_leverage, or price_after_leverage.",
            });
          }
        } else {
          // NEGOTIATION mode
          if (parsed.quote_stage !== "INITIAL") {
            if (!boundLeverageQuoteId) {
              return jsonResponse(422, {
                error: "mode_violation",
                message:
                  "NEGOTIATION mode requires a leverage quote bound to the call at start.",
              });
            }
            if (
              parsed.leverage_quote_id &&
              parsed.leverage_quote_id !== boundLeverageQuoteId
            ) {
              return jsonResponse(422, {
                error: "mode_violation",
                message:
                  "leverage_quote_id must match the leverage quote bound to this call at start.",
              });
            }
          }
        }

        const externalRef = normalizeExternalRef(parsed.external_ref, parsed.quote_stage);

        // Reconcile agent-supplied numerics with the spoken words. When the
        // provider says "fifteen hundred" but the agent extracts 500, the
        // spoken form wins.
        const total = reconcileSpokenAmount(
          parsed.total_amount ?? null,
          parsed.total_words ?? null,
        );
        const low = reconcileSpokenAmount(parsed.low_amount ?? null, parsed.low_words ?? null);
        const high = reconcileSpokenAmount(parsed.high_amount ?? null, parsed.high_words ?? null);
        const deposit = reconcileSpokenAmount(
          parsed.deposit_amount ?? null,
          parsed.deposit_words ?? null,
        );
        const amountOverrides = [
          total.source === "words_override" ? `total ${parsed.total_amount}→${total.amount}` : null,
          low.source === "words_override" ? `low ${parsed.low_amount}→${low.amount}` : null,
          high.source === "words_override" ? `high ${parsed.high_amount}→${high.amount}` : null,
          deposit.source === "words_override"
            ? `deposit ${parsed.deposit_amount}→${deposit.amount}`
            : null,
        ].filter((s): s is string => s != null);

        // Auto-link previous_quote_id for REVISED/FINAL when caller didn't
        // supply one. This groups snapshots by provider+call so the UI never
        // treats a revision as a new provider.
        let previousQuoteId: string | null = parsed.previous_quote_id ?? null;
        if (!previousQuoteId && parsed.quote_stage !== "INITIAL") {
          const { data: prior } = await supabaseAdmin
            .from("quotes")
            .select("id")
            .eq("call_id", call.id)
            .eq("provider_id", call.provider_id)
            .neq("external_ref", externalRef)
            .order("captured_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          previousQuoteId = prior?.id ?? null;
        }

        const insertRow = {
          negotiation_id: call.negotiation_id,
          provider_id: call.provider_id,
          call_id: call.id,
          previous_quote_id: previousQuoteId,
          quote_stage: parsed.quote_stage,
          currency: parsed.currency,
          total_amount: total.amount,
          low_amount: low.amount,
          high_amount: high.amount,
          estimate_type: parsed.estimate_type ?? null,
          valid_until: parsed.valid_until ?? null,
          deposit_amount: deposit.amount,
          deposit_refundable: parsed.deposit_refundable ?? null,
          deposit_required: parsed.deposit_required ?? null,
          deposit_percentage: parsed.deposit_percentage ?? null,
          deposit_due: parsed.deposit_due ?? null,
          deposit_conditions: parsed.deposit_conditions ?? null,
          final_confirmed_at:
            parsed.quote_stage === "FINAL" && parsed.final_confirmed === true
              ? new Date().toISOString()
              : null,

          terms: parsed.terms ?? null,
          included_services: parsed.included_services,
          excluded_services: parsed.excluded_services,
          price_change_conditions: parsed.price_change_conditions ?? null,
          spec_version: spec.version,
          spec_hash: spec.hash,
          verification_status: parsed.verification_status,
          external_ref: externalRef,
          captured_at: new Date().toISOString(),
          metadata: {
            call_mode: callMode,
            leverage_quote_id:
              callMode === "NEGOTIATION" && parsed.quote_stage !== "INITIAL"
                ? (parsed.leverage_quote_id ?? boundLeverageQuoteId)
                : null,
            price_before_leverage: parsed.price_before_leverage ?? null,
            price_after_leverage: parsed.price_after_leverage ?? null,
            changed_terms: parsed.changed_terms ?? [],
            amount_overrides: amountOverrides,
          },
        };

        // Idempotent upsert on (call_id, provider_id, external_ref).
        const { data: quote, error: upErr } = await supabaseAdmin
          .from("quotes")
          .upsert(insertRow, { onConflict: "call_id,provider_id,external_ref" })
          .select("id")
          .single();
        if (upErr || !quote) {
          console.error("[save-quote-snapshot] upsert failed", upErr);
          return jsonResponse(500, { error: "save_failed", detail: upErr?.message });
        }

        await supabaseAdmin.from("agent_events").insert({
          negotiation_id: call.negotiation_id,
          call_id: call.id,
          agent_name: "elevenlabs",
          event_type: "QUOTE_CAPTURED",
          event_status: amountOverrides.length > 0 ? "warning" : "success",
          summary: `Quote ${parsed.quote_stage} captured (${parsed.currency} ${total.amount ?? "—"})${amountOverrides.length ? " · spoken-word override" : ""}`,
          metadata: {
            quote_id: quote.id,
            provider_id: call.provider_id,
            spec_version: spec.version,
            previous_quote_id: previousQuoteId,
            amount_overrides: amountOverrides,
            total_source: total.source,
          },
        });

        await supabaseAdmin
          .from("calls")
          .update({ status: parsed.quote_stage === "REVISED" ? "negotiating" : "quote_captured" })
          .eq("id", call.id)
          .in("status", [
            "scheduled",
            "context_loading",
            "in_progress",
            "quote_captured",
            "negotiating",
          ]);

        await supabaseAdmin
          .from("negotiations")
          .update({ workflow_status: "QUOTES_RECEIVED" })
          .eq("id", call.negotiation_id)
          .in("workflow_status", ["SPEC_CONFIRMED", "CALLING_PROVIDERS", "QUOTES_RECEIVED"]);

        return jsonResponse(200, {
          ok: true,
          quote_id: quote.id,
          quote_stage: parsed.quote_stage,
          external_ref: externalRef,
          message: "Quote saved successfully",
        });
      },
    },
  },
});
