/**
 * Intake tool token authorization. Server-only.
 *
 * The estimator agent presents `X-BidPilot-Call-Token` (same header contract as
 * the provider agent — ElevenLabs cannot prepend "Bearer " in webhook headers).
 * We look the raw token up by SHA-256 hash, timing-safe compare, verify expiry,
 * and load session + draft + negotiation ownership.
 */
import { createHash, timingSafeEqual } from "crypto";

export function extractIntakeToken(req: Request): string | null {
  const bidpilot = req.headers.get("x-bidpilot-call-token");
  if (bidpilot && bidpilot.trim()) return bidpilot.trim();
  const auth = req.headers.get("authorization");
  if (auth && auth.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
  return null;
}

export function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export interface IntakeToolContext {
  tokenRowId: string;
  session: {
    id: string;
    negotiation_id: string;
    draft_id: string;
    user_id: string;
    status: string;
    conversation_id: string | null;
  };
  draft: {
    id: string;
    negotiation_id: string;
    revision: number;
    specification: Record<string, unknown>;
    field_provenance: Record<string, unknown>;
    conflicts: unknown[];
  };
  negotiation: {
    id: string;
    user_id: string;
  };
}

export async function authorizeIntakeToolRequest(
  req: Request,
  params: {
    expectedSessionId?: string;
    expectedNegotiationId?: string;
    allowedStatuses?: string[];
  } = {},
): Promise<{ ok: true; ctx: IntakeToolContext } | { ok: false; response: Response }> {
  const raw = extractIntakeToken(req);
  if (!raw) return { ok: false, response: jsonResponse(401, { error: "missing_token" }) };

  const tokenHash = createHash("sha256").update(raw).digest("hex");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { data: tokenRow, error: tokErr } = await supabaseAdmin
    .from("intake_tool_tokens")
    .select("id, session_id, negotiation_id, user_id, token_hash, expires_at")
    .eq("token_hash", tokenHash)
    .maybeSingle();
  if (tokErr) {
    console.error("[intake-token] lookup failed", tokErr);
    return { ok: false, response: jsonResponse(500, { error: "server_error" }) };
  }
  if (!tokenRow) return { ok: false, response: jsonResponse(401, { error: "invalid_token" }) };

  const a = Buffer.from(tokenRow.token_hash, "hex");
  const b = Buffer.from(tokenHash, "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, response: jsonResponse(401, { error: "invalid_token" }) };
  }
  if (new Date(tokenRow.expires_at).getTime() < Date.now()) {
    return { ok: false, response: jsonResponse(401, { error: "expired_token" }) };
  }
  if (params.expectedSessionId && params.expectedSessionId !== tokenRow.session_id) {
    return { ok: false, response: jsonResponse(403, { error: "session_mismatch" }) };
  }
  if (params.expectedNegotiationId && params.expectedNegotiationId !== tokenRow.negotiation_id) {
    return { ok: false, response: jsonResponse(403, { error: "negotiation_mismatch" }) };
  }

  const { data: session, error: sErr } = await supabaseAdmin
    .from("intake_sessions")
    .select("id, negotiation_id, draft_id, user_id, status, conversation_id")
    .eq("id", tokenRow.session_id)
    .maybeSingle();
  if (sErr || !session)
    return { ok: false, response: jsonResponse(404, { error: "session_not_found" }) };
  if (session.user_id !== tokenRow.user_id) {
    return { ok: false, response: jsonResponse(403, { error: "user_mismatch" }) };
  }
  if (params.allowedStatuses && !params.allowedStatuses.includes(session.status ?? "")) {
    return {
      ok: false,
      response: jsonResponse(409, {
        error: "session_not_active",
        status: session.status,
      }),
    };
  }

  const { data: draft, error: dErr } = await supabaseAdmin
    .from("job_spec_drafts")
    .select("id, negotiation_id, revision, specification, field_provenance, conflicts")
    .eq("id", session.draft_id)
    .maybeSingle();
  if (dErr || !draft)
    return { ok: false, response: jsonResponse(404, { error: "draft_not_found" }) };
  if (draft.negotiation_id !== session.negotiation_id) {
    return { ok: false, response: jsonResponse(403, { error: "draft_negotiation_mismatch" }) };
  }

  const { data: neg, error: nErr } = await supabaseAdmin
    .from("negotiations")
    .select("id, user_id")
    .eq("id", session.negotiation_id)
    .maybeSingle();
  if (nErr || !neg)
    return { ok: false, response: jsonResponse(404, { error: "negotiation_not_found" }) };
  if (neg.user_id !== tokenRow.user_id) {
    return { ok: false, response: jsonResponse(403, { error: "negotiation_owner_mismatch" }) };
  }

  return {
    ok: true,
    ctx: {
      tokenRowId: tokenRow.id,
      session: {
        id: session.id,
        negotiation_id: session.negotiation_id!,
        draft_id: session.draft_id!,
        user_id: session.user_id!,
        status: session.status!,
        conversation_id: session.conversation_id,
      },
      draft: {
        id: draft.id,
        negotiation_id: draft.negotiation_id,
        revision: draft.revision ?? 0,
        specification: (draft.specification ?? {}) as Record<string, unknown>,
        field_provenance: (draft.field_provenance ?? {}) as Record<string, unknown>,
        conflicts: Array.isArray(draft.conflicts) ? (draft.conflicts as unknown[]) : [],
      },
      negotiation: { id: neg.id, user_id: neg.user_id! },
    },
  };
}
