/**
 * ElevenLabs agent tool — save_quote_line_item.
 *
 * Appends a single line item to an existing quote (identified by
 * `external_ref` on the call). Authenticated via the short-lived call token.
 * Idempotent per (quote_id, idempotency_key).
 *
 * SECURITY:
 *  - Ownership derived server-side from token → call → negotiation.
 *  - Amounts rejected when negative or non-finite.
 *  - `provider_words` + `evidence` are stored verbatim to avoid guessed
 *    values leaking into structured columns.
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


const ENDPOINT = "save-quote-line-item";

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

const OptionalBooleanSchema = (fallback: boolean) =>
  z.preprocess((value) => {
    if (value == null || value === "") return fallback;
    if (typeof value === "string") {
      if (value.toLowerCase() === "true") return true;
      if (value.toLowerCase() === "false") return false;
    }
    return value;
  }, z.boolean());

function normalizeQuoteRef(value: string) {
  // Preserve caller-supplied ref (case + form) so it can match a snapshot
  // saved with the same ref exactly. Trim + cap only.
  return value.trim().slice(0, 120);
}

function inferQuoteStage(ref: string): "INITIAL" | "REVISED" | "FINAL" {
  const r = ref.toLowerCase();
  if (r.startsWith("final")) return "FINAL";
  if (r.startsWith("revised")) return "REVISED";
  return "INITIAL";
}


const BodySchema = z.object({
  call_id: z.string().uuid(),
  provider_id: z.string().uuid(),
  conversation_id: z.preprocess(emptyToNull, z.string().min(1).nullable()).optional(),
  expected_spec_version: z.preprocess(emptyToNull, z.coerce.number().int().nonnegative().nullable()).optional(),
  expected_spec_hash: z.preprocess(emptyToNull, z.string().min(1).nullable()).optional(),

  quote_external_ref: z.string().min(1).max(120).transform(normalizeQuoteRef),
  idempotency_key: z.preprocess(emptyToNull, z.string().min(1).max(120).nullable()).optional(),
  category: z.preprocess(
    (value) =>
      typeof value === "string"
        ? value
            .trim()
            .toLowerCase()
            .replace(/[\s-]+/g, "_")
        : value,
    z.enum([
      "labor",
      "transport",
      "packing",
      "materials",
      "fuel",
      "stairs",
      "long_carry",
      "heavy_item",
      "storage",
      "insurance",
      "deposit",
      "surcharge",
      "discount",
      "tax",
      "other",
    ]),
  ),
  label: z.string().min(1).max(200),
  amount: OptionalAmountSchema.optional(),
  amount_words: z.preprocess(emptyToNull, z.string().max(200).nullable()).optional(),
  currency: z
    .preprocess(
      (value) =>
        value == null || value === ""
          ? "USD"
          : typeof value === "string"
            ? value.trim().toUpperCase()
            : value,
      z.string().length(3),
    )
    .default("USD"),
  quantity: OptionalAmountSchema.optional(),
  unit: z.preprocess(emptyToNull, z.string().max(40).nullable()).optional(),
  included: OptionalBooleanSchema(true).default(true),
  conditional: OptionalBooleanSchema(false).default(false),
  condition_text: z.preprocess(emptyToNull, z.string().max(1000).nullable()).optional(),
  provider_words: z.preprocess(emptyToNull, z.string().max(2000).nullable()).optional(),
  evidence: z
    .preprocess(
      (value) => (value == null || value === "" ? {} : value),
      z.object({
        transcript_span: z.string().max(4000).optional(),
        timestamp_ms: z.coerce.number().int().nonnegative().optional(),
        source: z.string().max(200).optional(),
      }),
    )
    .default({}),
});

export const Route = createFileRoute("/api/public/elevenlabs/tools/save-quote-line-item")({
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

        let parsed: z.infer<typeof BodySchema>;
        try {
          parsed = BodySchema.parse(await request.json());
        } catch (e) {
          return invalidRequestResponse(e, ENDPOINT);
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

        // Find the enclosing quote by exact reference first. Tool orchestration
        // can occasionally omit or vary the snapshot reference, so fall back to
        // the matching quote stage and finally create an unverified shell. The
        // later snapshot upsert fills the authoritative total/terms.
        let quote: { id: string } | null = null;
        const exact = await supabaseAdmin
          .from("quotes")
          .select("id")
          .eq("call_id", call.id)
          .eq("provider_id", call.provider_id)
          .eq("external_ref", parsed.quote_external_ref)
          .maybeSingle();
        if (exact.error) {
          console.error("[save-quote-line-item] quote lookup failed", exact.error);
          return jsonResponse(500, {
            error: "server_error",
            message: "Could not locate the quote",
          });
        }
        quote = exact.data;

        const inferredStage = inferQuoteStage(parsed.quote_external_ref);
        if (!quote) {
          const fallback = await supabaseAdmin
            .from("quotes")
            .select("id")
            .eq("call_id", call.id)
            .eq("provider_id", call.provider_id)
            .eq("quote_stage", inferredStage)
            .order("captured_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          if (fallback.error) {
            console.error("[save-quote-line-item] stage fallback failed", fallback.error);
            return jsonResponse(500, {
              error: "server_error",
              message: "Could not locate the quote stage",
            });
          }
          quote = fallback.data;
        }

        if (!quote) {
          const shell = await supabaseAdmin
            .from("quotes")
            .upsert(
              {
                negotiation_id: call.negotiation_id,
                provider_id: call.provider_id,
                call_id: call.id,
                quote_stage: inferredStage,
                currency: parsed.currency,
                spec_version: spec.version,
                spec_hash: spec.hash,
                verification_status: "unverified",
                external_ref: parsed.quote_external_ref,
                captured_at: new Date().toISOString(),
              },
              { onConflict: "call_id,provider_id,external_ref" },
            )
            .select("id")
            .single();
          if (shell.error || !shell.data) {
            console.error("[save-quote-line-item] shell quote failed", shell.error);
            return jsonResponse(500, {
              error: "save_failed",
              message: "Could not prepare the quote for this line item",
            });
          }
          quote = shell.data;
          await supabaseAdmin.from("agent_events").insert({
            negotiation_id: call.negotiation_id,
            call_id: call.id,
            agent_name: "elevenlabs",
            event_type: "QUOTE_SHELL_CREATED",
            event_status: "warning",
            summary: `Prepared ${inferredStage} quote before saving line items`,
            metadata: { quote_id: quote.id, external_ref: parsed.quote_external_ref },
          });
        }

        const providerWords = parsed.provider_words?.trim() || null;
        const stableIdempotencyKey =
          parsed.idempotency_key?.trim() ||
          createHash("sha256")
            .update(
              `${parsed.quote_external_ref}|${parsed.category}|${parsed.label}|${providerWords ?? ""}`,
            )
            .digest("hex")
            .slice(0, 40);

        const reconciled = reconcileSpokenAmount(
          parsed.amount ?? null,
          parsed.amount_words ?? parsed.provider_words ?? null,
        );

        const row = {
          quote_id: quote.id,
          category: parsed.category,
          label: parsed.label,
          amount: reconciled.amount,
          currency: parsed.currency,
          quantity: parsed.quantity ?? null,
          unit: parsed.unit ?? null,
          included: parsed.included,
          conditional: parsed.conditional,
          condition_text: parsed.condition_text ?? null,
          provider_words: providerWords,
          evidence: parsed.evidence,
          idempotency_key: stableIdempotencyKey,
        };

        const { data: line, error: upErr } = await supabaseAdmin
          .from("quote_line_items")
          .upsert(row, { onConflict: "quote_id,idempotency_key" })
          .select("id")
          .single();
        if (upErr || !line) {
          console.error("[save-quote-line-item] upsert failed", upErr);
          return jsonResponse(500, { error: "save_failed", detail: upErr?.message });
        }

        await supabaseAdmin.from("agent_events").insert({
          negotiation_id: call.negotiation_id,
          call_id: call.id,
          agent_name: "elevenlabs",
          event_type: "QUOTE_LINE_ITEM_SAVED",
          event_status: "success",
          summary: `${parsed.category}: ${parsed.label}`,
          metadata: {
            quote_id: quote.id,
            line_id: line.id,
            spec_version: spec.version,
            amount: parsed.amount ?? null,
            currency: parsed.currency,
          },
        });

        await supabaseAdmin
          .from("calls")
          .update({ status: "quote_captured" })
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
          line_item_id: line.id,
          quote_id: quote.id,
          quote_external_ref: parsed.quote_external_ref,
          idempotency_key: stableIdempotencyKey,
          message: "Quote line item saved successfully",
        });
      },
    },
  },
});
