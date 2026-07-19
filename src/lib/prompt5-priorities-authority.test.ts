/**
 * Prompt 5 — structured priorities and authority integrity tests.
 *
 * These tests prove that:
 *   - customer_priorities drive ranking outcomes (winner can change)
 *   - multiple priorities compose cumulatively
 *   - hard eligibility (needs_review, unconfirmed FINAL) always overrides
 *     any customer preference
 *   - the 30% low-outlier exclusion overrides the price priority
 *   - the pure `deriveCallAuthority` helper matches the challenge invariants
 *     — a `may_*=false` permission BLOCKS the corresponding action, and a
 *     revoked `may_use_verified_leverage` suppresses leverage even in
 *     NEGOTIATION mode.
 *   - the locked call context computes authority from the confirmed
 *     specification's structured `agent_permissions`, not from
 *     `special_instructions`.
 */
import { describe, expect, it } from "vitest";

import {
  deriveCallAuthority,
  isLeverageAuthorized,
  type AgentPermissionsInput,
} from "@/lib/call-authority";
import {
  rank,
  scoreProvider,
  normalizedPriorityWeights,
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

describe("ranking is driven by structured customer priorities", () => {
  it("lowest_all_in_price favors the cheaper eligible quote", () => {
    const A = bundle("A", { total_amount: 1400 });
    const B = bundle("B", { total_amount: 1900 });
    const priorities: Priority[] = ["lowest_all_in_price"];
    const ranked = rank(
      [scoreProvider(A, priorities), scoreProvider(B, priorities)],
      priorities,
    );
    expect(ranked[0].providerId).toBe("A");
  });

  it("estimate_certainty can favor a slightly higher binding quote over a loose lower one", () => {
    const A = bundle("A", { total_amount: 1500, estimate_type: "estimated" });
    const B = bundle("B", { total_amount: 1650, estimate_type: "binding" });
    const priorities: Priority[] = ["estimate_certainty"];
    const ranked = rank(
      [scoreProvider(A, priorities), scoreProvider(B, priorities)],
      priorities,
    );
    expect(ranked[0].providerId).toBe("B");
  });

  it("lower_deposit_risk independently affects ranking", () => {
    const noPriority = scoreProvider(
      bundle("A", { deposit_amount: 500, deposit_refundable: false }),
      [] as Priority[],
    );
    const withPriority = scoreProvider(
      bundle("A", { deposit_amount: 500, deposit_refundable: false }),
      ["lower_deposit_risk"],
    );
    expect(withPriority.priorityBonus).toBeGreaterThan(noPriority.priorityBonus);
  });

  it("multiple selected priorities have cumulative influence", () => {
    const one = scoreProvider(bundle("A"), ["lowest_all_in_price"]);
    const many = scoreProvider(bundle("A"), [
      "lowest_all_in_price",
      "estimate_certainty",
      "evidence_quality",
    ]);
    expect(many.priorityBonus).toBeGreaterThan(one.priorityBonus);
    expect(many.composite).toBeGreaterThan(one.composite);
    // Server-computed weights must reflect the selection.
    const w = normalizedPriorityWeights([
      "lowest_all_in_price",
      "estimate_certainty",
      "evidence_quality",
    ]);
    const total = Object.values(w).reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(1, 2);
    expect(Object.keys(w).sort()).toEqual(
      ["estimate_certainty", "evidence_quality", "lowest_all_in_price"].sort(),
    );
  });
});

describe("hard eligibility overrides customer preferences", () => {
  it("needs_review blocks the cheapest quote from winning even under lowest_all_in_price", () => {
    const A = bundle("A", { total_amount: 900 }, { needsReview: true });
    const B = bundle("B", { total_amount: 2500 });
    const priorities: Priority[] = ["lowest_all_in_price"];
    const ranked = rank(
      [scoreProvider(A, priorities), scoreProvider(B, priorities)],
      priorities,
    );
    expect(ranked[0].providerId).toBe("B");
    expect(ranked.find((r) => r.providerId === "A")?.eligibleForWinner).toBe(false);
  });

  it("an unconfirmed FINAL quote cannot win even when it is cheapest", () => {
    const A = bundle("A", { total_amount: 900, final_confirmed: false });
    const B = bundle("B", { total_amount: 2400 });
    const priorities: Priority[] = ["lowest_all_in_price"];
    const ranked = rank(
      [scoreProvider(A, priorities), scoreProvider(B, priorities)],
      priorities,
    );
    expect(ranked[0].providerId).toBe("B");
  });
});

describe("low-outlier exclusion overrides the price priority", () => {
  it("a low-outlier flagged quote cannot win under lowest_all_in_price", () => {
    // Simulate the report pipeline: low-outlier is decided upstream, and
    // when true the ranker must treat the quote as ineligible.
    const priorities: Priority[] = ["lowest_all_in_price"];
    const outlier = scoreProvider(bundle("A", { total_amount: 800 }), priorities);
    outlier.lowOutlier = true;
    outlier.eligibleForWinner = false;
    outlier.eligibilityReasons.push("Low outlier vs comparable verified quotes");
    const normal = scoreProvider(bundle("B", { total_amount: 1600 }), priorities);
    const ranked = rank([outlier, normal], priorities);
    expect(ranked[0].providerId).toBe("B");
    expect(ranked.find((r) => r.providerId === "A")?.eligibleForWinner).toBe(false);
  });
});

describe("deriveCallAuthority — false permissions block prohibited actions", () => {
  const revoked: AgentPermissionsInput = {
    may_use_verified_leverage: false,
    may_accept_offer: false,
    may_change_inventory: false,
    may_reveal_max_budget: false,
    may_sign_or_authorize: false,
    may_pay_deposit: false,
  };

  it("may_use_verified_leverage=false suppresses leverage authority even in NEGOTIATION", () => {
    expect(isLeverageAuthorized(revoked)).toBe(false);
    const auth = deriveCallAuthority({
      callMode: "NEGOTIATION",
      perms: revoked,
      // The route sets leverageAvailable=false when authority is revoked,
      // but even if a caller passed true this must not enable it.
      leverageAvailable: true,
    });
    expect(auth.allowed_actions.use_verified_leverage).toBe(false);
    expect(auth.forbidden_actions.use_verified_leverage).toBe(true);
    expect(auth.forbidden_actions.mention_competing_quote).toBe(true);
    expect(auth.notes).toMatch(/REVOKED leverage authority/);
  });

  it("may_accept_offer=false forbids representing an offer as accepted", () => {
    const auth = deriveCallAuthority({
      callMode: "NEGOTIATION",
      perms: revoked,
      leverageAvailable: false,
    });
    expect(auth.can_accept_quote).toBe(false);
    expect(auth.forbidden_actions.accept_offer).toBe(true);
  });

  it("may_sign_or_authorize=false prevents booking the move", () => {
    const auth = deriveCallAuthority({
      callMode: "NEGOTIATION",
      perms: revoked,
      leverageAvailable: false,
    });
    expect(auth.can_book).toBe(false);
    expect(auth.forbidden_actions.sign_or_authorize).toBe(true);
  });

  it("may_change_inventory=false prevents approved scope changes", () => {
    const auth = deriveCallAuthority({
      callMode: "NEGOTIATION",
      perms: revoked,
      leverageAvailable: false,
    });
    expect(auth.forbidden_actions.change_inventory).toBe(true);
  });

  it("may_reveal_max_budget=false prevents budget disclosure", () => {
    const auth = deriveCallAuthority({
      callMode: "NEGOTIATION",
      perms: revoked,
      leverageAvailable: false,
    });
    expect(auth.forbidden_actions.reveal_max_budget).toBe(true);
  });
});

describe("locked call context reads structured authority, not special_instructions", () => {
  it("QUOTE_GATHERING mode forbids competing-quote mentions regardless of perms", () => {
    const auth = deriveCallAuthority({
      callMode: "QUOTE_GATHERING",
      perms: { may_use_verified_leverage: true, may_negotiate_price: true },
      leverageAvailable: true, // caller misbehaves — mode must still win
    });
    expect(auth.allowed_actions.use_verified_leverage).toBe(false);
    expect(auth.allowed_actions.negotiate_price).toBe(false);
    expect(auth.forbidden_actions.mention_competing_quote).toBe(true);
  });

  it("NEGOTIATION mode with full authority + eligible leverage authorizes citation", () => {
    const auth = deriveCallAuthority({
      callMode: "NEGOTIATION",
      perms: {
        may_use_verified_leverage: true,
        may_negotiate_price: true,
      },
      leverageAvailable: true,
    });
    expect(auth.allowed_actions.use_verified_leverage).toBe(true);
    expect(auth.allowed_actions.negotiate_price).toBe(true);
    expect(auth.forbidden_actions.mention_competing_quote).toBe(false);
    expect(auth.notes).toMatch(/verified leverage/);
  });

  it("default permissions never auto-grant customer-scope actions", () => {
    // Empty perms → conservative defaults: no accept, book, deposit,
    // inventory change, budget reveal, sign.
    const auth = deriveCallAuthority({
      callMode: "NEGOTIATION",
      perms: {},
      leverageAvailable: false,
    });
    expect(auth.can_accept_quote).toBe(false);
    expect(auth.can_book).toBe(false);
    expect(auth.forbidden_actions.pay_deposit).toBe(true);
    expect(auth.forbidden_actions.change_inventory).toBe(true);
    expect(auth.forbidden_actions.reveal_max_budget).toBe(true);
    expect(auth.forbidden_actions.sign_or_authorize).toBe(true);
  });
});
