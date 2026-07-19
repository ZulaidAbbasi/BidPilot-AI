/**
 * Wizard Fix — Safe Zero Defaults for "None" Numeric Fields.
 *
 * Proves that stairs_flights and long_carry_meters default to numeric 0
 * on both origin and destination access, that empty/null/NaN inputs
 * normalize to 0, that negatives and non-integers are rejected, that
 * zero survives Confirm-and-Lock, and that other unknown facts (floor,
 * bedroom count, inventory quantity, storage duration) are NOT silently
 * defaulted.
 */

import { describe, it, expect } from "vitest";
import { emptyDraft, sanitizeDraft, type JobSpecDraft } from "./job-spec";
import { validateForConfirm, computeCompletion } from "./job-spec-validation";

function completeDraft(): JobSpecDraft {
  return sanitizeDraft({
    ...emptyDraft(),
    origin: {
      line1: "1 Main St",
      city: "Miami",
      region: "FL",
      postal_code: "33101",
      country: "US",
    },
    destination: {
      line1: "2 Ocean Dr",
      city: "Miami Beach",
      region: "FL",
      postal_code: "33139",
      country: "US",
    },
    move_date: "2099-01-15",
    preferred_time_window: "morning",
    bedroom_count: 2,
    inventory: [{ id: "i1", label: "Sofa", quantity: 1 }],
    origin_access: {
      floor: 3,
      elevator: "passenger",
      elevator_reservation_required: false,
      parking: "street",
      parking_permit_required: false,
      long_carry_unit: "meters",
    },
    destination_access: {
      floor: 1,
      elevator: "none",
      elevator_reservation_required: false,
      parking: "driveway",
      parking_permit_required: false,
      long_carry_unit: "meters",
    },
    packing_level: "none",
    insurance_level: "standard",
    customer_priorities: ["lowest_all_in_price"],
  });
}

describe("safe-zero defaults", () => {
  it("emptyDraft initializes origin & destination stairs to 0", () => {
    const d = emptyDraft();
    expect(d.origin_access?.stairs_flights).toBe(0);
    expect(d.destination_access?.stairs_flights).toBe(0);
  });

  it("emptyDraft initializes origin & destination long carry to 0", () => {
    const d = emptyDraft();
    expect(d.origin_access?.long_carry_meters).toBe(0);
    expect(d.destination_access?.long_carry_meters).toBe(0);
  });

  it("user can replace 0 with a positive integer", () => {
    const s = sanitizeDraft({
      ...emptyDraft(),
      origin_access: { ...(emptyDraft().origin_access ?? {}), stairs_flights: 4 },
    });
    expect(s.origin_access?.stairs_flights).toBe(4);
  });

  it("empty-string, null, undefined, NaN all normalize to 0", () => {
    for (const bad of ["", null, undefined, Number.NaN] as unknown[]) {
      const s = sanitizeDraft({
        ...emptyDraft(),
        origin_access: {
          ...(emptyDraft().origin_access ?? {}),
          stairs_flights: bad as number,
          long_carry_meters: bad as number,
        },
      });
      expect(s.origin_access?.stairs_flights).toBe(0);
      expect(s.origin_access?.long_carry_meters).toBe(0);
    }
  });

  it("negative values are rejected (dropped, not silently coerced to 0)", () => {
    const s = sanitizeDraft({
      ...emptyDraft(),
      origin_access: {
        ...(emptyDraft().origin_access ?? {}),
        stairs_flights: -1,
        long_carry_meters: -5,
      },
    });
    // Negative was dropped by normalizeSafeZero → undefined; not clamped to 0.
    expect(s.origin_access?.stairs_flights).toBeUndefined();
    expect(s.origin_access?.long_carry_meters).toBeUndefined();
  });

  it("NaN is never persisted", () => {
    const s = sanitizeDraft({
      ...emptyDraft(),
      origin_access: {
        ...(emptyDraft().origin_access ?? {}),
        stairs_flights: Number.NaN,
      },
    });
    expect(Number.isNaN(s.origin_access?.stairs_flights)).toBe(false);
    expect(s.origin_access?.stairs_flights).toBe(0);
  });

  it("zero survives autosave round-trip via JSON", () => {
    const s = sanitizeDraft(completeDraft());
    const round = sanitizeDraft(JSON.parse(JSON.stringify(s)));
    expect(round.origin_access?.stairs_flights).toBe(0);
    expect(round.destination_access?.long_carry_meters).toBe(0);
  });

  it("zero passes Confirm-and-Lock and completion reaches 100%", () => {
    const draft = completeDraft();
    expect(computeCompletion(draft)).toBe(100);
    const res = validateForConfirm(draft);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.spec.origin_access.stairs_flights).toBe(0);
      expect(res.spec.destination_access.long_carry_meters).toBe(0);
    }
  });

  it("floor is NOT silently defaulted to 0", () => {
    const d = emptyDraft();
    expect(d.origin_access?.floor).toBeUndefined();
    expect(d.destination_access?.floor).toBeUndefined();
  });

  it("bedroom_count is NOT silently defaulted to 0", () => {
    const d = emptyDraft();
    expect(d.bedroom_count).toBeUndefined();
  });

  it("empty inventory does not create zero-quantity placeholder items", () => {
    const d = emptyDraft();
    expect(d.inventory).toEqual([]);
    expect(d.fragile_items).toEqual([]);
    expect(d.specialty_items).toEqual([]);
  });

  it("storage duration is omitted when storage is not needed", () => {
    const s = sanitizeDraft({
      ...emptyDraft(),
      storage: { needed: false, duration_days: 30, climate_controlled: true },
    });
    expect(s.storage?.needed).toBe(false);
    expect(s.storage?.duration_days).toBeUndefined();
    expect(s.storage?.climate_controlled).toBe(false);
  });

  it("elevator=none forces elevator_reservation_required to false", () => {
    const s = sanitizeDraft({
      ...emptyDraft(),
      origin_access: {
        ...(emptyDraft().origin_access ?? {}),
        elevator: "none",
        elevator_reservation_required: true,
      },
    });
    expect(s.origin_access?.elevator_reservation_required).toBe(false);
  });

  it("old draft with null stairs/carry normalizes to 0 without touching other fields", () => {
    const old: JobSpecDraft = {
      origin_access: {
        floor: 5,
        stairs_flights: null as unknown as number,
        long_carry_meters: "" as unknown as number,
        elevator: "passenger",
        parking: "street",
        elevator_reservation_required: true,
        parking_permit_required: false,
        long_carry_unit: "meters",
      },
    };
    const s = sanitizeDraft(old);
    expect(s.origin_access?.stairs_flights).toBe(0);
    expect(s.origin_access?.long_carry_meters).toBe(0);
    expect(s.origin_access?.floor).toBe(5); // untouched
    expect(s.origin_access?.elevator_reservation_required).toBe(true); // untouched
  });
});
