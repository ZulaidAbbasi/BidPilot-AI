/**
 * Provider Add — "Next action" workflow helpers.
 *
 * Pure, dependency-free helpers so the UI and unit tests share one
 * source of truth. Nothing in this file talks to Supabase or ElevenLabs;
 * the caller wires the values into a real navigation after inserting
 * the provider row.
 *
 * Design invariants (kept out of the UI so tests can pin them):
 *   - `call_mode` is a property of a specific `calls` row, never of a
 *     provider. This module only PRODUCES the mode the caller should
 *     use when it later opens a call; it does not persist anything.
 *   - "Negotiate an existing quote" is available only when the shared
 *     server-side `checkLeverageEligibility` accepts at least one
 *     comparable FINAL confirmed quote for the current spec hash.
 *   - Placeholder example strings (used only in the modal's
 *     `placeholder=` attribute) are treated as "no value" and must
 *     never be persisted, even if a user copy-pastes them verbatim.
 *   - No rehearsal-style / role-card / private-provider-behaviour fields
 *     appear here. Anti-screenplay rule.
 */

import { checkLeverageEligibility, type EligibilityFailureReason } from "./leverage-eligibility.server";

export const NEXT_ACTIONS = ["add_only", "quote_gathering", "negotiation"] as const;
export type NextAction = (typeof NEXT_ACTIONS)[number];

export const DEFAULT_NEXT_ACTION: NextAction = "quote_gathering";

export const NEXT_ACTION_META: Record<
  NextAction,
  { label: string; description: string; submitLabel: string }
> = {
  add_only: {
    label: "Add provider only",
    description:
      "Just save the provider record. No call will be prepared and no voice credits will be spent.",
    submitLabel: "Add provider",
  },
  quote_gathering: {
    label: "Gather an initial quote",
    description:
      "Ask this provider for its own itemized offer. No competing quote will be used.",
    submitLabel: "Add & prepare quote call",
  },
  negotiation: {
    label: "Negotiate an existing quote",
    description:
      "Use one verified comparable offer to request a genuine price or material-term improvement.",
    submitLabel: "Add & prepare negotiation",
  },
};

/**
 * Placeholder example strings that live in the Add Provider modal's
 * `placeholder=""` attributes. These are visual hints only — if a user
 * ever types them verbatim into the field, we treat them as "unset"
 * on submit so a fake number never reaches the database.
 */
export const PROVIDER_FIELD_PLACEHOLDERS: Readonly<Record<"phone" | "website" | "location", readonly string[]>> = {
  phone: ["+1 555 123 4567", "555-123-4567", "5551234567"],
  website: ["acmemoving.com", "example.com", "https://example.com"],
  location: ["Brooklyn, NY", "City, ST"],
} as const;

export function isPlaceholderProviderValue(
  field: "phone" | "website" | "location",
  value: string,
): boolean {
  const v = value.trim().toLowerCase();
  if (!v) return false;
  return PROVIDER_FIELD_PLACEHOLDERS[field].some((p) => p.toLowerCase() === v);
}

export type ProviderInput = { name: string; phone: string; website: string; location: string };
export type SanitizedProvider = {
  name: string;
  phone: string | null;
  website: string | null;
  location: string | null;
};

/**
 * Trims free-text fields, converts empty/placeholder values to `null`,
 * and leaves the caller responsible for validating that `name` is
 * present. Never mutates input.
 */
export function sanitizeProviderInput(input: ProviderInput): SanitizedProvider {
  const clean = (
    field: "phone" | "website" | "location",
    raw: string,
  ): string | null => {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    if (isPlaceholderProviderValue(field, trimmed)) return null;
    return trimmed;
  };
  return {
    name: input.name.trim(),
    phone: clean("phone", input.phone),
    website: clean("website", input.website),
    location: clean("location", input.location),
  };
}

// ---------------------------------------------------------------------------
// Leverage eligibility evaluation (client-side, but uses the shared server rule)
// ---------------------------------------------------------------------------

export type LeverageQuoteRow = {
  id: string;
  provider_id: string;
  provider_name: string | null;
  spec_hash: string | null;
  quote_stage: string;
  final_confirmed_at: string | null;
  verification_status: string;
  valid_until: string | null;
  total_amount: number | null;
  currency: string | null;
  captured_at: string;
  call: { status: string; needs_review: boolean | null } | null;
  evidence: Array<{ evidence_type: string; support_status: string }>;
};

export type EvaluatedLeverage = {
  eligible: LeverageQuoteRow[];
  ineligibleReasonsById: Map<string, EligibilityFailureReason>;
  /**
   * Human-readable reason to show under a disabled "Negotiate an existing
   * quote" option when there are zero eligible quotes.
   */
  disabledReason: string | null;
};

export function evaluateLeverageOptions(args: {
  candidates: LeverageQuoteRow[];
  currentProviderId: string;
  currentSpecHash: string;
  currentNegotiationId: string;
  now?: Date;
}): EvaluatedLeverage {
  const eligible: LeverageQuoteRow[] = [];
  const reasons = new Map<string, EligibilityFailureReason>();
  for (const q of args.candidates) {
    const result = checkLeverageEligibility({
      quote: {
        id: q.id,
        provider_id: q.provider_id,
        spec_hash: q.spec_hash,
        quote_stage: q.quote_stage,
        final_confirmed_at: q.final_confirmed_at,
        verification_status: q.verification_status,
        valid_until: q.valid_until,
        negotiation_id: args.currentNegotiationId,
      },
      call: q.call,
      evidence: q.evidence,
      currentProviderId: args.currentProviderId,
      currentSpecHash: args.currentSpecHash,
      now: args.now,
    });
    if (result.eligible) {
      eligible.push(q);
    } else {
      reasons.set(q.id, result.reason);
    }
  }
  let disabledReason: string | null = null;
  if (eligible.length === 0) {
    if (args.candidates.length === 0) {
      disabledReason =
        "No verified comparable quote is available yet. Complete Quote Gathering with another provider first.";
    } else {
      // At least one candidate existed but every one was rejected. Surface
      // the specific reason set so the UI can explain WHY none qualify.
      const set = new Set(reasons.values());
      disabledReason = describeIneligibilityReasons(set);
    }
  }
  return { eligible, ineligibleReasonsById: reasons, disabledReason };
}

const REASON_LABEL: Record<EligibilityFailureReason, string> = {
  different_spec: "the specification has changed since the offer was captured",
  same_provider: "the only comparable offer is from this same provider",
  not_final: "the offer has not been confirmed as FINAL yet",
  not_final_confirmed: "the FINAL offer has not been closed on the call",
  flagged: "the offer has been flagged for review",
  missing_transcript_evidence:
    "there is no supporting transcript evidence for the price on the offer",
  call_needs_review: "the source call still needs review",
  call_not_completed: "the source call is not completed and reconciled",
  expired: "the offer has expired",
};

function describeIneligibilityReasons(reasons: Set<EligibilityFailureReason>): string {
  if (reasons.size === 0) {
    return "No verified comparable quote is available yet.";
  }
  const parts = Array.from(reasons).map((r) => REASON_LABEL[r]).filter(Boolean);
  return `No verified comparable quote is available yet — ${parts.join("; ")}.`;
}

// ---------------------------------------------------------------------------
// Submission resolution
// ---------------------------------------------------------------------------

export type NextActionSubmission =
  | { nextAction: "add_only"; callMode: null; leverageQuoteId: null }
  | { nextAction: "quote_gathering"; callMode: "QUOTE_GATHERING"; leverageQuoteId: null }
  | { nextAction: "negotiation"; callMode: "NEGOTIATION"; leverageQuoteId: string };

export type NextActionValidationError = {
  kind: "missing_name" | "negotiation_requires_leverage" | "leverage_not_eligible";
  message: string;
};

/**
 * Turn the UI selection into a validated submission payload OR a
 * user-visible error. The caller uses `submission.callMode` and
 * `submission.leverageQuoteId` to build the navigation query string —
 * NEVER to write anything on the provider record.
 */
export function resolveNextActionSubmission(args: {
  nextAction: NextAction;
  providerName: string;
  selectedLeverageQuoteId: string | null;
  eligibleLeverageIds: readonly string[];
}): { ok: true; submission: NextActionSubmission } | { ok: false; error: NextActionValidationError } {
  if (!args.providerName.trim()) {
    return { ok: false, error: { kind: "missing_name", message: "Enter a provider name" } };
  }
  if (args.nextAction === "add_only") {
    return { ok: true, submission: { nextAction: "add_only", callMode: null, leverageQuoteId: null } };
  }
  if (args.nextAction === "quote_gathering") {
    return {
      ok: true,
      submission: { nextAction: "quote_gathering", callMode: "QUOTE_GATHERING", leverageQuoteId: null },
    };
  }
  // negotiation
  if (!args.selectedLeverageQuoteId) {
    return {
      ok: false,
      error: {
        kind: "negotiation_requires_leverage",
        message: "Select a verified comparable quote to use as leverage.",
      },
    };
  }
  if (!args.eligibleLeverageIds.includes(args.selectedLeverageQuoteId)) {
    // Guardrail: never silently fall back from NEGOTIATION to QUOTE_GATHERING.
    return {
      ok: false,
      error: {
        kind: "leverage_not_eligible",
        message: "The selected quote is no longer eligible as leverage.",
      },
    };
  }
  return {
    ok: true,
    submission: {
      nextAction: "negotiation",
      callMode: "NEGOTIATION",
      leverageQuoteId: args.selectedLeverageQuoteId,
    },
  };
}

/**
 * Build the query string used to navigate to the Control Room after a
 * prepared submission. The Control Room reads these to preselect the
 * new provider + intended call mode; the "Start voice call" button
 * remains an explicit user action.
 */
export function buildControlRoomSearch(args: {
  providerId: string;
  submission: NextActionSubmission;
}): Record<string, string> | null {
  if (args.submission.nextAction === "add_only") return null;
  const search: Record<string, string> = {
    providerId: args.providerId,
    mode: args.submission.callMode,
  };
  if (args.submission.nextAction === "negotiation") {
    search.leverageQuoteId = args.submission.leverageQuoteId;
  }
  return search;
}
