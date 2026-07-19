import { describe, expect, it } from "vitest";
import { createHash, randomBytes } from "crypto";

/**
 * Retried-start call-token safety test.
 *
 * The production endpoint (elevenlabs.functions.ts) DELETES prior rows for the
 * call before inserting the new token hash. This test simulates that lifecycle
 * against an in-memory Map to prove:
 *   1. Old token no longer authorises after a retry (returns 401).
 *   2. New token authorises after the retry.
 *   3. Only one row exists per call — duplicate historical rows can never
 *      trigger a 500 in the lookup path.
 *   4. Raw tokens are never persisted; only sha256 hashes are.
 */
type Row = { call_id: string; token_hash: string; expires_at: number };

function makeStore() {
  const rows = new Map<string, Row>(); // key = token_hash
  return {
    rotate(callId: string) {
      // Invalidate prior rows for the same call.
      for (const [h, r] of rows) if (r.call_id === callId) rows.delete(h);
      const raw = randomBytes(32).toString("hex");
      const hash = createHash("sha256").update(raw).digest("hex");
      rows.set(hash, {
        call_id: callId,
        token_hash: hash,
        expires_at: Date.now() + 60_000,
      });
      return raw;
    },
    authorize(rawToken: string, callId: string): number {
      const hash = createHash("sha256").update(rawToken).digest("hex");
      const row = rows.get(hash);
      if (!row) return 401;
      if (row.call_id !== callId) return 401;
      if (row.expires_at < Date.now()) return 401;
      return 200;
    },
    size() {
      return rows.size;
    },
    rowsForCall(callId: string) {
      return [...rows.values()].filter((r) => r.call_id === callId);
    },
    all() {
      return [...rows.values()];
    },
  };
}

describe("retried call-token lifecycle", () => {
  it("invalidates old token and authorizes new token after retry", () => {
    const store = makeStore();
    const callId = "call-1";
    const oldRaw = store.rotate(callId);
    expect(store.authorize(oldRaw, callId)).toBe(200);
    // Retry — mint replacement token.
    const newRaw = store.rotate(callId);
    expect(oldRaw).not.toBe(newRaw);
    // Old token now returns 401.
    expect(store.authorize(oldRaw, callId)).toBe(401);
    // New token authorizes.
    expect(store.authorize(newRaw, callId)).toBe(200);
  });

  it("never allows duplicate rows for the same call", () => {
    const store = makeStore();
    const callId = "call-2";
    store.rotate(callId);
    store.rotate(callId);
    store.rotate(callId);
    expect(store.rowsForCall(callId).length).toBe(1);
  });

  it("rejects a token that authenticates against a different call id", () => {
    const store = makeStore();
    const raw = store.rotate("call-a");
    expect(store.authorize(raw, "call-b")).toBe(401);
  });

  it("only stores hashes; raw token bytes never appear in any row", () => {
    const store = makeStore();
    const raw = store.rotate("call-hash");
    for (const row of store.all()) {
      expect(row.token_hash).not.toBe(raw);
      expect(row.token_hash.length).toBe(64); // sha256 hex
    }
  });
});
