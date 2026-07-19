/**
 * Server-side 30%-low-outlier red flag for verified comparable quotes.
 *
 * This rule is deterministic, does not call an LLM, and never fabricates
 * an external "market" benchmark. The comparison set consists ONLY of
 * genuinely comparable quotes already vetted by upstream evidence and
 * ranking eligibility (same negotiation, same confirmed spec hash, same
 * currency, FINAL + final_confirmed, reconciled + completed source call,
 * not needs_review, not flagged, not expired, supported transcript
 * evidence for the screened total).
 *
 * A flagged quote remains visible in the ranking but becomes ineligible
 * for automatic winner selection until a human reviews the risk.
 */

export const LOW_OUTLIER_THRESHOLD = 0.3;

export type LowOutlierBasis = "exact_total" | "range_high";

export interface LowOutlierInput {
  /** Stable id (e.g. finalQuoteId or providerId::callId). */
  id: string;
  /**
   * True only when the caller has already applied the full comparability
   * gate (spec hash, FINAL confirmed, reconciled call, evidence, not
   * needs_review / contradictory / expired, etc.). We do NOT re-derive
   * those checks — this function is strictly about the price comparison.
   */
  comparable: boolean;
  currency: string | null;
  /** Supported exact all-in total, when present. Preferred over range_high. */
  totalAmount: number | null;
  /** Supported high end of a confirmed range. Only used when totalAmount is null. */
  highAmount?: number | null;
}

export interface LowOutlierResult {
  id: string;
  lowOutlier: boolean;
  percentBelowComparables: number | null;
  lowOutlierComparisonValue: number | null;
  lowOutlierComparisonBasis: LowOutlierBasis | null;
  lowOutlierReferenceMedian: number | null;
  lowOutlierReason: string | null;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  if (n === 0) return 0;
  const mid = Math.floor(n / 2);
  return n % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function derive(
  input: LowOutlierInput,
): { value: number; basis: LowOutlierBasis } | null {
  if (input.totalAmount != null && Number.isFinite(input.totalAmount) && input.totalAmount > 0) {
    return { value: input.totalAmount, basis: "exact_total" };
  }
  if (input.highAmount != null && Number.isFinite(input.highAmount) && input.highAmount > 0) {
    return { value: input.highAmount, basis: "range_high" };
  }
  return null;
}

export function applyLowOutlierRedFlag(inputs: LowOutlierInput[]): LowOutlierResult[] {
  // Derive per-input screening values once; only comparable + priced entries
  // participate in the comparison set.
  const derived = new Map<string, { value: number; basis: LowOutlierBasis } | null>();
  for (const inp of inputs) {
    derived.set(inp.id, inp.comparable ? derive(inp) : null);
  }

  // Group priced comparable entries by currency for pooled median.
  const byCurrency = new Map<string, Array<{ id: string; value: number }>>();
  for (const inp of inputs) {
    const d = derived.get(inp.id);
    if (!d) continue;
    const cur = (inp.currency ?? "").toUpperCase();
    if (!cur) continue;
    const list = byCurrency.get(cur) ?? [];
    list.push({ id: inp.id, value: d.value });
    byCurrency.set(cur, list);
  }

  const results: LowOutlierResult[] = [];
  for (const inp of inputs) {
    const d = derived.get(inp.id);
    if (!d) {
      results.push({
        id: inp.id,
        lowOutlier: false,
        percentBelowComparables: null,
        lowOutlierComparisonValue: null,
        lowOutlierComparisonBasis: null,
        lowOutlierReferenceMedian: null,
        lowOutlierReason: null,
      });
      continue;
    }
    const cur = (inp.currency ?? "").toUpperCase();
    const peers = (byCurrency.get(cur) ?? []).filter((p) => p.id !== inp.id).map((p) => p.value);
    if (peers.length === 0) {
      results.push({
        id: inp.id,
        lowOutlier: false,
        percentBelowComparables: null,
        lowOutlierComparisonValue: d.value,
        lowOutlierComparisonBasis: d.basis,
        lowOutlierReferenceMedian: null,
        lowOutlierReason: null,
      });
      continue;
    }
    const ref = median(peers);
    if (ref <= 0) {
      results.push({
        id: inp.id,
        lowOutlier: false,
        percentBelowComparables: null,
        lowOutlierComparisonValue: d.value,
        lowOutlierComparisonBasis: d.basis,
        lowOutlierReferenceMedian: ref,
        lowOutlierReason: null,
      });
      continue;
    }
    const percentBelow = (ref - d.value) / ref;
    const flagged = percentBelow >= LOW_OUTLIER_THRESHOLD;
    const pctRounded = Math.round(percentBelow * 1000) / 10;
    results.push({
      id: inp.id,
      lowOutlier: flagged,
      percentBelowComparables: percentBelow,
      lowOutlierComparisonValue: d.value,
      lowOutlierComparisonBasis: d.basis,
      lowOutlierReferenceMedian: ref,
      lowOutlierReason: flagged
        ? `Priced ${pctRounded}% below comparable verified offers (screened ${
            d.basis === "exact_total" ? "exact total" : "range high"
          } vs median of ${peers.length} other verified offer${peers.length === 1 ? "" : "s"}). A 30%+ low outlier is a warning, not an automatic win. Human review is required.`
        : null,
    });
  }
  return results;
}
