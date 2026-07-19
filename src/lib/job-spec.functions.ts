/**
 * Server-side JobSpec confirmation.
 *
 * Clients cannot insert into `job_specs` directly (RLS write policies removed
 * — see migration). This function is the only path to a confirmed
 * specification: it authenticates the caller, verifies negotiation ownership,
 * validates the draft against the strict schema, canonicalizes + hashes the
 * spec server-side, allocates the next sequential version safely under
 * concurrent callers, inserts the immutable record, advances workflow status,
 * and writes an agent event.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { validateForConfirm } from "./job-spec-validation";
import { canonicalizeAndHash } from "./job-spec-canonical";

const InputSchema = z.object({ negotiationId: z.string().uuid() });

const MAX_VERSION_RETRIES = 5;

export const confirmJobSpec = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => InputSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const negotiationId = data.negotiationId;

    // 1–2. Ownership and draft reads are independent, so load them together.
    // If the user doesn't own the negotiation, RLS returns no negotiation row
    // — treat as 404 to avoid leaking existence.
    const [negotiationResult, draftResult] = await Promise.all([
      supabase
        .from("negotiations")
        .select("id, user_id, workflow_status")
        .eq("id", negotiationId)
        .maybeSingle(),
      supabase
        .from("job_spec_drafts")
        .select("specification")
        .eq("negotiation_id", negotiationId)
        .maybeSingle(),
    ]);

    const { data: negotiation, error: negErr } = negotiationResult;
    if (negErr) throw new Error(`Failed to load negotiation: ${negErr.message}`);
    if (!negotiation) throw new Error("Negotiation not found");
    if (negotiation.user_id !== userId) throw new Error("Negotiation not found");

    const { data: draftRow, error: draftErr } = draftResult;
    if (draftErr) throw new Error(`Failed to load draft: ${draftErr.message}`);
    if (!draftRow) throw new Error("No draft to confirm");

    // 3. Strict validation — shared canonical validator. Review, the
    //    Confirm dialog, and this server path all agree because they consult
    //    exactly this function on the sanitized draft.
    const parseResult = validateForConfirm(draftRow.specification as never);
    if (!parseResult.ok) {
      const issues = parseResult.issues
        .slice(0, 5)
        .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
        .join("; ");
      throw new Error(`Draft is incomplete or invalid — ${issues}`);
    }
    const spec = parseResult.spec;


    // 4. Canonicalize + hash server-side. The client never supplies the hash.
    const { canonical, hash } = await canonicalizeAndHash(spec);
    const canonicalSpec = JSON.parse(canonical);
    const confirmedAt = new Date().toISOString();

    // 5. Privileged writes: allocate next version, insert immutable row,
    // update workflow, log event. RLS write policies on job_specs are
    // removed; only service_role can insert.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    let insertedVersion: number | null = null;
    let insertedId: string | null = null;
    let lastConflict: string | null = null;

    for (let attempt = 0; attempt < MAX_VERSION_RETRIES; attempt++) {
      const { data: maxRow, error: maxErr } = await supabaseAdmin
        .from("job_specs")
        .select("id, version, specification_hash")
        .eq("negotiation_id", negotiationId)
        .eq("confirmed", true)
        .order("version", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (maxErr) throw new Error(`Version lookup failed: ${maxErr.message}`);

      if (maxRow?.specification_hash === hash) {
        insertedId = maxRow.id;
        insertedVersion = maxRow.version;
        break;
      }

      const nextVersion = (maxRow?.version ?? 0) + 1;

      const { data: inserted, error: insertErr } = await supabaseAdmin
        .from("job_specs")
        .insert({
          negotiation_id: negotiationId,
          version: nextVersion,
          specification: canonicalSpec,
          specification_hash: hash,
          confirmed: true,
          confirmed_at: confirmedAt,
          confirmed_by: userId,
        })
        .select("id, version")
        .single();

      if (!insertErr && inserted) {
        insertedId = inserted.id;
        insertedVersion = inserted.version;
        break;
      }
      // 23505 = unique_violation on (negotiation_id, version). A concurrent
      // caller won the race — retry with a fresh MAX() read.
      if (insertErr && "code" in insertErr && insertErr.code === "23505") {
        lastConflict = insertErr.message;
        continue;
      }
      throw new Error(`Confirm insert failed: ${insertErr?.message ?? "unknown"}`);
    }

    if (insertedId === null || insertedVersion === null) {
      throw new Error(
        `Could not allocate a version after ${MAX_VERSION_RETRIES} attempts: ${lastConflict ?? "conflict"}`,
      );
    }

    // 6. Advance workflow status. Keep it idempotent — if it's already at or
    // past SPEC_CONFIRMED we still allow revisions (each revision creates a
    // new version but resets status back to SPEC_CONFIRMED).
    const [statusResult, eventResult] = await Promise.all([
      supabaseAdmin
        .from("negotiations")
        .update({ workflow_status: "SPEC_CONFIRMED" })
        .eq("id", negotiationId),
      supabaseAdmin.from("agent_events").insert({
        negotiation_id: negotiationId,
        agent_name: "system",
        event_type: "spec_confirmed",
        event_status: "success",
        summary: `Specification v${insertedVersion} confirmed`,
        metadata: {
          version: insertedVersion,
          hash,
          confirmed_by: userId,
        },
      }),
    ]);
    if (statusResult.error) {
      throw new Error(`Workflow update failed: ${statusResult.error.message}`);
    }

    // 7. Agent event — non-fatal if it fails, but log it.
    const eventErr = eventResult.error;
    if (eventErr) {
      console.error("agent_events insert failed", eventErr);
    }

    return {
      id: insertedId,
      version: insertedVersion,
      hash,
      confirmed_at: confirmedAt,
    };
  });
