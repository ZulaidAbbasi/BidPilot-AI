import { describe, expect, it } from "vitest";

import {
  emptyDraft,
  JobSpecDraftSchema,
  JobSpecSchema,
  sanitizeDraft,
  type JobSpecDraft,
} from "./job-spec";
import { canonicalizeJson } from "./job-spec-canonical";

/**
 * Bug guardrails for the "unchecked checkbox saves as undefined" regression.
 * An untouched required boolean field MUST hydrate as `false`, survive a
 * save→reload round-trip as `false`, and pass strict validation as `false`.
 */

function filledJobSpec(): JobSpecDraft {
  return sanitizeDraft({
    ...emptyDraft(),
    origin: {
      line1: "1 A St",
      city: "Brooklyn",
      postal_code: "11201",
      country: "US",
    },
    destination: {
      line1: "2 B St",
      city: "Boston",
      postal_code: "02118",
      country: "US",
    },
    move_date: "2099-01-01",
    preferred_time_window: "flexible",
    bedroom_count: 2,
    inventory: [{ id: "i1", label: "Sofa", quantity: 1 }],
    fragile_items: [],
    specialty_items: [],
    origin_access: {
      floor: 1,
      stairs_flights: 0,
      elevator: "none",
      long_carry_meters: 0,
      parking: "street",
    },
    destination_access: {
      floor: 1,
      stairs_flights: 0,
      elevator: "none",
      long_carry_meters: 0,
      parking: "street",
    },
    packing_level: "none",
    insurance_level: "basic",
    customer_priorities: ["lowest_all_in_price"],
    special_instructions: "",
  });
}

describe("job-spec booleans", () => {
  it("emptyDraft() initializes every required boolean to false", () => {
    const d = emptyDraft();
    expect(d.unpacking_requested).toBe(false);
    expect(d.disassembly_required).toBe(false);
    expect(d.reassembly_required).toBe(false);
    expect(d.storage?.needed).toBe(false);
    expect(d.storage?.climate_controlled).toBe(false);
    expect(d.origin_access?.elevator_reservation_required).toBe(false);
    expect(d.origin_access?.parking_permit_required).toBe(false);
    expect(d.destination_access?.elevator_reservation_required).toBe(false);
    expect(d.destination_access?.parking_permit_required).toBe(false);
  });

  it("sanitizeDraft() normalizes missing access booleans to false", () => {
    const dirty: JobSpecDraft = {
      origin_access: { floor: 1 },
      destination_access: { floor: 2 },
    };
    const clean = sanitizeDraft(dirty);
    expect(clean.origin_access?.elevator_reservation_required).toBe(false);
    expect(clean.origin_access?.parking_permit_required).toBe(false);
    expect(clean.destination_access?.elevator_reservation_required).toBe(false);
    expect(clean.destination_access?.parking_permit_required).toBe(false);
  });

  it("false survives sanitize (never stripped from the payload)", () => {
    const draft = filledJobSpec();
    const clean = sanitizeDraft(draft);
    const json = JSON.parse(JSON.stringify(clean));
    // Explicit false values must be present in the serialized draft.
    expect(json.origin_access.elevator_reservation_required).toBe(false);
    expect(json.origin_access.parking_permit_required).toBe(false);
    expect(json.destination_access.elevator_reservation_required).toBe(false);
    expect(json.destination_access.parking_permit_required).toBe(false);
    expect(json.storage.needed).toBe(false);
    expect(json.storage.climate_controlled).toBe(false);
    expect(json.unpacking_requested).toBe(false);
    expect(json.disassembly_required).toBe(false);
    expect(json.reassembly_required).toBe(false);
  });

  it("false survives round-trip through JobSpecDraftSchema (reload)", () => {
    const draft = filledJobSpec();
    const serialized = JSON.parse(JSON.stringify(draft));
    const reloaded = JobSpecDraftSchema.parse(serialized);
    const clean = sanitizeDraft(reloaded);
    expect(clean.origin_access?.parking_permit_required).toBe(false);
    expect(clean.origin_access?.elevator_reservation_required).toBe(false);
    expect(clean.destination_access?.parking_permit_required).toBe(false);
    expect(clean.destination_access?.elevator_reservation_required).toBe(false);
  });

  it("false passes strict JobSpecSchema validation", () => {
    const result = JobSpecSchema.safeParse(filledJobSpec());
    expect(result.success).toBe(true);
  });

  it("true passes strict JobSpecSchema validation", () => {
    const draft = filledJobSpec();
    draft.origin_access!.parking_permit_required = true;
    draft.destination_access!.elevator_reservation_required = true;
    draft.storage = { needed: true, climate_controlled: true, duration_days: 3 };
    draft.unpacking_requested = true;
    const result = JobSpecSchema.safeParse(draft);
    expect(result.success).toBe(true);
  });

  it("undefined fails strict validation (missing required boolean)", () => {
    const draft = filledJobSpec();
    // Simulate a legacy draft where the field was never written.
    (draft.origin_access as Record<string, unknown>).parking_permit_required = undefined;
    const result = JobSpecSchema.safeParse(draft);
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join("."));
      expect(paths).toContain("origin_access.parking_permit_required");
    }
  });

  it("confirmed-spec canonicalization is deterministic across sanitize passes", () => {
    const a = canonicalizeJson(JobSpecSchema.parse(filledJobSpec()));
    const b = canonicalizeJson(JobSpecSchema.parse(sanitizeDraft(filledJobSpec())));
    expect(a).toEqual(b);
  });
});
