/**
 * Estimator tool: finalize-intake-session.
 *
 * Ends the data-collection phase without confirming the specification. The
 * tool is intentionally tolerant: ElevenLabs may provide only an action and
 * system conversation id, while the signed post-call webhook later enriches
 * transcript and recording metadata. Existing captured/unresolved fields are
 * merged, never replaced with empty arrays.
 */
import { createFileRoute } from "@tanstack/react-router";
import { createHash } from "crypto";

import {
  RATE_LIMITS,
  checkInvalidAuthLimit,
  checkValidCallerLimit,
  rateLimitResponse,
} from "@/lib/rate-limit.server";
import {
  authorizeIntakeToolRequest,
  extractIntakeToken,
  jsonResponse,
} from "@/lib/intake-token.server";
import {
  mergeIntakeFieldLists,
  parseFinalizeIntakeBody,
  type FinalizeIntakeBody,
} from "@/lib/intake-finalize";

const ENDPOINT = "finalize-intake-session";

export const Route = createFileRoute("/api/public/elevenlabs/intake/tools/finalize-intake-session")(
  {
    server: {
      handlers: {
        POST: async ({ request }) => {
          const rawToken = extractIntakeToken(request);
          if (!rawToken) {
            const limit = await checkInvalidAuthLimit(
              ENDPOINT,
              request,
              RATE_LIMITS[ENDPOINT].invalid,
            );
            if (!limit.allowed) return rateLimitResponse(limit.retryAfter);
            return jsonResponse(401, { error: "missing_token" });
          }

          const preHash = createHash("sha256").update(rawToken).digest("hex");
          const limit = await checkValidCallerLimit(ENDPOINT, preHash, RATE_LIMITS[ENDPOINT].valid);
          if (!limit.allowed) return rateLimitResponse(limit.retryAfter);

          let body: FinalizeIntakeBody;
          try {
            body = parseFinalizeIntakeBody((await request.json().catch(() => ({}))) ?? {});
          } catch (error) {
            return jsonResponse(400, {
              error: "invalid_request",
              detail: error instanceof Error ? error.message : "Invalid request",
            });
          }

          const auth = await authorizeIntakeToolRequest(request, {
            expectedSessionId: body.intake_session_id,
            expectedNegotiationId: body.negotiation_id,
            allowedStatuses: ["active", "completed", "interrupted"],
          });
          if (!auth.ok) return auth.response;

          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { data: current, error: currentError } = await supabaseAdmin
            .from("intake_sessions")
            .select(
              "status, conversation_id, transcript, recording_url, captured_fields, unresolved_fields, summary, ended_at, webhook_received_at, post_processing_status",
            )
            .eq("id", auth.ctx.session.id)
            .maybeSingle();
          if (currentError || !current) {
            return jsonResponse(500, {
              error: "session_load_failed",
              detail: currentError?.message ?? "Session not found",
            });
          }

          const capturedFields = mergeIntakeFieldLists(
            current.captured_fields,
            body.captured_fields,
          );
          const unresolvedFields = mergeIntakeFieldLists(
            current.unresolved_fields,
            body.unresolved_fields,
          ).filter((path) => !capturedFields.includes(path));
          const conversationId = body.conversation_id ?? current.conversation_id ?? null;
          const transcript =
            body.transcript && body.transcript.length > 0 ? body.transcript : current.transcript;
          const recordingUrl = body.recording_url ?? current.recording_url ?? null;
          const now = new Date().toISOString();
          const completedWithErrors = Boolean(body.completed_with_errors);

          // Idempotent finalization. Repeated calls may enrich summary/ids but
          // never erase transcript, capture state, or recording references.
          const update = {
            status: "completed",
            conversation_id: conversationId,
            transcript: transcript as never,
            captured_fields: capturedFields as never,
            unresolved_fields: unresolvedFields as never,
            summary:
              body.summary ??
              current.summary ??
              (completedWithErrors
                ? "Voice intake ended with tool errors; review unresolved fields."
                : "Voice intake completed; review and confirm the draft."),
            recording_url: recordingUrl,
            ended_at: current.ended_at ?? now,
            post_processing_status: current.webhook_received_at ? "completed" : "pending",
          } as const;

          const { error: updateError } = await supabaseAdmin
            .from("intake_sessions")
            .update(update)
            .eq("id", auth.ctx.session.id);
          if (updateError) {
            return jsonResponse(500, {
              error: "update_failed",
              detail: updateError.message,
            });
          }

          await supabaseAdmin.from("agent_events").insert({
            negotiation_id: auth.ctx.session.negotiation_id,
            agent_name: "elevenlabs_estimator",
            event_type: "intake_session_finalized",
            event_status:
              completedWithErrors || unresolvedFields.length > 0 ? "warning" : "success",
            summary: `Voice intake finalized (${capturedFields.length} captured, ${unresolvedFields.length} unresolved)`,
            metadata: {
              session_id: auth.ctx.session.id,
              conversation_id: conversationId,
              has_recording: Boolean(recordingUrl),
              transcript_turns: Array.isArray(transcript) ? transcript.length : 0,
              completed_with_errors: completedWithErrors,
              post_call_pending: !current.webhook_received_at,
            },
          });

          return jsonResponse(200, {
            ok: true,
            status: "completed",
            session_id: auth.ctx.session.id,
            conversation_id: conversationId,
            finalized_at: current.ended_at ?? now,
            captured_fields: capturedFields,
            unresolved_fields: unresolvedFields,
            post_call_pending: !current.webhook_received_at,
            spec_confirmed: false,
          });
        },
      },
    },
  },
);
