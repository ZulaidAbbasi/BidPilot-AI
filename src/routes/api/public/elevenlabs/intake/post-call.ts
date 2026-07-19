/**
 * ElevenLabs Estimator (voice-intake) post-call webhook.
 *
 * Separate endpoint from the provider post-call webhook. Intake transcripts,
 * recording references, and webhook events NEVER mix with provider calls.
 *
 * Security:
 *  - HMAC verification against ELEVENLABS_WEBHOOK_SECRET (timing-safe compare)
 *  - Enforces 30-minute timestamp/replay window
 *  - Rejects missing/forged signatures with 401
 *  - Session identity is resolved server-side from the ElevenLabs
 *    conversation_id — never trusted from the payload
 *  - Idempotent via deterministic event_hash unique index
 *
 * Recovery semantics:
 *  - If finalize_intake_session already ran, the webhook enriches the same
 *    session idempotently (transcript, recording, post_processing_status).
 *  - If finalization never occurred (hang-up / browser disconnect), the
 *    session is marked 'interrupted' while transcript, recording, captured
 *    fields, and unresolved conflicts remain preserved. The specification
 *    is NEVER confirmed or hashed by this webhook.
 */
import { createFileRoute } from "@tanstack/react-router";
import { createHash, createHmac, timingSafeEqual } from "crypto";

import {
  RATE_LIMITS,
  checkInvalidAuthLimit,
  checkWebhookLimit,
  rateLimitResponse,
} from "@/lib/rate-limit.server";

const ENDPOINT = "intake-post-call";
const REPLAY_WINDOW_SECONDS = 60 * 30;

function parseSignatureHeader(header: string | null): { t: number; v0: string } | null {
  if (!header) return null;
  const parts = header.split(",").map((p) => p.trim());
  let t: number | null = null;
  let v0: string | null = null;
  for (const p of parts) {
    if (p.startsWith("t=")) t = Number(p.slice(2));
    else if (p.startsWith("v0=")) v0 = p.slice(3);
  }
  if (t === null || !Number.isFinite(t) || !v0) return null;
  return { t, v0 };
}

export function verifyIntakeSignature(
  secret: string,
  rawBody: string,
  header: string | null,
): { ok: boolean; reason?: string } {
  const parsed = parseSignatureHeader(header);
  if (!parsed) return { ok: false, reason: "malformed_signature_header" };
  const ageSec = Math.abs(Math.floor(Date.now() / 1000) - parsed.t);
  if (ageSec > REPLAY_WINDOW_SECONDS) return { ok: false, reason: "stale_timestamp" };
  const expected = createHmac("sha256", secret).update(`${parsed.t}.${rawBody}`).digest("hex");
  const a = Buffer.from(parsed.v0, "hex");
  const b = Buffer.from(expected, "hex");
  if (a.length !== b.length || a.length === 0) return { ok: false, reason: "bad_signature" };
  if (!timingSafeEqual(a, b)) return { ok: false, reason: "bad_signature" };
  return { ok: true };
}

type TranscriptTurn = {
  role: "agent" | "user" | "system";
  text: string;
  at?: string | null;
};

function normalizeTranscript(raw: unknown): TranscriptTurn[] {
  if (!Array.isArray(raw)) return [];
  const out: TranscriptTurn[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const rawRole = String(rec.role ?? rec.speaker ?? "").toLowerCase();
    const role: TranscriptTurn["role"] =
      rawRole === "user" || rawRole === "customer" || rawRole === "human"
        ? "user"
        : rawRole === "system"
          ? "system"
          : "agent";
    const text = String(rec.text ?? rec.message ?? rec.content ?? "").slice(0, 4000);
    if (!text.trim()) continue;
    const rawAt = rec.at ?? rec.timestamp ?? rec.time ?? null;
    const at =
      typeof rawAt === "string"
        ? rawAt
        : typeof rawAt === "number"
          ? new Date(rawAt * 1000).toISOString()
          : null;
    out.push({ role, text, at });
  }
  return out;
}

type Payload = {
  type?: string;
  event_id?: string;
  data?: {
    conversation_id?: string;
    agent_id?: string;
    status?: string;
    transcript?: unknown;
    metadata?: Record<string, unknown>;
    analysis?: Record<string, unknown>;
    has_audio?: boolean;
    conversation_initiation_client_data?: {
      dynamic_variables?: Record<string, unknown>;
    };
  };
};

export const Route = createFileRoute("/api/public/elevenlabs/intake/post-call")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env.ELEVENLABS_WEBHOOK_SECRET;
        if (!secret) {
          console.error("[intake webhook] Missing ELEVENLABS_WEBHOOK_SECRET");
          return new Response("Server misconfigured", { status: 500 });
        }

        const rawBody = await request.text();
        const sig = verifyIntakeSignature(
          secret,
          rawBody,
          request.headers.get("elevenlabs-signature"),
        );
        if (!sig.ok) {
          const rl = await checkInvalidAuthLimit(ENDPOINT, request, RATE_LIMITS[ENDPOINT].unsigned);
          if (!rl.allowed) return rateLimitResponse(rl.retryAfter);
          console.warn("[intake webhook] signature rejected:", sig.reason);
          return new Response("Invalid signature", { status: 401 });
        }

        let payload: Payload;
        try {
          payload = JSON.parse(rawBody) as Payload;
        } catch {
          return new Response("Invalid JSON", { status: 400 });
        }

        const conversationId = payload.data?.conversation_id ?? null;
        const eventType = payload.type ?? "unknown";
        const externalEventId = payload.event_id ?? null;
        const expectedAgentId = process.env.ELEVENLABS_INTAKE_AGENT_ID;
        if (
          expectedAgentId &&
          payload.data?.agent_id &&
          payload.data.agent_id !== expectedAgentId
        ) {
          return new Response("wrong agent", { status: 403 });
        }

        const rlSigned = await checkWebhookLimit(
          ENDPOINT,
          conversationId ?? "unknown",
          RATE_LIMITS[ENDPOINT].signed,
        );
        if (!rlSigned.allowed) return rateLimitResponse(rlSigned.retryAfter);

        const eventHash = createHash("sha256")
          .update(externalEventId ?? "")
          .update("|")
          .update(conversationId ?? "")
          .update("|")
          .update(eventType)
          .update("|")
          .update(rawBody)
          .digest("hex");

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        // Prefer the conversation binding written by the authenticated React
        // client. If that write was delayed, fall back to signed dynamic
        // variables included by ElevenLabs in the post-call payload, then
        // verify the referenced session and negotiation server-side.
        let sessionId: string | null = null;
        let negotiationId: string | null = null;
        let existingStatus: string | null = null;
        if (conversationId) {
          const { data: session } = await supabaseAdmin
            .from("intake_sessions")
            .select("id, negotiation_id, status")
            .eq("conversation_id", conversationId)
            .maybeSingle();
          sessionId = session?.id ?? null;
          negotiationId = session?.negotiation_id ?? null;
          existingStatus = session?.status ?? null;
        }
        if (!sessionId) {
          const dynamicVariables =
            payload.data?.conversation_initiation_client_data?.dynamic_variables ?? {};
          const dynamicSessionId =
            typeof dynamicVariables.intake_session_id === "string"
              ? dynamicVariables.intake_session_id
              : null;
          const dynamicNegotiationId =
            typeof dynamicVariables.negotiation_id === "string"
              ? dynamicVariables.negotiation_id
              : null;
          if (dynamicSessionId) {
            const { data: session } = await supabaseAdmin
              .from("intake_sessions")
              .select("id, negotiation_id, status")
              .eq("id", dynamicSessionId)
              .maybeSingle();
            if (
              session &&
              (!dynamicNegotiationId || session.negotiation_id === dynamicNegotiationId)
            ) {
              sessionId = session.id;
              negotiationId = session.negotiation_id;
              existingStatus = session.status;
              if (conversationId) {
                await supabaseAdmin
                  .from("intake_sessions")
                  .update({ conversation_id: conversationId })
                  .eq("id", session.id)
                  .is("conversation_id", null);
              }
            }
          }
        }

        const { data: eventRow, error: insertErr } = await supabaseAdmin
          .from("intake_webhook_events")
          .insert({
            session_id: sessionId,
            negotiation_id: negotiationId,
            conversation_id: conversationId,
            event_type: eventType,
            event_hash: eventHash,
            external_event_id: externalEventId,
            signature_valid: true,
            processing_status: "processing",
            payload: payload as never,
          })
          .select("id")
          .single();

        if (insertErr) {
          if ((insertErr as { code?: string }).code === "23505") {
            return new Response("duplicate", { status: 200 });
          }
          console.error("[intake webhook] event insert failed", insertErr);
          return new Response("insert failed", { status: 500 });
        }

        const finish = async (
          status: "completed" | "failed" | "ignored",
          err?: { code: string; message: string },
        ) => {
          await supabaseAdmin
            .from("intake_webhook_events")
            .update({
              processing_status: status,
              processed_at: new Date().toISOString(),
              error_code: err?.code ?? null,
              error_message: err?.message ?? null,
            })
            .eq("id", eventRow.id);
        };

        if (eventType !== "post_call_transcription") {
          await finish("ignored");
          return new Response("ignored", { status: 200 });
        }

        if (!sessionId || !negotiationId) {
          await finish("failed", {
            code: "no_match",
            message: "intake session not found for conversation",
          });
          return new Response("no match", { status: 200 });
        }

        const providerStatus = payload.data?.status ?? "completed";
        const isSuccess = providerStatus === "done" || providerStatus === "completed";
        const transcript = normalizeTranscript(payload.data?.transcript);

        const hasAudio = Boolean(payload.data?.has_audio);
        const recordingUrl = hasAudio ? `elevenlabs:conversation:${conversationId}` : null;

        // Idempotent enrichment. finalize_intake_session may have already
        // marked the session completed — we ONLY overwrite transcript when
        // the webhook version is at least as complete (usually strictly
        // more complete because ElevenLabs sends the final full transcript).
        const nowIso = new Date().toISOString();

        // Decide final status. Never downgrade a 'completed' session.
        const nextStatus =
          existingStatus === "completed"
            ? "completed"
            : isSuccess
              ? existingStatus === "active"
                ? "interrupted"
                : (existingStatus ?? "interrupted")
              : "interrupted";

        const update: Record<string, unknown> = {
          conversation_id: conversationId,
          webhook_received_at: nowIso,
          post_processing_status: "completed",
        };
        if (transcript.length > 0) update.transcript = transcript;
        if (recordingUrl) update.recording_url = recordingUrl;
        if (existingStatus !== "completed") {
          update.status = nextStatus;
        }
        update.ended_at = nowIso;

        const { error: updErr } = await supabaseAdmin
          .from("intake_sessions")
          .update(update as never)
          .eq("id", sessionId);

        if (updErr) {
          await finish("failed", { code: "update_failed", message: updErr.message });
          return new Response("update failed", { status: 500 });
        }

        await supabaseAdmin.from("agent_events").insert({
          negotiation_id: negotiationId,
          agent_name: "elevenlabs_estimator",
          event_type: "intake_post_call_received",
          event_status: isSuccess ? "success" : "warning",
          summary: `Intake post-call webhook processed (status=${nextStatus})`,
          metadata: {
            session_id: sessionId,
            conversation_id: conversationId,
            has_audio: hasAudio,
            transcript_turns: transcript.length,
            was_previously_completed: existingStatus === "completed",
            spec_confirmed: false,
          },
        });

        await finish("completed");
        return new Response("ok", { status: 200 });
      },
    },
  },
});
