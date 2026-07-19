/**
 * Wizard repair 4/7 — additional stops + Services conditional validation.
 *
 * Proves the canonical spec accepts zero stops, that add/edit/delete/reorder
 * roundtrips cleanly, that stops feed the deterministic hash (order and
 * content), that a changed-stop variant produces a different hash so
 * same-spec leverage is invalidated, and that Services conditional
 * validation is real:
 *
 *   - storage.needed=false does NOT require duration_days
 *   - storage.needed=true DOES require duration_days > 0
 *   - unpacking/disassembly/reassembly persist independently as false
 *   - full / partial / none packing levels serialize distinctly, and
 *     partial_packing_notes rides along without breaking full/none
 */
import { describe, expect, it } from "vitest";

import {
  JobSpecSchema,
  defaultAgentPermissions,
  sanitizeDraft,
  type JobSpec,
  type JobSpecDraft,
} from "./job-spec";
import { canonicalizeAndHash } from "./job-spec-canonical";

function baseSpec(overrides: Partial<JobSpec> = {}): JobSpec {
  return {
    origin: {
      line1: "1 Market St",
      city: "San Francisco",
      postal_code: "94105",
      country: "US",
    } as JobSpec["origin"],
    destination: {
      line1: "500 Terry Ave N",
      city: "Seattle",
      postal_code: "98109",
      country: "US",
    } as JobSpec["destination"],
    additional_stops: [],
    move_date: "2099-01-15",
    preferred_time_window: "morning",
    bedroom_count: 2,
    inventory: [{ id: "a", label: "Sofa", quantity: 1 }],
    fragile_items: [],
    specialty_items: [],
    origin_access: {
      floor: 1,
      stairs_flights: 0,
      elevator: "none",
      elevator_reservation_required: false,
      long_carry_meters: 0,
      parking: "driveway",
      parking_permit_required: false,
    } as JobSpec["origin_access"],
    destination_access: {
      floor: 1,
      stairs_flights: 0,
      elevator: "none",
      elevator_reservation_required: false,
      long_carry_meters: 0,
      parking: "driveway",
      parking_permit_required: false,
    } as JobSpec["destination_access"],
    packing_level: "none",
    unpacking_requested: false,
    disassembly_required: false,
    reassembly_required: false,
    storage: { needed: false },
    insurance_level: "standard",
    customer_priorities: ["lowest_all_in_price"],
    agent_permissions: defaultAgentPermissions(),
    special_instructions: "",
    ...overrides,
  };
}

const stopA = {
  id: "s1",
  label: "Storage unit",
  address: "200 Warehouse Way, Oakland, CA 94607",
  stop_order: 0,
  purpose: "storage" as const,
  notes: "Gate code 4412",
  services: ["boxes", "sofa"],
  time_restriction: "after 2pm",
};
const stopB = {
  id: "s2",
  label: "Second pickup",
  address: "50 Grand Ave, Oakland, CA 94612",
  stop_order: 1,
  purpose: "pickup" as const,
  notes: "",
  services: ["piano"],
  time_restriction: "",
};

describe("additional_stops schema and hashing", () => {
  it("zero stops passes strict validation", () => {
    const result = JobSpecSchema.safeParse(baseSpec({ additional_stops: [] }));
    expect(result.success).toBe(true);
  });

  it("add/edit/delete produces distinct hashes for each state", async () => {
    const empty = await canonicalizeAndHash(baseSpec({ additional_stops: [] }));
    const withOne = await canonicalizeAndHash(baseSpec({ additional_stops: [stopA] }));
    const edited = await canonicalizeAndHash(
      baseSpec({
        additional_stops: [{ ...stopA, notes: "Gate code 9999" }],
      }),
    );
    const withTwo = await canonicalizeAndHash(baseSpec({ additional_stops: [stopA, stopB] }));
    const deleted = await canonicalizeAndHash(baseSpec({ additional_stops: [stopB] }));
    const hashes = new Set([empty.hash, withOne.hash, edited.hash, withTwo.hash, deleted.hash]);
    expect(hashes.size).toBe(5);
  });

  it("reordering stops changes the hash (order is semantic)", async () => {
    const asIs = await canonicalizeAndHash(
      baseSpec({ additional_stops: [stopA, stopB] }),
    );
    const reordered = await canonicalizeAndHash(
      baseSpec({
        additional_stops: [
          { ...stopB, stop_order: 0 },
          { ...stopA, stop_order: 1 },
        ],
      }),
    );
    expect(asIs.hash).not.toBe(reordered.hash);
  });

  it("changed-stop variant does NOT qualify as same-spec leverage", async () => {
    // Two negotiations share every field except that provider B was quoted
    // with an extra pickup stop. Same-spec leverage requires identical
    // canonical hashes; this proves it does not.
    const providerA = await canonicalizeAndHash(baseSpec({ additional_stops: [stopA] }));
    const providerB = await canonicalizeAndHash(
      baseSpec({ additional_stops: [stopA, stopB] }),
    );
    expect(providerA.hash).not.toBe(providerB.hash);
  });

  it("stops survive draft sanitize (survives refresh from persisted draft)", () => {
    const draft: JobSpecDraft = {
      additional_stops: [stopA, stopB],
    };
    const sanitized = sanitizeDraft(draft);
    expect(sanitized.additional_stops).toEqual([stopA, stopB]);
  });

  it("sanitize seeds an empty stops array when the draft omits it", () => {
    const sanitized = sanitizeDraft({});
    expect(sanitized.additional_stops).toEqual([]);
  });
});

describe("Services conditional validation", () => {
  it("storage.needed=false does not require duration_days", () => {
    const result = JobSpecSchema.safeParse(
      baseSpec({ storage: { needed: false } as JobSpec["storage"] }),
    );
    expect(result.success).toBe(true);
  });

  it("storage.needed=true rejects a missing duration_days", () => {
    const result = JobSpecSchema.safeParse(
      baseSpec({ storage: { needed: true } as JobSpec["storage"] }),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some((i) => i.path.join(".") === "storage.duration_days"),
      ).toBe(true);
    }
  });

  it("storage.needed=true rejects a zero duration_days", () => {
    const result = JobSpecSchema.safeParse(
      baseSpec({ storage: { needed: true, duration_days: 0 } as JobSpec["storage"] }),
    );
    expect(result.success).toBe(false);
  });

  it("storage.needed=true accepts a positive duration_days", () => {
    const result = JobSpecSchema.safeParse(
      baseSpec({
        storage: { needed: true, duration_days: 14, climate_controlled: false } as JobSpec["storage"],
      }),
    );
    expect(result.success).toBe(true);
  });

  it("false service booleans persist through sanitize (not stripped)", () => {
    const sanitized = sanitizeDraft({
      unpacking_requested: false,
      disassembly_required: false,
      reassembly_required: false,
      storage: { needed: false, climate_controlled: false },
    });
    expect(sanitized.unpacking_requested).toBe(false);
    expect(sanitized.disassembly_required).toBe(false);
    expect(sanitized.reassembly_required).toBe(false);
    expect(sanitized.storage?.needed).toBe(false);
    expect(sanitized.storage?.climate_controlled).toBe(false);
  });

  it("full / partial / none packing serialize to distinct canonical hashes", async () => {
    const none = await canonicalizeAndHash(baseSpec({ packing_level: "none" }));
    const partial = await canonicalizeAndHash(baseSpec({ packing_level: "partial" }));
    const full = await canonicalizeAndHash(baseSpec({ packing_level: "full" }));
    expect(new Set([none.hash, partial.hash, full.hash]).size).toBe(3);
  });

  it("partial_packing_notes further distinguishes two partial-packing specs", async () => {
    const partialNoNotes = await canonicalizeAndHash(baseSpec({ packing_level: "partial" }));
    const partialWithNotes = await canonicalizeAndHash(
      baseSpec({ packing_level: "partial", partial_packing_notes: "kitchen + artwork only" }),
    );
    expect(partialNoNotes.hash).not.toBe(partialWithNotes.hash);
  });
});
