/**
 * Date-only helpers.
 *
 * The BidPilot spec treats `move_date` and `moving_date` as calendar dates
 * (`YYYY-MM-DD`), not timestamps. Parsing them with `new Date("2026-07-19")`
 * yields UTC midnight, which flips to the previous day in negative-UTC
 * locales — that produced the "in 0d" / off-by-one bugs.
 *
 * These helpers parse the string as a local calendar date at noon so no
 * DST or TZ boundary can shift the day.
 */

export function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function parseDateOnly(
  iso: string | null | undefined,
): { y: number; m: number; d: number } | null {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return null;
  return { y: +m[1], m: +m[2], d: +m[3] };
}

function toLocalNoon(p: { y: number; m: number; d: number }): Date {
  return new Date(p.y, p.m - 1, p.d, 12, 0, 0, 0);
}

export function formatDateOnly(
  iso: string | null | undefined,
  opts: Intl.DateTimeFormatOptions = {
    month: "short",
    day: "numeric",
    year: "numeric",
  },
): string {
  const p = parseDateOnly(iso);
  if (!p) return "—";
  return toLocalNoon(p).toLocaleDateString(undefined, opts);
}

export function daysUntil(iso: string | null | undefined): number | null {
  const p = parseDateOnly(iso);
  if (!p) return null;
  const target = toLocalNoon(p).getTime();
  const now = parseDateOnly(todayIso())!;
  const today = toLocalNoon(now).getTime();
  return Math.round((target - today) / 86_400_000);
}

/**
 * Spoken form for ElevenLabs agent dynamic variables. Reads the date at
 * UTC noon so the wording matches the calendar date the user picked.
 */
export function spokenDate(iso: string | null | undefined): string {
  const p = parseDateOnly(iso);
  if (!p) return "an unspecified date";
  // Use UTC to make the spoken output deterministic across server locales.
  const d = new Date(Date.UTC(p.y, p.m - 1, p.d, 12, 0, 0, 0));
  return d.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}
