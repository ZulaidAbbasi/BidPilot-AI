/**
 * ElevenLabs agent tool endpoint — load-call-context.
 *
 * Called by the ElevenLabs conversational agent during a live rehearsal to
 * fetch the immutable job specification, provider, and negotiation authority
 * for the current call. Authenticated with a short-lived `call_tool_token`
 * minted server-side when the call was started (see `startProviderRehearsal`).
 * Only the token's SHA-256 hash is stored; the raw value is single-use and
 * expires after two hours.
 *
 * SECURITY:
 *  - Never returns user IDs, secrets, service-role credentials, or internal
 *    scoring.
 *  - Verifies the loaded specification's version and hash before returning.
 *  - Logs CONTEXT_LOADED and SPEC_VERIFIED events.
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

const ENDPOINT = "load-call-context";

const BodySchema = z.object({
  call_id: z.string().uuid(),
  conversation_id: z.string().min(1).optional(),
  expected_spec_version: z.number().int().nonnegative().optional(),
  expected_spec_hash: z.string().min(1).optional(),
});

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function extractToken(req: Request): string | null {
  // Preferred: ElevenLabs dynamic-variable header (their UI cannot prepend "Bearer ").
  const bidpilot = req.headers.get("x-bidpilot-call-token");
  if (bidpilot && bidpilot.trim()) return bidpilot.trim();
  // Backward compatibility: Authorization: Bearer <token>
  const auth = req.headers.get("authorization");
  if (auth && auth.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
  // Legacy fallback header name.
  const x = req.headers.get("x-call-tool-token");
  return x && x.trim() ? x.trim() : null;
}

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

        // Bucket ANY caller with a syntactically-present token by its hash so
        // concurrent requests cannot bypass the per-token budget.
        const preHash = createHash("sha256").update(rawToken).digest("hex");
        const rlValid = await checkValidCallerLimit(ENDPOINT, preHash, RATE_LIMITS[ENDPOINT].valid);
        if (!rlValid.allowed) return rateLimitResponse(rlValid.retryAfter);

        let parsed: z.infer<typeof BodySchema>;
        try {
          parsed = BodySchema.parse(await request.json());
        } catch (e) {
          return json(400, {
            error: "invalid_request",
            detail: (e as Error).message,
          });
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
          // Bump the stricter invalid-auth bucket before returning.
          await checkInvalidAuthLimit(ENDPOINT, request, RATE_LIMITS[ENDPOINT].invalid);
          return json(401, { error: code });
        };
        if (!tokenRow) return failAuth("invalid_token");

        // Constant-time comparison of hashes.
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
            "id, negotiation_id, provider_id, external_call_id, job_spec_version, job_spec_hash",
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

        // Verify version + hash match the call record (defence in depth).
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

        // Log verification + context load. Never include user ids/secrets.
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

        // Mark the token as used (still valid for retry within TTL — tools may
        // legitimately be called more than once per call — but we record it).
        if (!tokenRow.used_at) {
          await supabaseAdmin
            .from("call_tool_tokens")
            .update({ used_at: new Date().toISOString() })
            .eq("id", tokenRow.id);
        }

        // Structured authority sourced from the confirmed specification.
        const specDoc = (spec.specification ?? {}) as {
          agent_permissions?: Record<string, boolean>;
          customer_priorities?: string[];
          agent_guidance?: string;
        };
        const perms = specDoc.agent_permissions ?? {};
        const authority = {
          allowed_actions: {
            request_quote: perms.may_request_quote ?? true,
            request_itemization: perms.may_request_itemization ?? true,
            negotiate_price: perms.may_negotiate_price ?? true,
            request_fee_waivers: perms.may_request_fee_waivers ?? true,
            request_improved_terms: perms.may_request_improved_terms ?? true,
            use_verified_leverage: perms.may_use_verified_leverage ?? true,
            request_written_estimates: perms.may_request_written_estimates ?? true,
          },
          forbidden_actions: {
            accept_offer: !(perms.may_accept_offer ?? false),
            pay_deposit: !(perms.may_pay_deposit ?? false),
            change_inventory: !(perms.may_change_inventory ?? false),
            add_paid_services: !(perms.may_add_paid_services ?? false),
            reveal_max_budget: !(perms.may_reveal_max_budget ?? false),
            sign_or_authorize: !(perms.may_sign_or_authorize ?? false),
          },
          can_accept_quote: perms.may_accept_offer ?? false,
          can_book: perms.may_sign_or_authorize ?? false,
          requires_human_approval: true,
          notes: "Agent is gathering a quote only. All commitments require human approval.",
        };

        return json(200, {
          call_mode: "QUOTE_GATHERING",
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
          customer_priorities: Array.isArray(specDoc.customer_priorities)
            ? specDoc.customer_priorities
            : [],
          agent_guidance: typeof specDoc.agent_guidance === "string" ? specDoc.agent_guidance : "",
          benchmark: null,
          eligible_leverage: [],
        });
      },
    },
  },
});
