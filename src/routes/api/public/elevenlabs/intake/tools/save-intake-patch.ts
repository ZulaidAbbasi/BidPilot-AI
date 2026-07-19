/**
 * Estimator tool: save-intake-patch.
 *
 * Accepts batch, single-field, or JSON-string payloads from ElevenLabs,
 * validates them against the real JobSpecDraft schema, preserves document/
 * manual conflicts, updates completion, and records a complete audit trail.
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
import { computeCompletion } from "@/lib/job-spec";
import { getAtPath, setAtPath } from "@/lib/intake-schema";
import {
  parseIntakePatchBody,
  validateAndNormalizePatches,
  validateDraftAfterPatches,
} from "@/lib/intake-patch";

const ENDPOINT = "save-intake-patch";

function redactBody(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const clone: Record<string, unknown> = { ...(raw as Record<string, unknown>) };
  for (const key of Object.keys(clone)) {
    if (/token|secret|authorization|bearer/i.test(key)) clone[key] = "[REDACTED]";
  }
  return clone;
}

export const Route = createFileRoute("/api/public/elevenlabs/intake/tools/save-intake-patch")({
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

        const rawBodyText = await request.text().catch(() => "");
        let rawJson: unknown = {};
        try {
          rawJson = rawBodyText ? JSON.parse(rawBodyText) : {};
        } catch {
          rawJson = { __unparseable_body__: rawBodyText.slice(0, 500) };
        }

        let parsed;
        try {
          parsed = validateAndNormalizePatches(parseIntakePatchBody(rawJson));
        } catch (error) {
          const rejected =
            error && typeof error === "object" && "rejected" in error
              ? (error as { rejected?: unknown }).rejected
              : undefined;
          const detail = error instanceof Error ? error.message : "Invalid request";
          const code =
            error && typeof error === "object" && "code" in error
              ? String((error as { code?: unknown }).code ?? "invalid_request")
              : "invalid_request";
          return jsonResponse(400, {
            error: code,
            detail,
            rejected,
          });
        }

        const auth = await authorizeIntakeToolRequest(request, {
          expectedSessionId: parsed.intake_session_id,
          expectedNegotiationId: parsed.negotiation_id,
          allowedStatuses: ["active"],
        });
        if (!auth.ok) return auth.response;

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const logFailure = async (reason: string, detail: unknown) => {
          await supabaseAdmin
            .from("agent_events")
            .insert({
              negotiation_id: auth.ctx.session.negotiation_id,
              agent_name: "elevenlabs_estimator",
              event_type: "intake_patch_failed",
              event_status: "error",
              summary: `save_intake_patch rejected: ${reason}`,
              metadata: {
                session_id: auth.ctx.session.id,
                reason,
                detail: JSON.parse(JSON.stringify(detail ?? null)),
                body: JSON.parse(JSON.stringify(redactBody(rawJson) ?? null)),
                server_revision: auth.ctx.draft.revision,
              } as never,
            })
            .then(
              () => undefined,
              () => undefined,
            );
        };

        const idemInput =
          parsed.idempotency_key ??
          `${auth.ctx.session.id}:${parsed.patches
            .map((patch) => `${patch.path}=${JSON.stringify(patch.value)}`)
            .join("|")}`;
        const idemHash = createHash("sha256")
          .update(`${auth.ctx.session.id}:${idemInput}`)
          .digest("hex");

        const { data: prior } = await supabaseAdmin
          .from("agent_events")
          .select("metadata")
          .eq("negotiation_id", auth.ctx.session.negotiation_id)
          .eq("event_type", "intake_patch_applied")
          .filter("metadata->>idem_hash", "eq", idemHash)
          .maybeSingle();
        if (prior) {
          const metadata = (prior.metadata ?? {}) as Record<string, unknown>;
          return jsonResponse(200, {
            ok: true,
            status: "idempotent_replay",
            idempotent_replay: true,
            revision:
              typeof metadata.revision === "number" ? metadata.revision : auth.ctx.draft.revision,
            applied: Array.isArray(metadata.applied_paths) ? metadata.applied_paths : [],
            conflicts: [],
          });
        }

        const expectedRevision = parsed.expected_revision ?? auth.ctx.draft.revision;
        if (expectedRevision !== auth.ctx.draft.revision) {
          await logFailure("stale_revision", {
            client_revision: expectedRevision,
            server_revision: auth.ctx.draft.revision,
          });
          return jsonResponse(409, {
            error: "stale_revision",
            server_revision: auth.ctx.draft.revision,
            retryable: true,
            hint: "Call load_intake_context once, then retry with the returned draft_revision or omit expected_revision.",
          });
        }

        const now = new Date().toISOString();
        let specification = { ...auth.ctx.draft.specification };
        const provenance = {
          ...(auth.ctx.draft.field_provenance as Record<string, unknown>),
        };
        const conflicts = Array.isArray(auth.ctx.draft.conflicts)
          ? [...auth.ctx.draft.conflicts]
          : [];
        const applied: string[] = [];
        const writtenPatches: { path: string; value: unknown }[] = [];
        const newConflicts: unknown[] = [];

        for (const patch of parsed.patches) {
          const existing = getAtPath(specification, patch.path);
          const existingProvenance = provenance[patch.path] as
            | {
                source?: string;
                updated_at?: string;
                origin_ref?: string;
                voice_confirmed_at?: string;
                voice_session_id?: string;
              }
            | undefined;
          const differs = JSON.stringify(existing) !== JSON.stringify(patch.value);
          const hasProtectedExistingValue =
            existing !== undefined &&
            existing !== null &&
            existing !== "" &&
            existingProvenance?.source &&
            existingProvenance.source !== "voice";

          if (hasProtectedExistingValue && differs && !patch.conflict_decision) {
            newConflicts.push({
              path: patch.path,
              detected_at: now,
              intake_session_id: auth.ctx.session.id,
              sources: [
                {
                  source: existingProvenance.source,
                  value: existing,
                  at: existingProvenance.updated_at,
                },
                { source: "voice", value: patch.value, at: now },
              ],
              resolved: false,
            });
            continue;
          }

          if (
            hasProtectedExistingValue &&
            differs &&
            patch.conflict_decision &&
            patch.conflict_decision !== "accept_voice"
          ) {
            // The customer chose the current manual/document value. Resolve
            // the conflict without replacing it with the proposed voice value.
            const existingConflictIndex = conflicts.findIndex((conflict) => {
              const row = conflict as { path?: string; resolved?: boolean };
              return row.path === patch.path && !row.resolved;
            });
            if (existingConflictIndex >= 0) {
              const row = conflicts[existingConflictIndex] as Record<string, unknown>;
              row.resolved = true;
              row.resolved_at = now;
              row.resolution = patch.conflict_decision;
            }
            applied.push(patch.path);
            continue;
          }

          specification = setAtPath(specification, patch.path, patch.value);
          provenance[patch.path] =
            !differs && existingProvenance?.source && existingProvenance.source !== "voice"
              ? {
                  ...existingProvenance,
                  voice_confirmed_at: now,
                  voice_session_id: auth.ctx.session.id,
                }
              : {
                  source: "voice",
                  updated_at: now,
                  origin_ref: auth.ctx.session.id,
                };
          applied.push(patch.path);
          writtenPatches.push({ path: patch.path, value: patch.value });

          const existingConflictIndex = conflicts.findIndex((conflict) => {
            const row = conflict as { path?: string; resolved?: boolean };
            return row.path === patch.path && !row.resolved;
          });
          if (existingConflictIndex >= 0) {
            const row = conflicts[existingConflictIndex] as Record<string, unknown>;
            row.resolved = true;
            row.resolved_at = now;
            row.resolution = patch.conflict_decision ?? "accept_voice";
          }
        }

        let validatedSpecification;
        try {
          validatedSpecification = validateDraftAfterPatches(
            auth.ctx.draft.specification,
            writtenPatches,
          );
        } catch (error) {
          await logFailure("invalid_value", error instanceof Error ? error.message : error);
          return jsonResponse(422, {
            error: "invalid_value",
            detail: error instanceof Error ? error.message : "Draft validation failed",
          });
        }

        // If every requested value became a conflict, preserve the existing
        // validated draft and only append conflict records.
        if (applied.length === 0) {
          validatedSpecification = auth.ctx.draft.specification as never;
        }

        const nextRevision = auth.ctx.draft.revision + 1;
        const mergedConflicts = [...conflicts, ...newConflicts];
        const completionPercent = computeCompletion(validatedSpecification);

        const { data: updated, error: updateError } = await supabaseAdmin
          .from("job_spec_drafts")
          .update({
            specification: validatedSpecification as never,
            field_provenance: provenance as never,
            conflicts: mergedConflicts as never,
            completion_percent: completionPercent,
            revision: nextRevision,
            updated_at: now,
          })
          .eq("id", auth.ctx.draft.id)
          .eq("revision", auth.ctx.draft.revision)
          .select("revision, completion_percent")
          .maybeSingle();

        if (updateError) {
          await logFailure("update_failed", updateError.message);
          return jsonResponse(500, { error: "update_failed", detail: updateError.message });
        }
        if (!updated) {
          await logFailure("stale_revision_at_write", {
            expected: auth.ctx.draft.revision,
          });
          return jsonResponse(409, {
            error: "stale_revision",
            retryable: true,
          });
        }

        const conflictPaths = newConflicts
          .map((conflict) => (conflict as { path?: string }).path)
          .filter((path): path is string => typeof path === "string");

        const { data: sessionState } = await supabaseAdmin
          .from("intake_sessions")
          .select("captured_fields, unresolved_fields")
          .eq("id", auth.ctx.session.id)
          .maybeSingle();
        const previousCaptured = Array.isArray(sessionState?.captured_fields)
          ? (sessionState.captured_fields as string[])
          : [];
        const previousUnresolved = Array.isArray(sessionState?.unresolved_fields)
          ? (sessionState.unresolved_fields as string[])
          : [];
        const capturedFields = Array.from(new Set([...previousCaptured, ...applied]));
        const unresolvedFields = Array.from(
          new Set([...previousUnresolved, ...conflictPaths]),
        ).filter((path) => !capturedFields.includes(path));

        const { error: sessionError } = await supabaseAdmin
          .from("intake_sessions")
          .update({
            captured_fields: capturedFields as never,
            unresolved_fields: unresolvedFields as never,
            updated_at: now,
          })
          .eq("id", auth.ctx.session.id);

        await supabaseAdmin.from("agent_events").insert({
          negotiation_id: auth.ctx.session.negotiation_id,
          agent_name: "elevenlabs_estimator",
          event_type: "intake_patch_applied",
          event_status: sessionError ? "warning" : "success",
          summary: `${applied.length} field(s) captured${
            newConflicts.length ? `, ${newConflicts.length} conflict(s)` : ""
          }`,
          metadata: {
            idem_hash: idemHash,
            session_id: auth.ctx.session.id,
            applied_paths: applied,
            conflict_paths: conflictPaths,
            revision: updated.revision,
            completion_percent: updated.completion_percent,
            session_progress_error: sessionError?.message ?? null,
          },
        });

        return jsonResponse(200, {
          ok: true,
          status: newConflicts.length
            ? applied.length
              ? "applied_with_conflicts"
              : "conflict_recorded"
            : "applied",
          revision: updated.revision,
          completion_percent: updated.completion_percent,
          applied,
          conflicts: newConflicts,
          captured_fields: capturedFields,
          unresolved_fields: unresolvedFields,
          retryable: false,
        });
      },
    },
  },
});
