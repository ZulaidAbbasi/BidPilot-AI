/**
 * Parses spoken/written English number phrases into a numeric value.
 *
 * Examples (all → returned number):
 *   "$1,500"                        → 1500
 *   "1500"                          → 1500
 *   "fifteen hundred"               → 1500
 *   "fifteen hundred dollars"       → 1500
 *   "one thousand five hundred"     → 1500
 *   "thirteen hundred fifty"        → 1350
 *   "one thousand three hundred and fifty" → 1350
 *   "two thousand"                  → 2000
 *
 * Returns `null` if the input has no coherent number.
 *
 * This is called by the ElevenLabs tool endpoints BEFORE numeric validation
 * so an agent that mis-transcribes "fifteen hundred" as "500" or leaves the
 * numeric amount blank can still be recovered from the caller-provided
 * spoken words (`total_words`, `low_words`, etc.).
 */

const SMALL: Record<string, number> = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
};

const TENS: Record<string, number> = {
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
};

const SCALES: Record<string, number> = {
  hundred: 100,
  thousand: 1_000,
  million: 1_000_000,
};

function normalizeInput(input: string): string {
  return input
    .toLowerCase()
    .replace(/[\u2010-\u2015-]/g, " ") // dashes → space
    .replace(/[^\w.,\s]/g, " ") // keep commas so "1,350" survives
    .replace(/\bdollars?\b|\busd\b|\bcents?\b|\band\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Extract the first coherent digit-based amount from a string, if any.
 * Handles "$1,500", "1500.00", "1,350", "1.5k".
 */
function extractDigitAmount(s: string): number | null {
  const kMatch = s.match(/(\d+(?:\.\d+)?)\s*k\b/);
  if (kMatch) {
    const n = Number(kMatch[1]);
    if (Number.isFinite(n)) return Math.round(n * 1000 * 100) / 100;
  }
  const m = s.match(/\d[\d,]*(?:\.\d+)?/);
  if (!m) return null;
  const n = Number(m[0].replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

/**
 * Word-form parser. Returns null when no word-number is found.
 * Follows the standard left-to-right "current + total" grammar with
 * scale words that can *multiply* the current chunk (thousand, million).
 * "hundred" multiplies the current chunk only.
 */
function parseWordNumber(s: string): number | null {
  const tokens = s.split(" ").filter(Boolean);
  let total = 0;
  let current = 0;
  let sawAnyWord = false;

  for (const raw of tokens) {
    const t = raw;
    if (t in SMALL) {
      current += SMALL[t];
      sawAnyWord = true;
      continue;
    }
    if (t in TENS) {
      current += TENS[t];
      sawAnyWord = true;
      continue;
    }
    if (t === "hundred") {
      // e.g. "fifteen hundred" → current=15, then * 100 = 1500
      current = (current || 1) * 100;
      sawAnyWord = true;
      continue;
    }
    if (t === "thousand" || t === "million") {
      current = (current || 1) * SCALES[t];
      total += current;
      current = 0;
      sawAnyWord = true;
      continue;
    }
    // Non-number token — stop accumulating this run.
    // (Guards against phrases like "fifteen hundred for the labor and thirty for fuel".)
    if (sawAnyWord) break;
  }

  const value = total + current;
  return sawAnyWord ? value : null;
}

/**
 * Parse any spoken/written amount phrase into a number, or null.
 *
 * Strategy:
 *   1. If input already contains a plain digit amount, prefer it.
 *   2. Otherwise parse a word-form number.
 *   3. Clamp to [0, 10_000_000] to reject nonsense.
 */
export function parseSpokenAmount(input: unknown): number | null {
  if (input == null) return null;
  if (typeof input === "number") return Number.isFinite(input) && input >= 0 ? input : null;
  if (typeof input !== "string") return null;
  // Reject explicit negative amounts before dash normalization would drop them.
  if (/(^|\s)-\s*\d/.test(input)) return null;
  const cleaned = normalizeInput(input);
  if (!cleaned) return null;

  const digit = extractDigitAmount(cleaned);
  const words = parseWordNumber(cleaned);

  // Prefer the larger of digit/words when both exist AND the digit form looks
  // like a stray token (e.g. agent said "fifteen hundred, that's about 500 per
  // room"). The word-form is authoritative for the total when it exceeds a
  // stray digit run.
  let chosen: number | null = null;
  if (digit != null && words != null) {
    chosen = digit >= words ? digit : words;
  } else {
    chosen = digit ?? words;
  }

  if (chosen == null) return null;
  if (!Number.isFinite(chosen)) return null;
  if (chosen < 0) return null;
  if (chosen > 10_000_000) return null;
  return chosen;
}

/**
 * Convenience: given an amount and (optional) spoken words the agent said
 * verbatim, return the most trustworthy numeric value.
 *
 * - If `words` parses to a number and the parsed word-form is materially
 *   larger than `amount` (>= 2x), prefer the word-form. This catches the
 *   "fifteen hundred" → agent-extracted "500" case.
 * - Otherwise prefer `amount` when it is finite.
 * - Falls back to the word-form when `amount` is missing.
 */
export function reconcileSpokenAmount(
  amount: number | null | undefined,
  words: string | null | undefined,
): { amount: number | null; source: "amount" | "words" | "words_override" | "none" } {
  const parsed = parseSpokenAmount(words ?? null);
  const numeric = typeof amount === "number" && Number.isFinite(amount) ? amount : null;

  if (numeric == null && parsed == null) return { amount: null, source: "none" };
  if (numeric == null && parsed != null) return { amount: parsed, source: "words" };
  if (numeric != null && parsed == null) return { amount: numeric, source: "amount" };

  // Both present. Trust the word-form when the numeric form looks like a
  // truncated / dropped-thousand extraction of the same phrase.
  if (parsed != null && numeric != null && parsed >= 100 && numeric >= 0) {
    // "fifteen hundred" → 1500 vs agent-sent 500 → override.
    if (parsed >= numeric * 2 && parsed - numeric >= 500) {
      return { amount: parsed, source: "words_override" };
    }
    // Exact digit-match inside the spoken words takes the numeric value.
  }
  return { amount: numeric, source: "amount" };
}
