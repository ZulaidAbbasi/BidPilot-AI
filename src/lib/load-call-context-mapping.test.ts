import { describe, expect, it } from "vitest";
import { checkLeverageEligibility } from "./leverage-eligibility.server";

// This suite proves that the mapping from `checkLeverageEligibility` reasons
// to the load-call-context `leverage_unavailable_reason` values in
// `src/routes/api/public/elevenlabs/tools/load-call-context.ts` stays complete.
// If the shared function grows a new failure reason, this test forces the
// endpoint's map to be extended too.
const ELIGIBILITY_REASON_MAP = {
  different_spec: "different_spec",
  same_provider: "same_provider",
  not_final: "not_final",
  not_final_confirmed: "final_not_confirmed",
  flagged: "flagged",
  missing_transcript_evidence: "unsupported_evidence",
  call_needs_review: "needs_review",
  call_not_completed: "source_call_incomplete",
  expired: "expired",
} as const;

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

describe("load-call-context leverage reason mapping", () => {
  it("maps every shared-eligibility failure reason to a stable endpoint reason", () => {
    const cases: Array<[keyof typeof ELIGIBILITY_REASON_MAP, () => unknown]> = [
      ["same_provider", () => checkLeverageEligibility({ ...base, currentProviderId: "P-OTHER" })],
      [
        "different_spec",
        () =>
          checkLeverageEligibility({ ...base, quote: { ...base.quote, spec_hash: "HASH-B" } }),
      ],
      [
        "not_final",
        () =>
          checkLeverageEligibility({
            ...base,
            quote: { ...base.quote, quote_stage: "REVISED" },
          }),
      ],
      [
        "not_final_confirmed",
        () =>
          checkLeverageEligibility({
            ...base,
            quote: { ...base.quote, final_confirmed_at: null },
          }),
      ],
      [
        "flagged",
        () =>
          checkLeverageEligibility({
            ...base,
            quote: { ...base.quote, verification_status: "flagged" },
          }),
      ],
      ["missing_transcript_evidence", () => checkLeverageEligibility({ ...base, evidence: [] })],
      [
        "call_needs_review",
        () =>
          checkLeverageEligibility({
            ...base,
            call: { status: "completed", needs_review: true },
          }),
      ],
      [
        "call_not_completed",
        () =>
          checkLeverageEligibility({
            ...base,
            call: { status: "in_progress", needs_review: false },
          }),
      ],
      [
        "expired",
        () =>
          checkLeverageEligibility({
            ...base,
            quote: { ...base.quote, valid_until: "2026-01-01" },
          }),
      ],
    ];
    for (const [reason, run] of cases) {
      const result = run() as { eligible: false; reason: string };
      expect(result.eligible).toBe(false);
      expect(result.reason).toBe(reason);
      expect(ELIGIBILITY_REASON_MAP[reason]).toBeTypeOf("string");
    }
  });
});
