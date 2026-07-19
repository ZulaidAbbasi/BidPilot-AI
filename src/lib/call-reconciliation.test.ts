import { describe, expect, it } from "vitest";
import { classifyAmount, classifyText, reconcile } from "./call-reconciliation.server";

describe("classifyAmount", () => {
  it("marks supported when amount appears in transcript", () => {
    expect(classifyAmount(1250, "the total will be about $1,250 today").status).toBe("supported");
    expect(classifyAmount(1250, "twelve fifty").status).toBe("missing_evidence");
  });
  it("supports common spoken amount forms", () => {
    expect(classifyAmount(1500, "the initial estimate is fifteen hundred dollars").status).toBe(
      "supported",
    );
    expect(
      classifyAmount(1350, "the final total is one thousand three hundred fifty dollars").status,
    ).toBe("supported");
  });
  it("null amount is missing_evidence", () => {
    expect(classifyAmount(null, "anything").status).toBe("missing_evidence");
  });
});

describe("classifyText", () => {
  it("supported when substring appears", () => {
    expect(classifyText("no elevator fee", "we waived the no elevator fee provision")).toBe(
      "supported",
    );
  });
  it("empty text is missing_evidence", () => {
    expect(classifyText(null, "x")).toBe("missing_evidence");
  });
});

describe("reconcile", () => {
  const transcripts = [
    { id: "t1", text: "final price is $1,000", sequence_number: 0, started_at_ms: 0 },
  ];
  it("computes price change from INITIAL/FINAL quotes", () => {
    const r = reconcile(
      [
        {
          id: "q1",
          quote_stage: "INITIAL",
          total_amount: 1500,
          low_amount: null,
          high_amount: null,
          deposit_amount: null,
          terms: null,
          price_change_conditions: null,
        },
        {
          id: "q2",
          quote_stage: "FINAL",
          total_amount: 1000,
          low_amount: null,
          high_amount: null,
          deposit_amount: null,
          terms: null,
          price_change_conditions: null,
        },
      ],
      {},
      transcripts,
    );
    expect(r.priceChanged).toBe(true);
    expect(r.initialTotal).toBe(1500);
    expect(r.finalTotal).toBe(1000);
    // Evidence generated per quote (price).
    expect(r.evidence.filter((e) => e.evidence_type === "price").length).toBe(2);
  });
  it("no price change when totals match", () => {
    const r = reconcile(
      [
        {
          id: "q1",
          quote_stage: "INITIAL",
          total_amount: 500,
          low_amount: null,
          high_amount: null,
          deposit_amount: null,
          terms: null,
          price_change_conditions: null,
        },
        {
          id: "q2",
          quote_stage: "FINAL",
          total_amount: 500,
          low_amount: null,
          high_amount: null,
          deposit_amount: null,
          terms: null,
          price_change_conditions: null,
        },
      ],
      {},
      transcripts,
    );
    expect(r.priceChanged).toBe(false);
  });
});
