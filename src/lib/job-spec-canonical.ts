/**
 * Deterministic canonicalization + SHA-256 hashing for confirmed JobSpecs.
 *
 * Runs on both server (Node/Worker `crypto`) and browser (SubtleCrypto).
 * A confirmed specification's hash is derived ONLY from server-canonicalized
 * bytes, but this module is pure and safe to import from either side for
 * tests and UI previews.
 */

import type { JobSpec } from "./job-spec";

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

/**
 * Canonicalize a value:
 * - object keys sorted lexicographically at every depth
 * - `undefined` values omitted (JSON has no undefined)
 * - arrays preserve order (order is semantically significant here)
 * - numbers left as-is; JSON.stringify handles IEEE-754 uniformly
 *
 * The result is a stable JSON string: two structurally-equivalent inputs
 * always produce byte-identical output.
 */
export function canonicalizeJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): JsonValue {
  if (value === null) return null;
  if (Array.isArray(value)) return value.map(sortValue);
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const out: Record<string, JsonValue> = {};
    // Sort keys before insertion. JSON.stringify serializes in insertion order,
    // so this determines the on-wire order.
    for (const key of Object.keys(obj).sort()) {
      const v = obj[key];
      if (v === undefined) continue;
      out[key] = sortValue(v);
    }
    return out;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("Non-finite numbers cannot be canonicalized");
    }
    return value;
  }
  if (typeof value === "string" || typeof value === "boolean") return value;
  // Undefined, functions, symbols, bigints are not JSON.
  throw new Error(`Unsupported value in canonicalization: ${typeof value}`);
}

/**
 * SHA-256 of a canonical JobSpec. Returns lowercase hex.
 *
 * Uses Node's `crypto.createHash` when available (Cloudflare Workers with
 * nodejs_compat, tests under Node/Vitest) and falls back to Web Crypto
 * SubtleCrypto in the browser.
 */
export async function sha256Hex(input: string): Promise<string> {
  // Prefer Node's synchronous createHash when available.
  try {
    const nodeCrypto = await import("crypto");
    if (typeof nodeCrypto.createHash === "function") {
      return nodeCrypto.createHash("sha256").update(input, "utf8").digest("hex");
    }
  } catch {
    // fall through to SubtleCrypto
  }
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Convenience: canonicalize a JobSpec and hash it.
 *
 * Transient row IDs on inventory/fragile/specialty items and additional
 * stops are stripped BEFORE canonicalization. Those IDs exist only for
 * React field-array identity — removing an item and re-adding one with
 * identical content must not change the confirmed hash. Content-bearing
 * fields (label, quantity, category, purpose, stop_order, address…)
 * remain fully hashed, so any real edit still produces a new hash.
 */
export async function canonicalizeAndHash(spec: JobSpec): Promise<{
  canonical: string;
  hash: string;
}> {
  const stable = stripTransientIds(spec);
  const canonical = canonicalizeJson(stable);
  const hash = await sha256Hex(canonical);
  return { canonical, hash };
}

const ID_STRIP_KEYS = [
  "inventory",
  "fragile_items",
  "specialty_items",
  "additional_stops",
] as const;

function stripTransientIds(spec: JobSpec): unknown {
  const out: Record<string, unknown> = { ...(spec as Record<string, unknown>) };
  for (const key of ID_STRIP_KEYS) {
    const arr = out[key];
    if (Array.isArray(arr)) {
      out[key] = arr.map((row) => {
        if (row && typeof row === "object") {
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { id: _id, ...rest } = row as Record<string, unknown>;
          return rest;
        }
        return row;
      });
    }
  }
  return out;
}

export function shortHash(hash: string, chars = 10): string {
  return hash.slice(0, chars);
}

