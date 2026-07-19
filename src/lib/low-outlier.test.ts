import { describe, expect, it } from "vitest";
import { LOW_OUTLIER_THRESHOLD, applyLowOutlierRedFlag } from "./low-outlier.server";

function mk(overrides: Partial<Parameters<typeof applyLowOutlierRedFlag>[0][number]> & { id: string }) {
  return {
    comparable: true,
    currency: "USD",
    totalAmount: null,
    highAmount: null,
    ...overrides,
  };
}

describe("applyLowOutlierRedFlag", () => {
  it("constant", () => {
    expect(LOW_OUTLIER_THRESHOLD).toBe(0.3);
  });

  it("flags exact 30% below boundary", () => {
    const r = applyLowOutlierRedFlag([
      mk({ id: "a", totalAmount: 1050 }),
      mk({ id: "b", totalAmount: 1500 }),
      mk({ id: "c", totalAmount: 1500 }),
    ]);
    const a = r.find((x) => x.id === "a")!;
    expect(a.lowOutlier).toBe(true);
    expect(a.lowOutlierComparisonBasis).toBe("exact_total");
    expect(a.lowOutlierReferenceMedian).toBe(1500);
    expect(a.percentBelowComparables).toBeCloseTo(0.3, 6);
    expect(a.lowOutlierReason).toMatch(/30%\+ low outlier/);
    expect(r.find((x) => x.id === "b")!.lowOutlier).toBe(false);
  });

  it("does not flag at ~26.67% below (under threshold)", () => {
    const r = applyLowOutlierRedFlag([
      mk({ id: "a", totalAmount: 1100 }),
      mk({ id: "b", totalAmount: 1500 }),
      mk({ id: "c", totalAmount: 1500 }),
    ]);
    expect(r.find((x) => x.id === "a")!.lowOutlier).toBe(false);
    expect(r.find((x) => x.id === "a")!.percentBelowComparables).toBeCloseTo(0.2667, 3);
  });

  it("flags a clear low outlier and produces a reason string", () => {
    const r = applyLowOutlierRedFlag([
      mk({ id: "a", totalAmount: 1000 }),
      mk({ id: "b", totalAmount: 1500 }),
      mk({ id: "c", totalAmount: 1600 }),
    ]);
    const a = r.find((x) => x.id === "a")!;
    expect(a.lowOutlier).toBe(true);
    expect(a.lowOutlierReferenceMedian).toBe(1550);
    expect(a.lowOutlierReason).toContain("below comparable verified offers");
  });

  it("single comparable quote: no peers → not flagged, null percent", () => {
    const r = applyLowOutlierRedFlag([mk({ id: "a", totalAmount: 500 })]);
    expect(r[0].lowOutlier).toBe(false);
    expect(r[0].percentBelowComparables).toBeNull();
    expect(r[0].lowOutlierReferenceMedian).toBeNull();
  });

  it("non-comparable inputs (callback/refused/etc marked comparable=false) never flagged and not in peer set", () => {
    const r = applyLowOutlierRedFlag([
      mk({ id: "a", totalAmount: 1000 }),
      mk({ id: "callback", comparable: false, totalAmount: 200 }),
      mk({ id: "refused", comparable: false, totalAmount: 300 }),
      mk({ id: "b", totalAmount: 1500 }),
      mk({ id: "c", totalAmount: 1600 }),
    ]);
    // Non-comparable rows return null result, are never flagged.
    for (const id of ["callback", "refused"]) {
      const row = r.find((x) => x.id === id)!;
      expect(row.lowOutlier).toBe(false);
      expect(row.percentBelowComparables).toBeNull();
      expect(row.lowOutlierComparisonValue).toBeNull();
    }
    // Peer median for "a" is median(1500, 1600) = 1550 (not polluted by 200/300).
    expect(r.find((x) => x.id === "a")!.lowOutlierReferenceMedian).toBe(1550);
  });

  it("different currency: excluded from same-currency peer median", () => {
    const r = applyLowOutlierRedFlag([
      mk({ id: "usd-a", currency: "USD", totalAmount: 1000 }),
      mk({ id: "usd-b", currency: "USD", totalAmount: 1500 }),
      mk({ id: "eur", currency: "EUR", totalAmount: 100 }),
    ]);
    // usd-a has only one USD peer (1500). percentBelow = 33.3% → flagged.
    const a = r.find((x) => x.id === "usd-a")!;
    expect(a.lowOutlierReferenceMedian).toBe(1500);
    expect(a.lowOutlier).toBe(true);
    // EUR row has no peers.
    expect(r.find((x) => x.id === "eur")!.lowOutlier).toBe(false);
    expect(r.find((x) => x.id === "eur")!.lowOutlierReferenceMedian).toBeNull();
  });

  it("range: uses high_amount, never midpoint", () => {
    const r = applyLowOutlierRedFlag([
      mk({ id: "range", totalAmount: null, highAmount: 1050 }),
      mk({ id: "b", totalAmount: 1500 }),
      mk({ id: "c", totalAmount: 1500 }),
    ]);
    const row = r.find((x) => x.id === "range")!;
    expect(row.lowOutlierComparisonValue).toBe(1050);
    expect(row.lowOutlierComparisonBasis).toBe("range_high");
    expect(row.lowOutlier).toBe(true);
  });

  it("exact total basis is exposed on results", () => {
    const r = applyLowOutlierRedFlag([
      mk({ id: "a", totalAmount: 1400 }),
      mk({ id: "b", totalAmount: 1500 }),
      mk({ id: "c", totalAmount: 1500 }),
    ]);
    const a = r.find((x) => x.id === "a")!;
    expect(a.lowOutlierComparisonBasis).toBe("exact_total");
    expect(a.lowOutlierComparisonValue).toBe(1400);
    expect(a.lowOutlier).toBe(false);
  });

  it("no comparable priced peer (all excluded) → not flagged", () => {
    const r = applyLowOutlierRedFlag([
      mk({ id: "a", totalAmount: 1000 }),
      mk({ id: "excluded", comparable: false, totalAmount: 1500 }),
    ]);
    expect(r.find((x) => x.id === "a")!.lowOutlier).toBe(false);
    expect(r.find((x) => x.id === "a")!.percentBelowComparables).toBeNull();
  });
});
