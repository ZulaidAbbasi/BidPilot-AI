/**
 * Shared server-side helpers for the negotiation report / judge-mode
 * pipeline. Extracted so `getNegotiationReport`, `getJudgeModeSnapshot`,
 * and integration tests all exercise the same production normalization
 * path for the 30% low-outlier red flag.
 */
import { applyLowOutlierRedFlag } from "./low-outlier.server";
import type { ProviderScore } from "./ranking.server";

export interface LowOutlierReportEntry {
  providerId: string;
  providerName: string;
  callId: string | null;
  quoteId: string | null;
  currency: string;
  comparisonValue: number | null;
  comparisonValueBasis: "exact_total" | "range_high" | null;
  percentBelowComparables: number | null;
  referenceMedian: number | null;
  reason: string;
}

/**
 * Applies the 30%-below-comparable-verified-offers red flag to the given
 * scored providers, mutating each score's outlier fields, downgrading any
 * flagged entry's `eligibleForWinner` to false with an explanatory reason,
 * and returning one report entry per flagged provider (empty when none).
 *
 * The comparable set is `s.comparableForOutlier` only. Screening value is
 * `totalPrice` when present, else `highAmount`; midpoints of ranges are
 * never used.
 */
export function applyOutliersToScoredProviders(
  scored: ProviderScore[],
): LowOutlierReportEntry[] {
  const outlierResults = applyLowOutlierRedFlag(
    scored.map((s) => ({
      id: `${s.providerId}::${s.callId ?? ""}`,
      comparable: s.comparableForOutlier,
      currency: s.currency,
      totalAmount: s.totalPrice,
      highAmount: s.highAmount,
    })),
  );
  const byId = new Map(outlierResults.map((r) => [r.id, r]));
  const list: LowOutlierReportEntry[] = [];
  for (const s of scored) {
    const r = byId.get(`${s.providerId}::${s.callId ?? ""}`);
    if (!r) continue;
    s.lowOutlier = r.lowOutlier;
    s.percentBelowComparables = r.percentBelowComparables;
    s.lowOutlierComparisonValue = r.lowOutlierComparisonValue;
    s.lowOutlierComparisonBasis = r.lowOutlierComparisonBasis;
    s.lowOutlierReferenceMedian = r.lowOutlierReferenceMedian;
    s.lowOutlierReason = r.lowOutlierReason;
    if (r.lowOutlier && r.lowOutlierReason) {
      s.eligibleForWinner = false;
      s.eligibilityReasons.push(r.lowOutlierReason);
      const pct =
        r.percentBelowComparables != null
          ? Math.round(r.percentBelowComparables * 1000) / 10
          : null;
      s.rationale.push(
        `Low-outlier warning: ${pct}% below comparable verified offers (screened ${
          r.lowOutlierComparisonBasis === "range_high" ? "range high" : "exact total"
        } vs median ${r.lowOutlierReferenceMedian})`,
      );
      list.push({
        providerId: s.providerId,
        providerName: s.providerName,
        callId: s.callId,
        quoteId: s.finalQuoteId,
        currency: s.currency,
        comparisonValue: r.lowOutlierComparisonValue,
        comparisonValueBasis: r.lowOutlierComparisonBasis,
        percentBelowComparables: r.percentBelowComparables,
        referenceMedian: r.lowOutlierReferenceMedian,
        reason: r.lowOutlierReason,
      });
    }
  }
  return list;
}
