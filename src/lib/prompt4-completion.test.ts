import { describe, expect, it } from "vitest";

import {
  normalizedPriorityWeights,
  scoreProvider,
  rank,
  type Priority,
  type ProviderOutcomeInput,
} from "@/lib/ranking.server";

function q(overrides: Partial<ProviderOutcomeInput["quotes"][number]> = {}) {
  return {
    id: "q",
    quote_stage: "FINAL" as const,
    total_amount: 1500,
    estimate_type: "binding",
    valid_until: null,
    deposit_amount: 100,
    deposit_refundable: true,
    verification_status: "confirmed",
    final_confirmed: true,
    line_item_count: 5,
    conditional_line_item_count: 0,
    supported_evidence: 3,
    contradictory_evidence: 0,
    unsupported_evidence: 0,
    missing_evidence: 0,
    leverage_quote_id: null,
    price_before_leverage: null,
    price_after_leverage: null,
    ...overrides,
  };
}

function bundle(
  providerId: string,
  quoteOverrides: Partial<ProviderOutcomeInput["quotes"][number]> = {},
  overrides: Partial<ProviderOutcomeInput> = {},
): ProviderOutcomeInput {
  return {
    providerId,
    providerName: providerId,
    callId: `c-${providerId}`,
    callMode: "QUOTE_GATHERING",
    finalOutcome: "quote_received",
    needsReview: false,
    callbackTime: null,
    hasRecording: true,
    hasTranscript: true,
    quotes: [q({ id: `q-${providerId}`, ...quoteOverrides })],
    ...overrides,
  };
}

describe("normalizedPriorityWeights", () => {
  it("returns empty object when no priorities are set", () => {
    expect(normalizedPriorityWeights([])).toEqual({});
  });

  it("weights sum to 1 for a mixed priority list", () => {
    const w = normalizedPriorityWeights([
      "lowest_all_in_price",
      "estimate_certainty",
      "evidence_quality",
    ]);
    const total = Object.values(w).reduce((n, v) => n + v, 0);
    expect(total).toBeCloseTo(1, 2);
    expect(w.lowest_all_in_price).toBeGreaterThan(0);
    expect(w.estimate_certainty).toBeGreaterThan(0);
    expect(w.evidence_quality).toBeGreaterThan(0);
  });

  it("cumulative priorities produce a larger score contribution than a single related one", () => {
    // Provider benefits from both a low refundable deposit and cancellation
    // safety; adding a second related priority should push their composite up.
    const b = bundle("solo", {
      deposit_amount: 100,
      deposit_refundable: true,
    });
    const single = scoreProvider(b, ["lower_deposit_risk"]);
    const combined = scoreProvider(b, ["lower_deposit_risk", "better_cancellation"]);
    expect(combined.priorityBonus).toBeGreaterThan(single.priorityBonus);
    expect(combined.composite).toBeGreaterThan(single.composite);
  });
});

describe("customer priority behavior — winner changes", () => {
  it("different priorities produce different rankings on the same provider set", () => {
    // A: cheaper but loose estimate + higher deposit.
    // B: pricier but binding + refundable low deposit.
    const A = bundle("A", {
      total_amount: 1400,
      estimate_type: "estimated",
      deposit_amount: 400,
      deposit_refundable: false,
      line_item_count: 3,
      supported_evidence: 2,
    });
    const B = bundle("B", {
      total_amount: 1600,
      estimate_type: "binding",
      deposit_amount: 100,
      deposit_refundable: true,
      line_item_count: 6,
      supported_evidence: 4,
    });

    const priceFirst: Priority[] = ["lowest_all_in_price"];
    const rankedPrice = rank(
      [scoreProvider(A, priceFirst), scoreProvider(B, priceFirst)],
      priceFirst,
    );
    expect(rankedPrice[0].providerId).toBe("A");

    const certaintyFirst: Priority[] = [
      "estimate_certainty",
      "lower_deposit_risk",
      "better_cancellation",
    ];
    const rankedCertainty = rank(
      [scoreProvider(A, certaintyFirst), scoreProvider(B, certaintyFirst)],
      certaintyFirst,
    );
    expect(rankedCertainty[0].providerId).toBe("B");
  });

  it("hard ineligibility (needs_review) always overrides customer preferences", () => {
    const A = bundle("A", { total_amount: 1000 }, { needsReview: true });
    const B = bundle("B", { total_amount: 5000 });
    const priorities: Priority[] = ["lowest_all_in_price"];
    const ranked = rank(
      [scoreProvider(A, priorities), scoreProvider(B, priorities)],
      priorities,
    );
    expect(ranked[0].providerId).toBe("B");
    expect(ranked.find((r) => r.providerId === "A")?.eligibleForWinner).toBe(false);
  });

  it("hard ineligibility (unconfirmed FINAL) always overrides customer preferences", () => {
    const A = bundle("A", { total_amount: 1000, final_confirmed: false });
    const B = bundle("B", { total_amount: 5000 });
    const priorities: Priority[] = ["lowest_all_in_price"];
    const ranked = rank(
      [scoreProvider(A, priorities), scoreProvider(B, priorities)],
      priorities,
    );
    expect(ranked[0].providerId).toBe("B");
  });
});
