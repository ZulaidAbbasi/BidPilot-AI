import { describe, expect, it } from "vitest";
import { reconcile, type LineItemRow, type QuoteRow } from "./call-reconciliation.server";

const q: QuoteRow = {
  id: "q1",
  quote_stage: "INITIAL",
  total_amount: 1500,
  low_amount: null,
  high_amount: null,
  deposit_amount: 200,
  terms: null,
  price_change_conditions: null,
  captured_at: new Date(0).toISOString(),
};

const transcripts = [
  {
    id: "t1",
    text: "Does that fifteen hundred include labor, transportation, packing, storage, stairs, long carry, fuel and tax?",
    sequence_number: 0,
    started_at_ms: 1000,
  },
  {
    id: "t2",
    text: "Yes, everything is included.",
    sequence_number: 1,
    started_at_ms: 2000,
  },
  {
    id: "t3",
    text: "Great, and what about the cancellation deadline?",
    sequence_number: 2,
    started_at_ms: 3000,
  },
];

function inclusionItem(category: string, label: string): LineItemRow {
  return {
    id: `li-${category}`,
    label,
    amount: null,
    provider_words: "Yes, everything is included.",
    category,
    included: true,
  };
}

describe("multi-turn inclusion evidence", () => {
  it("links Q→A span for inclusion-only line items", () => {
    const items: LineItemRow[] = [
      inclusionItem("labor", "Labor included"),
      inclusionItem("transport", "Transportation included"),
      inclusionItem("fuel", "Fuel included"),
    ];
    const r = reconcile([q], { q1: items }, transcripts);
    const line = r.evidence.filter((e) => e.evidence_type === "line_item");
    expect(line.every((e) => e.support_status === "supported")).toBe(true);
    // Excerpt must include both the agent question and the provider affirmation.
    expect(line[0].extracted_text).toContain("Yes, everything is included");
    expect(line[0].extracted_text).toContain("labor");
  });

  it("does not verify category-specific amounts from 'everything included'", () => {
    const withAmount: LineItemRow = {
      id: "li-labor-amt",
      label: "Labor 400",
      amount: 400, // amount is present, so inclusion-span rule does not apply
      provider_words: null,
      category: "labor",
      included: true,
    };
    const r = reconcile([q], { q1: [withAmount] }, transcripts);
    const line = r.evidence.find((e) => e.evidence_type === "line_item")!;
    // Amount 400 is NOT in transcript, so it must not be marked supported.
    expect(line.support_status).not.toBe("supported");
  });

  it("keeps categories the provider did not mention as missing_evidence", () => {
    const item = inclusionItem("insurance", "Insurance");
    const r = reconcile([q], { q1: [item] }, transcripts);
    const line = r.evidence.find((e) => e.evidence_type === "line_item")!;
    expect(line.support_status).toBe("missing_evidence");
  });

  it("computes zero verified savings when INITIAL and FINAL match", () => {
    const final: QuoteRow = {
      ...q,
      id: "q2",
      quote_stage: "FINAL",
      captured_at: new Date(10_000).toISOString(),
    };
    const r = reconcile([q, final], {}, transcripts);
    expect(r.priceChanged).toBe(false);
    expect(r.initialTotal).toBe(1500);
    expect(r.finalTotal).toBe(1500);
  });
});
