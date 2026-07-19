/**
 * Wizard Repair 6/7 — shared validation, completion, and Review/Confirm parity.
 *
 * These tests lock the "Review and Confirm can never disagree" invariant:
 *  - `computeCompletion` is derived from `validateForConfirm`, so 100% happens
 *    if and only if `JobSpecSchema` accepts the sanitized draft.
 *  - unchecked booleans and legitimate zeros are complete answers, not
 *    missing data.
 *  - optional empty arrays (fragile / specialty / additional_stops) never
 *    reduce completion.
 *  - conditional storage.duration_days is not required when storage.needed
 *    is false — the wizard cannot be trapped by a hidden field.
 */
import { describe, expect, it } from "vitest";
import { CUSTOMER_PRIORITIES, emptyDraft, sanitizeDraft, type JobSpecDraft } from "./job-spec";
import { computeCompletion, validateForConfirm } from "./job-spec-validation";

function completeDraft(overrides: Partial<JobSpecDraft> = {}): JobSpecDraft {
  return sanitizeDraft({
    ...emptyDraft(),
    origin: {
      line1: "1 A St",
      city: "Brooklyn",
      region: "NY",
      postal_code: "11201",
      country: "US",
    },
    destination: {
      line1: "2 B St",
      city: "Boston",
      region: "MA",
      postal_code: "02118",
      country: "US",
    },
    move_date: "2099-01-01",
    preferred_time_window: "flexible",
    bedroom_count: 2,
    inventory: [{ id: "i1", label: "Sofa", quantity: 1 }],
    fragile_items: [],
    specialty_items: [],
    additional_stops: [],
    origin_access: {
      floor: 0,
      stairs_flights: 0,
      elevator: "none",
      elevator_reservation_required: false,
      long_carry_meters: 0,
      long_carry_unit: "meters",
      parking: "street",
      parking_permit_required: false,
    },
    destination_access: {
      floor: 0,
      stairs_flights: 0,
      elevator: "none",
      elevator_reservation_required: false,
      long_carry_meters: 0,
      long_carry_unit: "meters",
      parking: "street",
      parking_permit_required: false,
    },
    packing_level: "none",
    unpacking_requested: false,
    disassembly_required: false,
    reassembly_required: false,
    storage: { needed: false, climate_controlled: false },
    insurance_level: "basic",
    customer_priorities: [CUSTOMER_PRIORITIES[0]],
    ...overrides,
  });
}

describe("wizard repair 6 — shared validator", () => {
  it("a fully-answered smoke-test draft reaches exactly 100%", () => {
    const draft = completeDraft();
    expect(validateForConfirm(draft).ok).toBe(true);
    expect(computeCompletion(draft)).toBe(100);
  });

  it("false / zero / 'none' count as complete answers, not missing", () => {
    // Every boolean is deliberately `false` and every numeric field is `0`.
    // A truthy-counting completion checker would have graded this <100%.
    const draft = completeDraft();
    expect(draft.unpacking_requested).toBe(false);
    expect(draft.storage?.needed).toBe(false);
    expect(draft.origin_access?.floor).toBe(0);
    expect(draft.origin_access?.stairs_flights).toBe(0);
    expect(draft.origin_access?.long_carry_meters).toBe(0);
    expect(computeCompletion(draft)).toBe(100);
  });

  it("optional empty arrays do not reduce completion", () => {
    const draft = completeDraft({
      fragile_items: [],
      specialty_items: [],
      additional_stops: [],
    });
    expect(computeCompletion(draft)).toBe(100);
  });

  it("conditional storage.duration_days is not required when needed=false", () => {
    const draft = completeDraft({
      storage: { needed: false, climate_controlled: false },
    });
    // duration_days is undefined but the draft is still Confirm-ready.
    expect(draft.storage?.duration_days).toBeUndefined();
    expect(validateForConfirm(draft).ok).toBe(true);
    expect(computeCompletion(draft)).toBe(100);
  });

  it("conditional storage.duration_days IS required when needed=true", () => {
    const draft = completeDraft({
      storage: { needed: true, climate_controlled: false },
    });
    const result = validateForConfirm(draft);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(
        result.issues.some(
          (i) => i.path[0] === "storage" && i.path[1] === "duration_days",
        ),
      ).toBe(true);
    }
    // Completion must be < 100% whenever Confirm would fail.
    expect(computeCompletion(draft)).toBeLessThan(100);
  });

  it("missing customer_priorities drops below 100% and reports the exact path", () => {
    const draft = completeDraft({ customer_priorities: [] });
    const result = validateForConfirm(draft);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((i) => i.path[0] === "customer_priorities")).toBe(true);
    }
    expect(computeCompletion(draft)).toBeLessThan(100);
  });

  it("empty draft: completion is well under 100 and never negative", () => {
    const empty = sanitizeDraft(emptyDraft());
    const pct = computeCompletion(empty);
    expect(pct).toBeGreaterThanOrEqual(0);
    expect(pct).toBeLessThan(100);
    expect(validateForConfirm(empty).ok).toBe(false);
  });

  it("completion is 100% only when Confirm would succeed (parity)", () => {
    // Deliberately toggle three fields off/on and prove the two views agree.
    const good = completeDraft();
    const bad1 = completeDraft({ move_date: "" });
    const bad2 = completeDraft({ packing_level: undefined });
    const bad3 = completeDraft({ insurance_level: undefined });
    for (const d of [good, bad1, bad2, bad3]) {
      const ok = validateForConfirm(d).ok;
      const pct = computeCompletion(d);
      // If Confirm succeeds, pct MUST be 100. Otherwise pct MUST be < 100.
      expect(ok ? pct === 100 : pct < 100).toBe(true);
    }
  });
});
