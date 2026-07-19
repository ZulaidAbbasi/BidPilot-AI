/**
 * Strict leverage-eligibility rules for NEGOTIATION-mode provider calls.
 *
 * A quote is eligible to be cited as leverage against `currentProviderId`
 * only when ALL of the following hold:
 *   1. Same negotiation.
 *   2. Same `job_spec_hash` as the currently confirmed specification.
 *   3. From a DIFFERENT provider than the one being called.
 *   4. `quote_stage = 'FINAL'` AND `final_confirmed_at IS NOT NULL`
 *      (the provider explicitly closed on the offer).
 *   5. `verification_status <> 'flagged'` (no contradictory evidence).
 *   6. Has at least one `quote_evidence` row with `support_status='supported'`
 *      and an `evidence_type` matching price/total/line (transcript evidence).
 *   7. The parent call is `completed` and NOT `needs_review`.
 *   8. Not expired (`valid_until` in the future, or NULL).
 *
 * These rules are enforced identically on the client picker, at call-start
 * (`startProviderRehearsal`), and in the mode-strictness tests.
 */
export type EligibilityFailureReason =
  | "different_spec"
  | "same_provider"
  | "not_final"
  | "not_final_confirmed"
  | "flagged"
  | "missing_transcript_evidence"
  | "call_needs_review"
  | "call_not_completed"
  | "expired";

export type LeverageEligibilityInput = {
  quote: {
    id: string;
    provider_id: string;
    spec_hash: string | null;
    quote_stage: string;
    final_confirmed_at: string | null;
    verification_status: string;
    valid_until: string | null;
    negotiation_id: string;
  };
  call: { status: string; needs_review: boolean | null } | null;
  evidence: Array<{ evidence_type: string; support_status: string }>;
  currentProviderId: string;
  currentSpecHash: string;
  now?: Date;
};

export type EligibilityResult = { eligible: true } | { eligible: false; reason: EligibilityFailureReason };

const PRICE_EVIDENCE_TYPE = /price|total|line/i;

export function checkLeverageEligibility(input: LeverageEligibilityInput): EligibilityResult {
  const { quote, call, evidence, currentProviderId, currentSpecHash } = input;
  const now = input.now ?? new Date();
  if (quote.provider_id === currentProviderId) return { eligible: false, reason: "same_provider" };
  if (!quote.spec_hash || quote.spec_hash !== currentSpecHash)
    return { eligible: false, reason: "different_spec" };
  if (quote.quote_stage !== "FINAL") return { eligible: false, reason: "not_final" };
  if (!quote.final_confirmed_at) return { eligible: false, reason: "not_final_confirmed" };
  if (quote.verification_status === "flagged") return { eligible: false, reason: "flagged" };
  if (!call) return { eligible: false, reason: "call_not_completed" };
  if (call.status !== "completed") return { eligible: false, reason: "call_not_completed" };
  if (call.needs_review) return { eligible: false, reason: "call_needs_review" };
  const supported = evidence.some(
    (e) => e.support_status === "supported" && PRICE_EVIDENCE_TYPE.test(e.evidence_type),
  );
  if (!supported) return { eligible: false, reason: "missing_transcript_evidence" };
  if (quote.valid_until) {
    const vu = new Date(quote.valid_until).getTime();
    if (Number.isFinite(vu) && vu < now.getTime()) return { eligible: false, reason: "expired" };
  }
  return { eligible: true };
}
