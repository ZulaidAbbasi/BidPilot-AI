import { describe, expect, it } from "vitest";
import { deriveShowcaseReadiness, computeVerifiedSavings } from "./showcase";

type Input = Parameters<typeof deriveShowcaseReadiness>[0];
const baseInput = (): Input => ({
  calls: [],
  quotes: [],
  negotiationCall: null,
  initialTotalByProvider: new Map<string, number>(),
  finalTotalByProvider: new Map<string, number>(),
});

describe("showcase readiness — pipeline completion derivation", () => {
  it("requires three DISTINCT styles with reconciled terminal outcomes", () => {
    const i = baseInput();
    // Two calls of the same style should not count as two.
    i.calls = [
      {
        providerId: "p1",
        showcaseProfile: "flexible_transparent",
        terminalOutcome: "quote_received",
        reconciled: true,
        needsReview: false,
        jobSpecHash: "h",
      },
      {
        providerId: "p2",
        showcaseProfile: "flexible_transparent",
        terminalOutcome: "quote_received",
        reconciled: true,
        needsReview: false,
        jobSpecHash: "h",
      },
    ];
    const r = deriveShowcaseReadiness(i);
    expect(r.distinctStylesCompleted).toBe(1);
    expect(r.providerCallsDone).toBe(false);
  });

  it("counts a truthful refusal as a valid terminal outcome for its style", () => {
    const i = baseInput();
    i.calls = (["flexible_transparent", "hidden_fee_lowballer", "stonewaller_hard_sell"] as const).map(
      (s, idx) => ({
        providerId: `p${idx}`,
        showcaseProfile: s,
        terminalOutcome: s === "stonewaller_hard_sell" ? "provider_declined" : "quote_received",
        reconciled: true,
        needsReview: false,
        jobSpecHash: "h",
      }),
    );
    const r = deriveShowcaseReadiness(i);
    expect(r.providerCallsDone).toBe(true);
  });

  it("needs_review calls do NOT satisfy their style slot", () => {
    const i = baseInput();
    i.calls = [
      {
        providerId: "p1",
        showcaseProfile: "flexible_transparent",
        terminalOutcome: "quote_received",
        reconciled: true,
        needsReview: true, // <— review-flagged
        jobSpecHash: "h",
      },
    ];
    const r = deriveShowcaseReadiness(i);
    expect(r.distinctStylesCompleted).toBe(0);
  });

  it("eligibleLeverageAvailable requires FINAL + final_confirmed_at + reconciled + not needs_review", () => {
    const i = baseInput();
    i.quotes = [
      {
        providerId: "p1",
        quoteStage: "FINAL",
        finalConfirmedAt: null, // <— missing confirmation
        totalAmount: 1000,
        jobSpecHash: "h",
        termsChanged: false,
        callReconciled: true,
        needsReview: false,
      },
    ];
    expect(deriveShowcaseReadiness(i).eligibleLeverageAvailable).toBe(false);

    i.quotes[0].finalConfirmedAt = "2026-07-20T00:00:00Z";
    expect(deriveShowcaseReadiness(i).eligibleLeverageAvailable).toBe(true);

    i.quotes[0].needsReview = true;
    expect(deriveShowcaseReadiness(i).eligibleLeverageAvailable).toBe(false);
  });

  it("negotiation is truthful when reconciled + terminal outcome + leverage_quote_id set", () => {
    const i = baseInput();
    i.negotiationCall = {
      callId: "c",
      terminalOutcome: "negotiation_failed",
      reconciled: true,
      needsReview: false,
      leverageQuoteId: "q",
    };
    expect(deriveShowcaseReadiness(i).negotiationTerminated).toBe(true);
  });

  it("truthful refusal keeps leverageDrivenImprovement=FAIL (the official criterion)", () => {
    const i = baseInput();
    // Provider calls complete, negotiation reconciled as a truthful refusal,
    // no price movement, no terms_changed.
    i.calls = (["flexible_transparent", "hidden_fee_lowballer", "stonewaller_hard_sell"] as const).map(
      (s, idx) => ({
        providerId: `p${idx}`,
        showcaseProfile: s,
        terminalOutcome: "quote_received",
        reconciled: true,
        needsReview: false,
        jobSpecHash: "h",
      }),
    );
    i.quotes = [
      {
        providerId: "p0",
        quoteStage: "FINAL",
        finalConfirmedAt: "t",
        totalAmount: 1000,
        jobSpecHash: "h",
        termsChanged: false,
        callReconciled: true,
        needsReview: false,
      },
    ];
    i.negotiationCall = {
      callId: "c",
      terminalOutcome: "negotiation_failed",
      reconciled: true,
      needsReview: false,
      leverageQuoteId: "q",
    };
    const r = deriveShowcaseReadiness(i);
    expect(r.providerCallsDone).toBe(true);
    expect(r.negotiationTerminated).toBe(true);
    expect(r.materialImprovement).toBe(false);
    expect(r.overallLeverageDrivenImprovementPass).toBe(false);
  });

  it("term-only improvement flips materialImprovement true, price savings stay zero", () => {
    const i = baseInput();
    i.quotes = [
      {
        providerId: "p0",
        quoteStage: "FINAL",
        finalConfirmedAt: "t",
        totalAmount: 1000,
        jobSpecHash: "h",
        termsChanged: true, // <— term-only improvement
        callReconciled: true,
        needsReview: false,
      },
    ];
    // Same initial and final total, so price savings must be 0.
    i.initialTotalByProvider.set("p0", 1000);
    i.finalTotalByProvider.set("p0", 1000);
    expect(deriveShowcaseReadiness(i).materialImprovement).toBe(true);
    expect(computeVerifiedSavings(1000, 1000)).toBe(0);
  });

  it("price reduction flips materialImprovement true and gives positive savings", () => {
    const i = baseInput();
    i.initialTotalByProvider.set("p0", 1500);
    i.finalTotalByProvider.set("p0", 1350);
    expect(deriveShowcaseReadiness(i).materialImprovement).toBe(true);
    expect(computeVerifiedSavings(1500, 1350)).toBe(150);
  });

  it("computeVerifiedSavings never returns a negative number (agent inflation cannot happen)", () => {
    expect(computeVerifiedSavings(1000, 1500)).toBe(0);
    expect(computeVerifiedSavings(0, 0)).toBe(0);
  });
});
