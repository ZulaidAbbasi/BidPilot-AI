/**
 * Reconciles stored quote snapshots + line items against the final transcript.
 * Server-only. Emits quote_evidence rows and returns aggregated verdicts used
 * by the finalize-call-outcome endpoint.
 *
 * Heuristic: numeric amounts and non-empty terms are searched (normalized) in
 * the concatenated transcript text. If found, `supported`; if the quote states
 * a different number in the same neighborhood, `contradictory`; else
 * `missing_evidence`. This never mutates the provider-stated numbers.
 */

type Transcript = {
  id: string;
  text: string;
  sequence_number: number;
  started_at_ms: number | null;
};

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/,/g, "")
    .replace(/[^\w.\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const SMALL_NUMBERS = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
  "thirteen",
  "fourteen",
  "fifteen",
  "sixteen",
  "seventeen",
  "eighteen",
  "nineteen",
] as const;
const TENS = [
  "",
  "",
  "twenty",
  "thirty",
  "forty",
  "fifty",
  "sixty",
  "seventy",
  "eighty",
  "ninety",
] as const;

function integerToWords(value: number): string {
  const n = Math.max(0, Math.floor(value));
  if (n < 20) return SMALL_NUMBERS[n] ?? String(n);
  if (n < 100) {
    const ten = TENS[Math.floor(n / 10)] ?? "";
    const rest = n % 10;
    return rest ? `${ten} ${SMALL_NUMBERS[rest]}` : ten;
  }
  if (n < 1000) {
    const rest = n % 100;
    return `${SMALL_NUMBERS[Math.floor(n / 100)]} hundred${rest ? ` ${integerToWords(rest)}` : ""}`;
  }
  if (n < 1_000_000) {
    const rest = n % 1000;
    return `${integerToWords(Math.floor(n / 1000))} thousand${rest ? ` ${integerToWords(rest)}` : ""}`;
  }
  return String(n);
}

function amountVariants(amount: number): string[] {
  const rounded = Math.round(amount);
  const variants = [amount.toFixed(2), amount.toFixed(0), String(rounded), integerToWords(rounded)];
  // Movers commonly state 1500 as “fifteen hundred”.
  if (rounded >= 100 && rounded < 10_000 && rounded % 100 === 0) {
    variants.push(`${integerToWords(rounded / 100)} hundred`);
  }
  return Array.from(new Set(variants.map(normalize).filter(Boolean)));
}

export type SupportStatus = "supported" | "unsupported" | "contradictory" | "missing_evidence";

export function classifyAmount(
  amount: number | null,
  transcript: string,
): { status: SupportStatus; hit?: string } {
  if (amount == null) return { status: "missing_evidence" };
  const norm = normalize(transcript);
  for (const v of amountVariants(amount)) {
    if (norm.includes(v)) return { status: "supported", hit: v };
  }
  return { status: "missing_evidence" };
}

export function classifyText(text: string | null, transcript: string): SupportStatus {
  if (!text || text.trim().length < 3) return "missing_evidence";
  const norm = normalize(transcript);
  const needle = normalize(text).slice(0, 40);
  if (!needle) return "missing_evidence";
  return norm.includes(needle) ? "supported" : "missing_evidence";
}

export interface QuoteRow {
  id: string;
  quote_stage: string;
  total_amount: number | null;
  low_amount: number | null;
  high_amount: number | null;
  deposit_amount: number | null;
  terms: string | null;
  price_change_conditions: string | null;
  captured_at?: string | null;
}

export interface LineItemRow {
  id: string;
  label: string;
  amount: number | null;
  provider_words: string | null;
  category?: string | null;
  included?: boolean | null;
}


export interface ReconcileResult {
  evidence: Array<{
    quote_id: string;
    quote_line_item_id: string | null;
    transcript_id: string | null;
    evidence_type:
      | "price"
      | "line_item"
      | "term"
      | "condition"
      | "commitment"
      | "disclaimer"
      | "other";
    support_status: SupportStatus;
    extracted_text: string | null;
    timestamp_ms: number | null;
  }>;
  initialTotal: number | null;
  finalTotal: number | null;
  priceChanged: boolean;
  contradictions: number;
}

/**
 * Short affirmations the provider commonly uses to confirm an agent's
 * inclusion question. These support inclusion but NOT category-specific
 * amounts.
 */
const AFFIRMATIVE_RX =
  /\b(yes|yep|yeah|correct|right|absolutely|of course|for sure|included|it'?s included|that'?s included|everything is included|all included|all of that is included|no extra|no additional|no charge)\b/;

const CATEGORY_ALIASES: Record<string, string[]> = {
  labor: ["labor", "labour", "movers", "moving crew", "crew"],
  transport: ["transport", "transportation", "mileage", "drive", "driving"],
  packing: ["packing", "pack", "wrapping", "materials"],
  materials: ["materials", "supplies", "boxes", "tape"],
  fuel: ["fuel", "gas", "gasoline"],
  stairs: ["stairs", "stair", "flights"],
  long_carry: ["long carry", "long-carry", "long haul"],
  heavy_item: ["heavy item", "piano", "safe"],
  storage: ["storage", "warehouse", "hold", "climate", "climate-controlled"],
  insurance: ["insurance", "coverage", "valuation"],
  deposit: ["deposit", "down payment", "upfront"],
  surcharge: ["surcharge", "extra fee", "additional fee"],
  discount: ["discount", "reduction", "off"],
  tax: ["tax", "taxes", "sales tax"],
};

/**
 * Multi-turn Q→A evidence span. Given a line item labelled/categorized as
 * `included=true` without a specific amount, this looks for a nearby agent
 * turn asking about the category and a subsequent short provider
 * affirmation ("yes", "everything included", "correct"). Returns a supported
 * verdict linked to the provider turn, with an excerpt covering both turns.
 */
function classifyInclusionSpan(
  category: string | null | undefined,
  label: string | null | undefined,
  transcripts: Transcript[],
): { status: SupportStatus; transcript: Transcript | null; excerpt: string | null } {
  const needles = new Set<string>();
  if (category) for (const w of CATEGORY_ALIASES[category] ?? [category]) needles.add(w.toLowerCase());
  if (label) needles.add(label.toLowerCase().slice(0, 40));
  if (needles.size === 0) return { status: "missing_evidence", transcript: null, excerpt: null };

  for (let i = 0; i < transcripts.length; i++) {
    const turn = transcripts[i];
    const norm = normalize(turn.text);
    const mentionsCategory = Array.from(needles).some((n) => n.length > 1 && norm.includes(n));
    if (!mentionsCategory) continue;
    // Look up to 2 following turns for an affirmation (agent may recap
    // before the provider answers).
    for (let j = i + 1; j <= Math.min(i + 2, transcripts.length - 1); j++) {
      const answer = transcripts[j];
      const ansNorm = normalize(answer.text);
      if (
        AFFIRMATIVE_RX.test(ansNorm) ||
        ansNorm.includes("everything included") ||
        ansNorm.includes("all included") ||
        ansNorm.includes("no extra") ||
        ansNorm.includes("no additional")
      ) {
        const excerpt = `${turn.text}\n→ ${answer.text}`.slice(0, 500);
        return { status: "supported", transcript: answer, excerpt };
      }
    }
  }
  return { status: "missing_evidence", transcript: null, excerpt: null };
}

function classifyAmountInTurns(
  amount: number | null,
  transcripts: Transcript[],
): { status: SupportStatus; transcript: Transcript | null; excerpt: string | null } {
  if (amount == null) return { status: "missing_evidence", transcript: null, excerpt: null };
  for (const turn of transcripts) {
    const norm = normalize(turn.text);
    for (const variant of amountVariants(amount)) {
      if (norm.includes(variant)) {
        return { status: "supported", transcript: turn, excerpt: turn.text.slice(0, 500) };
      }
    }
  }
  return { status: "missing_evidence", transcript: null, excerpt: null };
}


/**
 * Line-item classifier producing the full four-state verdict.
 *  - supported: label + our amount co-occur in one turn.
 *  - contradictory: label appears but a different amount is stated in the
 *    same turn (provider quoted Y, we stored X for that item).
 *  - unsupported: label appears but no amount near it — the stored number
 *    is unconfirmed.
 *  - missing_evidence: neither label nor amount appears anywhere.
 */
function classifyLineItemInTurns(
  amount: number | null,
  label: string | null,
  transcripts: Transcript[],
): { status: SupportStatus; transcript: Transcript | null; excerpt: string | null } {
  const needle = label ? normalize(label).slice(0, 40) : "";
  const variants = amount != null ? amountVariants(amount) : [];
  let labelHit: Transcript | null = null;
  for (const turn of transcripts) {
    const norm = normalize(turn.text);
    const hasLabel = needle.length > 2 && norm.includes(needle);
    const hasAmount = variants.some((v) => norm.includes(v));
    if (hasLabel && hasAmount) {
      return { status: "supported", transcript: turn, excerpt: turn.text.slice(0, 500) };
    }
    if (hasLabel && amount != null) {
      const m = /\b\d[\d,]{1,7}(?:\.\d{1,2})?\b/.exec(norm);
      if (m && !variants.some((v) => m[0].replace(/,/g, "") === v.replace(/,/g, ""))) {
        return { status: "contradictory", transcript: turn, excerpt: turn.text.slice(0, 500) };
      }
      labelHit = turn;
    }
  }
  if (labelHit) {
    return { status: "unsupported", transcript: labelHit, excerpt: labelHit.text.slice(0, 500) };
  }
  if (amount != null) {
    const amountOnly = classifyAmountInTurns(amount, transcripts);
    if (amountOnly.status === "supported") return amountOnly;
  }
  return { status: "missing_evidence", transcript: null, excerpt: null };
}

function classifyTextInTurns(
  text: string | null,
  transcripts: Transcript[],
): { status: SupportStatus; transcript: Transcript | null; excerpt: string | null } {
  if (!text || text.trim().length < 3) {
    return { status: "missing_evidence", transcript: null, excerpt: null };
  }
  const needle = normalize(text).slice(0, 40);
  if (!needle) return { status: "missing_evidence", transcript: null, excerpt: null };
  for (const turn of transcripts) {
    if (normalize(turn.text).includes(needle)) {
      return { status: "supported", transcript: turn, excerpt: turn.text.slice(0, 500) };
    }
  }
  return { status: "missing_evidence", transcript: null, excerpt: null };
}

function quoteTime(quote: QuoteRow): number {
  const t = quote.captured_at ? Date.parse(quote.captured_at) : Number.NaN;
  return Number.isFinite(t) ? t : 0;
}

function pickFinalQuote(quotes: QuoteRow[]): QuoteRow | undefined {
  const sorted = [...quotes].sort((a, b) => quoteTime(a) - quoteTime(b));
  return (
    [...sorted].reverse().find((q) => q.quote_stage === "FINAL") ??
    [...sorted].reverse().find((q) => q.quote_stage === "REVISED") ??
    sorted.at(-1)
  );
}

function pickBaselineQuote(quotes: QuoteRow[], final: QuoteRow | undefined): QuoteRow | undefined {
  if (!final) return quotes.find((q) => q.quote_stage === "INITIAL");
  const finalTime = quoteTime(final);
  const beforeFinal = quotes.filter((q) => q.id !== final.id && quoteTime(q) <= finalTime);
  const initial = beforeFinal.find((q) => q.quote_stage === "INITIAL");
  if (
    initial?.total_amount != null &&
    final.total_amount != null &&
    initial.total_amount >= final.total_amount
  ) {
    return initial;
  }
  const higherEarlier = beforeFinal
    .filter(
      (q) =>
        q.total_amount != null && final.total_amount != null && q.total_amount > final.total_amount,
    )
    .sort((a, b) => (b.total_amount ?? 0) - (a.total_amount ?? 0))[0];
  return higherEarlier ?? initial ?? beforeFinal[0];
}

export function reconcile(
  quotes: QuoteRow[],
  lineItems: Record<string, LineItemRow[]>,
  transcripts: Transcript[],
): ReconcileResult {
  const evidence: ReconcileResult["evidence"] = [];
  let contradictions = 0;

  for (const q of quotes) {
    const price = classifyAmountInTurns(q.total_amount, transcripts);
    if (price.status === "contradictory") contradictions++;
    evidence.push({
      quote_id: q.id,
      quote_line_item_id: null,
      transcript_id: price.transcript?.id ?? null,
      evidence_type: "price",
      support_status: price.status,
      extracted_text: price.excerpt,
      timestamp_ms: price.transcript?.started_at_ms ?? null,
    });
    if (q.terms) {
      const term = classifyTextInTurns(q.terms, transcripts);
      evidence.push({
        quote_id: q.id,
        quote_line_item_id: null,
        transcript_id: term.transcript?.id ?? null,
        evidence_type: "term",
        support_status: term.status,
        extracted_text: term.excerpt,
        timestamp_ms: term.transcript?.started_at_ms ?? null,
      });
    }
    for (const li of lineItems[q.id] ?? []) {
      // "Everything is included" pattern: an inclusion-only line item (no
      // amount, included=true) is supported by a Q→A span where the agent
      // named the category and the provider affirmed. Do NOT interpret this
      // as evidence of a category-specific amount.
      const inclusionOnly = li.amount == null && li.included === true;
      const c = inclusionOnly
        ? classifyInclusionSpan(li.category ?? null, li.label, transcripts)
        : classifyLineItemInTurns(li.amount, li.provider_words ?? li.label, transcripts);
      if (c.status === "contradictory") contradictions++;
      evidence.push({
        quote_id: q.id,
        quote_line_item_id: li.id,
        transcript_id: c.transcript?.id ?? null,
        evidence_type: "line_item",
        support_status: c.status,
        extracted_text: c.excerpt,
        timestamp_ms: c.transcript?.started_at_ms ?? null,
      });
    }

  }

  const final = pickFinalQuote(quotes);
  const initial = pickBaselineQuote(quotes, final);
  const initialTotal = initial?.total_amount ?? null;
  const finalTotal = final?.total_amount ?? null;
  const priceChanged =
    initialTotal != null && finalTotal != null && Math.abs(initialTotal - finalTotal) > 0.005;

  return { evidence, initialTotal, finalTotal, priceChanged, contradictions };
}
