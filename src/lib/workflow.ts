/**
 * Canonical BidPilot AI negotiation workflow states.
 *
 * IMPORTANT: keep this in sync with the CHECK constraint on
 * public.negotiations.workflow_status in the Supabase migrations.
 */
export const WORKFLOW_STATUSES = [
  "DRAFT",
  "INTAKE_IN_PROGRESS",
  "AWAITING_CONFIRMATION",
  "SPEC_CONFIRMED",
  "CALLING_PROVIDERS",
  "QUOTES_RECEIVED",
  "AUDITING_QUOTES",
  "CLARIFICATION_REQUIRED",
  "READY_TO_NEGOTIATE",
  "AWAITING_HUMAN_APPROVAL",
  "NEGOTIATING",
  "NEGOTIATION_COMPLETE",
  "REPORT_READY",
  "FAILED",
] as const;

export type WorkflowStatus = (typeof WORKFLOW_STATUSES)[number];

/** Ordered pipeline stages for progress UI (excludes FAILED terminal state). */
export const WORKFLOW_STAGES: { key: WorkflowStatus; label: string }[] = [
  { key: "DRAFT", label: "Draft" },
  { key: "INTAKE_IN_PROGRESS", label: "Intake" },
  { key: "AWAITING_CONFIRMATION", label: "Awaiting confirmation" },
  { key: "SPEC_CONFIRMED", label: "Specification" },
  { key: "CALLING_PROVIDERS", label: "Calling providers" },
  { key: "QUOTES_RECEIVED", label: "Quotes received" },
  { key: "AUDITING_QUOTES", label: "Auditing quotes" },
  { key: "CLARIFICATION_REQUIRED", label: "Clarification" },
  { key: "READY_TO_NEGOTIATE", label: "Ready to negotiate" },
  { key: "AWAITING_HUMAN_APPROVAL", label: "Awaiting approval" },
  { key: "NEGOTIATING", label: "Negotiating" },
  { key: "NEGOTIATION_COMPLETE", label: "Negotiation complete" },
  { key: "REPORT_READY", label: "Report" },
];

export function isWorkflowStatus(v: string): v is WorkflowStatus {
  return (WORKFLOW_STATUSES as readonly string[]).includes(v);
}

export function workflowStageIndex(status: string): number {
  const idx = WORKFLOW_STAGES.findIndex((s) => s.key === status);
  return idx === -1 ? 0 : idx;
}

export function workflowLabel(status: string): string {
  const stage = WORKFLOW_STAGES.find((s) => s.key === status);
  if (stage) return stage.label;
  if (status === "FAILED") return "Failed";
  return status;
}

export function statusTone(status: string): "verified" | "warn" | "risk" | "neutral" {
  if (status === "REPORT_READY" || status === "NEGOTIATION_COMPLETE") return "verified";
  if (status === "FAILED") return "risk";
  if (
    status === "DRAFT" ||
    status === "CLARIFICATION_REQUIRED" ||
    status === "AWAITING_HUMAN_APPROVAL"
  )
    return "warn";
  return "neutral";
}

/** Next-action hint used by the overview page. */
export function nextAction(
  status: string,
  hasSpec: boolean,
  providerCount: number,
): {
  label: string;
  to: "intake" | "specification" | "providers" | "control-room" | "negotiate" | "report";
} {
  if (status === "REPORT_READY") return { label: "View report", to: "report" };
  if (status === "NEGOTIATION_COMPLETE") return { label: "Prepare report", to: "report" };
  if (
    status === "NEGOTIATING" ||
    status === "AWAITING_HUMAN_APPROVAL" ||
    status === "READY_TO_NEGOTIATE"
  )
    return { label: "Open negotiation", to: "negotiate" };
  if (
    status === "CALLING_PROVIDERS" ||
    status === "QUOTES_RECEIVED" ||
    status === "AUDITING_QUOTES" ||
    status === "CLARIFICATION_REQUIRED"
  )
    return { label: "Open control room", to: "control-room" };
  if (status === "SPEC_CONFIRMED" && providerCount === 0)
    return { label: "Add providers", to: "providers" };
  if (status === "SPEC_CONFIRMED") return { label: "Open control room", to: "control-room" };
  if (status === "AWAITING_CONFIRMATION" || hasSpec === false)
    return { label: "Confirm specification", to: "specification" };
  if (status === "INTAKE_IN_PROGRESS") return { label: "Continue intake", to: "intake" };
  return { label: "Complete intake", to: "intake" };
}
