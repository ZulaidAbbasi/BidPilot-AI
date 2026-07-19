/**
 * Challenge Phase 1 — Voice Intake E2E.
 *
 * Runs against the live dev server. Seeds a user, negotiation, and draft with
 * a manually captured field, then exercises the three Estimator webhook tools
 * via `X-BidPilot-Call-Token` and asserts:
 *
 *   1. Manual, document (simulated via provenance=document), and voice writes
 *      all land on the SAME job_spec_drafts row.
 *   2. `load-intake-context` reflects captured/missing fields and provenance.
 *   3. `save-intake-patch` requires customer_confirmed, rejects prototype
 *      paths, rejects unknown paths, rejects stale revisions, and dedupes
 *      via idempotency_key.
 *   4. Voice value that disagrees with an existing manual value is NOT
 *      silently overwritten — a structured conflict is recorded and the
 *      manual value stays; explicit conflict_decision resolves it.
 *   5. Cross-session, cross-user, and expired tokens are rejected.
 *   6. `finalize-intake-session` stores conversation ID, transcript, recording
 *      URL, captured/unresolved fields, and does NOT confirm or hash the spec.
 *   7. The negotiation still has no confirmed job_specs row after finalize.
 */
import { createClient } from "@supabase/supabase-js";
import { createHash, randomBytes, randomUUID } from "crypto";

const BASE = process.env.BIDPILOT_TEST_BASE_URL ?? "http://localhost:8080";
const SUPABASE_URL = process.env.SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
  process.exit(1);
}

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const results: { name: string; ok: boolean; detail?: string }[] = [];
function record(name: string, ok: boolean, detail?: string) {
  results.push({ name, ok, detail });
  const tag = ok ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m";
  console.log(`  ${tag} ${name}${!ok && detail ? `  — ${detail}` : ""}`);
}

function sha256Hex(s: string) {
  return createHash("sha256").update(s).digest("hex");
}

async function post(
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<{ status: number; json: Record<string, unknown> | null; text: string }> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json: Record<string, unknown> | null = null;
  try {
    json = text ? (JSON.parse(text) as Record<string, unknown>) : null;
  } catch {
    /* non-JSON */
  }
  return { status: res.status, json, text };
}

async function mintToken(
  sessionId: string,
  negotiationId: string,
  userId: string,
  ttlSeconds = 3600,
): Promise<string> {
  const raw = randomBytes(32).toString("hex");
  const expires = new Date(Date.now() + ttlSeconds * 1000).toISOString();
  const { error } = await admin.from("intake_tool_tokens").insert({
    session_id: sessionId,
    negotiation_id: negotiationId,
    user_id: userId,
    token_hash: sha256Hex(raw),
    expires_at: expires,
  });
  if (error) throw new Error(`token mint failed: ${error.message}`);
  return raw;
}

async function main() {
  console.log(`\n▶ Voice Intake E2E — ${BASE}\n`);
  const runId = randomBytes(4).toString("hex");
  const futureDate = new Date(Date.now() + 30 * 86400 * 1000).toISOString().slice(0, 10);

  // === Seed primary user + negotiation + draft ===
  const email = `e2e-voice-${runId}@bidpilot.test`;
  const { data: u, error: uErr } = await admin.auth.admin.createUser({
    email,
    password: randomBytes(16).toString("hex"),
    email_confirm: true,
    user_metadata: { full_name: "Alice Voice" },
  });
  if (uErr || !u.user) throw new Error(`createUser failed: ${uErr?.message}`);
  const userId = u.user.id;

  const negotiationId = randomUUID();
  await admin
    .from("negotiations")
    .insert({
      id: negotiationId,
      user_id: userId,
      title: `voice-intake-${runId}`,
      origin_address: "Manual Origin",
      destination_address: "Manual Destination",
      moving_date: futureDate,
      bedroom_count: 2,
      vertical: "moving",
      workflow_status: "DRAFT",
    })
    .throwOnError();

  // Seed the draft with a MANUAL field and a DOCUMENT-derived field.
  const now = new Date().toISOString();
  const { data: draftRow, error: dErr } = await admin
    .from("job_spec_drafts")
    .insert({
      negotiation_id: negotiationId,
      specification: {
        origin: { city: "Boston" },
        bedrooms: 2,
      },
      field_provenance: {
        "origin.city": { source: "manual", updated_at: now },
        bedrooms: { source: "document", updated_at: now, origin_ref: "doc_abc" },
      },
      revision: 0,
    })
    .select("id, revision")
    .single();
  if (dErr || !draftRow) throw new Error(`draft insert failed: ${dErr?.message}`);
  const draftId = draftRow.id;

  // Create session + mint token.
  const { data: sessionRow, error: sErr } = await admin
    .from("intake_sessions")
    .insert({
      negotiation_id: negotiationId,
      draft_id: draftId,
      user_id: userId,
      status: "active",
    })
    .select("id")
    .single();
  if (sErr || !sessionRow) throw new Error(`session insert failed: ${sErr?.message}`);
  const sessionId = sessionRow.id;
  const token = await mintToken(sessionId, negotiationId, userId);

  // === 1. load-intake-context returns draft + provenance ===
  {
    const r = await post(
      "/api/public/elevenlabs/intake/tools/load-intake-context",
      { intake_session_id: sessionId, negotiation_id: negotiationId },
      { "X-BidPilot-Call-Token": token },
    );
    const ok =
      r.status === 200 &&
      Array.isArray(r.json?.completed_fields) &&
      (r.json?.completed_fields as string[]).includes("origin.city") &&
      Array.isArray(r.json?.missing_fields) &&
      (r.json?.missing_fields as string[]).includes("moving_date") &&
      Array.isArray(r.json?.document_derived_fields) &&
      (r.json?.document_derived_fields as string[]).includes("bedrooms") &&
      (r.json?.customer_first_name as string) === "Alice";
    record("load-intake-context returns draft, provenance, first name", ok, r.text.slice(0, 200));
  }

  // === 2. save-intake-patch rejects missing token ===
  {
    const r = await post("/api/public/elevenlabs/intake/tools/save-intake-patch", {
      intake_session_id: sessionId,
      expected_revision: 0,
      idempotency_key: `noauth-${runId}`,
      patches: [{ path: "notes", value: "x", customer_confirmed: true }],
    });
    record("save-intake-patch rejects missing token (401)", r.status === 401, `status=${r.status}`);
  }

  // === 3. save-intake-patch rejects prototype-pollution path ===
  {
    const r = await post(
      "/api/public/elevenlabs/intake/tools/save-intake-patch",
      {
        intake_session_id: sessionId,
        expected_revision: 0,
        idempotency_key: `proto-${runId}`,
        patches: [{ path: "__proto__.polluted", value: true, customer_confirmed: true }],
      },
      { "X-BidPilot-Call-Token": token },
    );
    record(
      "save-intake-patch rejects __proto__ path (400)",
      r.status === 400 && r.json?.error === "invalid_patch",
      r.text.slice(0, 160),
    );
  }

  // === 4. save-intake-patch rejects unknown path ===
  {
    const r = await post(
      "/api/public/elevenlabs/intake/tools/save-intake-patch",
      {
        intake_session_id: sessionId,
        expected_revision: 0,
        idempotency_key: `unknown-${runId}`,
        patches: [{ path: "made_up_field", value: 1, customer_confirmed: true }],
      },
      { "X-BidPilot-Call-Token": token },
    );
    record("save-intake-patch rejects unknown path (400)", r.status === 400, r.text.slice(0, 160));
  }

  // === 5. save-intake-patch rejects customer_confirmed=false ===
  {
    const r = await post(
      "/api/public/elevenlabs/intake/tools/save-intake-patch",
      {
        intake_session_id: sessionId,
        expected_revision: 0,
        idempotency_key: `unconfirmed-${runId}`,
        patches: [{ path: "notes", value: "x", customer_confirmed: false }],
      },
      { "X-BidPilot-Call-Token": token },
    );
    record(
      "save-intake-patch requires customer_confirmed (400)",
      r.status === 400,
      r.text.slice(0, 160),
    );
  }

  // === 6. Apply a new voice field ===
  let revision = 0;
  {
    const r = await post(
      "/api/public/elevenlabs/intake/tools/save-intake-patch",
      {
        intake_session_id: sessionId,
        expected_revision: 0,
        idempotency_key: `apply-postal-${runId}`,
        patches: [
          { path: "origin.postal_code", value: "02118", customer_confirmed: true },
          { path: "moving_date", value: futureDate, customer_confirmed: true },
        ],
      },
      { "X-BidPilot-Call-Token": token },
    );
    const applied = (r.json?.applied as string[]) ?? [];
    const ok =
      r.status === 200 &&
      applied.includes("origin.postal_code") &&
      applied.includes("moving_date") &&
      typeof r.json?.revision === "number" &&
      (r.json?.revision as number) === 1;
    revision = (r.json?.revision as number) ?? 0;
    record(
      "save-intake-patch applies voice fields on same draft (revision→1)",
      ok,
      r.text.slice(0, 200),
    );
  }

  // === 7. Same-draft assertion ===
  {
    const { data: d } = await admin
      .from("job_spec_drafts")
      .select("id, specification, field_provenance")
      .eq("negotiation_id", negotiationId);
    const spec = (d?.[0]?.specification ?? {}) as Record<string, unknown>;
    const prov = (d?.[0]?.field_provenance ?? {}) as Record<string, { source: string }>;
    const origin = (spec.origin ?? {}) as Record<string, unknown>;
    const ok =
      d?.length === 1 &&
      d[0]!.id === draftId &&
      origin.city === "Boston" &&
      origin.postal_code === "02118" &&
      prov["origin.city"]?.source === "manual" &&
      prov["origin.postal_code"]?.source === "voice" &&
      prov.bedrooms?.source === "document";
    record("manual, document, and voice writes share the same draft", ok);
  }

  // === 8. Idempotency replay ===
  {
    const r = await post(
      "/api/public/elevenlabs/intake/tools/save-intake-patch",
      {
        intake_session_id: sessionId,
        expected_revision: 999, // wrong on purpose; idempotency wins
        idempotency_key: `apply-postal-${runId}`,
        patches: [{ path: "origin.postal_code", value: "02118", customer_confirmed: true }],
      },
      { "X-BidPilot-Call-Token": token },
    );
    record(
      "save-intake-patch is idempotent by (session, idempotency_key)",
      r.status === 200 && r.json?.idempotent_replay === true,
      r.text.slice(0, 160),
    );
  }

  // === 9. Stale revision rejected ===
  {
    const r = await post(
      "/api/public/elevenlabs/intake/tools/save-intake-patch",
      {
        intake_session_id: sessionId,
        expected_revision: 0,
        idempotency_key: `stale-${runId}`,
        patches: [{ path: "notes", value: "stale write", customer_confirmed: true }],
      },
      { "X-BidPilot-Call-Token": token },
    );
    record(
      "save-intake-patch rejects stale revision (409)",
      r.status === 409 && r.json?.error === "stale_revision",
      r.text.slice(0, 160),
    );
  }

  // === 10. Voice-vs-manual conflict NOT silently overwritten ===
  {
    const r = await post(
      "/api/public/elevenlabs/intake/tools/save-intake-patch",
      {
        intake_session_id: sessionId,
        expected_revision: revision,
        idempotency_key: `conflict-${runId}`,
        patches: [{ path: "origin.city", value: "Cambridge", customer_confirmed: true }],
      },
      { "X-BidPilot-Call-Token": token },
    );
    const conflicts = (r.json?.conflicts as unknown[]) ?? [];
    const applied = (r.json?.applied as string[]) ?? [];
    const okShape =
      r.status === 200 &&
      applied.length === 0 &&
      conflicts.length === 1 &&
      (conflicts[0] as { path?: string }).path === "origin.city";

    // Confirm draft still holds manual value.
    const { data: d } = await admin
      .from("job_spec_drafts")
      .select("specification, conflicts")
      .eq("id", draftId)
      .single();
    const origin = ((d?.specification as Record<string, unknown>)?.origin ?? {}) as Record<
      string,
      unknown
    >;
    const storedConflicts = (d?.conflicts as unknown[]) ?? [];
    const okStorage = origin.city === "Boston" && storedConflicts.length >= 1;
    record(
      "voice-vs-manual conflict recorded, manual value preserved",
      okShape && okStorage,
      r.text.slice(0, 200),
    );
    // Refresh revision after conflict write.
    const { data: d2 } = await admin
      .from("job_spec_drafts")
      .select("revision")
      .eq("id", draftId)
      .single();
    revision = d2?.revision ?? revision;
  }

  // === 11. Explicit conflict_decision applies voice value ===
  {
    const r = await post(
      "/api/public/elevenlabs/intake/tools/save-intake-patch",
      {
        intake_session_id: sessionId,
        expected_revision: revision,
        idempotency_key: `resolve-${runId}`,
        patches: [
          {
            path: "origin.city",
            value: "Cambridge",
            customer_confirmed: true,
            conflict_decision: "accept_voice",
          },
        ],
      },
      { "X-BidPilot-Call-Token": token },
    );
    const { data: d } = await admin
      .from("job_spec_drafts")
      .select("specification, field_provenance")
      .eq("id", draftId)
      .single();
    const origin = ((d?.specification as Record<string, unknown>)?.origin ?? {}) as Record<
      string,
      unknown
    >;
    const prov = (d?.field_provenance as Record<string, { source: string }>) ?? {};
    const ok =
      r.status === 200 && origin.city === "Cambridge" && prov["origin.city"]?.source === "voice";
    record("explicit conflict_decision applies voice value", ok, r.text.slice(0, 200));
    const { data: d2 } = await admin
      .from("job_spec_drafts")
      .select("revision")
      .eq("id", draftId)
      .single();
    revision = d2?.revision ?? revision;
  }

  // === 12. Cross-session rejection ===
  {
    const otherNegotiationId = randomUUID();
    await admin
      .from("negotiations")
      .insert({
        id: otherNegotiationId,
        user_id: userId,
        title: `other-${runId}`,
        origin_address: "X",
        destination_address: "Y",
        moving_date: futureDate,
        bedroom_count: 1,
        vertical: "moving",
        workflow_status: "DRAFT",
      })
      .throwOnError();
    const { data: otherDraft } = await admin
      .from("job_spec_drafts")
      .insert({ negotiation_id: otherNegotiationId })
      .select("id")
      .single();
    const { data: otherSession } = await admin
      .from("intake_sessions")
      .insert({
        negotiation_id: otherNegotiationId,
        draft_id: otherDraft!.id,
        user_id: userId,
        status: "active",
      })
      .select("id")
      .single();

    // Present the FIRST token but claim the OTHER session id.
    const r = await post(
      "/api/public/elevenlabs/intake/tools/save-intake-patch",
      {
        intake_session_id: otherSession!.id,
        expected_revision: 0,
        idempotency_key: `xs-${runId}`,
        patches: [{ path: "notes", value: "cross", customer_confirmed: true }],
      },
      { "X-BidPilot-Call-Token": token },
    );
    record(
      "save-intake-patch rejects cross-session token (403)",
      r.status === 403 && r.json?.error === "session_mismatch",
      r.text.slice(0, 160),
    );
  }

  // === 13. Cross-user rejection ===
  {
    const otherEmail = `e2e-voice-b-${runId}@bidpilot.test`;
    const { data: u2 } = await admin.auth.admin.createUser({
      email: otherEmail,
      password: randomBytes(16).toString("hex"),
      email_confirm: true,
    });
    const otherUserId = u2.user!.id;
    const otherNegId = randomUUID();
    await admin
      .from("negotiations")
      .insert({
        id: otherNegId,
        user_id: otherUserId,
        title: `other-user-${runId}`,
        origin_address: "P",
        destination_address: "Q",
        moving_date: futureDate,
        bedroom_count: 1,
        vertical: "moving",
        workflow_status: "DRAFT",
      })
      .throwOnError();
    const { data: otherDraft } = await admin
      .from("job_spec_drafts")
      .insert({ negotiation_id: otherNegId })
      .select("id")
      .single();
    const { data: otherSession } = await admin
      .from("intake_sessions")
      .insert({
        negotiation_id: otherNegId,
        draft_id: otherDraft!.id,
        user_id: otherUserId,
        status: "active",
      })
      .select("id")
      .single();
    const otherToken = await mintToken(otherSession!.id, otherNegId, otherUserId);

    // Present user B's token but claim user A's session — must fail.
    const r = await post(
      "/api/public/elevenlabs/intake/tools/save-intake-patch",
      {
        intake_session_id: sessionId,
        expected_revision: revision,
        idempotency_key: `xu-${runId}`,
        patches: [{ path: "notes", value: "steal", customer_confirmed: true }],
      },
      { "X-BidPilot-Call-Token": otherToken },
    );
    record(
      "save-intake-patch rejects cross-user token (403)",
      r.status === 403,
      `status=${r.status} ${r.text.slice(0, 120)}`,
    );
  }

  // === 14. Expired token rejection ===
  {
    const expiredRaw = randomBytes(32).toString("hex");
    await admin
      .from("intake_tool_tokens")
      .insert({
        session_id: sessionId,
        negotiation_id: negotiationId,
        user_id: userId,
        token_hash: sha256Hex(expiredRaw),
        expires_at: new Date(Date.now() - 60_000).toISOString(),
      })
      .throwOnError();
    const r = await post(
      "/api/public/elevenlabs/intake/tools/save-intake-patch",
      {
        intake_session_id: sessionId,
        expected_revision: revision,
        idempotency_key: `exp-${runId}`,
        patches: [{ path: "notes", value: "late", customer_confirmed: true }],
      },
      { "X-BidPilot-Call-Token": expiredRaw },
    );
    record(
      "save-intake-patch rejects expired token (401)",
      r.status === 401 && r.json?.error === "expired_token",
      r.text.slice(0, 160),
    );
  }

  // === 15. finalize-intake-session persists conversation + transcript ===
  const conversationId = `conv_intake_${runId}`;
  {
    const r = await post(
      "/api/public/elevenlabs/intake/tools/finalize-intake-session",
      {
        intake_session_id: sessionId,
        conversation_id: conversationId,
        transcript: [
          { role: "agent", text: "What's your origin postal code?" },
          { role: "user", text: "02118" },
        ],
        captured_fields: ["origin.city", "origin.postal_code", "moving_date"],
        unresolved_fields: ["destination.postal_code"],
        summary: "Two-bedroom move confirmed",
        recording_url: "https://example.com/recording.mp3",
      },
      { "X-BidPilot-Call-Token": token },
    );
    const ok = r.status === 200 && r.json?.ok === true && r.json?.spec_confirmed === false;
    record("finalize-intake-session succeeds and does NOT confirm spec", ok, r.text.slice(0, 200));
  }

  {
    const { data: s } = await admin
      .from("intake_sessions")
      .select(
        "status, conversation_id, transcript, recording_url, captured_fields, unresolved_fields, summary, ended_at",
      )
      .eq("id", sessionId)
      .single();
    const ok =
      s?.status === "completed" &&
      s?.conversation_id === conversationId &&
      Array.isArray(s?.transcript) &&
      (s?.transcript as unknown[]).length === 2 &&
      s?.recording_url === "https://example.com/recording.mp3" &&
      Array.isArray(s?.captured_fields) &&
      (s?.captured_fields as string[]).includes("moving_date") &&
      s?.summary === "Two-bedroom move confirmed" &&
      s?.ended_at !== null;
    record("session row stores conversation, transcript, recording, timestamps", ok);
  }

  // === 16. No confirmed job_specs row was created by voice intake ===
  {
    const { data: js } = await admin
      .from("job_specs")
      .select("id, confirmed, specification_hash")
      .eq("negotiation_id", negotiationId);
    const ok = !js || js.length === 0;
    record("voice intake never created a confirmed job_specs row", ok, `rows=${js?.length ?? 0}`);
  }

  // === Cleanup ===
  await admin.from("negotiations").delete().eq("user_id", userId);
  await admin.auth.admin.deleteUser(userId);

  const passed = results.filter((r) => r.ok).length;
  const failed = results.length - passed;
  console.log(`\n▶ ${passed}/${results.length} passed${failed ? ` (${failed} failed)` : ""}\n`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error("E2E crashed:", e);
  process.exit(1);
});
