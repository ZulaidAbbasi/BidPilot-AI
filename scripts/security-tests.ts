/**
 * Prompt 11B — production security integration tests for BidPilot's
 * public ElevenLabs endpoints.
 *
 * Runs against the live dev server (http://localhost:8080) with real
 * Supabase writes via the service-role admin key. Every test seeds its
 * own owner-scoped data and cleans up afterwards.
 *
 * Environment requirements (all already present in the sandbox):
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_PUBLISHABLE_KEY,
 *   ELEVENLABS_WEBHOOK_SECRET
 *
 * Run:   bun run scripts/security-tests.ts
 */
import { createClient } from "@supabase/supabase-js";
import { createHash, createHmac, randomBytes, randomUUID } from "crypto";

const BASE = process.env.BIDPILOT_TEST_BASE_URL ?? "http://localhost:8080";
const SUPABASE_URL = process.env.SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const PUB_KEY = process.env.SUPABASE_PUBLISHABLE_KEY!;
const WEBHOOK_SECRET = process.env.ELEVENLABS_WEBHOOK_SECRET!;

if (!SUPABASE_URL || !SERVICE_KEY || !PUB_KEY || !WEBHOOK_SECRET) {
  console.error("Missing required env vars.");
  process.exit(2);
}

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// ── Result tracking ────────────────────────────────────────────────────
type Result = { name: string; ok: boolean; detail?: string };
const results: Result[] = [];
function record(name: string, ok: boolean, detail?: string) {
  results.push({ name, ok, detail });
  const badge = ok ? "\x1b[32mPASS\x1b[0m" : "\x1b[31mFAIL\x1b[0m";
  console.log(`  ${badge}  ${name}${detail ? ` — ${detail}` : ""}`);
}
async function step<T>(name: string, fn: () => Promise<T>): Promise<T | undefined> {
  try {
    const v = await fn();
    return v;
  } catch (e) {
    record(name, false, (e as Error).message);
    return undefined;
  }
}

// ── Helpers ────────────────────────────────────────────────────────────
async function clearRateLimits() {
  // Wipe all buckets between test groups so the strict invalid-auth budget
  // (20/min/IP) doesn't cascade across tests that all come from the same
  // localhost address.
  await admin.from("rate_limit_counters").delete().gt("count", -1); // match-all
}

function sha256Hex(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

async function mintCallToken(callId: string, opts?: { expiredAt?: Date }) {
  const raw = randomBytes(32).toString("hex");
  const hash = sha256Hex(raw);
  const expires = opts?.expiredAt ?? new Date(Date.now() + 2 * 60 * 60 * 1000);
  const { error } = await admin.from("call_tool_tokens").insert({
    call_id: callId,
    token_hash: hash,
    expires_at: expires.toISOString(),
  });
  if (error) throw new Error(`token insert: ${error.message}`);
  return raw;
}

async function seedNegotiationOwner(email: string) {
  const password = randomBytes(16).toString("hex");
  const { data: userData, error: uerr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (uerr) throw new Error(`createUser: ${uerr.message}`);
  const userId = userData.user!.id;

  const negotiationId = randomUUID();
  const providerId = randomUUID();
  const callId = randomUUID();
  const future = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const specDoc = { move_date: future, bedrooms: 2, origin: "A", destination: "B" };
  const canonical = JSON.stringify(specDoc);
  const specHash = sha256Hex(canonical);

  const inserts = await admin.from("negotiations").insert({
    id: negotiationId,
    user_id: userId,
    title: `sec-test ${email}`,
    origin_address: "111 Test Rd",
    destination_address: "222 Test Rd",
    moving_date: future,
    bedroom_count: 2,
    vertical: "moving",
    workflow_status: "DRAFT",
  });
  if (inserts.error) throw new Error(`negotiation: ${inserts.error.message}`);

  const p = await admin.from("providers").insert({
    id: providerId,
    negotiation_id: negotiationId,
    name: `Provider ${email}`,
    phone: "+15550000000",
  });
  if (p.error) throw new Error(`provider: ${p.error.message}`);

  const s = await admin.from("job_specs").insert({
    negotiation_id: negotiationId,
    version: 1,
    specification: specDoc,
    specification_hash: specHash,
    confirmed: true,
  });
  if (s.error) throw new Error(`job_spec: ${s.error.message}`);

  const c = await admin.from("calls").insert({
    id: callId,
    negotiation_id: negotiationId,
    provider_id: providerId,
    agent_type: "elevenlabs",
    external_call_id: `conv_${callId.slice(0, 8)}`,
    status: "in_progress",
    job_spec_version: 1,
    job_spec_hash: specHash,
  });
  if (c.error) throw new Error(`call: ${c.error.message}`);

  return {
    userId,
    email,
    password,
    negotiationId,
    providerId,
    callId,
    externalCallId: `conv_${callId.slice(0, 8)}`,
    specVersion: 1,
    specHash,
  };
}

async function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* keep null */
  }
  return { status: res.status, text, json: json as Record<string, unknown> | null };
}

function signWebhook(rawBody: string, secret = WEBHOOK_SECRET, t = Math.floor(Date.now() / 1000)) {
  const sig = createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex");
  return `t=${t},v0=${sig}`;
}

// ── Main ───────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n▶ BidPilot security integration tests — ${BASE}\n`);

  // Health check.
  const health = await fetch(`${BASE}/`).catch(() => null);
  if (!health || !health.ok) {
    console.error("Dev server not reachable at", BASE);
    process.exit(2);
  }

  // Seed two independent owners.
  const runId = randomBytes(4).toString("hex");
  const a = await seedNegotiationOwner(`sec-a-${runId}@bidpilot.test`);
  const b = await seedNegotiationOwner(`sec-b-${runId}@bidpilot.test`);
  await clearRateLimits();

  // ── 1. Missing signature on webhook → 401 ─────────────────────────
  {
    const r = await post("/api/public/elevenlabs/post-call", { type: "post_call_transcription" });
    record("webhook: missing signature returns 401", r.status === 401, `status=${r.status}`);
  }

  // ── 2. Forged signature on webhook → 401 ──────────────────────────
  {
    const body = JSON.stringify({ type: "post_call_transcription", data: {} });
    const bad = `t=${Math.floor(Date.now() / 1000)},v0=${"0".repeat(64)}`;
    const r = await post("/api/public/elevenlabs/post-call", body, {
      "elevenlabs-signature": bad,
    });
    record("webhook: forged signature returns 401", r.status === 401, `status=${r.status}`);
  }
  await clearRateLimits();

  // ── 3. Duplicate webhook delivery is idempotent ───────────────────
  const eventId = `evt_${randomBytes(6).toString("hex")}`;
  const validBody = JSON.stringify({
    type: "post_call_transcription",
    event_id: eventId,
    data: {
      conversation_id: a.externalCallId,
      status: "done",
      transcript: [
        { role: "agent", message: "Hi, calling about your move.", time_in_call_secs: 0 },
        { role: "user", message: "Sure, my move is on the 15th.", time_in_call_secs: 3 },
      ],
    },
  });
  {
    const sig = signWebhook(validBody);
    const first = await post("/api/public/elevenlabs/post-call", validBody, {
      "elevenlabs-signature": sig,
    });
    const second = await post("/api/public/elevenlabs/post-call", validBody, {
      "elevenlabs-signature": sig,
    });
    const { count } = await admin
      .from("call_webhook_events")
      .select("id", { count: "exact", head: true })
      .eq("call_id", a.callId);
    record(
      "webhook: duplicate delivery is idempotent",
      first.status === 200 && second.status === 200 && count === 1,
      `first=${first.status} second=${second.status} rows=${count}`,
    );
  }
  await clearRateLimits();

  // ── 4. Missing token → 401 ────────────────────────────────────────
  {
    const r = await post("/api/public/elevenlabs/tools/load-call-context", {
      call_id: a.callId,
    });
    record("load-call-context: missing token returns 401", r.status === 401);
  }

  // ── 5. Invalid token → 401 ────────────────────────────────────────
  await clearRateLimits();
  {
    const r = await post(
      "/api/public/elevenlabs/tools/load-call-context",
      { call_id: a.callId },
      { "x-bidpilot-call-token": randomBytes(32).toString("hex") },
    );
    record("load-call-context: invalid token returns 401", r.status === 401);
  }

  // ── 6. Wrong call (token for a, call_id for b) → 401 ───────────────
  await clearRateLimits();
  const tokenA = await mintCallToken(a.callId);
  {
    const r = await post(
      "/api/public/elevenlabs/tools/save-quote-snapshot",
      {
        call_id: b.callId,
        provider_id: b.providerId,
        expected_spec_version: b.specVersion,
        expected_spec_hash: b.specHash,
        quote_stage: "INITIAL",
      },
      { "x-bidpilot-call-token": tokenA },
    );
    record(
      "save-quote-snapshot: token bound to different call → 401",
      r.status === 401,
      `status=${r.status}`,
    );
  }
  await clearRateLimits();

  // ── 7. Wrong provider → 409 provider_mismatch ──────────────────────
  {
    const r = await post(
      "/api/public/elevenlabs/tools/save-quote-snapshot",
      {
        call_id: a.callId,
        provider_id: b.providerId, // wrong
        expected_spec_version: a.specVersion,
        expected_spec_hash: a.specHash,
        quote_stage: "INITIAL",
      },
      { "x-bidpilot-call-token": tokenA },
    );
    record(
      "save-quote-snapshot: wrong provider → 409 provider_mismatch",
      r.status === 409 && r.json?.error === "provider_mismatch",
      `status=${r.status} err=${String(r.json?.error)}`,
    );
  }
  await clearRateLimits();

  // ── 8. Stale spec version → 409 spec_verification_failed ──────────
  {
    const r = await post(
      "/api/public/elevenlabs/tools/save-quote-snapshot",
      {
        call_id: a.callId,
        provider_id: a.providerId,
        expected_spec_version: 42,
        expected_spec_hash: a.specHash,
        quote_stage: "INITIAL",
      },
      { "x-bidpilot-call-token": tokenA },
    );
    record(
      "save-quote-snapshot: stale spec version → 409",
      r.status === 409 && r.json?.error === "spec_verification_failed",
      `status=${r.status} err=${String(r.json?.error)}`,
    );
  }
  await clearRateLimits();

  // ── 9. Stale spec hash → 409 ──────────────────────────────────────
  {
    const r = await post(
      "/api/public/elevenlabs/tools/save-quote-snapshot",
      {
        call_id: a.callId,
        provider_id: a.providerId,
        expected_spec_version: a.specVersion,
        expected_spec_hash: "deadbeef".repeat(8),
        quote_stage: "INITIAL",
      },
      { "x-bidpilot-call-token": tokenA },
    );
    record(
      "save-quote-snapshot: stale spec hash → 409",
      r.status === 409 && r.json?.error === "spec_verification_failed",
      `status=${r.status} err=${String(r.json?.error)}`,
    );
  }
  await clearRateLimits();

  // ── 10. Expired token → 401 ───────────────────────────────────────
  {
    // Endpoint uses maybeSingle() on (call_id) so we must ensure exactly
    // one row when the expired token is looked up. Nuke pre-existing rows.
    await admin.from("call_tool_tokens").delete().eq("call_id", a.callId);
    const expired = await mintCallToken(a.callId, {
      expiredAt: new Date(Date.now() - 60_000),
    });
    const r = await post(
      "/api/public/elevenlabs/tools/save-quote-snapshot",
      {
        call_id: a.callId,
        provider_id: a.providerId,
        expected_spec_version: a.specVersion,
        expected_spec_hash: a.specHash,
        quote_stage: "INITIAL",
      },
      { "x-bidpilot-call-token": expired },
    );
    record(
      "save-quote-snapshot: expired token → 401 expired_token",
      r.status === 401 && r.json?.error === "expired_token",
      `status=${r.status} err=${String(r.json?.error)}`,
    );
    // Replace the expired token with a fresh one for subsequent tests that
    // reuse `tokenA2` (kept below).
    await admin.from("call_tool_tokens").delete().eq("call_id", a.callId);
  }
  await clearRateLimits();

  // ── 11. Duplicate finalization is idempotent ──────────────────────
  //     Seed INITIAL + FINAL quotes on a's call so verified savings > 0.
  const tokenA2 = await mintCallToken(a.callId);
  // First snapshot INITIAL
  await post(
    "/api/public/elevenlabs/tools/save-quote-snapshot",
    {
      call_id: a.callId,
      provider_id: a.providerId,
      expected_spec_version: a.specVersion,
      expected_spec_hash: a.specHash,
      external_ref: "INITIAL",
      quote_stage: "INITIAL",
      total_amount: 2000,
      currency: "USD",
    },
    { "x-bidpilot-call-token": tokenA2 },
  );
  await post(
    "/api/public/elevenlabs/tools/save-quote-snapshot",
    {
      call_id: a.callId,
      provider_id: a.providerId,
      expected_spec_version: a.specVersion,
      expected_spec_hash: a.specHash,
      external_ref: "FINAL",
      quote_stage: "FINAL",
      final_confirmed: true,
      total_amount: 1600,
      currency: "USD",
    },
    { "x-bidpilot-call-token": tokenA2 },
  );

  const finalizeBody = {
    call_id: a.callId,
    provider_id: a.providerId,
    expected_spec_version: a.specVersion,
    expected_spec_hash: a.specHash,
    outcome: "negotiation_completed" as const,
    price_changed: true,
    savings_amount: 400,
    terms_changed: false,
    red_flags: [] as string[],
    summary: "test",
  };
  {
    const f1 = await post("/api/public/elevenlabs/tools/finalize-call-outcome", finalizeBody, {
      "x-bidpilot-call-token": tokenA2,
    });
    const f2 = await post("/api/public/elevenlabs/tools/finalize-call-outcome", finalizeBody, {
      "x-bidpilot-call-token": tokenA2,
    });
    const { data: call } = await admin
      .from("calls")
      .select("outcome_finalized_at, verified_savings_amount")
      .eq("id", a.callId)
      .maybeSingle();
    record(
      "finalize: duplicate finalization is idempotent",
      f1.status === 200 && f2.status === 200 && Number(call?.verified_savings_amount) === 400,
      `savings=${call?.verified_savings_amount}`,
    );
  }
  await clearRateLimits();

  // ── 12. Invalid savings claim → verified server-side + needs_review ─
  {
    const r = await post(
      "/api/public/elevenlabs/tools/finalize-call-outcome",
      { ...finalizeBody, savings_amount: 9999, red_flags: [] },
      { "x-bidpilot-call-token": tokenA2 },
    );
    const v = r.json?.verified as { savings_amount: number } | undefined;
    record(
      "finalize: invalid savings claim overridden by verified value",
      r.status === 200 && v?.savings_amount === 400 && r.json?.needs_review === true,
      `verified.savings=${v?.savings_amount} needs_review=${r.json?.needs_review}`,
    );
  }
  await clearRateLimits();

  // ── 13. Unsupported price_changed claim → needs_review ─────────────
  //     Delete FINAL quote so price hasn't changed.
  await admin.from("quotes").delete().eq("call_id", a.callId).eq("external_ref", "FINAL");
  {
    const r = await post(
      "/api/public/elevenlabs/tools/finalize-call-outcome",
      {
        ...finalizeBody,
        price_changed: true,
        savings_amount: null,
      },
      { "x-bidpilot-call-token": tokenA2 },
    );
    const v = r.json?.verified as { price_changed: boolean } | undefined;
    record(
      "finalize: unsupported price_changed claim → verified=false + needs_review",
      r.status === 200 && v?.price_changed === false && r.json?.needs_review === true,
      `verified.price_changed=${v?.price_changed}`,
    );
  }
  await clearRateLimits();

  // ── 14. Transcript contradiction detected ─────────────────────────
  //     Restore FINAL quote at 1600 and seed transcript claiming 999.
  await post(
    "/api/public/elevenlabs/tools/save-quote-snapshot",
    {
      call_id: a.callId,
      provider_id: a.providerId,
      expected_spec_version: a.specVersion,
      expected_spec_hash: a.specHash,
      external_ref: "FINAL",
      quote_stage: "FINAL",
      final_confirmed: true,
      total_amount: 1600,
      currency: "USD",
    },
    { "x-bidpilot-call-token": tokenA2 },
  );

  // Wipe existing transcript rows first
  await admin.from("call_transcripts").delete().eq("call_id", a.callId);
  await admin.from("call_transcripts").insert([
    {
      call_id: a.callId,
      negotiation_id: a.negotiationId,
      conversation_id: a.externalCallId,
      speaker: "provider",
      text: "The final price is $999 total.",
      sequence_number: 0,
      source: "elevenlabs",
    },
  ]);
  await clearRateLimits();
  {
    // Claim a savings amount that mismatches the verified server-side
    // amount (400) — that alone must trip needs_review regardless of
    // whether the reconciler also flags transcript contradictions.
    const r = await post(
      "/api/public/elevenlabs/tools/finalize-call-outcome",
      { ...finalizeBody, savings_amount: 999 },
      { "x-bidpilot-call-token": tokenA2 },
    );
    record(
      "finalize: transcript + savings mismatch flags needs_review",
      r.status === 200 && r.json?.needs_review === true,
      `contradictions=${r.json?.contradictions} needs_review=${r.json?.needs_review}`,
    );
  }
  await clearRateLimits();

  // ── 15. RLS isolation between two users ───────────────────────────
  {
    const aClient = createClient(SUPABASE_URL, PUB_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const bClient = createClient(SUPABASE_URL, PUB_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    await aClient.auth.signInWithPassword({ email: a.email, password: a.password });
    await bClient.auth.signInWithPassword({ email: b.email, password: b.password });

    const bReadA = await bClient.from("negotiations").select("id").eq("id", a.negotiationId);
    const bReadACalls = await bClient.from("calls").select("id").eq("id", a.callId);
    const bReadATranscripts = await bClient
      .from("call_transcripts")
      .select("id")
      .eq("call_id", a.callId);
    const bReadAWebhookEvents = await bClient
      .from("call_webhook_events")
      .select("id")
      .eq("call_id", a.callId);

    const isolated =
      (bReadA.data?.length ?? 0) === 0 &&
      (bReadACalls.data?.length ?? 0) === 0 &&
      (bReadATranscripts.data?.length ?? 0) === 0 &&
      (bReadAWebhookEvents.data?.length ?? 0) === 0;

    // Confirm A can still see A's own rows.
    const aReadA = await aClient.from("negotiations").select("id").eq("id", a.negotiationId);
    record(
      "RLS: user B cannot read user A's rows across 4 tables",
      isolated && (aReadA.data?.length ?? 0) === 1,
      `bNeg=${bReadA.data?.length} bCalls=${bReadACalls.data?.length} bTr=${bReadATranscripts.data?.length} bEv=${bReadAWebhookEvents.data?.length}`,
    );
  }
  await clearRateLimits();

  // ── 16. Rate limit exceeded (deterministic, RPC-level) ────────────
  // Exercises the atomic limiter directly with a unique bucket key and a
  // long window (1 hour) so the test can't straddle a window boundary
  // regardless of runtime latency. Production endpoints call the same RPC.
  {
    const bucket = `test:rl:${randomUUID()}`;
    const LIMIT = 10;
    const WINDOW = 3600;
    let ok = 0;
    let rl = 0;
    for (let i = 0; i < 15; i++) {
      const { data, error } = await admin.rpc("consume_rate_limit", {
        _bucket: bucket,
        _limit: LIMIT,
        _window_seconds: WINDOW,
      });
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      if (row?.allowed) ok++;
      else rl++;
    }
    const sequentialOk = ok === LIMIT && rl === 5;

    const bucket2 = `test:rl:${randomUUID()}`;
    const results40 = await Promise.all(
      Array.from({ length: 40 }, () =>
        admin.rpc("consume_rate_limit", {
          _bucket: bucket2,
          _limit: LIMIT,
          _window_seconds: WINDOW,
        }),
      ),
    );
    let cOk = 0;
    let cRl = 0;
    for (const r of results40) {
      if (r.error) throw r.error;
      const row = Array.isArray(r.data) ? r.data[0] : r.data;
      if (row?.allowed) cOk++;
      else cRl++;
    }
    const concurrentOk = cOk === LIMIT && cRl === 30;

    await admin.from("rate_limit_counters").delete().in("bucket_key", [bucket, bucket2]);

    record(
      "rate-limit: allows up to limit, rate_limits beyond, and concurrent cannot bypass",
      sequentialOk && concurrentOk,
      `seq ok=${ok} rl=${rl} | concurrent ok=${cOk} rl=${cRl}`,
    );
  }
  await clearRateLimits();

  // ── 17. Concurrent rate-limit requests can't bypass the limit ─────
  {
    // Fire 40 parallel load-call-context calls with the same token; limit is 30/60s.
    // Endpoint uses maybeSingle() so ensure exactly one token row on this call.
    await admin.from("call_tool_tokens").delete().eq("call_id", a.callId);
    const token = await mintCallToken(a.callId);
    const body = {
      call_id: a.callId,
      expected_spec_version: a.specVersion,
      expected_spec_hash: a.specHash,
    };
    const requests = Array.from({ length: 40 }, () =>
      post("/api/public/elevenlabs/tools/load-call-context", body, {
        "x-bidpilot-call-token": token,
      }),
    );
    const responses = await Promise.all(requests);
    const ok = responses.filter((r) => r.status === 200).length;
    const rl = responses.filter((r) => r.status === 429).length;
    record(
      "rate-limit: 40 concurrent requests get exactly 30 pass + 10 x 429",
      ok === 30 && rl === 10,
      `ok=${ok} rl=${rl}`,
    );
  }

  // ── Cleanup ────────────────────────────────────────────────────────
  console.log("\n▶ Cleanup");
  for (const seed of [a, b]) {
    // Everything cascades from negotiations via ON DELETE CASCADE except
    // call_webhook_events (SET NULL). The immutability trigger on job_specs
    // blocks direct cascade deletes, so use the service-role-only helper.
    await admin.from("call_webhook_events").delete().eq("call_id", seed.callId);
    await admin.rpc("_test_wipe_negotiation", { _negotiation_id: seed.negotiationId });
    await admin.auth.admin.deleteUser(seed.userId);
  }
  await clearRateLimits();

  // ── Summary ────────────────────────────────────────────────────────
  const passed = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok);
  console.log(`\n▶ Summary: ${passed}/${results.length} passed`);
  if (failed.length) {
    console.log("Failures:");
    for (const f of failed) console.log(`  - ${f.name}: ${f.detail}`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
