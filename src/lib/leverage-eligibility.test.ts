import { describe, expect, it } from "vitest";
import { checkLeverageEligibility } from "./leverage-eligibility.server";

const base = {
  currentProviderId: "P-CUR",
  currentSpecHash: "HASH-A",
  now: new Date("2026-07-20T00:00:00Z"),
  call: { status: "completed", needs_review: false },
  evidence: [{ evidence_type: "price_total", support_status: "supported" }],
  quote: {
    id: "Q1",
    provider_id: "P-OTHER",
    negotiation_id: "N1",
    spec_hash: "HASH-A",
    quote_stage: "FINAL",
    final_confirmed_at: "2026-07-19T10:00:00Z",
    verification_status: "verified",
    valid_until: "2026-08-01",
  },
};

describe("checkLeverageEligibility (strict)", () => {
  it("accepts a same-spec, different-provider, FINAL confirmed, verified, evidenced quote", () => {
    expect(checkLeverageEligibility(base)).toEqual({ eligible: true });
  });

  it("rejects same-provider quotes", () => {
    expect(checkLeverageEligibility({ ...base, currentProviderId: "P-OTHER" })).toEqual({
      eligible: false,
      reason: "same_provider",
    });
  });

  it("rejects different spec_hash", () => {
    expect(
      checkLeverageEligibility({ ...base, quote: { ...base.quote, spec_hash: "HASH-B" } }),
    ).toEqual({ eligible: false, reason: "different_spec" });
  });

  it("rejects REVISED and INITIAL stages", () => {
    for (const stage of ["REVISED", "INITIAL"] as const) {
      expect(
        checkLeverageEligibility({ ...base, quote: { ...base.quote, quote_stage: stage } }),
      ).toEqual({ eligible: false, reason: "not_final" });
    }
  });

  it("rejects FINAL without final_confirmed_at", () => {
    expect(
      checkLeverageEligibility({ ...base, quote: { ...base.quote, final_confirmed_at: null } }),
    ).toEqual({ eligible: false, reason: "not_final_confirmed" });
  });

  it("rejects flagged quotes", () => {
    expect(
      checkLeverageEligibility({
        ...base,
        quote: { ...base.quote, verification_status: "flagged" },
      }),
    ).toEqual({ eligible: false, reason: "flagged" });
  });

  it("rejects when no supported price/total/line transcript evidence", () => {
    expect(checkLeverageEligibility({ ...base, evidence: [] })).toEqual({
      eligible: false,
      reason: "missing_transcript_evidence",
    });
    expect(
      checkLeverageEligibility({
        ...base,
        evidence: [{ evidence_type: "identity", support_status: "supported" }],
      }),
    ).toEqual({ eligible: false, reason: "missing_transcript_evidence" });
  });

  it("rejects when the parent call is needs_review or not completed", () => {
    expect(
      checkLeverageEligibility({ ...base, call: { status: "completed", needs_review: true } }),
    ).toEqual({ eligible: false, reason: "call_needs_review" });
    expect(
      checkLeverageEligibility({ ...base, call: { status: "in_progress", needs_review: false } }),
    ).toEqual({ eligible: false, reason: "call_not_completed" });
  });

  it("rejects expired quotes", () => {
    expect(
      checkLeverageEligibility({ ...base, quote: { ...base.quote, valid_until: "2026-01-01" } }),
    ).toEqual({ eligible: false, reason: "expired" });
  });
});
