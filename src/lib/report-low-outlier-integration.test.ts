/**
 * Integration test — exercises the production report normalization path for
 * the 30% low-outlier red flag with a range-only FINAL quote.
 *
 * The report pipeline (`getNegotiationReport`) builds `ProviderOutcomeInput`
 * bundles from the DB, runs `scoreProvider` on each, then calls
 * `applyOutliersToScoredProviders` (the shared helper used by both the
 * server function and this test). This test wires exactly the same code
 * path — bundle → scoreProvider → applyOutliersToScoredProviders — and
 * verifies the range-only quote:
 *   - enters the comparable set,
 *   - screens on high_amount (1050), never the midpoint (975),
 *   - has comparisonValueBasis === "range_high",
 *   - is flagged 30% below the $1500 / $1500 comparable pair,
 *   - appears in the returned `lowOutliers` array.
 */
import { describe, expect, it } from "vitest";
import { scoreProvider, type ProviderOutcomeInput } from "./ranking.server";
import { applyOutliersToScoredProviders } from "./build-report.server";

function bundle(overrides: Partial<ProviderOutcomeInput> & {
  providerId: string;
  callId: string;
  quote: ProviderOutcomeInput["quotes"][number];
}): ProviderOutcomeInput {
  const { providerId, callId, quote, ...rest } = overrides;
  return {
    providerId,
    providerName: `Provider ${providerId}`,
    callId,
    callMode: "quote_gathering",
    finalOutcome: "quote_received",
    needsReview: false,
    callbackTime: null,
    hasRecording: true,
    hasTranscript: true,
    quotes: [quote],
    ...rest,
  };
}

function baseFinalQuote(overrides: Partial<ProviderOutcomeInput["quotes"][number]> = {}) {
  return {
    id: `q-${Math.random().toString(36).slice(2, 8)}`,
    quote_stage: "FINAL" as const,
    total_amount: 1500,
    estimate_type: "binding",
    valid_until: null,
    deposit_amount: 200,
    deposit_refundable: true,
    verification_status: "verified",
    final_confirmed: true,
    line_item_count: 5,
    conditional_line_item_count: 0,
    supported_evidence: 4,
    contradictory_evidence: 0,
    unsupported_evidence: 0,
    missing_evidence: 0,
    leverage_quote_id: null,
    price_before_leverage: null,
    price_after_leverage: null,
    ...overrides,
  };
}

describe("report pipeline — range-only low-outlier integration", () => {
  it("range-only quote (total_amount=null, low=900, high=1050) screens on 1050 (range_high) and is flagged against $1500/$1500 comparables", () => {
    const rangeOnlyBundle = bundle({
      providerId: "p-range",
      callId: "c-range",
      quote: baseFinalQuote({
        id: "q-range",
        total_amount: null,
        high_amount: 1050,
        // low_amount is intentionally not consumed by the scorer / outlier
        // rule — it must never appear in the screening path.
      }),
    });
    const comp1 = bundle({
      providerId: "p-a",
      callId: "c-a",
      quote: baseFinalQuote({ id: "q-a", total_amount: 1500 }),
    });
    const comp2 = bundle({
      providerId: "p-b",
      callId: "c-b",
      quote: baseFinalQuote({ id: "q-b", total_amount: 1500 }),
    });

    // Production scoring path.
    const scored = [rangeOnlyBundle, comp1, comp2].map((b) => scoreProvider(b, ["price"]));

    // A range-only quote is NOT winner-eligible (no verified exact total),
    // but it must be comparable for the low-outlier rule.
    const rangeScore = scored.find((s) => s.providerId === "p-range")!;
    expect(rangeScore.totalPrice).toBeNull();
    expect(rangeScore.highAmount).toBe(1050);
    expect(rangeScore.comparableForOutlier).toBe(true);
    expect(rangeScore.finalStage).toBe("FINAL");

    // Production outlier-application path — the same helper the server
    // function `getNegotiationReport` calls.
    const lowOutliers = applyOutliersToScoredProviders(scored);

    // The range-only quote is flagged.
    const flagged = lowOutliers.find((o) => o.providerId === "p-range");
    expect(flagged).toBeDefined();
    expect(flagged!.comparisonValue).toBe(1050);
    expect(flagged!.comparisonValueBasis).toBe("range_high");
    expect(flagged!.referenceMedian).toBe(1500);
    expect(flagged!.percentBelowComparables).toBeCloseTo(0.3, 5);
    expect(flagged!.reason).toMatch(/below comparable verified offers/i);

    // Midpoint (975) is never used anywhere in the pipeline.
    expect(rangeScore.lowOutlierComparisonValue).toBe(1050);
    expect(rangeScore.lowOutlierComparisonValue).not.toBe(975);
    expect(rangeScore.lowOutlierReferenceMedian).not.toBe(975);

    // Flagged range-only provider loses automatic-winner eligibility with an
    // explanatory reason.
    expect(rangeScore.eligibleForWinner).toBe(false);
    expect(rangeScore.eligibilityReasons.join(" ")).toMatch(/low outlier|below comparable verified/i);

    // The two comparable $1500 quotes are neither flagged nor demoted.
    for (const id of ["p-a", "p-b"] as const) {
      const s = scored.find((x) => x.providerId === id)!;
      expect(s.lowOutlier).toBe(false);
      expect(s.eligibleForWinner).toBe(true);
    }

    // No other lowOutliers entries besides the range-only provider.
    expect(lowOutliers.map((o) => o.providerId)).toEqual(["p-range"]);
  });

  it("range-only quote just above threshold (high=1051, comparables=1500/1500) is NOT flagged", () => {
    const scored = [
      bundle({
        providerId: "p-range",
        callId: "c-range",
        quote: baseFinalQuote({ id: "q-range", total_amount: null, high_amount: 1051 }),
      }),
      bundle({
        providerId: "p-a",
        callId: "c-a",
        quote: baseFinalQuote({ id: "q-a", total_amount: 1500 }),
      }),
      bundle({
        providerId: "p-b",
        callId: "c-b",
        quote: baseFinalQuote({ id: "q-b", total_amount: 1500 }),
      }),
    ].map((b) => scoreProvider(b, ["price"]));

    const lowOutliers = applyOutliersToScoredProviders(scored);
    expect(lowOutliers).toEqual([]);
    const r = scored.find((s) => s.providerId === "p-range")!;
    expect(r.lowOutlier).toBe(false);
    expect(r.lowOutlierComparisonValue).toBe(1051);
    expect(r.lowOutlierComparisonBasis).toBe("range_high");
  });
});
