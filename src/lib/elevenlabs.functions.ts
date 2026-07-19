/**
 * ElevenLabs Conversational AI — server-side endpoints for the Provider Call
 * Rehearsal panel. The API key never leaves the server: the client only ever
 * receives a signed conversation URL scoped to a single session. All dynamic
 * variables passed to the agent are generated server-side from the confirmed
 * immutable specification — never trusted from the browser.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { createHash, randomBytes } from "crypto";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { spokenDate } from "./date";

export const REHEARSAL_STYLES = ["flexible", "stonewaller", "upseller"] as const;
export type RehearsalStyle = (typeof REHEARSAL_STYLES)[number];

export const CALL_MODES = ["QUOTE_GATHERING", "NEGOTIATION"] as const;
export type CallMode = (typeof CALL_MODES)[number];

// NOTE: Rehearsal-style guidance MUST NOT be sent to the caller agent — it is
// counterparty persona text and would corrupt the agent's identity. Operator-
// facing role-player guidance lives in `src/lib/role-cards.ts` and is never
// referenced from any code path that builds agent dynamic variables.

const StartInput = z.object({
  negotiationId: z.string().uuid(),
  providerId: z.string().uuid(),
  rehearsalStyle: z.enum(REHEARSAL_STYLES).optional(),
  callMode: z.enum(CALL_MODES).optional(),
  leverageQuoteId: z.string().uuid().optional(),
});

const AttachInput = z.object({
  callId: z.string().uuid(),
  conversationId: z.string().min(1),
});

const EndInput = z.object({
  callId: z.string().uuid(),
  reason: z.string().optional(),
});

const ELEVENLABS_API = "https://api.elevenlabs.io";

const RECORDING_DISCLOSURE_EN =
  "Hi, this is BidPilot AI calling on behalf of a customer to gather a moving quote. This call may be recorded for quality and accuracy. If you'd prefer not to be recorded, please let me know now.";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing server environment variable: ${name}`);
  return v;
}

function firstName(full: string | null | undefined): string {
  if (!full) return "there";
  const t = full.trim().split(/\s+/)[0];
  return t || "there";
}

function shortAddress(
  structured: { city?: string; region?: string } | null | undefined,
  fallback: string | null | undefined,
): string {
  if (structured && (structured.city || structured.region)) {
    return [structured.city, structured.region].filter(Boolean).join(", ");
  }
  const s = (fallback ?? "").trim();
  if (!s) return "";
  const first = s.split(",")[0]?.trim() ?? s;
  return first.slice(0, 60);
}

export const startProviderRehearsal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => StartInput.parse(data))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // 1. Verify ownership + load negotiation (RLS scoped).
    const { data: negotiation, error: negErr } = await supabase
      .from("negotiations")
      .select("id, user_id, title, vertical, moving_date, origin_address, destination_address")
      .eq("id", data.negotiationId)
      .maybeSingle();
    if (negErr) throw new Error(negErr.message);
    if (!negotiation || negotiation.user_id !== userId) {
      throw new Error("Negotiation not found");
    }

    const { data: provider, error: provErr } = await supabase
      .from("providers")
      .select("id, name, negotiation_id")
      .eq("id", data.providerId)
      .eq("negotiation_id", data.negotiationId)
      .maybeSingle();
    if (provErr) throw new Error(provErr.message);
    if (!provider) throw new Error("Provider not found for this negotiation");

    // 2. Load latest confirmed JobSpec.
    const { data: spec, error: specErr } = await supabase
      .from("job_specs")
      .select("id, version, specification, specification_hash")
      .eq("negotiation_id", data.negotiationId)
      .eq("confirmed", true)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (specErr) throw new Error(specErr.message);
    if (!spec) throw new Error("Confirm a specification before rehearsing");

    // Caller profile (for first name).
    const { data: profile } = await supabase
      .from("profiles")
      .select("full_name")
      .eq("id", userId)
      .maybeSingle();

    // 3. Request a WebRTC conversation token from ElevenLabs (recommended
    //    for reliable mic capture; websocket path had inconsistent input audio
    //    in @elevenlabs/react 1.10+).
    const agentId = requireEnv("ELEVENLABS_PROVIDER_AGENT_ID");
    const apiKey = requireEnv("ELEVENLABS_API_KEY");
    const res = await fetch(
      `${ELEVENLABS_API}/v1/convai/conversation/token?agent_id=${encodeURIComponent(agentId)}`,
      { headers: { "xi-api-key": apiKey } },
    );
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`ElevenLabs token request failed [${res.status}]: ${body}`);
    }
    const { token: conversationToken } = (await res.json()) as { token: string };
    if (!conversationToken) throw new Error("ElevenLabs did not return a conversation token");

    // 4. Determine call mode + resolve leverage (NEGOTIATION only).
    const callMode: CallMode = data.callMode ?? "QUOTE_GATHERING";
    const rehearsalStyle = data.rehearsalStyle ?? null;

    type LeverageInfo = {
      quoteId: string;
      providerName: string;
      totalAmount: number | null;
      currency: string;
      includedServices: string[];
      capturedAt: string;
      specVersion: number;
      specHash: string;
    };
    let leverage: LeverageInfo | null = null;
    if (callMode === "NEGOTIATION") {
      if (!data.leverageQuoteId) {
        throw new Error("A leverage quote is required for NEGOTIATION mode");
      }
      const { data: lq, error: lqErr } = await supabase
        .from("quotes")
        .select(
          "id, provider_id, total_amount, currency, included_services, captured_at, spec_version, spec_hash, verification_status, quote_stage, final_confirmed_at, valid_until, call_id",
        )
        .eq("id", data.leverageQuoteId)
        .eq("negotiation_id", data.negotiationId)
        .maybeSingle();
      if (lqErr) throw new Error(lqErr.message);
      if (!lq) throw new Error("Leverage quote not found");

      // Strict eligibility. Same rules as the client picker and the tests.
      const { checkLeverageEligibility } = await import("./leverage-eligibility.server");
      const { data: lqEvidence } = await supabase
        .from("quote_evidence")
        .select("evidence_type, support_status")
        .eq("quote_id", lq.id);
      const { data: lqCall } = lq.call_id
        ? await supabase
            .from("calls")
            .select("status, needs_review")
            .eq("id", lq.call_id)
            .maybeSingle()
        : { data: null as { status: string; needs_review: boolean | null } | null };
      const elig = checkLeverageEligibility({
        quote: {
          id: lq.id,
          provider_id: lq.provider_id as string,
          negotiation_id: data.negotiationId,
          spec_hash: lq.spec_hash as string | null,
          quote_stage: lq.quote_stage as string,
          final_confirmed_at: lq.final_confirmed_at as string | null,
          verification_status: (lq.verification_status as string) ?? "unverified",
          valid_until: lq.valid_until as string | null,
        },
        call: lqCall ? { status: lqCall.status ?? "", needs_review: lqCall.needs_review } : null,
        evidence: (lqEvidence ?? []) as Array<{ evidence_type: string; support_status: string }>,
        currentProviderId: provider.id,
        currentSpecHash: spec.specification_hash ?? "",
      });
      if (!elig.eligible) {
        throw new Error(`Leverage quote is not eligible: ${elig.reason}`);
      }
      const { data: lp } = await supabase
        .from("providers")
        .select("name")
        .eq("id", lq.provider_id)
        .maybeSingle();
      leverage = {
        quoteId: lq.id,
        providerName: lp?.name ?? "another provider",
        totalAmount: lq.total_amount != null ? Number(lq.total_amount) : null,
        currency: lq.currency ?? "USD",
        includedServices: Array.isArray(lq.included_services)
          ? (lq.included_services as string[])
          : [],
        capturedAt: lq.captured_at as string,
        specVersion: lq.spec_version as number,
        specHash: lq.spec_hash as string,
      };
    }

    // 5. Create a real call record (privileged write via service role).
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: call, error: callErr } = await supabaseAdmin
      .from("calls")
      .insert({
        negotiation_id: data.negotiationId,
        provider_id: provider.id,
        agent_type: "provider_rehearsal",
        status: "scheduled",
        job_spec_version: spec.version,
        job_spec_hash: spec.specification_hash,
        call_mode: callMode,
        started_at: new Date().toISOString(),
        metadata: {
          agent_id: agentId,
          provider_name: provider.name,
          call_mode: callMode,
          rehearsal_style: rehearsalStyle,
          leverage_quote_id: leverage?.quoteId ?? null,
          leverage_provider_name: leverage?.providerName ?? null,
          leverage_total_amount: leverage?.totalAmount ?? null,
        },
      })
      .select("id")
      .single();
    if (callErr || !call) throw new Error(`Call insert failed: ${callErr?.message}`);

    // 6. Mint a short-lived, single-call tool token.
    //    Retried-start safety: remove any prior tokens bound to this call
    //    before inserting the new hash so only the newest token authorises.
    //    Raw tokens are never persisted; only the sha256 hash is stored.
    const rawToken = randomBytes(32).toString("hex");
    const tokenHash = createHash("sha256").update(rawToken).digest("hex");
    const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
    const { error: tokDelErr } = await supabaseAdmin
      .from("call_tool_tokens")
      .delete()
      .eq("call_id", call.id);
    if (tokDelErr) throw new Error(`Prior tool-token cleanup failed: ${tokDelErr.message}`);
    const { error: tokErr } = await supabaseAdmin.from("call_tool_tokens").insert({
      call_id: call.id,
      token_hash: tokenHash,
      expires_at: expiresAt,
    });
    if (tokErr) throw new Error(`Tool-token insert failed: ${tokErr.message}`);

    await supabaseAdmin
      .from("negotiations")
      .update({ workflow_status: "CALLING_PROVIDERS" })
      .eq("id", data.negotiationId)
      .in("workflow_status", ["SPEC_CONFIRMED", "CALLING_PROVIDERS"]);

    await supabaseAdmin.from("agent_events").insert({
      negotiation_id: data.negotiationId,
      call_id: call.id,
      agent_name: "elevenlabs",
      event_type: "call_started",
      event_status: "success",
      summary: `${callMode === "NEGOTIATION" ? "Negotiation" : "Rehearsal"} call opened with ${provider.name}${rehearsalStyle ? ` (${rehearsalStyle})` : ""}${leverage ? ` · leverage: ${leverage.providerName}` : ""}`,
      metadata: {
        provider_id: provider.id,
        confirmed_spec_version: spec.version,
        call_mode: callMode,
        rehearsal_style: rehearsalStyle,
        leverage_quote_id: leverage?.quoteId ?? null,
      },
    });

    // 7. Derive server-side dynamic variables. Never trust the client.
    const specJson = (spec.specification ?? {}) as {
      origin?: { city?: string; region?: string };
      destination?: { city?: string; region?: string };
    };

    const { directiveForMode, buildLeverageCitation, FORBIDDEN_ALWAYS } = await import(
      "./agent-directives"
    );

    const leverageInstruction =
      callMode === "NEGOTIATION" && leverage
        ? buildLeverageCitation({
            providerName: leverage.providerName,
            currency: leverage.currency,
            totalAmount: leverage.totalAmount,
            includedServices: leverage.includedServices,
          })
        : "";

    const dynamicVariables: Record<string, string | number | boolean> = {
      call_mode: callMode,
      mode_directive: directiveForMode(callMode),
      forbidden_always: FORBIDDEN_ALWAYS,
      negotiation_objective:
        callMode === "NEGOTIATION"
          ? "Get this provider to match, beat, or materially improve the verified competing offer, or record a truthful refusal."
          : "",
      customer_authority:
        callMode === "NEGOTIATION"
          ? "You may agree in principle to price and term improvements, but you must NOT commit to signing, paying a deposit, or scheduling on the call. Any acceptance is conditional on the customer's written approval after the call."
          : "",
      negotiation_id: data.negotiationId,
      call_id: call.id,
      provider_id: provider.id,
      provider_name: provider.name,
      customer_first_name: firstName(profile?.full_name),
      origin_short: shortAddress(specJson.origin, negotiation.origin_address),
      destination_short: shortAddress(specJson.destination, negotiation.destination_address),
      moving_date_spoken: spokenDate(negotiation.moving_date),
      confirmed_spec_version: spec.version,
      confirmed_spec_hash: spec.specification_hash ?? "",
      confirmed_spec_json: JSON.stringify(spec.specification ?? {}),
      preferred_language: "en",
      customer_timezone: "UTC",
      recording_disclosure_instruction: RECORDING_DISCLOSURE_EN,
      recording_disclosure_text: RECORDING_DISCLOSURE_EN,
      secret__call_tool_token: rawToken,
      // rehearsal_style / rehearsal_style_guidance intentionally NOT injected.
      // Style is persisted in calls.metadata.rehearsal_style for readiness/
      // reporting only; the caller agent remains style-blind.
      leverage_available: callMode === "NEGOTIATION" && leverage ? "true" : "false",
      leverage_provider_name: callMode === "NEGOTIATION" ? (leverage?.providerName ?? "") : "",
      leverage_total_amount:
        callMode === "NEGOTIATION" && leverage?.totalAmount != null
          ? String(leverage.totalAmount)
          : "",
      leverage_currency: callMode === "NEGOTIATION" ? (leverage?.currency ?? "") : "",
      leverage_included_services:
        callMode === "NEGOTIATION" && leverage ? leverage.includedServices.join(", ") : "",
      leverage_quote_id: callMode === "NEGOTIATION" ? (leverage?.quoteId ?? "") : "",
      leverage_instruction: leverageInstruction,
    };

    return {
      conversationToken,
      callId: call.id,
      dynamicVariables,
      confirmedSpecVersion: spec.version,
      confirmedSpecHash: spec.specification_hash,
      callMode,
      leverageQuoteId: leverage?.quoteId ?? null,
    };
  });

export const attachConversationId = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => AttachInput.parse(data))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: call, error } = await supabase
      .from("calls")
      .select("id, negotiation_id, negotiations!inner(user_id)")
      .eq("id", data.callId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!call) throw new Error("Call not found");
    const owner = (call as unknown as { negotiations: { user_id: string } }).negotiations.user_id;
    if (owner !== userId) throw new Error("Call not found");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error: updErr } = await supabaseAdmin
      .from("calls")
      .update({
        external_call_id: data.conversationId,
        status: "in_progress",
      })
      .eq("id", data.callId);
    if (updErr) throw new Error(updErr.message);
    return { ok: true as const };
  });

export const endProviderRehearsal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => EndInput.parse(data))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: call, error } = await supabase
      .from("calls")
      .select("id, status, negotiation_id, final_outcome, negotiations!inner(user_id)")
      .eq("id", data.callId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!call) throw new Error("Call not found");
    const owner = (call as unknown as { negotiations: { user_id: string } }).negotiations.user_id;
    if (owner !== userId) throw new Error("Call not found");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { persistCallReconciliation } = await import(
      "@/lib/persist-call-reconciliation.server"
    );

    const now = new Date().toISOString();

    // Drive the FSM forward: whichever active state we're in, land in `ending`,
    // then attempt to move into `processing` (reconciliation) once the SDK has
    // confirmed the audio session actually stopped.
    const nonTerminal = new Set([
      "scheduled",
      "context_loading",
      "connecting",
      "in_progress",
      "quote_captured",
      "negotiating",
    ]);
    if (nonTerminal.has(call.status ?? "")) {
      await supabaseAdmin
        .from("calls")
        .update({ status: "ending", session_ended_at: now, ended_at: now })
        .eq("id", data.callId);
    } else if (call.status === "ending") {
      await supabaseAdmin
        .from("calls")
        .update({ session_ended_at: now, ended_at: now })
        .eq("id", data.callId);
    }

    await supabaseAdmin.from("agent_events").insert({
      negotiation_id: call.negotiation_id!,
      call_id: data.callId,
      agent_name: "elevenlabs",
      event_type: "call_ended_client",
      event_status: "success",
      summary: data.reason ?? "Rehearsal ended by user",
    });

    // If finalize has landed (call has final_outcome), transition into
    // `processing` and let the reconciler pick the terminal state. If the
    // transcript webhook has not yet arrived, reconciliation will run again
    // when it does.
    if (call.final_outcome) {
      const { data: latest } = await supabaseAdmin
        .from("calls")
        .select("status")
        .eq("id", data.callId)
        .maybeSingle();
      if (latest?.status === "ending") {
        await supabaseAdmin
          .from("calls")
          .update({ status: "processing" })
          .eq("id", data.callId);
      }
      try {
        await persistCallReconciliation(data.callId);
      } catch (e) {
        console.warn("[endProviderRehearsal] reconciliation failed", e);
      }
    }

    return { ok: true as const };
  });

