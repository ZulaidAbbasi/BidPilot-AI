/**
 * ElevenLabs agent tool endpoint — load-call-context.
 *
 * Returns the immutable job specification, provider, negotiation authority,
 * and — for NEGOTIATION mode calls — the verified competing quote (leverage)
 * that was bound server-side when the call started.
 *
 * SECURITY:
 *  - Never returns user IDs, secrets, credentials, role-cards, rehearsal
 *    style, provider minimums, or concession policy.
 *  - The call mode is always the real persisted value on the calls row.
 *  - Leverage must pass the shared `checkLeverageEligibility` function used
 *    by the picker, call-start, and eligibility tests. This endpoint adds
 *    strictness (must be the bound quote, must have an amount, currency, and
 *    a reconciled source call) but never weakens it.
 *  - When leverage cannot be verified we return leverage:null with a
 *    machine-readable reason and log LEVERAGE_VERIFICATION_FAILED. The
 *    endpoint NEVER silently falls back to QUOTE_GATHERING.
 */
import { createFileRoute } from "@tanstack/react-router";
import { createHash, timingSafeEqual } from "crypto";
import { z } from "zod";

import {
  RATE_LIMITS,
  checkInvalidAuthLimit,
  checkValidCallerLimit,
  rateLimitResponse,
} from "@/lib/rate-limit.server";
import { deriveCallAuthority, isLeverageAuthorized } from "@/lib/call-authority";
import { normalizedPriorityWeights, type Priority } from "@/lib/ranking.server";
import {
  checkLeverageEligibility,
  type EligibilityFailureReason,
} from "@/lib/leverage-eligibility.server";

const ENDPOINT = "load-call-context";

const BodySchema = z.object({
  call_id: z.string().uuid(),
  conversation_id: z.string().min(1).optional(),
  expected_spec_version: z.number().int().nonnegative().optional(),
  expected_spec_hash: z.string().min(1).optional(),
});

export type LeverageUnavailableReason =
  | "missing_bound_quote"
  | "same_provider"
  | "different_spec"
  | "not_final"
  | "final_not_confirmed"
  | "unsupported_evidence"
  | "source_call_incomplete"
  | "not_reconciled"
  | "needs_review"
  | "flagged"
  | "contradictory"
  | "expired"
  | "missing_amount"
  | "currency_mismatch";

export interface LoadedLeverage {
  quote_id: string;
  provider_id: string;
  provider_name: string;
  source_call_id: string | null;
  currency: string;
  total_amount: number | null;
  low_amount: number | null;
  high_amount: number | null;
  estimate_type: string | null;
  included_services: string[];
  supported_material_terms: string[];
  captured_at: string;
  final_confirmed_at: string;
  job_spec_hash: string;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function extractToken(req: Request): string | null {
  const bidpilot = req.headers.get("x-bidpilot-call-token");
  if (bidpilot && bidpilot.trim()) return bidpilot.trim();
  const auth = req.headers.get("authorization");
  if (auth && auth.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
  const x = req.headers.get("x-call-tool-token");
  return x && x.trim() ? x.trim() : null;
}

const ELIGIBILITY_REASON_MAP: Record<EligibilityFailureReason, LeverageUnavailableReason> = {
  different_spec: "different_spec",
  same_provider: "same_provider",
  not_final: "not_final",
  not_final_confirmed: "final_not_confirmed",
  flagged: "flagged",
  missing_transcript_evidence: "unsupported_evidence",
  call_needs_review: "needs_review",
  call_not_completed: "source_call_incomplete",
  expired: "expired",
};

export const Route = createFileRoute("/api/public/elevenlabs/tools/load-call-context")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const rawToken = extractToken(request);
        if (!rawToken) {
          const rl = await checkInvalidAuthLimit(ENDPOINT, request, RATE_LIMITS[ENDPOINT].invalid);
          if (!rl.allowed) return rateLimitResponse(rl.retryAfter);
          return json(401, { error: "missing_token" });
        }

        const preHash = createHash("sha256").update(rawToken).digest("hex");
        const rlValid = await checkValidCallerLimit(ENDPOINT, preHash, RATE_LIMITS[ENDPOINT].valid);
        if (!rlValid.allowed) return rateLimitResponse(rlValid.retryAfter);

        let parsed: z.infer<typeof BodySchema>;
        try {
          parsed = BodySchema.parse(await request.json());
        } catch (e) {
          return json(400, { error: "invalid_request", detail: (e as Error).message });
        }

        const tokenHash = createHash("sha256").update(rawToken).digest("hex");
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const { data: tokenRow, error: tokErr } = await supabaseAdmin
          .from("call_tool_tokens")
          .select("id, call_id, token_hash, expires_at, used_at")
          .eq("call_id", parsed.call_id)
          .maybeSingle();
        if (tokErr) {
          console.error("[load-call-context] token lookup failed", tokErr);
          return json(500, { error: "server_error" });
        }
        const failAuth = async (code: string): Promise<Response> => {
          await checkInvalidAuthLimit(ENDPOINT, request, RATE_LIMITS[ENDPOINT].invalid);
          return json(401, { error: code });
        };
        if (!tokenRow) return failAuth("invalid_token");

        const a = Buffer.from(tokenRow.token_hash, "hex");
        const b = Buffer.from(tokenHash, "hex");
        if (a.length !== b.length || a.length === 0 || !timingSafeEqual(a, b)) {
          return failAuth("invalid_token");
        }
        if (new Date(tokenRow.expires_at).getTime() < Date.now()) {
          return failAuth("expired_token");
        }

        // Load call + provider + spec.
        const { data: call, error: callErr } = await supabaseAdmin
          .from("calls")
          .select(
            "id, negotiation_id, provider_id, external_call_id, job_spec_version, job_spec_hash, call_mode, metadata",
          )
          .eq("id", parsed.call_id)
          .maybeSingle();
        if (callErr || !call) return json(404, { error: "call_not_found" });

        if (
          parsed.conversation_id &&
          call.external_call_id &&
          call.external_call_id !== parsed.conversation_id
        ) {
          return json(409, { error: "conversation_mismatch" });
        }

        const { data: spec, error: specErr } = await supabaseAdmin
          .from("job_specs")
          .select("id, version, specification, specification_hash, confirmed")
          .eq("negotiation_id", call.negotiation_id)
          .eq("confirmed", true)
          .order("version", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (specErr || !spec) return json(404, { error: "spec_not_found" });

        const versionOk = call.job_spec_version == null || call.job_spec_version === spec.version;
        const hashOk = !call.job_spec_hash || call.job_spec_hash === spec.specification_hash;
        const expectedVersionOk =
          parsed.expected_spec_version == null || parsed.expected_spec_version === spec.version;
        const expectedHashOk =
          !parsed.expected_spec_hash || parsed.expected_spec_hash === spec.specification_hash;

        if (!versionOk || !hashOk || !expectedVersionOk || !expectedHashOk) {
          await supabaseAdmin.from("agent_events").insert({
            negotiation_id: call.negotiation_id,
            call_id: call.id,
            agent_name: "elevenlabs",
            event_type: "SPEC_VERIFIED",
            event_status: "failure",
            summary: "Specification version or hash mismatch",
            metadata: {
              call_version: call.job_spec_version,
              spec_version: spec.version,
              call_hash: call.job_spec_hash,
              spec_hash: spec.specification_hash,
            },
          });
          return json(409, { error: "spec_verification_failed" });
        }

        const { data: provider, error: provErr } = await supabaseAdmin
          .from("providers")
          .select("id, name, phone, website, location")
          .eq("id", call.provider_id!)
          .maybeSingle();
        if (provErr || !provider) return json(404, { error: "provider_not_found" });

        // Persisted call_mode is the source of truth. Default to QUOTE_GATHERING
        // only when the row is missing the value (legacy).
        const callMode: "QUOTE_GATHERING" | "NEGOTIATION" =
          call.call_mode === "NEGOTIATION" ? "NEGOTIATION" : "QUOTE_GATHERING";

        // Resolve bound leverage (NEGOTIATION only).
        let leverage: LoadedLeverage | null = null;
        let leverageUnavailableReason: LeverageUnavailableReason | null = null;

        // Authority gate: `may_use_verified_leverage=false` blocks leverage
        // delivery outright, even when the bound quote would otherwise verify.
        // This must run before eligibility so the agent can never receive a
        // competing offer that the customer has forbidden it to cite.
        const specDocEarly = (spec.specification ?? {}) as {
          agent_permissions?: Record<string, boolean>;
        };
        const leverageAuthorized = isLeverageAuthorized(specDocEarly.agent_permissions ?? null);

        if (callMode === "NEGOTIATION" && !leverageAuthorized) {
          leverageUnavailableReason = "missing_bound_quote";
          // Log the authority denial so the audit trail is explicit.
          await supabaseAdmin.from("agent_events").insert({
            negotiation_id: call.negotiation_id,
            call_id: call.id,
            agent_name: "elevenlabs",
            event_type: "LEVERAGE_AUTHORITY_DENIED",
            event_status: "warning",
            summary: "Customer revoked may_use_verified_leverage — leverage suppressed",
            metadata: { call_mode: callMode },
          });
        }

        if (callMode === "NEGOTIATION" && leverageAuthorized) {
          const meta = (call.metadata ?? {}) as { leverage_quote_id?: string | null };
          const boundQuoteId =
            typeof meta.leverage_quote_id === "string" && meta.leverage_quote_id
              ? meta.leverage_quote_id
              : null;


          if (!boundQuoteId) {
            leverageUnavailableReason = "missing_bound_quote";
          } else {
            const { data: lq } = await supabaseAdmin
              .from("quotes")
              .select(
                "id, negotiation_id, provider_id, call_id, total_amount, low_amount, high_amount, estimate_type, currency, included_services, captured_at, spec_version, spec_hash, verification_status, quote_stage, final_confirmed_at, valid_until",
              )
              .eq("id", boundQuoteId)
              .eq("negotiation_id", call.negotiation_id)
              .maybeSingle();

            if (!lq) {
              leverageUnavailableReason = "missing_bound_quote";
            } else {
              const [{ data: lqEvidence }, { data: lqCall }] = await Promise.all([
                supabaseAdmin
                  .from("quote_evidence")
                  .select("evidence_type, support_status")
                  .eq("quote_id", lq.id),
                lq.call_id
                  ? supabaseAdmin
                      .from("calls")
                      .select("id, status, needs_review, reconciled_at")
                      .eq("id", lq.call_id)
                      .maybeSingle()
                  : Promise.resolve({ data: null }),
              ]);

              // Reuse the shared eligibility function — single source of truth.
              const elig = checkLeverageEligibility({
                quote: {
                  id: lq.id,
                  provider_id: lq.provider_id as string,
                  negotiation_id: call.negotiation_id,
                  spec_hash: lq.spec_hash as string | null,
                  quote_stage: lq.quote_stage as string,
                  final_confirmed_at: lq.final_confirmed_at as string | null,
                  verification_status: (lq.verification_status as string) ?? "unverified",
                  valid_until: lq.valid_until as string | null,
                },
                call: lqCall
                  ? {
                      status: (lqCall as { status: string | null }).status ?? "",
                      needs_review: (lqCall as { needs_review: boolean | null }).needs_review,
                    }
                  : null,
                evidence: (lqEvidence ?? []) as Array<{
                  evidence_type: string;
                  support_status: string;
                }>,
                currentProviderId: provider.id,
                currentSpecHash: spec.specification_hash ?? "",
              });

              if (!elig.eligible) {
                leverageUnavailableReason = ELIGIBILITY_REASON_MAP[elig.reason];
              } else if (
                (lq.verification_status as string | null) === "contradictory"
              ) {
                leverageUnavailableReason = "contradictory";
              } else if (
                !lqCall ||
                !(lqCall as { reconciled_at: string | null }).reconciled_at
              ) {
                leverageUnavailableReason = "not_reconciled";
              } else if (lq.total_amount == null) {
                leverageUnavailableReason = "missing_amount";
              } else if (!lq.currency || String(lq.currency).trim() === "") {
                leverageUnavailableReason = "currency_mismatch";
              } else {
                const { data: lp } = await supabaseAdmin
                  .from("providers")
                  .select("name")
                  .eq("id", lq.provider_id as string)
                  .maybeSingle();

                const supportedMaterialTerms = Array.from(
                  new Set(
                    ((lqEvidence ?? []) as Array<{
                      evidence_type: string;
                      support_status: string;
                    }>)
                      .filter((e) => e.support_status === "supported")
                      .map((e) => e.evidence_type),
                  ),
                );

                leverage = {
                  quote_id: lq.id,
                  provider_id: lq.provider_id as string,
                  provider_name: lp?.name ?? "another provider",
                  source_call_id: (lq.call_id as string | null) ?? null,
                  currency: lq.currency as string,
                  total_amount: lq.total_amount != null ? Number(lq.total_amount) : null,
                  low_amount: lq.low_amount != null ? Number(lq.low_amount) : null,
                  high_amount: lq.high_amount != null ? Number(lq.high_amount) : null,
                  estimate_type: (lq.estimate_type as string | null) ?? null,
                  included_services: Array.isArray(lq.included_services)
                    ? (lq.included_services as string[])
                    : [],
                  supported_material_terms: supportedMaterialTerms,
                  captured_at: lq.captured_at as string,
                  final_confirmed_at: lq.final_confirmed_at as string,
                  job_spec_hash: lq.spec_hash as string,
                };
              }
            }
          }

          if (leverageUnavailableReason) {
            await supabaseAdmin.from("agent_events").insert({
              negotiation_id: call.negotiation_id,
              call_id: call.id,
              agent_name: "elevenlabs",
              event_type: "LEVERAGE_VERIFICATION_FAILED",
              event_status: "warning",
              summary: `Bound leverage failed verification: ${leverageUnavailableReason}`,
              metadata: {
                provider_id: provider.id,
                bound_quote_id: boundQuoteId,
                reason: leverageUnavailableReason,
              },
            });
          }
        }

        // Log verification + context load.
        await supabaseAdmin.from("agent_events").insert([
          {
            negotiation_id: call.negotiation_id,
            call_id: call.id,
            agent_name: "elevenlabs",
            event_type: "SPEC_VERIFIED",
            event_status: "success",
            summary: `Confirmed spec v${spec.version} verified`,
            metadata: {
              spec_version: spec.version,
              spec_hash: spec.specification_hash,
            },
          },
          {
            negotiation_id: call.negotiation_id,
            call_id: call.id,
            agent_name: "elevenlabs",
            event_type: "CONTEXT_LOADED",
            event_status: "success",
            summary: "Agent loaded call context",
            metadata: {
              conversation_id: parsed.conversation_id ?? call.external_call_id,
              provider_id: provider.id,
              call_mode: callMode,
              leverage_verified: leverage !== null,
            },
          },
        ]);

        await supabaseAdmin
          .from("calls")
          .update({ status: "in_progress" })
          .eq("id", call.id)
          .in("status", ["scheduled", "context_loading", "in_progress"]);

        await supabaseAdmin
          .from("negotiations")
          .update({ workflow_status: "CALLING_PROVIDERS" })
          .eq("id", call.negotiation_id)
          .in("workflow_status", ["SPEC_CONFIRMED", "CALLING_PROVIDERS"]);

        if (!tokenRow.used_at) {
          await supabaseAdmin
            .from("call_tool_tokens")
            .update({ used_at: new Date().toISOString() })
            .eq("id", tokenRow.id);
        }

        // Authority sourced from confirmed specification + call mode.
        const specDoc = (spec.specification ?? {}) as {
          agent_permissions?: Record<string, boolean>;
          customer_priorities?: string[];
          agent_guidance?: string;
        };
        const perms = specDoc.agent_permissions ?? {};

        // Structured authority + notes come from the shared pure helper so
        // every consumer (route, tests, docs) reads the same rules. See
        // src/lib/call-authority.ts.
        const authority = deriveCallAuthority({
          callMode,
          perms,
          leverageAvailable: leverage !== null,
        });

        const priorities: string[] = Array.isArray(specDoc.customer_priorities)
          ? specDoc.customer_priorities.filter((p) => typeof p === "string")
          : [];
        // Weights are computed server-side ONLY. The browser and the
        // Provider Agent must render/consume, never recompute.
        const priorityWeights = normalizedPriorityWeights(priorities as Priority[]);

        return json(200, {
          call_mode: callMode,
          call_id: call.id,
          provider: {
            id: provider.id,
            name: provider.name,
            phone: provider.phone ?? null,
            website: provider.website ?? null,
            location: provider.location ?? null,
          },
          specification: {
            version: spec.version,
            hash: spec.specification_hash,
            confirmed: spec.confirmed,
            document: spec.specification,
          },
          authority,
          customer_priorities: priorities,
          priority_weights: priorityWeights,
          agent_guidance: typeof specDoc.agent_guidance === "string" ? specDoc.agent_guidance : "",
          benchmark: null,
          leverage,
          leverage_unavailable_reason: leverageUnavailableReason,
          // Backward-compatible array kept for the currently published
          // ElevenLabs Provider Agent prompt. Contains the same verified
          // leverage object (at most one) or [] when unavailable.
          eligible_leverage: leverage ? [leverage] : [],
        });

      },
    },
  },
});
