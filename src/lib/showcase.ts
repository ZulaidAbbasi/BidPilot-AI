/**
 * Judge-facing showcase readiness derivation. Pure function of persisted
 * evidence — no fabrication, no timers, no side effects.
 *
 * A truthful refusal is a valid terminal outcome for a call, but does NOT
 * satisfy `leverageDrivenImprovement`: the official showcase criterion for
 * "leverage produced a real improvement" remains FAIL until at least one
 * price reduction or documented material-term improvement exists.
 */

export type TerminalOutcome =
  | "quote_received"
  | "callback_committed"
  | "provider_declined"
  | "provider_unavailable"
  | "technical_failure"
  | "negotiation_completed"
  | "negotiation_failed";

export interface ShowcaseCallRow {
  providerId: string;
  showcaseProfile: string | null;
  terminalOutcome: TerminalOutcome | null;
  reconciled: boolean;
  needsReview: boolean;
  jobSpecHash: string | null;
}

export interface ShowcaseQuoteRow {
  providerId: string;
  quoteStage: "INITIAL" | "REVISED" | "FINAL";
  finalConfirmedAt: string | null;
  totalAmount: number | null;
  jobSpecHash: string | null;
  termsChanged: boolean;
  callReconciled: boolean;
  needsReview: boolean;
}

export interface ShowcaseNegotiationCall {
  callId: string;
  terminalOutcome: TerminalOutcome | null;
  reconciled: boolean;
  needsReview: boolean;
  leverageQuoteId: string | null;
}

export interface ShowcaseReadiness {
  distinctStylesCompleted: number; // 0..3
  providerCallsDone: boolean;
  eligibleLeverageAvailable: boolean;
  negotiationTerminated: boolean;
  materialImprovement: boolean;
  overallLeverageDrivenImprovementPass: boolean;
  reasons: string[];
}

const REQUIRED_STYLES = new Set([
  "flexible_transparent",
  "hidden_fee_lowballer",
  "stonewaller_hard_sell",
]);

export function deriveShowcaseReadiness(input: {
  calls: ShowcaseCallRow[];
  quotes: ShowcaseQuoteRow[];
  negotiationCall: ShowcaseNegotiationCall | null;
  initialTotalByProvider: Map<string, number>;
  finalTotalByProvider: Map<string, number>;
}): ShowcaseReadiness {
  const reasons: string[] = [];

  // 1. Three distinct styles with a structured terminal outcome.
  const stylesTerminated = new Set<string>();
  for (const c of input.calls) {
    if (!c.showcaseProfile) continue;
    if (!REQUIRED_STYLES.has(c.showcaseProfile)) continue;
    if (c.terminalOutcome && c.reconciled && !c.needsReview) {
      stylesTerminated.add(c.showcaseProfile);
    }
  }
  const distinctStylesCompleted = stylesTerminated.size;
  const providerCallsDone = distinctStylesCompleted === 3;
  if (!providerCallsDone) {
    reasons.push(
      `Provider calls: ${distinctStylesCompleted}/3 distinct styles have a reconciled terminal outcome.`,
    );
  }

  // 2. Eligible leverage available — at least one FINAL confirmed quote
  //    on the same spec, reconciled, not needs_review.
  const eligibleFinals = input.quotes.filter(
    (q) =>
      q.quoteStage === "FINAL" &&
      q.finalConfirmedAt != null &&
      q.callReconciled &&
      !q.needsReview &&
      q.totalAmount != null,
  );
  const eligibleLeverageAvailable = eligibleFinals.length > 0;
  if (!eligibleLeverageAvailable) {
    reasons.push("Leverage: no eligible FINAL-confirmed comparable quote yet.");
  }

  // 3. Negotiation terminated truthfully.
  const negotiationTerminated =
    !!input.negotiationCall &&
    input.negotiationCall.terminalOutcome != null &&
    input.negotiationCall.reconciled &&
    !input.negotiationCall.needsReview &&
    input.negotiationCall.leverageQuoteId != null;
  if (!negotiationTerminated) {
    reasons.push("Negotiation: not yet reconciled with a terminal outcome and a persisted leverage quote.");
  }

  // 4. Material improvement — at least one price reduction (INITIAL >
  //    FINAL for the same provider) OR a documented terms_changed flag.
  let materialImprovement = false;
  for (const [pid, initial] of input.initialTotalByProvider) {
    const final = input.finalTotalByProvider.get(pid);
    if (final != null && initial != null && final < initial) {
      materialImprovement = true;
      break;
    }
  }
  if (!materialImprovement) {
    materialImprovement = input.quotes.some((q) => q.termsChanged);
  }
  if (!materialImprovement) {
    reasons.push(
      "Improvement: no price reduction or documented terms-changed evidence — truthful refusal keeps this criterion FAIL.",
    );
  }

  return {
    distinctStylesCompleted,
    providerCallsDone,
    eligibleLeverageAvailable,
    negotiationTerminated,
    materialImprovement,
    overallLeverageDrivenImprovementPass:
      providerCallsDone && negotiationTerminated && materialImprovement,
    reasons,
  };
}

/**
 * Server-authoritative savings. Agent-supplied savings are always ignored.
 */
export function computeVerifiedSavings(initialTotal: number, finalTotal: number): number {
  return Math.max(0, initialTotal - finalTotal);
}
