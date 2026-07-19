/**
 * Wizard Repair 6/7 — single shared validator.
 *
 * Autosave completion percentage, the wizard Review step, the Specification
 * editor's Confirm-and-Lock button, and the server-side confirm-job-spec
 * function all consult exactly one function: `validateForConfirm`.
 *
 * Rules this file locks in:
 *  - a draft is Confirm-ready if and only if `JobSpecSchema` accepts the
 *    sanitized draft. There is no second, weaker "looks filled" heuristic;
 *    Review and Confirm can never disagree.
 *  - completion percentage is 100% only when Confirm would succeed. A single
 *    validation issue collapses the number below 100 so the UI never shows
 *    "ready" for a draft the server would reject.
 *  - required booleans are `false`, not undefined, after `sanitizeDraft`.
 *    Valid `false` and valid `0` count as complete answers, never missing.
 *  - optional empty arrays (fragile_items, specialty_items,
 *    additional_stops) never reduce completion. Conditional fields
 *    (storage.duration_days when storage.needed is false) do not count as
 *    missing either — the strict schema simply doesn't require them.
 */

import { sanitizeDraft, JobSpecSchema, type JobSpec, type JobSpecDraft } from "./job-spec";

/**
 * The 15 canonical requirement groups. Completion percentage is
 * `groups without a validation issue / 15`, rounded — so a draft with two
 * failing groups is 87%, one is 93%, and zero is 100%. Anything that would
 * cause the strict schema to reject shows up as a missing group.
 *
 * `agent_permissions` is included so revoked-but-undefined booleans register
 * as an incomplete group in the completion meter, matching what Confirm and
 * Lock will refuse.
 */
export const REQUIREMENT_GROUPS = [
  "origin",
  "destination",
  "move_date",
  "preferred_time_window",
  "bedroom_count",
  "inventory",
  "origin_access",
  "destination_access",
  "packing_level",
  "unpacking_requested",
  "disassembly_required",
  "reassembly_required",
  "storage",
  "insurance_level",
  "customer_priorities",
  "agent_permissions",
] as const;
export type RequirementGroup = (typeof REQUIREMENT_GROUPS)[number];

export type ValidateResult =
  | { ok: true; spec: JobSpec; sanitized: JobSpecDraft }
  | {
      ok: false;
      sanitized: JobSpecDraft;
      issues: readonly {
        path: (string | number)[];
        message: string;
      }[];
    };

/**
 * The single validation entry point. Always sanitizes the incoming draft
 * before running the strict schema so that unchecked booleans are treated as
 * an explicit `false` — never as missing data. Review, Confirm, autosave
 * completion, and confirm-job-spec must all use this function.
 */
export function validateForConfirm(draft: JobSpecDraft): ValidateResult {
  const sanitized = sanitizeDraft(draft);
  const result = JobSpecSchema.safeParse(sanitized);
  if (result.success) {
    return { ok: true, spec: result.data as JobSpec, sanitized };
  }
  return {
    ok: false,
    sanitized,
    issues: result.error.issues.map((i) => ({
      path: [...i.path] as (string | number)[],
      message: i.message,
    })),
  };
}

/**
 * Completion percentage derived from `validateForConfirm`. 100% exists only
 * when the confirm-schema passes; anything less is
 * `groups without an issue / total groups`, rounded.
 */
export function computeCompletion(draft: JobSpecDraft): number {
  const result = validateForConfirm(draft);
  if (result.ok) return 100;
  const badRoots = new Set<string>();
  for (const issue of result.issues) {
    const root = issue.path[0];
    if (typeof root === "string") badRoots.add(root);
  }
  let filled = 0;
  for (const group of REQUIREMENT_GROUPS) {
    if (!badRoots.has(group)) filled += 1;
  }
  // Never round up to 100 unless the strict schema actually passes — we
  // already returned above in that case. Floor the last percent instead.
  const raw = (filled / REQUIREMENT_GROUPS.length) * 100;
  const rounded = Math.round(raw);
  return rounded >= 100 ? 99 : rounded;
}
