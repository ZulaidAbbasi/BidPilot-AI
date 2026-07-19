import { describe, expect, it } from "vitest";

import { reconcile } from "./call-reconciliation.server";
import { parseSpokenAmount, reconcileSpokenAmount } from "./spoken-number";

// Production scenario recap:
//   1. Provider says "fifteen hundred dollars"   → agent extracts 500  (BUG)
//   2. Provider says "one thousand five hundred" → agent extracts 1500
//   3. Provider says "thirteen hundred fifty"    → agent extracts 1350 (final offer)
// Expected outcome after fixes:
//   - INITIAL parsed via spoken words → 1500 (not 500)
//   - REVISED $1500, REVISED $1350 → the latest gets promoted to FINAL by
//     finalize-call-outcome when the caller reports negotiation_completed.
//   - reconcile() picks baseline = $1500 (higher earlier), final = $1350
//   - savings = 150, price_changed = true
describe("$1,500 → $1,350 negotiation flow", () => {
  it("parses fifteen-hundred spoken phrases into 1500 and overrides the LLM 500", () => {
    expect(parseSpokenAmount("fifteen hundred dollars")).toBe(1500);
    expect(parseSpokenAmount("one thousand five hundred")).toBe(1500);
    expect(parseSpokenAmount("thirteen hundred fifty")).toBe(1350);

    const rec = reconcileSpokenAmount(500, "fifteen hundred dollars");
    expect(rec.source).toBe("words_override");
    expect(rec.amount).toBe(1500);
  });

  it("reconciles baseline=1500, final=1350, savings=150 across the three snapshots", () => {
    const quotes = [
      {
        id: "q1",
        quote_stage: "INITIAL",
        total_amount: 1500,
        terms: null,
        captured_at: "2026-07-19T10:00:00Z",
      },
      {
        id: "q2",
        quote_stage: "REVISED",
        total_amount: 1500,
        terms: null,
        captured_at: "2026-07-19T10:01:00Z",
      },
      {
        id: "q3",
        quote_stage: "FINAL",
        total_amount: 1350,
        terms: null,
        captured_at: "2026-07-19T10:02:00Z",
      },
    ];
    const transcripts = [
      {
        id: "t1",
        text: "The total will be one thousand five hundred dollars.",
        sequence_number: 1,
        started_at_ms: 1000,
      },
      {
        id: "t2",
        text: "Okay, I can bring it down to thirteen hundred fifty for the whole job, that's the final offer.",
        sequence_number: 2,
        started_at_ms: 2000,
      },
    ];
    const rec = reconcile(quotes as never, {}, transcripts as never);
    expect(rec.initialTotal).toBe(1500);
    expect(rec.finalTotal).toBe(1350);
    expect(rec.priceChanged).toBe(true);
    expect(Math.max(0, (rec.initialTotal ?? 0) - (rec.finalTotal ?? 0))).toBe(150);
  });

  it("still finds baseline=1500 when the anomalous $500 INITIAL is present", () => {
    const quotes = [
      {
        id: "q0",
        quote_stage: "INITIAL",
        total_amount: 500,
        terms: null,
        captured_at: "2026-07-19T09:59:00Z",
      },
      {
        id: "q1",
        quote_stage: "REVISED",
        total_amount: 1500,
        terms: null,
        captured_at: "2026-07-19T10:00:00Z",
      },
      {
        id: "q2",
        quote_stage: "FINAL",
        total_amount: 1350,
        terms: null,
        captured_at: "2026-07-19T10:02:00Z",
      },
    ];
    const rec = reconcile(quotes as never, {}, []);
    expect(rec.initialTotal).toBe(1500);
    expect(rec.finalTotal).toBe(1350);
  });
});
