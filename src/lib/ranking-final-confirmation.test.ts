import { describe, expect, it } from "vitest";
import { scoreProvider, type ProviderOutcomeInput } from "./ranking.server";

/**
 * Turn B guarantee: a provider whose FINAL quote never received an explicit
 * final_confirmed=true from the provider CANNOT be selected as the winning
 * recommendation, and therefore cannot contribute to verified savings.
 */
function baseInput(overrides: Partial<ProviderOutcomeInput> = {}): ProviderOutcomeInput {
  return {
    providerId: "p1",
    providerName: "Acme Movers",
    callId: "c1",
    callMode: "quote_gathering",
    finalOutcome: "quote_received",
    needsReview: false,
    callbackTime: null,
    hasRecording: true,
    hasTranscript: true,
    quotes: [
      {
        id: "q-initial",
        quote_stage: "INITIAL",
        total_amount: 2000,
        estimate_type: "binding",
        valid_until: null,
        deposit_amount: 200,
        deposit_refundable: true,
        verification_status: "unverified",
        line_item_count: 5,
        conditional_line_item_count: 0,
        supported_evidence: 3,
        contradictory_evidence: 0,
        unsupported_evidence: 0,
        missing_evidence: 0,
        leverage_quote_id: null,
        price_before_leverage: null,
        price_after_leverage: null,
      },
      {
        id: "q-final",
        quote_stage: "FINAL",
        total_amount: 1750,
        estimate_type: "binding",
        valid_until: null,
        deposit_amount: 200,
        deposit_refundable: true,
        verification_status: "unverified",
        // Not confirmed by default.
        final_confirmed: false,
        line_item_count: 5,
        conditional_line_item_count: 0,
        supported_evidence: 3,
        contradictory_evidence: 0,
        unsupported_evidence: 0,
        missing_evidence: 0,
        leverage_quote_id: null,
        price_before_leverage: null,
        price_after_leverage: null,
      },
    ],
    ...overrides,
  };
}

describe("ranking eligibility — FINAL confirmation gate", () => {
  it("excludes unconfirmed FINAL candidates from winning recommendation", () => {
    const score = scoreProvider(baseInput(), ["price"]);
    expect(score.finalStage).toBe("FINAL");
    expect(score.eligibleForWinner).toBe(false);
    expect(score.eligibilityReasons.join(" ")).toMatch(/unconfirmed candidate/i);
  });

  it("includes confirmed FINAL candidates", () => {
    const input = baseInput();
    input.quotes[1]!.final_confirmed = true;
    const score = scoreProvider(input, ["price"]);
    expect(score.eligibleForWinner).toBe(true);
    expect(score.eligibilityReasons).toEqual([]);
  });

  it("excludes providers whose latest quote is still REVISED (no FINAL)", () => {
    const input = baseInput();
    input.quotes = input.quotes.filter((q) => q.quote_stage !== "FINAL");
    input.quotes.push({
      ...input.quotes[0]!,
      id: "q-revised",
      quote_stage: "REVISED",
      total_amount: 1850,
    });
    const score = scoreProvider(input, ["price"]);
    expect(score.finalStage).toBe("REVISED");
    expect(score.eligibleForWinner).toBe(false);
    expect(score.eligibilityReasons.join(" ")).toMatch(/not a confirmed FINAL/i);
  });
});
