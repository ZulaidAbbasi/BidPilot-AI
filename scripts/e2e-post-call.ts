/**
 * Prompt 13C — End-to-end post-call, evidence and verified-savings test.
 *
 * Runs against the live dev server. Seeds a negotiation + confirmed spec +
 * provider + call, mints an agent tool token, then:
 *   1. Sends INITIAL quote via save-quote-snapshot
 *   2. Sends FINAL quote via save-quote-snapshot
 *   3. Delivers a signed post-call webhook (with transcript containing
 *      "1500", "1350", and "stair fee included")
 *   4. Delivers the SAME webhook again to prove idempotency
 *   5. Calls finalize-call-outcome with an unsupported savings claim to
 *      verify server-side overrides
 *   6. Reads back the call, transcript, and evidence to verify:
 *        - full transcript stored with speaker/sequence/timestamps
 *        - verified_savings_amount computed server-side (150)
 *        - verified_price_changed=true, verified_terms_changed=true
 *        - call.status='completed' with all three preconditions met
 *        - full arrays persisted in agent_events metadata
 *        - quote_evidence rows use the allowed support_status values
 */
import { createClient } from "@supabase/supabase-js";
import { createHash, createHmac, randomBytes, randomUUID } from "crypto";

const BASE = process.env.BIDPILOT_TEST_BASE_URL ?? "http://localhost:8080";
const SUPABASE_URL = process.env.SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const WEBHOOK_SECRET = process.env.ELEVENLABS_WEBHOOK_SECRET!;

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function sha256Hex(s: string) {
  return createHash("sha256").update(s).digest("hex");
}
function signWebhook(rawBody: string) {
  const t = Math.floor(Date.now() / 1000);
  const sig = createHmac("sha256", WEBHOOK_SECRET).update(`${t}.${rawBody}`).digest("hex");
  return `t=${t},v0=${sig}`;
}
async function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  const raw = typeof body === "string" ? body : JSON.stringify(body);
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: raw,
  });
  const text = await res.text();
  let json: Record<string, unknown> | null = null;
  try {
    json = text ? (JSON.parse(text) as Record<string, unknown>) : null;
  } catch {
    // ignore JSON parse errors — surface raw text instead
  }
  return { status: res.status, text, json, raw };
}

async function main() {
  console.log(`\n▶ Prompt 13C e2e — ${BASE}\n`);
  const runId = randomBytes(4).toString("hex");
  const email = `e2e-${runId}@bidpilot.test`;
  const { data: u, error: uerr } = await admin.auth.admin.createUser({
    email,
    password: randomBytes(16).toString("hex"),
    email_confirm: true,
  });
  if (uerr) throw uerr;
  const userId = u.user!.id;
  const negotiationId = randomUUID();
  const providerId = randomUUID();
  const callId = randomUUID();
  const externalCallId = `conv_${runId}`;
  const future = new Date(Date.now() + 30 * 86400e3).toISOString().slice(0, 10);
  const specDoc = { move_date: future, bedrooms: 2, origin: "A", destination: "B" };
  const specHash = sha256Hex(JSON.stringify(specDoc));

  await admin
    .from("negotiations")
    .insert({
      id: negotiationId,
      user_id: userId,
      title: `e2e ${runId}`,
      origin_address: "A",
      destination_address: "B",
      moving_date: future,
      bedroom_count: 2,
      vertical: "moving",
      workflow_status: "DRAFT",
    })
    .throwOnError();
  await admin
    .from("providers")
    .insert({
      id: providerId,
      negotiation_id: negotiationId,
      name: "Acme Movers",
      phone: "+15550000000",
    })
    .throwOnError();
  await admin
    .from("job_specs")
    .insert({
      negotiation_id: negotiationId,
      version: 1,
      specification: specDoc,
      specification_hash: specHash,
      confirmed: true,
    })
    .throwOnError();
  await admin
    .from("calls")
    .insert({
      id: callId,
      negotiation_id: negotiationId,
      provider_id: providerId,
      agent_type: "elevenlabs",
      external_call_id: externalCallId,
      status: "in_progress",
      job_spec_version: 1,
      job_spec_hash: specHash,
    })
    .throwOnError();

  const rawToken = randomBytes(32).toString("hex");
  await admin
    .from("call_tool_tokens")
    .insert({
      call_id: callId,
      token_hash: sha256Hex(rawToken),
      expires_at: new Date(Date.now() + 2 * 3600e3).toISOString(),
    })
    .throwOnError();

  const toolHeaders = { "X-BidPilot-Call-Token": rawToken };
  const specCtx = {
    call_id: callId,
    provider_id: providerId,
    expected_spec_version: 1,
    expected_spec_hash: specHash,
    conversation_id: externalCallId,
  };

  // ── 1. INITIAL quote ────────────────────────────────────────────────
  const initial = await post(
    "/api/public/elevenlabs/tools/save-quote-snapshot",
    {
      ...specCtx,
      quote_stage: "INITIAL",
      total_amount: 1500,
      currency: "USD",
      terms: "standard terms, no stair fee",
    },
    toolHeaders,
  );
  console.log("initial snapshot:", initial.status, initial.json?.error ?? "ok");

  // ── 2. FINAL quote ──────────────────────────────────────────────────
  const finalQ = await post(
    "/api/public/elevenlabs/tools/save-quote-snapshot",
    {
      ...specCtx,
      quote_stage: "FINAL",
      total_amount: 1350,
      currency: "USD",
      terms: "stair fee included, otherwise standard",
    },
    toolHeaders,
  );
  console.log("final snapshot:", finalQ.status, finalQ.json?.error ?? "ok");

  // ── 3. Signed webhook with full transcript ──────────────────────────
  const transcript = [
    { role: "agent", message: "Hi, calling about your move on the 15th.", time_in_call_secs: 0 },
    { role: "provider", message: "Sure, our base rate is 1500 dollars.", time_in_call_secs: 4 },
    { role: "agent", message: "Can you do better if we book today?", time_in_call_secs: 9 },
    {
      role: "provider",
      message: "Alright, final is 1350 and stair fee included.",
      time_in_call_secs: 14,
    },
    { role: "user", message: "Great, thanks.", time_in_call_secs: 18 },
  ];
  const eventId = `evt_${randomBytes(6).toString("hex")}`;
  const webhookBody = JSON.stringify({
    type: "post_call_transcription",
    event_id: eventId,
    data: { conversation_id: externalCallId, agent_id: "agent_x", status: "done", transcript },
  });
  const sig = signWebhook(webhookBody);
  const w1 = await post("/api/public/elevenlabs/post-call", webhookBody, {
    "elevenlabs-signature": sig,
  });
  const w2 = await post("/api/public/elevenlabs/post-call", webhookBody, {
    "elevenlabs-signature": sig,
  });
  const { count: eventCount } = await admin
    .from("call_webhook_events")
    .select("id", { count: "exact", head: true })
    .eq("call_id", callId);
  console.log("webhook: first=%d second=%d rows=%d", w1.status, w2.status, eventCount);

  // ── 4. Finalize with an unsupported savings claim ───────────────────
  const fin = await post(
    "/api/public/elevenlabs/tools/finalize-call-outcome",
    {
      ...specCtx,
      outcome: "negotiation_completed",
      price_changed: true,
      initial_amount: 1500,
      final_amount: 1350,
      savings_amount: 999, // wrong on purpose
      terms_changed: true,
      changed_terms: ["stair fee included"],
      provider_commitments: ["Waive stair fee", "Arrive between 8-9am"],
      unresolved_questions: ["Any weekend surcharge?"],
      red_flags: [],
      summary: "Provider agreed to include stair fee and drop total to 1350.",
    },
    toolHeaders,
  );
  console.log("finalize:", fin.status, JSON.stringify(fin.json));

  // ── 5. Read back state ──────────────────────────────────────────────
  const { data: call } = await admin.from("calls").select("*").eq("id", callId).single();
  const { data: transcripts } = await admin
    .from("call_transcripts")
    .select("speaker, sequence_number, started_at_ms, text")
    .eq("call_id", callId)
    .order("sequence_number");
  const { data: evidence } = await admin
    .from("quote_evidence")
    .select("evidence_type, support_status")
    .eq("negotiation_id", negotiationId);
  const { data: agentEv } = await admin
    .from("agent_events")
    .select("event_type, metadata")
    .eq("call_id", callId)
    .eq("event_type", "CALL_FINALIZED")
    .maybeSingle();

  console.log("\n── call row ──");
  console.log({
    status: call?.status,
    final_outcome: call?.final_outcome,
    verified_savings_amount: call?.verified_savings_amount,
    verified_price_changed: call?.verified_price_changed,
    verified_terms_changed: call?.verified_terms_changed,
    webhook_received_at: !!call?.webhook_received_at,
    reconciled_at: !!call?.reconciled_at,
    needs_review: call?.needs_review,
  });
  console.log("\n── transcript rows ──");
  console.log(transcripts);
  console.log("\n── evidence support_status distribution ──");
  const dist: Record<string, number> = {};
  for (const e of evidence ?? []) dist[e.support_status] = (dist[e.support_status] ?? 0) + 1;
  console.log(dist);
  const allowed = new Set(["supported", "unsupported", "contradictory", "missing_evidence"]);
  const bad = (evidence ?? []).find((e) => !allowed.has(e.support_status));
  console.log("evidence uses only allowed statuses:", !bad);
  console.log("\n── CALL_FINALIZED metadata arrays ──");
  console.log({
    provider_commitments: agentEv?.metadata?.provider_commitments,
    changed_terms: agentEv?.metadata?.changed_terms,
    unresolved_questions: agentEv?.metadata?.unresolved_questions,
    red_flags: agentEv?.metadata?.red_flags,
  });

  // ── Assertions ──────────────────────────────────────────────────────
  const checks: Array<[string, boolean]> = [
    ["webhook first=200", w1.status === 200],
    ["webhook duplicate idempotent (rows=1)", eventCount === 1],
    [
      "transcript 5 rows persisted in order",
      (transcripts?.length ?? 0) === 5 && transcripts!.every((r, i) => r.sequence_number === i),
    ],
    [
      "speakers preserved (agent/provider/user)",
      transcripts?.[0]?.speaker === "agent" &&
        transcripts?.[1]?.speaker === "provider" &&
        transcripts?.[4]?.speaker === "user",
    ],
    ["timestamps preserved", transcripts?.[1]?.started_at_ms === 4000],
    ["finalize 200", fin.status === 200],
    ["verified_savings_amount = 150", Number(call?.verified_savings_amount) === 150],
    ["verified_price_changed = true", call?.verified_price_changed === true],
    ["verified_terms_changed = true", call?.verified_terms_changed === true],
    ["needs_review = true (unsupported claim)", call?.needs_review === true],
    ["webhook_received_at set", !!call?.webhook_received_at],
    ["reconciled_at set", !!call?.reconciled_at],
    ["final_outcome = negotiation_completed", call?.final_outcome === "negotiation_completed"],
    ["evidence support_status values valid", !bad && (evidence?.length ?? 0) > 0],
    ["provider_commitments persisted (2)", agentEv?.metadata?.provider_commitments?.length === 2],
    [
      "changed_terms persisted (stair fee included)",
      agentEv?.metadata?.changed_terms?.[0] === "stair fee included",
    ],
    ["unresolved_questions persisted (1)", agentEv?.metadata?.unresolved_questions?.length === 1],
  ];
  let ok = 0;
  for (const [name, pass] of checks) {
    console.log(`  ${pass ? "\x1b[32mPASS\x1b[0m" : "\x1b[31mFAIL\x1b[0m"}  ${name}`);
    if (pass) ok++;
  }
  console.log(`\n▶ ${ok}/${checks.length} checks passed`);

  // Cleanup
  await admin.rpc("_test_wipe_negotiation", { _negotiation_id: negotiationId }).throwOnError();
  await admin.auth.admin.deleteUser(userId).catch(() => {});
  process.exit(ok === checks.length ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
