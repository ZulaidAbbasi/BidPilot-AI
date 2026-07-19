/**
 * Shared helpers to return safe, agent-friendly validation errors from the
 * ElevenLabs tool endpoints.
 *
 * Response contract (matches the ElevenLabs tool schema our agent expects):
 *   { ok: false, error_code: "invalid_field", field, retryable: true, issues: [...] }
 *
 * Never log tokens, credentials, or raw payload contents. Only field paths,
 * received types, and stable Zod error codes are logged.
 */
import { ZodError, type ZodIssue } from "zod";
import { jsonResponse } from "@/lib/call-token.server";

export interface ToolValidationIssue {
  field: string;
  code: string;
  received: string;
  message: string;
}

function receivedType(issue: ZodIssue): string {
  // `received` exists on invalid_type; fall back to code otherwise.
  const anyIssue = issue as unknown as { received?: unknown };
  if (typeof anyIssue.received === "string") return anyIssue.received;
  return "unknown";
}

export function formatZodIssues(err: ZodError): ToolValidationIssue[] {
  return err.issues.map((issue: ZodIssue) => ({
    field: issue.path.length ? issue.path.join(".") : "(root)",
    code: issue.code,
    received: receivedType(issue),
    message: (issue.message || "invalid").slice(0, 200),
  }));
}

/**
 * Agent-facing validation failure. Returns HTTP 200 with `ok:false` so the
 * ElevenLabs runtime does not surface a generic "technical error" to the
 * provider — the agent can read the structured body and retry with a
 * corrected value on the next turn.
 */
export function invalidRequestResponse(err: unknown, endpoint: string): Response {
  if (err instanceof ZodError) {
    const issues = formatZodIssues(err);
    const primary = issues[0];
    // Sanitized structured log line — endpoint, field, received type, error code, HTTP status.
    for (const i of issues) {
      console.warn(
        `[tool-validation] endpoint=${endpoint} field=${i.field} received=${i.received} code=${i.code} status=200`,
      );
    }
    return jsonResponse(200, {
      ok: false,
      error_code: "invalid_field",
      field: primary?.field ?? "(root)",
      retryable: true,
      message: "One or more fields did not match the accepted schema. Retry with corrected values.",
      issues,
    });
  }
  console.warn(`[tool-validation] endpoint=${endpoint} field=(root) code=parse_error status=200`);
  return jsonResponse(200, {
    ok: false,
    error_code: "invalid_body",
    field: "(root)",
    retryable: true,
    message: "Request body could not be parsed as JSON.",
  });
}
