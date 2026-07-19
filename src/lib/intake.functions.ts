/** Authenticated launcher and client-side recovery helpers for voice intake. */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { createHash, randomBytes } from "crypto";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const ELEVENLABS_API = "https://api.elevenlabs.io";
const TOKEN_TTL_MS = 60 * 60 * 1000;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing server environment variable: ${name}`);
  return value;
}

function firstName(full: string | null | undefined, emailLocal: string | null | undefined): string {
  const fromProfile = full?.trim().split(/\s+/)[0];
  return fromProfile || emailLocal || "there";
}

const StartInput = z.object({
  negotiationId: z.string().uuid(),
  resume: z.boolean().optional(),
});

export const startVoiceIntake = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => StartInput.parse(data))
  .handler(async ({ data, context }) => {
    const { supabase, userId, claims } = context;

    const { data: negotiation, error: negotiationError } = await supabase
      .from("negotiations")
      .select("id, user_id, title")
      .eq("id", data.negotiationId)
      .maybeSingle();
    if (negotiationError) throw new Error(negotiationError.message);
    if (!negotiation || negotiation.user_id !== userId) throw new Error("Negotiation not found");

    let { data: draft } = await supabase
      .from("job_spec_drafts")
      .select("id, revision, specification, field_provenance")
      .eq("negotiation_id", data.negotiationId)
      .maybeSingle();
    if (!draft) {
      const { data: created, error } = await supabase
        .from("job_spec_drafts")
        .insert({ negotiation_id: data.negotiationId })
        .select("id, revision, specification, field_provenance")
        .single();
      if (error || !created) throw new Error(error?.message ?? "Draft creation failed");
      draft = created;
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    let sessionId: string;

    const { data: activeSessions } = await supabaseAdmin
      .from("intake_sessions")
      .select("id, draft_id")
      .eq("negotiation_id", data.negotiationId)
      .eq("user_id", userId)
      .eq("status", "active")
      .order("started_at", { ascending: false });

    if (data.resume && activeSessions?.[0]) {
      sessionId = activeSessions[0].id;
      if (activeSessions[0].draft_id !== draft.id) {
        await supabaseAdmin
          .from("intake_sessions")
          .update({ draft_id: draft.id })
          .eq("id", sessionId);
      }
    } else {
      // A fresh session preserves older sessions as interrupted audit records.
      if (activeSessions && activeSessions.length > 0) {
        const now = new Date().toISOString();
        await supabaseAdmin
          .from("intake_sessions")
          .update({
            status: "interrupted",
            ended_at: now,
            summary: "Superseded by a new voice-intake session.",
          })
          .in(
            "id",
            activeSessions.map((session) => session.id),
          );
      }

      const { data: created, error } = await supabaseAdmin
        .from("intake_sessions")
        .insert({
          negotiation_id: data.negotiationId,
          draft_id: draft.id,
          user_id: userId,
          status: "active",
          post_processing_status: "pending",
        })
        .select("id")
        .single();

      if (error?.code === "23505") {
        // A concurrent Start request won the one-active-session race. Reuse
        // the authorized active row instead of creating two conversations.
        const { data: concurrentSession, error: concurrentError } = await supabaseAdmin
          .from("intake_sessions")
          .select("id")
          .eq("negotiation_id", data.negotiationId)
          .eq("user_id", userId)
          .eq("status", "active")
          .order("started_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (concurrentError || !concurrentSession) {
          throw new Error(concurrentError?.message ?? "An intake session is already starting");
        }
        sessionId = concurrentSession.id;
      } else {
        if (error || !created) throw new Error(error?.message ?? "Session creation failed");
        sessionId = created.id;
      }
    }

    // Revoke previous launch tokens for this session before minting a new one.
    const now = new Date().toISOString();
    await supabaseAdmin
      .from("intake_tool_tokens")
      .update({ expires_at: now, used_at: now })
      .eq("session_id", sessionId)
      .is("used_at", null);

    const rawToken = randomBytes(32).toString("hex");
    const tokenHash = createHash("sha256").update(rawToken).digest("hex");
    const expiresAt = new Date(Date.now() + TOKEN_TTL_MS).toISOString();
    const { error: tokenError } = await supabaseAdmin.from("intake_tool_tokens").insert({
      session_id: sessionId,
      negotiation_id: data.negotiationId,
      user_id: userId,
      token_hash: tokenHash,
      expires_at: expiresAt,
    });
    if (tokenError) throw new Error(`Intake token insert failed: ${tokenError.message}`);

    const agentId = requireEnv("ELEVENLABS_INTAKE_AGENT_ID");
    const apiKey = requireEnv("ELEVENLABS_API_KEY");
    const response = await fetch(
      `${ELEVENLABS_API}/v1/convai/conversation/token?agent_id=${encodeURIComponent(agentId)}`,
      { headers: { "xi-api-key": apiKey } },
    );
    if (!response.ok) {
      const body = await response.text();
      await supabaseAdmin
        .from("intake_sessions")
        .update({ status: "failed", ended_at: new Date().toISOString(), summary: "Launch failed." })
        .eq("id", sessionId);
      throw new Error(`ElevenLabs intake token request failed [${response.status}]: ${body}`);
    }
    const { token: conversationToken } = (await response.json()) as { token?: string };
    if (!conversationToken) throw new Error("ElevenLabs did not return a conversation token");

    await supabaseAdmin.from("agent_events").insert({
      negotiation_id: data.negotiationId,
      agent_name: "elevenlabs_estimator",
      event_type: "intake_session_started",
      event_status: "success",
      summary: "Voice intake session opened",
      metadata: { session_id: sessionId, resume: Boolean(data.resume) },
    });

    const emailLocal = typeof claims?.email === "string" ? claims.email.split("@")[0] : null;
    const { data: profile } = await supabase
      .from("profiles")
      .select("full_name")
      .eq("id", userId)
      .maybeSingle();

    return {
      sessionId,
      draftId: draft.id,
      agentId,
      conversationToken,
      dynamicVariables: {
        customer_first_name: firstName(profile?.full_name, emailLocal),
        intake_session_id: sessionId,
        negotiation_id: data.negotiationId,
        draft_id: draft.id,
        draft_revision: draft.revision ?? 0,
        known_fields: Object.keys(draft.specification ?? {}).join(", ") || "none",
        secret__intake_session_token: rawToken,
      },
      expiresAt,
    };
  });

const BindConversationInput = z.object({
  negotiationId: z.string().uuid(),
  sessionId: z.string().uuid(),
  conversationId: z.string().min(1).max(200),
});

/** Persist the SDK-returned conversation id immediately so post-call webhooks can match. */
export const bindIntakeConversation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => BindConversationInput.parse(data))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: session, error } = await supabase
      .from("intake_sessions")
      .select("id, user_id, negotiation_id, status, conversation_id")
      .eq("id", data.sessionId)
      .eq("negotiation_id", data.negotiationId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!session || session.user_id !== userId) throw new Error("Intake session not found");
    if (session.status !== "active") throw new Error(`Intake session is ${session.status}`);
    if (session.conversation_id && session.conversation_id !== data.conversationId) {
      throw new Error("A different ElevenLabs conversation is already bound to this session");
    }
    const { error: updateError } = await supabase
      .from("intake_sessions")
      .update({ conversation_id: data.conversationId })
      .eq("id", data.sessionId);
    if (updateError) throw new Error(updateError.message);
    return { ok: true, conversationId: data.conversationId };
  });

const ClientDisconnectInput = z.object({
  negotiationId: z.string().uuid(),
  sessionId: z.string().uuid(),
  conversationId: z.string().min(1).max(200).optional(),
  transcript: z
    .array(
      z.object({
        role: z.enum(["agent", "user", "system"]),
        text: z.string().max(4000),
        at: z.string().optional(),
      }),
    )
    .max(400),
});

/** Preserve a provisional client transcript if the agent tool fails to finalize. */
export const recordIntakeClientDisconnect = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => ClientDisconnectInput.parse(data))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: session, error } = await supabase
      .from("intake_sessions")
      .select(
        "id, user_id, negotiation_id, status, transcript, conversation_id, webhook_received_at",
      )
      .eq("id", data.sessionId)
      .eq("negotiation_id", data.negotiationId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!session || session.user_id !== userId) throw new Error("Intake session not found");

    const update: Record<string, unknown> = {
      ended_at: new Date().toISOString(),
      post_processing_status: session.webhook_received_at ? "completed" : "pending",
    };
    if (!session.conversation_id && data.conversationId)
      update.conversation_id = data.conversationId;
    if (
      (!Array.isArray(session.transcript) || session.transcript.length === 0) &&
      data.transcript.length
    ) {
      update.transcript = data.transcript;
    }
    if (session.status === "active") {
      update.status = "interrupted";
      update.summary =
        "Conversation ended before server finalization. Provisional transcript preserved; post-call webhook pending.";
    }

    const { error: updateError } = await supabase
      .from("intake_sessions")
      .update(update as never)
      .eq("id", data.sessionId);
    if (updateError) throw new Error(updateError.message);
    return { ok: true };
  });

export const getIntakeSession = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ negotiationId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: session } = await supabase
      .from("intake_sessions")
      .select(
        "id, status, started_at, ended_at, captured_fields, unresolved_fields, summary, conversation_id, recording_url, webhook_received_at, post_processing_status, transcript",
      )
      .eq("negotiation_id", data.negotiationId)
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const { data: draft } = await supabase
      .from("job_spec_drafts")
      .select("id, revision, specification, field_provenance, conflicts, completion_percent")
      .eq("negotiation_id", data.negotiationId)
      .maybeSingle();

    return { session: session ?? null, draft: draft ?? null };
  });
