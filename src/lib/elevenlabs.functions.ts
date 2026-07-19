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

const REHEARSAL_STYLE_GUIDANCE: Record<RehearsalStyle, string> = {
  flexible:
    "Role-play a flexible provider: give a clear itemised quote up front (base labor, mileage, stair fee if any, deposit). If the customer presents verified leverage (a real competing quote you can see in the call context), you MAY lower the total or waive small fees — but never invent a lower number the customer did not earn. End with a firm final price when the customer confirms.",
  stonewaller:
    "Role-play a stonewalling provider: refuse to give an immediate quote, answer vaguely ('depends on the crew', 'we'd have to see it'), and try to push the customer to a callback, an in-home survey, or an email quote. It is acceptable — and expected — to end the call WITHOUT a firm quote. Do not eventually cave and produce a full itemised quote just to be helpful; hold the line while remaining polite.",
  upseller:
    "Role-play an upseller / hidden-fee provider: open with a suspiciously low base quote, then reveal conditional charges as the conversation progresses — stair fee, long-carry fee, mandatory packing materials, larger-than-expected deposit, fuel surcharge. Reveal at least two extra fees before the call ends. Never disclose the full total up front. Stay in character even under pressure to itemise.",
};

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
          "id, provider_id, total_amount, currency, included_services, captured_at, spec_version, spec_hash, verification_status",
        )
        .eq("id", data.leverageQuoteId)
        .eq("negotiation_id", data.negotiationId)
        .maybeSingle();
      if (lqErr) throw new Error(lqErr.message);
      if (!lq) throw new Error("Leverage quote not found");
      if (lq.provider_id === provider.id) {
        throw new Error("Leverage quote must come from a different provider");
      }
      if (lq.spec_hash && lq.spec_hash !== spec.specification_hash) {
        throw new Error("Leverage quote is from a different confirmed specification");
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
    const rawToken = randomBytes(32).toString("hex");
    const tokenHash = createHash("sha256").update(rawToken).digest("hex");
    const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
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

    const leverageInstruction = leverage
      ? `You have a real, previously captured competing quote you MAY cite by name. Competitor: "${leverage.providerName}". Their total: ${leverage.currency} ${leverage.totalAmount ?? "unspecified"}. Included: ${leverage.includedServices.join(", ") || "not itemised"}. Use it to ask for a better price or better terms. Do NOT invent numbers, do NOT cite any other competitor, and do NOT quote a lower competitor price than this. If the provider improves their offer, capture the change via the save_quote_snapshot tool with quote_stage=REVISED and note the leverage_quote_id in the notes.`
      : "";

    const dynamicVariables: Record<string, string | number | boolean> = {
      call_mode: callMode,
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
      rehearsal_style: rehearsalStyle ?? "",
      rehearsal_style_guidance: rehearsalStyle ? REHEARSAL_STYLE_GUIDANCE[rehearsalStyle] : "",
      leverage_available: leverage ? "true" : "false",
      leverage_provider_name: leverage?.providerName ?? "",
      leverage_total_amount: leverage?.totalAmount != null ? String(leverage.totalAmount) : "",
      leverage_currency: leverage?.currency ?? "",
      leverage_included_services: leverage ? leverage.includedServices.join(", ") : "",
      leverage_quote_id: leverage?.quoteId ?? "",
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
      .select("id, status, negotiation_id, negotiations!inner(user_id)")
      .eq("id", data.callId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!call) throw new Error("Call not found");
    const owner = (call as unknown as { negotiations: { user_id: string } }).negotiations.user_id;
    if (owner !== userId) throw new Error("Call not found");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // Client-side "end" is advisory only. Terminal state comes from the webhook
    // + finalize-call-outcome tool. Just record ended_at.
    await supabaseAdmin
      .from("calls")
      .update({ ended_at: new Date().toISOString() })
      .eq("id", data.callId);

    await supabaseAdmin.from("agent_events").insert({
      negotiation_id: call.negotiation_id!,
      call_id: data.callId,
      agent_name: "elevenlabs",
      event_type: "call_ended_client",
      event_status: "success",
      summary: data.reason ?? "Rehearsal ended by user",
    });

    return { ok: true as const };
  });
