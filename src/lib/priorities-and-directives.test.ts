import { describe, expect, it } from "vitest";

import {
  AI_DISCLOSURE_DIRECTIVE,
  NEGOTIATION_DIRECTIVE,
  QUOTE_GATHERING_DIRECTIVE,
} from "@/lib/agent-directives";
import { scoreProvider, type Priority, type ProviderOutcomeInput } from "@/lib/ranking.server";

function baseInput(overrides: Partial<ProviderOutcomeInput> = {}): ProviderOutcomeInput {
  return {
    providerId: "p1",
    providerName: "Test Provider",
    callId: "c1",
    callMode: "QUOTE_GATHERING",
    finalOutcome: "quote_received",
    needsReview: false,
    callbackTime: null,
    hasRecording: true,
    hasTranscript: true,
    quotes: [
      {
        id: "q1",
        quote_stage: "FINAL",
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
      },
    ],
    ...overrides,
  };
}

describe("AI disclosure directives", () => {
  it("both mode directives require AI disclosure", () => {
    expect(QUOTE_GATHERING_DIRECTIVE).toContain("AI DISCLOSURE");
    expect(NEGOTIATION_DIRECTIVE).toContain("AI DISCLOSURE");
    expect(AI_DISCLOSURE_DIRECTIVE).toMatch(/AI assistant/i);
    expect(AI_DISCLOSURE_DIRECTIVE).toMatch(/Never claim to be a human/i);
  });
});

describe("customer priorities influence ranking weights", () => {
  it("gives a higher priorityBonus when customer priorities include price + certainty", () => {
    const empty = scoreProvider(baseInput(), [] as Priority[]);
    const priced = scoreProvider(baseInput(), ["lowest_all_in_price", "estimate_certainty"]);
    expect(priced.priorityBonus).toBeGreaterThan(empty.priorityBonus);
    expect(priced.composite).toBeGreaterThan(empty.composite);
  });

  it("evidence_quality priority rewards well-supported quotes", () => {
    const flat = scoreProvider(baseInput(), []);
    const weighted = scoreProvider(baseInput(), ["evidence_quality"]);
    expect(weighted.priorityBonus).toBeGreaterThan(flat.priorityBonus);
  });

  it("legacy 'price' alias still works alongside canonical 'lowest_all_in_price'", () => {
    const legacy = scoreProvider(baseInput(), ["price"]);
    const canonical = scoreProvider(baseInput(), ["lowest_all_in_price"]);
    expect(legacy.priorityBonus).toBeCloseTo(canonical.priorityBonus, 6);
  });
});
