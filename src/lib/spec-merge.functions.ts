/**
 * Atomic document-merge for the JobSpec draft.
 *
 * Fixes the client-only merge race (upsert + refetch + autosave writing stale
 * blank values back over the merged draft). The full merge — apply patches,
 * update provenance, bump revision — happens in a single revision-guarded
 * server transaction. Client updates its cache with the returned draft.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { JobSpecDraftSchema, computeCompletion, type JobSpecDraft } from "./job-spec";
import { flattenLeafPaths } from "./intake-schema";

const PatchEntry = z.object({
  key: z.string().min(1).max(80),
  value: z.unknown(),
});

const InputSchema = z.object({
  negotiationId: z.string().uuid(),
  expectedRevision: z.number().int().nonnegative(),
  patches: z.array(PatchEntry).min(1).max(64),
  // Free-form marker so the caller can detect an idempotent replay.
  idempotencyKey: z.string().min(6).max(120).optional(),
  // Explicit resolution of prior conflict rows this merge answers.
  resolveConflictPaths: z.array(z.string()).optional(),
});

export type MergedDraftResult = {
  id: string;
  revision: number;
  updated_at: string;
  completion_percent: number;
  specification: JobSpecDraft;
  applied_keys: string[];
  rejected: { key: string; reason: string }[];
  resolved_conflict_paths: string[];
};

export const mergeSpecFromDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => InputSchema.parse(data))
  .handler(async ({ data, context }): Promise<MergedDraftResult> => {
    const { supabase, userId } = context;
    const { negotiationId, expectedRevision, patches } = data;

    // Ownership check — RLS on negotiations returns nothing for non-owners.
    const { data: neg, error: negErr } = await supabase
      .from("negotiations")
      .select("id, user_id")
      .eq("id", negotiationId)
      .maybeSingle();
    if (negErr) throw new Error(`Load negotiation failed: ${negErr.message}`);
    if (!neg || neg.user_id !== userId) throw new Error("Negotiation not found");

    // Load the current draft (revision, spec, provenance, conflicts).
    const { data: draftRow, error: draftErr } = await supabase
      .from("job_spec_drafts")
      .select("id, revision, specification, field_provenance, conflicts, updated_at")
      .eq("negotiation_id", negotiationId)
      .maybeSingle();
    if (draftErr) throw new Error(`Load draft failed: ${draftErr.message}`);

    const baseSpec: Record<string, unknown> =
      (draftRow?.specification as Record<string, unknown> | null) ?? {};
    const baseProv: Record<string, { source: string; updated_at: string }> =
      (draftRow?.field_provenance as never) ?? {};
    const baseConflicts: unknown[] = Array.isArray(draftRow?.conflicts)
      ? (draftRow!.conflicts as unknown[])
      : [];
    const baseRevision: number = draftRow?.revision ?? 0;

    if (baseRevision !== expectedRevision) {
      throw new Error(`stale_revision: expected ${expectedRevision}, server is at ${baseRevision}`);
    }

    // Apply patches. Reject unknown top-level keys against the schema shape.
    const allowedKeys = new Set(Object.keys(JobSpecDraftSchema.shape));
    const merged: Record<string, unknown> = { ...baseSpec };
    const applied: string[] = [];
    const rejected: { key: string; reason: string }[] = [];
    const now = new Date().toISOString();
    const nextProv = { ...baseProv };

    for (const p of patches) {
      if (!allowedKeys.has(p.key)) {
        rejected.push({ key: p.key, reason: "unknown_field" });
        continue;
      }
      if (p.key === "__proto__" || p.key === "constructor" || p.key === "prototype") {
        rejected.push({ key: p.key, reason: "forbidden_key" });
        continue;
      }
      merged[p.key] = p.value;
      for (const path of flattenLeafPaths(p.value, p.key)) {
        nextProv[path] = { source: "document", updated_at: now };
      }
      applied.push(p.key);
    }

    if (applied.length === 0) {
      throw new Error("No valid patches to apply");
    }

    // Full validation of the merged draft. Reject the whole merge if invalid.
    const parsed = JobSpecDraftSchema.safeParse(merged);
    if (!parsed.success) {
      const issues = parsed.error.issues
        .slice(0, 6)
        .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
        .join("; ");
      throw new Error(`Merged draft failed validation — ${issues}`);
    }

    // Mark any prior conflicts that the merge resolves.
    const resolvePaths = new Set(data.resolveConflictPaths ?? applied);
    const nextConflicts = baseConflicts.map((c) => {
      const rec = c as Record<string, unknown>;
      const path = typeof rec.path === "string" ? rec.path : "";
      const topKey = path.split(".")[0];
      if (!rec.resolved && (resolvePaths.has(path) || resolvePaths.has(topKey))) {
        return {
          ...rec,
          resolved: true,
          resolved_at: now,
          resolution: "accept_document",
        };
      }
      return rec;
    });

    const completion = computeCompletion(parsed.data);
    const nextRevision = baseRevision + 1;

    // Revision-guarded write. Insert path first when no draft exists;
    // otherwise CAS update — bail if the row moved under us.
    if (!draftRow) {
      const { data: inserted, error: insErr } = await supabase
        .from("job_spec_drafts")
        .insert({
          negotiation_id: negotiationId,
          specification: parsed.data as unknown as never,
          completion_percent: completion,
          revision: nextRevision,
          field_provenance: nextProv as unknown as never,
          conflicts: nextConflicts as unknown as never,
        })
        .select("id, revision, updated_at, completion_percent, specification")
        .single();
      if (insErr) throw new Error(`Insert failed: ${insErr.message}`);
      return {
        id: inserted.id,
        revision: inserted.revision,
        updated_at: inserted.updated_at as string,
        completion_percent: inserted.completion_percent,
        specification: parsed.data,
        applied_keys: applied,
        rejected,
        resolved_conflict_paths: [...resolvePaths],
      };
    }

    const { data: updated, error: updErr } = await supabase
      .from("job_spec_drafts")
      .update({
        specification: parsed.data as unknown as never,
        completion_percent: completion,
        revision: nextRevision,
        field_provenance: nextProv as unknown as never,
        conflicts: nextConflicts as unknown as never,
      })
      .eq("id", draftRow.id)
      .eq("revision", baseRevision)
      .select("id, revision, updated_at, completion_percent, specification")
      .maybeSingle();
    if (updErr) throw new Error(`Update failed: ${updErr.message}`);
    if (!updated) {
      // Row moved — another writer bumped the revision between our read and
      // write. Surface as stale so the client can reload and retry.
      throw new Error("stale_revision: draft changed during merge");
    }

    // Audit event (non-fatal).
    await supabase.from("agent_events").insert({
      negotiation_id: negotiationId,
      agent_name: "system",
      event_type: "spec_document_merge",
      event_status: "success",
      summary: `${applied.length} field(s) merged from document`,
      metadata: {
        applied,
        rejected,
        revision: updated.revision,
        idempotency_key: data.idempotencyKey ?? null,
      },
    });

    return {
      id: updated.id,
      revision: updated.revision,
      updated_at: updated.updated_at as string,
      completion_percent: updated.completion_percent,
      specification: parsed.data,
      applied_keys: applied,
      rejected,
      resolved_conflict_paths: [...resolvePaths],
    };
  });
