/**
 * Shared helpers for ElevenLabs agent tool endpoints. Server-only.
 *
 * - `extractCallToken` reads the preferred `X-BidPilot-Call-Token` header, with
 *   legacy fallbacks `Authorization: Bearer` and `X-Call-Tool-Token`.
 * - `authorizeCallToolRequest` validates the token against the stored hash,
 *   loads the call, verifies provider linkage, and checks the confirmed spec
 *   version and hash. Returns fully-typed context or a `Response` to return
 *   directly.
 */
import { createHash, timingSafeEqual } from "crypto";

export function extractCallToken(req: Request): string | null {
  const bidpilot = req.headers.get("x-bidpilot-call-token");
  if (bidpilot && bidpilot.trim()) return bidpilot.trim();
  const auth = req.headers.get("authorization");
  if (auth && auth.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
  const x = req.headers.get("x-call-tool-token");
  return x && x.trim() ? x.trim() : null;
}

export function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export interface CallToolContext {
  call: {
    id: string;
    negotiation_id: string;
    provider_id: string;
    external_call_id: string | null;
    job_spec_version: number | null;
    job_spec_hash: string | null;
  };
  spec: {
    version: number;
    hash: string;
  };
  tokenRowId: string;
  tokenUsedAt: string | null;
}

export interface AuthorizeParams {
  callId: string;
  providerId: string;
  expectedSpecVersion?: number;
  expectedSpecHash?: string;
  conversationId?: string;
}

export async function authorizeCallToolRequest(
  req: Request,
  params: AuthorizeParams,
): Promise<{ ok: true; ctx: CallToolContext } | { ok: false; response: Response }> {
  const rawToken = extractCallToken(req);
  if (!rawToken) return { ok: false, response: jsonResponse(401, { error: "missing_token" }) };

  const tokenHash = createHash("sha256").update(rawToken).digest("hex");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { data: tokenRow, error: tokErr } = await supabaseAdmin
    .from("call_tool_tokens")
    .select("id, call_id, token_hash, expires_at, used_at")
    .eq("call_id", params.callId)
    .maybeSingle();
  if (tokErr) {
    console.error("[call-token] lookup failed", tokErr);
    return { ok: false, response: jsonResponse(500, { error: "server_error" }) };
  }
  if (!tokenRow) return { ok: false, response: jsonResponse(401, { error: "invalid_token" }) };

  const a = Buffer.from(tokenRow.token_hash, "hex");
  const b = Buffer.from(tokenHash, "hex");
  if (a.length !== b.length || a.length === 0 || !timingSafeEqual(a, b)) {
    return { ok: false, response: jsonResponse(401, { error: "invalid_token" }) };
  }
  if (new Date(tokenRow.expires_at).getTime() < Date.now()) {
    return { ok: false, response: jsonResponse(401, { error: "expired_token" }) };
  }

  const { data: call, error: callErr } = await supabaseAdmin
    .from("calls")
    .select("id, negotiation_id, provider_id, external_call_id, job_spec_version, job_spec_hash")
    .eq("id", params.callId)
    .maybeSingle();
  if (callErr || !call)
    return { ok: false, response: jsonResponse(404, { error: "call_not_found" }) };
  if (call.provider_id !== params.providerId) {
    return { ok: false, response: jsonResponse(409, { error: "provider_mismatch" }) };
  }
  if (
    params.conversationId &&
    call.external_call_id &&
    call.external_call_id !== params.conversationId
  ) {
    return { ok: false, response: jsonResponse(409, { error: "conversation_mismatch" }) };
  }

  const { data: spec, error: specErr } = await supabaseAdmin
    .from("job_specs")
    .select("version, specification_hash")
    .eq("negotiation_id", call.negotiation_id)
    .eq("confirmed", true)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (specErr || !spec || !spec.specification_hash) {
    return { ok: false, response: jsonResponse(404, { error: "spec_not_found" }) };
  }

  const versionOk = call.job_spec_version == null || call.job_spec_version === spec.version;
  const hashOk = !call.job_spec_hash || call.job_spec_hash === spec.specification_hash;
  const expectedVersionOk =
    params.expectedSpecVersion == null || params.expectedSpecVersion === spec.version;
  const expectedHashOk =
    !params.expectedSpecHash || params.expectedSpecHash === spec.specification_hash;
  if (!versionOk || !hashOk || !expectedVersionOk || !expectedHashOk) {
    return { ok: false, response: jsonResponse(409, { error: "spec_verification_failed" }) };
  }

  return {
    ok: true,
    ctx: {
      call: {
        id: call.id,
        negotiation_id: call.negotiation_id!,
        provider_id: call.provider_id!,
        external_call_id: call.external_call_id,
        job_spec_version: call.job_spec_version,
        job_spec_hash: call.job_spec_hash,
      },
      spec: { version: spec.version, hash: spec.specification_hash },
      tokenRowId: tokenRow.id,
      tokenUsedAt: tokenRow.used_at,
    },
  };
}
