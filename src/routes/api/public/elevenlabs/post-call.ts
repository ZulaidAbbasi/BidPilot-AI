/**
 * ElevenLabs post-call webhook (hardened + idempotent).
 *
 * Flow:
 *  1. Verify HMAC signature against raw body — reject unsigned/invalid.
 *  2. Insert into call_webhook_events with deterministic event_hash. If a
 *     row already exists for that hash, treat as duplicate delivery and return 200.
 *  3. Locate the call via external_call_id.
 *  4. Persist transcript rows (call_transcripts) idempotently.
 *  5. Update call terminal status + webhook_received_at.
 *  6. Mark event completed / failed.
 *
 * Nothing here is trusted from the browser; all writes use service_role.
 * Raw tokens or secrets are never logged.
 */
import { createFileRoute } from "@tanstack/react-router";
import { createHash, createHmac, timingSafeEqual } from "crypto";

import {
  normalizeElevenLabsTranscript,
  persistElevenLabsTranscript,
} from "@/lib/elevenlabs-transcript.server";
import { persistCallReconciliation } from "@/lib/persist-call-reconciliation.server";
import {
  RATE_LIMITS,
  checkInvalidAuthLimit,
  checkWebhookLimit,
  rateLimitResponse,
} from "@/lib/rate-limit.server";

const ENDPOINT = "post-call";

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

function verifySignature(
  secret: string,
  rawBody: string,
  header: string | null,
): { ok: boolean; reason?: string } {
  const parsed = parseSignatureHeader(header);
  if (!parsed) return { ok: false, reason: "malformed_signature_header" };
  const ageSec = Math.abs(Math.floor(Date.now() / 1000) - parsed.t);
  if (ageSec > 60 * 30) return { ok: false, reason: "stale_timestamp" };
  const expected = createHmac("sha256", secret).update(`${parsed.t}.${rawBody}`).digest("hex");
  const a = Buffer.from(parsed.v0, "hex");
  const b = Buffer.from(expected, "hex");
  if (a.length !== b.length || a.length === 0) return { ok: false, reason: "bad_signature" };
  if (!timingSafeEqual(a, b)) return { ok: false, reason: "bad_signature" };
  return { ok: true };
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
  };
};

export const Route = createFileRoute("/api/public/elevenlabs/post-call")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env.ELEVENLABS_WEBHOOK_SECRET;
        if (!secret) {
          console.error("[elevenlabs webhook] Missing ELEVENLABS_WEBHOOK_SECRET");
          return new Response("Server misconfigured", { status: 500 });
        }
        const rawBody = await request.text();
        const sig = verifySignature(secret, rawBody, request.headers.get("elevenlabs-signature"));
        if (!sig.ok) {
          // Strict per-IP limit for unsigned/invalid-signature traffic so
          // random probes cannot burn our webhook budget.
          const rl = await checkInvalidAuthLimit(ENDPOINT, request, RATE_LIMITS[ENDPOINT].unsigned);
          if (!rl.allowed) return rateLimitResponse(rl.retryAfter);
          console.warn("[elevenlabs webhook] signature rejected:", sig.reason);
          return new Response("Invalid signature", { status: 401 });
        }

        let payload: Payload;
        try {
          payload = JSON.parse(rawBody) as Payload;
        } catch {
          return new Response("Invalid JSON", { status: 400 });
        }

        // Per-conversation limit for signed traffic (retries are fine — the
        // event_hash unique index makes duplicates cheap, but a stuck retry
        // loop shouldn't be able to hammer the endpoint indefinitely).
        const rlSigned = await checkWebhookLimit(
          ENDPOINT,
          payload.data?.conversation_id ?? "unknown",
          RATE_LIMITS[ENDPOINT].signed,
        );
        if (!rlSigned.allowed) return rateLimitResponse(rlSigned.retryAfter);

        const eventType = payload.type ?? "unknown";
        const conversationId = payload.data?.conversation_id ?? null;
        const externalEventId = payload.event_id ?? null;

        // Deterministic event hash for idempotency.
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

        // Resolve call by conversation_id (may be null for non-transcription events).
        let callId: string | null = null;
        let negotiationId: string | null = null;
        if (conversationId) {
          const { data: call } = await supabaseAdmin
            .from("calls")
            .select("id, negotiation_id")
            .eq("external_call_id", conversationId)
            .maybeSingle();
          callId = call?.id ?? null;
          negotiationId = call?.negotiation_id ?? null;
        }

        // Idempotent insert. Duplicate deliveries hit the unique event_hash.
        const { data: eventRow, error: insertErr } = await supabaseAdmin
          .from("call_webhook_events")
          .insert({
            call_id: callId,
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
          // Duplicate delivery — unique constraint violation.
          if ((insertErr as { code?: string }).code === "23505") {
            return new Response("duplicate", { status: 200 });
          }
          console.error("[elevenlabs webhook] event insert failed", insertErr);
          return new Response("insert failed", { status: 500 });
        }

        const finish = async (
          status: "completed" | "failed",
          err?: { code: string; message: string },
        ) => {
          await supabaseAdmin
            .from("call_webhook_events")
            .update({
              processing_status: status,
              processed_at: new Date().toISOString(),
              error_code: err?.code ?? null,
              error_message: err?.message ?? null,
            })
            .eq("id", eventRow.id);
        };

        if (eventType !== "post_call_transcription") {
          await finish("completed");
          return new Response("ignored", { status: 200 });
        }

        if (!callId || !conversationId || !negotiationId) {
          await finish("failed", { code: "no_match", message: "conversation not found" });
          return new Response("no match", { status: 200 });
        }

        const providerStatus = payload.data?.status ?? "completed";
        const transcript = normalizeElevenLabsTranscript(payload.data?.transcript);
        const isSuccess = providerStatus === "done" || providerStatus === "completed";

        let transcriptText = "";
        try {
          const persisted = await persistElevenLabsTranscript({
            callId,
            negotiationId,
            conversationId,
            transcript,
            markWebhookReceived: true,
          });
          transcriptText = persisted.transcriptText;
        } catch (error) {
          const message = error instanceof Error ? error.message : "Transcript write failed";
          await finish("failed", { code: "transcript_write", message });
          return new Response("transcript write failed", { status: 500 });
        }

        // Persist webhook/transcript state first. Reconciliation is then run
        // from the persisted records so it always sees the complete post-call
        // transcript (finalize_call_outcome frequently arrives first).
        const { data: preCall } = await supabaseAdmin
          .from("calls")
          .select("status, final_outcome")
          .eq("id", callId)
          .maybeSingle();

        const provisionalStatus = !isSuccess
          ? "failed"
          : preCall?.final_outcome
            ? (preCall.status ?? "quote_captured")
            : preCall?.status === "in_progress"
              ? "quote_captured"
              : (preCall?.status ?? "in_progress");

        const rawData = payload.data as Record<string, unknown> | undefined;
        const hasAudio = Boolean(rawData?.has_audio);
        const recordingUrl = hasAudio
          ? `elevenlabs:conversation:${conversationId}`
          : null;

        const { error: updErr } = await supabaseAdmin
          .from("calls")
          .update({
            status: provisionalStatus,
            outcome: providerStatus,
            transcript_text: transcriptText || null,
            recording_url: recordingUrl,
            ended_at: new Date().toISOString(),
            webhook_received_at: new Date().toISOString(),
            failure_reason: isSuccess ? null : providerStatus,
            metadata: {
              agent_id: payload.data?.agent_id ?? null,
              analysis: (payload.data?.analysis ?? null) as unknown,
              provider_metadata: (payload.data?.metadata ?? null) as unknown,
              has_audio: hasAudio,
              has_user_audio: rawData?.has_user_audio ?? null,
              has_response_audio: rawData?.has_response_audio ?? null,
            } as never,
          })
          .eq("id", callId);

        if (updErr) {
          await finish("failed", { code: "call_update", message: updErr.message });
          return new Response("update failed", { status: 500 });
        }

        let reconciliation: Awaited<ReturnType<typeof persistCallReconciliation>> | null = null;
        if (isSuccess && preCall?.final_outcome) {
          try {
            reconciliation = await persistCallReconciliation(callId);
          } catch (error) {
            const message = error instanceof Error ? error.message : "Reconciliation failed";
            await finish("failed", { code: "reconciliation_failed", message });
            return new Response("reconciliation failed", { status: 500 });
          }
        }

        await supabaseAdmin.from("agent_events").insert({
          negotiation_id: negotiationId,
          call_id: callId,
          agent_name: "elevenlabs",
          event_type: "post_call_transcription",
          event_status: isSuccess ? "success" : "failure",
          summary: isSuccess
            ? `Transcript received (${transcript.length} turns)`
            : `Call failed: ${providerStatus}`,
          metadata: {
            conversation_id: conversationId,
            status: providerStatus,
            reconciliation,
          },
        });

        await finish("completed");
        return new Response("ok", { status: 200 });
      },
    },
  },
});
