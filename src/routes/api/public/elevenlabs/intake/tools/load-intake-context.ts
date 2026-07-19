/**
 * Estimator agent tool: load-intake-context.
 *
 * Auth: X-BidPilot-Call-Token (SHA-256 hashed short-lived intake token minted
 * by `startVoiceIntake`). Rate-limited per token + per invalid-caller IP.
 * Returns customer name, canonical draft, completed/missing paths, allowed
 * enum values, priorities, and authority — never secrets or PII outside this
 * negotiation.
 */
import { createFileRoute } from "@tanstack/react-router";
import { createHash } from "crypto";
import { z } from "zod";

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
import { INTAKE_ALLOWED_PATHS, getAtPath } from "@/lib/intake-schema";
import { INTAKE_TOOL_ENUMS } from "@/lib/intake-patch";

const ENDPOINT = "load-intake-context";

const BodySchema = z
  .object({
    // ElevenLabs load_intake_context tool sends `{ "action": "load_intake_context" }`.
    // We accept only that exact value (or absence, for backward compatibility
    // with older no-body callers). Authorization NEVER depends on this field —
    // it is a routing hint. All identity comes from X-BidPilot-Call-Token.
    action: z.literal("load_intake_context").optional(),
    // The following fields are ignored for authorization. If provided they must
    // match the token; the auth helper enforces this and rejects mismatches.
    intake_session_id: z.string().uuid().optional(),
    negotiation_id: z.string().uuid().optional(),
  })
  .strict();

export const Route = createFileRoute("/api/public/elevenlabs/intake/tools/load-intake-context")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const rawToken = extractIntakeToken(request);
        if (!rawToken) {
          const rl = await checkInvalidAuthLimit(ENDPOINT, request, RATE_LIMITS[ENDPOINT].invalid);
          if (!rl.allowed) return rateLimitResponse(rl.retryAfter);
          return jsonResponse(401, { error: "missing_token" });
        }
        const preHash = createHash("sha256").update(rawToken).digest("hex");
        const rl = await checkValidCallerLimit(ENDPOINT, preHash, RATE_LIMITS[ENDPOINT].valid);
        if (!rl.allowed) return rateLimitResponse(rl.retryAfter);

        let body: z.infer<typeof BodySchema> = {};
        try {
          const parsed = (await request.json().catch(() => ({}))) ?? {};
          body = BodySchema.parse(parsed);
        } catch (e) {
          return jsonResponse(400, { error: "invalid_request", detail: (e as Error).message });
        }

        const auth = await authorizeIntakeToolRequest(request, {
          expectedSessionId: body.intake_session_id,
          expectedNegotiationId: body.negotiation_id,
          allowedStatuses: ["active"],
        });
        if (!auth.ok) return auth.response;

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: profile } = await supabaseAdmin
          .from("profiles")
          .select("full_name")
          .eq("id", auth.ctx.negotiation.user_id)
          .maybeSingle();
        const firstName = (profile?.full_name ?? "").trim().split(/\s+/)[0] || "there";

        const spec = auth.ctx.draft.specification;
        // Provenance is also how we distinguish an explicitly confirmed empty
        // list (for example no specialty items or no additional stops) from an
        // unanswered list.
        const provenance = auth.ctx.draft.field_provenance as Record<
          string,
          { source?: string; updated_at?: string } | undefined
        >;
        const completed: string[] = [];
        const missing: string[] = [];
        for (const p of INTAKE_ALLOWED_PATHS) {
          const v = getAtPath(spec, p);
          const explicitlyAnsweredEmptyArray =
            Array.isArray(v) && v.length === 0 && Boolean(provenance[p]?.source);
          const empty =
            v === undefined ||
            v === null ||
            v === "" ||
            (Array.isArray(v) && v.length === 0 && !explicitlyAnsweredEmptyArray);
          if (empty) missing.push(p);
          else completed.push(p);
        }

        // Provenance breakdown.
        const provenanceForSummary = provenance as Record<
          string,
          { source?: string; updated_at?: string } | undefined
        >;
        const documentDerived = Object.entries(provenanceForSummary)
          .filter(([, v]) => v && v.source === "document")
          .map(([k]) => k);

        // Build safe field_sources summary. Contains only what the agent needs
        // to describe a conflict accurately: path, current value, current
        // source, and unresolved document/voice alternatives. Deliberately
        // excludes token hashes, internal IDs, historical drafts, and metadata.
        const conflictByPath = new Map<string, { document?: unknown; voice?: unknown }>();
        for (const cRaw of auth.ctx.draft.conflicts) {
          const c = cRaw as {
            path?: string;
            resolved?: boolean;
            sources?: { source?: string; value?: unknown }[];
          };
          if (!c?.path || c.resolved) continue;
          const bucket = conflictByPath.get(c.path) ?? {};
          for (const s of c.sources ?? []) {
            if (s?.source === "document") bucket.document = s.value;
            if (s?.source === "voice") bucket.voice = s.value;
          }
          conflictByPath.set(c.path, bucket);
        }

        const fieldSources = completed.map((path) => {
          const prov = provenanceForSummary[path];
          const conflict = conflictByPath.get(path);
          return {
            path,
            value: getAtPath(spec, path),
            source: prov?.source ?? "unknown",
            document_alternative: conflict?.document,
            voice_alternative: conflict?.voice,
            has_conflict: Boolean(conflict),
          };
        });

        return jsonResponse(200, {
          customer_first_name: firstName,
          intake_session_id: auth.ctx.session.id,
          negotiation_id: auth.ctx.session.negotiation_id,
          draft_id: auth.ctx.draft.id,
          draft_revision: auth.ctx.draft.revision,
          specification: spec,
          completed_fields: completed,
          missing_fields: missing,
          document_derived_fields: documentDerived,
          field_sources: fieldSources,
          unresolved_conflicts: auth.ctx.draft.conflicts,
          supported_paths: INTAKE_ALLOWED_PATHS,
          enums: INTAKE_TOOL_ENUMS,
          write_contract: {
            preferred_shape: {
              path: "move_date",
              value: "2026-08-15",
              customer_confirmed: true,
              expected_revision: auth.ctx.draft.revision,
              idempotency_key: "unique-per-confirmed-save",
            },
            notes: [
              "Use only supported_paths.",
              "Write inventory, fragile_items, specialty_items, and additional_stops as complete JSON arrays.",
              "Use the revision returned by each successful save, or omit expected_revision.",
              "A conflict_recorded response means the voice value was preserved as a conflict, not applied.",
            ],
          },
        });
      },
    },
  },
});
