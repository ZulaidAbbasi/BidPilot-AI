/**
 * Postgres-backed atomic rate limiter for the public ElevenLabs endpoints.
 *
 * All limits are enforced through the `consume_rate_limit` SECURITY DEFINER
 * database function which performs an atomic `INSERT ... ON CONFLICT DO
 * UPDATE ... RETURNING count`. Concurrent requests cannot bypass the limit
 * because Postgres serializes the ON CONFLICT update on the conflicting row.
 *
 * The bucket key is a SHA-256 hash of stable components — never the raw
 * token — so the counter store never contains sensitive material.
 *
 * On database failure the limiter fails OPEN (returns allowed=true) so a
 * transient outage cannot lock legitimate ElevenLabs traffic out. Errors
 * are logged for observability.
 */
import { createHash } from "crypto";

export type RateLimit = { allowed: boolean; count: number; retryAfter: number };

export function clientIp(req: Request): string {
  const cf = req.headers.get("cf-connecting-ip");
  if (cf) return cf;
  const real = req.headers.get("x-real-ip");
  if (real) return real;
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  return "unknown";
}

function bucketKey(parts: string[]): string {
  return createHash("sha256").update(parts.join("|")).digest("hex");
}

async function consume(
  bucket: string,
  limit: number,
  windowSeconds: number,
): Promise<RateLimit> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin.rpc("consume_rate_limit", {
      _bucket: bucket,
      _limit: limit,
      _window_seconds: windowSeconds,
    });
    if (error) {
      console.error("[rate-limit] rpc error:", error.message);
      return { allowed: true, count: 0, retryAfter: 0 };
    }
    const row = (Array.isArray(data) ? data[0] : data) as
      | { allowed: boolean; current_count: number; retry_after_seconds: number }
      | undefined;
    if (!row) return { allowed: true, count: 0, retryAfter: 0 };
    return {
      allowed: row.allowed !== false,
      count: row.current_count ?? 0,
      retryAfter: row.retry_after_seconds ?? 0,
    };
  } catch (e) {
    console.error("[rate-limit] unexpected error:", (e as Error).message);
    return { allowed: true, count: 0, retryAfter: 0 };
  }
}

export async function checkValidCallerLimit(
  endpoint: string,
  tokenHash: string,
  limit: number,
  windowSeconds = 60,
): Promise<RateLimit> {
  return consume(bucketKey(["v1", endpoint, "token", tokenHash]), limit, windowSeconds);
}

export async function checkWebhookLimit(
  endpoint: string,
  identity: string,
  limit: number,
  windowSeconds = 60,
): Promise<RateLimit> {
  return consume(bucketKey(["v1", endpoint, "wh", identity]), limit, windowSeconds);
}

export async function checkInvalidAuthLimit(
  endpoint: string,
  req: Request,
  limit = 20,
  windowSeconds = 60,
): Promise<RateLimit> {
  return consume(bucketKey(["v1", endpoint, "invalid", clientIp(req)]), limit, windowSeconds);
}

export function rateLimitResponse(retryAfter: number): Response {
  const secs = Math.max(1, retryAfter | 0);
  return new Response(
    JSON.stringify({ error: "rate_limited", retry_after_seconds: secs }),
    {
      status: 429,
      headers: {
        "content-type": "application/json",
        "retry-after": String(secs),
      },
    },
  );
}

/**
 * Canonical per-endpoint budgets. Keep in sync with the docs in Prompt 11B.
 */
export const RATE_LIMITS = {
  "load-call-context": { valid: 30, invalid: 20 },
  "save-quote-snapshot": { valid: 30, invalid: 20 },
  "save-quote-line-item": { valid: 120, invalid: 20 },
  "finalize-call-outcome": { valid: 10, invalid: 20 },
  "post-call": { signed: 60, unsigned: 30 },
} as const;
