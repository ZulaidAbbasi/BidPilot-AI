/**
 * Unit tests for the intake post-call webhook signature verifier.
 * Full e2e against Supabase lives in scripts/e2e-intake-webhook.ts.
 */
import { describe, it, expect } from "vitest";
import { createHmac } from "crypto";

import { verifyIntakeSignature } from "@/routes/api/public/elevenlabs/intake/post-call";

function sign(secret: string, body: string, t = Math.floor(Date.now() / 1000)) {
  const v0 = createHmac("sha256", secret).update(`${t}.${body}`).digest("hex");
  return { header: `t=${t},v0=${v0}`, t, v0 };
}

describe("intake post-call signature", () => {
  const secret = "test-secret-abc";
  const body = JSON.stringify({ type: "post_call_transcription", event_id: "evt_1" });

  it("accepts a fresh valid signature", () => {
    const { header } = sign(secret, body);
    expect(verifyIntakeSignature(secret, body, header).ok).toBe(true);
  });

  it("rejects a missing header", () => {
    expect(verifyIntakeSignature(secret, body, null).ok).toBe(false);
  });

  it("rejects a forged signature", () => {
    const { header } = sign("attacker-secret", body);
    const r = verifyIntakeSignature(secret, body, header);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("bad_signature");
  });

  it("rejects a stale timestamp (>30 min)", () => {
    const stale = Math.floor(Date.now() / 1000) - 60 * 60;
    const { header } = sign(secret, body, stale);
    const r = verifyIntakeSignature(secret, body, header);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("stale_timestamp");
  });

  it("rejects mutated body with previously-valid signature", () => {
    const { header } = sign(secret, body);
    const r = verifyIntakeSignature(secret, body + "x", header);
    expect(r.ok).toBe(false);
  });

  it("rejects malformed header", () => {
    const r = verifyIntakeSignature(secret, body, "garbage");
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("malformed_signature_header");
  });
});
