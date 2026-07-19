/**
 * Wizard Repair 7/7 — end-to-end Miami smoke spec.
 *
 * Proves the canonical draft round-trips deterministically through the
 * shared validator + canonicalizer without touching the database, and
 * pins the false / zero / structured priority invariants that the wizard
 * relies on for Confirm-and-Lock.
 *
 * The DB write path is covered separately by scripts/security-tests.ts
 * and the existing E2E post-call scripts.
 */
import { describe, expect, it } from "vitest";
import {
  CUSTOMER_PRIORITIES,
  emptyDraft,
  defaultAgentPermissions,
  sanitizeDraft,
  type JobSpecDraft,
} from "./job-spec";
import { validateForConfirm, computeCompletion } from "./job-spec-validation";
import { canonicalizeAndHash, canonicalizeJson } from "./job-spec-canonical";

function miamiSmokeDraft(): JobSpecDraft {
  return sanitizeDraft({
    ...emptyDraft(),
    origin: {
      line1: "1200 Brickell Ave",
      line2: "Apt 1204",
      city: "Miami",
      region: "FL",
      postal_code: "33131",
      country: "US",
    },
    destination: {
      line1: "845 Lincoln Rd",
      city: "Miami Beach",
      region: "FL",
      postal_code: "33139",
      country: "US",
    },
    move_date: "2099-07-14",
    preferred_time_window: "morning",
    bedroom_count: 2,
    inventory: [
      { id: "i1", label: "Queen bed", quantity: 1, category: "furniture" },
      { id: "i2", label: "Sofa", quantity: 1, category: "furniture" },
      { id: "i3", label: "Dining table", quantity: 1, category: "furniture" },
      { id: "i4", label: "Boxes", quantity: 25, category: "misc" },
    ],
    fragile_items: [{ id: "f1", label: "TV", category: "electronics", quantity: 1 }],
    specialty_items: [],
    additional_stops: [
      {
        id: "s1",
        label: "Storage pickup",
        purpose: "pickup",
        stop_order: 1,
        address: "500 SW 8th St, Miami, FL 33130",
        services: ["load_only"],
      },
    ],
    origin_access: {
      property_type: "apartment",
      floor: 12,
      stairs_flights: 0,
      elevator: "service",
      elevator_reservation_required: true,
      long_carry_meters: 30,
      long_carry_unit: "meters",
      parking: "loading_dock",
      parking_permit_required: false,
      loading_dock_available: true,
      site_notes: "Loading dock hours 9am-5pm",
    },
    destination_access: {
      property_type: "townhouse",
      floor: 3,
      stairs_flights: 3,
      elevator: "none",
      elevator_reservation_required: false,
      long_carry_meters: 0,
      long_carry_unit: "meters",
      parking: "street",
      parking_permit_required: true,
    },

    packing_level: "partial",
    partial_packing_notes: "Kitchen and artwork only",
    unpacking_requested: false,
    disassembly_required: true,
    reassembly_required: true,
    storage: { needed: false, climate_controlled: false },
    insurance_level: "full_value",
    customer_priorities: [
      CUSTOMER_PRIORITIES[0],
      "estimate_certainty",
      "evidence_quality",
    ],
    agent_permissions: defaultAgentPermissions(),
    special_instructions: "Building requires 24h notice for elevator reservation.",
  });
}

describe("wizard repair 7 — Miami smoke E2E", () => {
  it("all six steps complete → Review at 100% and Confirm accepts", () => {
    const draft = miamiSmokeDraft();
    expect(computeCompletion(draft)).toBe(100);
    const result = validateForConfirm(draft);
    expect(result.ok).toBe(true);
  });

  it("canonical hash is deterministic across two independent computations", async () => {
    const draft = miamiSmokeDraft();
    const r = validateForConfirm(draft);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const a = await canonicalizeAndHash(r.spec);
    const b = await canonicalizeAndHash(r.spec);
    expect(a.hash).toBe(b.hash);
    expect(a.canonical).toBe(b.canonical);
    // Hash is a full SHA-256 hex string.
    expect(a.hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("reload path (sanitize → validate) returns identical spec + hash", async () => {
    const draft = miamiSmokeDraft();
    const first = validateForConfirm(draft);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const stored = JSON.parse(JSON.stringify(first.spec)); // storage round-trip
    const reloaded = validateForConfirm(sanitizeDraft(stored));
    expect(reloaded.ok).toBe(true);
    if (!reloaded.ok) return;
    const h1 = await canonicalizeAndHash(first.spec);
    const h2 = await canonicalizeAndHash(reloaded.spec);
    expect(h1.hash).toBe(h2.hash);
    expect(h1.canonical).toBe(h2.canonical);
  });

  it("structured priorities and authority are preserved end-to-end", () => {
    const draft = miamiSmokeDraft();
    const r = validateForConfirm(draft);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.spec.customer_priorities).toEqual([
      "lowest_all_in_price",
      "estimate_certainty",
      "evidence_quality",
    ]);
    // Every canonical authority boolean is an explicit true/false.
    const perms = r.spec.agent_permissions as Record<string, unknown>;
    for (const [k, v] of Object.entries(perms)) {
      expect(typeof v, `agent_permissions.${k}`).toBe("boolean");
    }
  });

  it("false / zero values survive sanitize + validate + canonicalize", async () => {
    const draft = miamiSmokeDraft();
    const r = validateForConfirm(draft);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // False survives.
    expect(r.spec.storage?.needed).toBe(false);
    expect(r.spec.unpacking_requested).toBe(false);
    expect(r.spec.origin_access?.parking_permit_required).toBe(false);
    // Zero survives.
    expect(r.spec.origin_access?.stairs_flights).toBe(0);
    expect(r.spec.destination_access?.long_carry_meters).toBe(0);
    // And the canonical bytes contain the literal values, not stripped.
    const canonical = canonicalizeJson(r.spec);
    expect(canonical).toContain('"needed":false');
    expect(canonical).toContain('"stairs_flights":0');
  });

  it("inventory and additional stops are preserved", () => {
    const draft = miamiSmokeDraft();
    const r = validateForConfirm(draft);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.spec.inventory).toHaveLength(4);
    expect(r.spec.inventory.map((i) => i.label)).toEqual([
      "Queen bed",
      "Sofa",
      "Dining table",
      "Boxes",
    ]);
    expect(r.spec.additional_stops).toHaveLength(1);
    expect(r.spec.additional_stops?.[0].purpose).toBe("pickup");
  });

  it("canonicalization strips transient row IDs so hashes are stable across regenerations", async () => {
    // Two drafts, identical content but different transient client-side ids.
    const a = miamiSmokeDraft();
    const b = miamiSmokeDraft();
    const va = validateForConfirm(a);
    const vb = validateForConfirm(b);
    expect(va.ok && vb.ok).toBe(true);
    if (!va.ok || !vb.ok) return;
    // Mutate transient ids only.
    for (const item of vb.spec.inventory) {
      (item as { id?: string }).id = `rand-${Math.random()}`;
    }
    if (vb.spec.additional_stops) {
      for (const s of vb.spec.additional_stops) {
        (s as { id?: string }).id = `rand-${Math.random()}`;
      }
    }
    const ha = await canonicalizeAndHash(va.spec);
    const hb = await canonicalizeAndHash(vb.spec);
    expect(ha.hash).toBe(hb.hash);
  });
});
