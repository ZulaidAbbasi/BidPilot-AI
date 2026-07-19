/**
 * Server-only multi-criteria provider ranking.
 *
 * Given per-provider outcome bundles (calls + quotes + evidence for the
 * confirmed spec), returns a stable ranking with a human-readable rationale
 * for the winner and every loser. Only quotes/calls that share the current
 * confirmed spec hash are ranked — mismatched offers are excluded upstream.
 */

export type Priority = "price" | "certainty" | "reliability" | "speed";

export interface ProviderOutcomeInput {
  providerId: string;
  providerName: string;
  callId: string | null;
  callMode: string | null;
  finalOutcome: string | null;
  needsReview: boolean;
  callbackTime: string | null;
  hasRecording: boolean;
  hasTranscript: boolean;
  quotes: Array<{
    id: string;
    quote_stage: "INITIAL" | "REVISED" | "FINAL" | string;
    total_amount: number | null;
    estimate_type: string | null;
    valid_until: string | null;
    deposit_amount: number | null;
    deposit_refundable: boolean | null;
    verification_status: string;
    line_item_count: number;
    conditional_line_item_count: number;
    supported_evidence: number;
    contradictory_evidence: number;
    unsupported_evidence: number;
    missing_evidence: number;
    leverage_quote_id: string | null;
    price_before_leverage: number | null;
    price_after_leverage: number | null;
  }>;
}

export interface ProviderScore {
  providerId: string;
  providerName: string;
  callId: string | null;
  totalPrice: number | null;
  currency: string;
  finalStage: "INITIAL" | "REVISED" | "FINAL" | null;
  finalQuoteId: string | null;
  itemizationScore: number; // 0..1
  certaintyScore: number;    // 0..1
  hiddenFeeRisk: number;     // 0..1 (higher = worse)
  depositRisk: number;       // 0..1 (higher = worse)
  evidenceQuality: number;   // 0..1
  priorityBonus: number;     // 0..1
  composite: number;         // higher is better
  rationale: string[];
  outcomeKind: "quote" | "callback" | "declined" | "unavailable" | "unknown";
  eligibleForWinner: boolean;
  eligibilityReasons: string[];
}

const OUTCOME_KIND: Record<string, ProviderScore["outcomeKind"]> = {
  quote_received: "quote",
  negotiation_completed: "quote",
  callback_requested: "callback",
  refused: "declined",
  unavailable: "unavailable",
  disconnected: "unavailable",
  wrong_number: "unavailable",
  negotiation_failed: "declined",
};

export function scoreProvider(
  input: ProviderOutcomeInput,
  priorities: Priority[],
): ProviderScore {
  const outcomeKind = OUTCOME_KIND[input.finalOutcome ?? ""] ?? "unknown";
  const sorted = [...input.quotes].sort((a, b) => stageWeight(a.quote_stage) - stageWeight(b.quote_stage));
  const finalQ =
    sorted.find((q) => q.quote_stage === "FINAL") ??
    sorted.find((q) => q.quote_stage === "REVISED") ??
    sorted[0] ??
    null;

  const totalPrice = finalQ?.total_amount ?? null;
  const finalStage = (finalQ?.quote_stage ?? null) as ProviderScore["finalStage"];

  // Itemization completeness.
  const items = finalQ?.line_item_count ?? 0;
  const itemizationScore = Math.min(1, items / 4);

  // Estimate certainty (binding > not_to_exceed > flat > hourly > estimated).
  const et = (finalQ?.estimate_type ?? "").toLowerCase();
  const certaintyScore =
    et === "binding" ? 1
      : et === "not_to_exceed" ? 0.85
      : et === "flat" ? 0.65
      : et === "hourly" ? 0.35
      : et === "estimated" ? 0.25
      : 0;

  // Hidden-fee risk from conditional lines / unsupported evidence.
  const conditional = finalQ?.conditional_line_item_count ?? 0;
  const hiddenFeeRisk = Math.min(1, conditional / 3 + (finalQ?.unsupported_evidence ?? 0) / 6);

  // Deposit / cancellation risk.
  const depositAmt = finalQ?.deposit_amount ?? 0;
  const totalAmt = finalQ?.total_amount ?? 0;
  const depositFraction = totalAmt > 0 ? depositAmt / totalAmt : depositAmt > 0 ? 0.5 : 0;
  const nonRefundable = finalQ ? finalQ.deposit_refundable === false : false;
  const depositRisk = Math.min(1, depositFraction * (nonRefundable ? 1.5 : 1));

  // Evidence quality across all captured quotes for this provider.
  const totalEv =
    input.quotes.reduce(
      (n, q) =>
        n + q.supported_evidence + q.contradictory_evidence + q.unsupported_evidence + q.missing_evidence,
      0,
    ) || 0;
  const goodEv = input.quotes.reduce((n, q) => n + q.supported_evidence, 0);
  const badEv = input.quotes.reduce(
    (n, q) => n + q.contradictory_evidence + q.unsupported_evidence,
    0,
  );
  const evidenceQuality =
    totalEv === 0
      ? input.hasTranscript ? 0.15 : 0
      : Math.max(0, goodEv / totalEv - badEv / (totalEv * 2));

  // Customer-priority bonus.
  let bonus = 0;
  if (priorities.includes("price") && totalPrice != null) bonus += 0.15;
  if (priorities.includes("certainty")) bonus += certaintyScore * 0.15;
  if (priorities.includes("reliability")) bonus += (1 - hiddenFeeRisk) * 0.1;
  if (priorities.includes("speed") && finalQ?.valid_until) bonus += 0.05;
  const priorityBonus = Math.min(1, bonus);

  // Composite — price is the anchor once other criteria pass a bar.
  // We convert to a score where higher is better; price handled inversely later.
  const composite =
    certaintyScore * 0.25 +
    itemizationScore * 0.2 +
    (1 - hiddenFeeRisk) * 0.15 +
    (1 - depositRisk) * 0.1 +
    evidenceQuality * 0.2 +
    priorityBonus * 0.1;

  const rationale: string[] = [];
  const eligibilityReasons: string[] = [];
  let eligible = outcomeKind === "quote" && totalPrice != null && !input.needsReview;
  if (outcomeKind !== "quote") {
    eligible = false;
    eligibilityReasons.push(`Outcome is ${input.finalOutcome ?? "unknown"}, not a firm quote`);
  }
  if (totalPrice == null && outcomeKind === "quote") {
    eligible = false;
    eligibilityReasons.push("No verified total price");
  }
  if (input.needsReview) {
    eligible = false;
    eligibilityReasons.push("Call reconciliation flagged for review");
  }
  if (evidenceQuality < 0.2 && outcomeKind === "quote") {
    eligible = false;
    eligibilityReasons.push("Transcript evidence too weak to trust the quote");
  }

  if (eligible) rationale.push(`Verified quote ${formatMoney(totalPrice)} with ${items} itemised lines`);
  if (certaintyScore >= 0.8) rationale.push(`${et.replace("_", " ")} estimate → high price certainty`);
  else if (certaintyScore <= 0.35 && finalQ) rationale.push(`${et || "loose"} estimate → low price certainty`);
  if (hiddenFeeRisk >= 0.5) rationale.push(`${conditional} conditional fee(s) → hidden-fee risk`);
  if (depositRisk >= 0.5) rationale.push(`Deposit ${nonRefundable ? "non-refundable" : "high"} → cancellation risk`);
  if (evidenceQuality >= 0.7) rationale.push("Strong transcript evidence backing the quote");
  else if (evidenceQuality < 0.3) rationale.push("Weak or missing transcript evidence");
  if (input.needsReview) rationale.push("Reconciliation flagged review items");
  if (outcomeKind === "callback") rationale.push(`Provider requested callback${input.callbackTime ? ` at ${input.callbackTime}` : ""}`);
  if (outcomeKind === "declined" || outcomeKind === "unavailable") {
    rationale.push(`Provider ended without quote (${input.finalOutcome ?? "unknown"})`);
  }

  return {
    providerId: input.providerId,
    providerName: input.providerName,
    callId: input.callId,
    totalPrice,
    currency: "USD",
    finalStage,
    finalQuoteId: finalQ?.id ?? null,
    itemizationScore,
    certaintyScore,
    hiddenFeeRisk,
    depositRisk,
    evidenceQuality,
    priorityBonus,
    composite,
    rationale,
    outcomeKind,
    eligibleForWinner: eligible,
    eligibilityReasons,
  };
}

function stageWeight(stage: string): number {
  if (stage === "INITIAL") return 0;
  if (stage === "REVISED") return 1;
  if (stage === "FINAL") return 2;
  return 3;
}

function formatMoney(v: number | null) {
  if (v == null) return "no price";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(v);
}

export function rank(
  scores: ProviderScore[],
  priorities: Priority[],
): ProviderScore[] {
  const eligible = scores.filter((s) => s.eligibleForWinner);
  const others = scores.filter((s) => !s.eligibleForWinner);
  // primary sort for eligible providers is price when price is a priority;
  // then blend with composite quality score.
  const priceWeight = priorities.includes("price") ? 0.7 : 0.4;
  const scoreOf = (s: ProviderScore) => {
    const price = s.totalPrice ?? Number.POSITIVE_INFINITY;
    // Normalize price against best in set (lower is better).
    return { price, s };
  };
  const minPrice =
    eligible.reduce((m, s) => Math.min(m, s.totalPrice ?? Number.POSITIVE_INFINITY), Number.POSITIVE_INFINITY);
  eligible.sort((a, b) => {
    const na = a.totalPrice != null && minPrice > 0 ? minPrice / a.totalPrice : 0;
    const nb = b.totalPrice != null && minPrice > 0 ? minPrice / b.totalPrice : 0;
    const sa = na * priceWeight + a.composite * (1 - priceWeight);
    const sb = nb * priceWeight + b.composite * (1 - priceWeight);
    return sb - sa;
  });
  others.sort((a, b) => b.composite - a.composite);
  return [...eligible, ...others];
}
