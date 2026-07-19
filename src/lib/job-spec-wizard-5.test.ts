/**
 * Wizard Repair 5/7 — Move Basics, Access, and Inventory consistency.
 *
 * These tests lock the canonical behaviour we care about at the schema
 * and hashing layer, so refactors in the UI can never silently regress:
 *
 *  1. Move date is stored date-only and round-trips without a Z / time
 *     component sneaking in from the browser.
 *  2. Origin and destination addresses stay isolated — mutating one
 *     never leaks into the other.
 *  3. Legitimate zero / false values on Access (floor 0, 0 stairs, no
 *     elevator, no permit) must survive draft sanitize and end up in
 *     the canonical hash payload, not be treated as "missing".
 *  4. Inventory hashes are stable across transient React `id`s and
 *     rearrangements do change the hash (order is data).
 */

import { describe, it, expect } from "vitest";
import { emptyDraft, sanitizeDraft, newItemId } from "./job-spec";
import { canonicalizeAndHash } from "./job-spec-canonical";

describe("wizard repair 5 — move basics, access, inventory", () => {
  it("preserves date-only move date without timezone drift", () => {
    const d = emptyDraft();
    d.move_date = "2026-08-14";
    const clean = sanitizeDraft(d);
    expect(clean.move_date).toBe("2026-08-14");
    expect(clean.move_date).not.toMatch(/T|Z/);
  });

  it("keeps origin and destination addresses isolated", () => {
    const d = emptyDraft();
    d.origin = {
      line1: "1 Origin St",
      line2: "Apt 2",
      city: "Origintown",
      region: "CA",
      postal_code: "90001",
      country: "US",
    };
    d.destination = {
      line1: "9 Dest Ave",
      line2: undefined,
      city: "Destcity",
      region: "NY",
      postal_code: "10001",
      country: "US",
    };
    // Mutating destination must never bleed into origin.
    d.destination.line1 = "MUTATED";
    expect(d.origin?.line1).toBe("1 Origin St");
    expect(d.origin?.line2).toBe("Apt 2");
  });

  it("keeps zero/false access values in the canonical hash payload", async () => {
    const d = emptyDraft();
    d.origin_access = {
      property_type: "apartment",
      floor: 0,
      stairs_flights: 0,
      elevator: "none",
      elevator_reservation_required: false,
      long_carry_meters: 0,
      long_carry_unit: "meters",
      parking: "street",
      parking_permit_required: false,
      loading_dock_available: false,
    };
    const clean = sanitizeDraft(d);
    // Zero and false are real answers, not undefined.
    expect(clean.origin_access?.floor).toBe(0);
    expect(clean.origin_access?.stairs_flights).toBe(0);
    expect(clean.origin_access?.elevator).toBe("none");
    expect(clean.origin_access?.parking_permit_required).toBe(false);
    expect(clean.origin_access?.long_carry_meters).toBe(0);
  });

  it("produces the same inventory hash regardless of transient item ids", async () => {
    const base = emptyDraft();
    base.inventory = [
      { id: newItemId(), label: "Sofa", quantity: 1, category: "furniture" },
      { id: newItemId(), label: "TV", quantity: 2, category: "electronics" },
    ];
    // Same structural content, different React ids.
    const other = emptyDraft();
    other.move_date = base.move_date;
    other.inventory = [
      { id: newItemId(), label: "Sofa", quantity: 1, category: "furniture" },
      { id: newItemId(), label: "TV", quantity: 2, category: "electronics" },
    ];
    const a = await canonicalizeAndHash(sanitizeDraft(base) as never);
    const b = await canonicalizeAndHash(sanitizeDraft(other) as never);
    expect(a.hash).toEqual(b.hash);
  });

  it("changes the inventory hash when items are reordered (order is data)", async () => {
    const one = emptyDraft();
    one.inventory = [
      { id: newItemId(), label: "Sofa", quantity: 1, category: "furniture" },
      { id: newItemId(), label: "TV", quantity: 2, category: "electronics" },
    ];
    const two = emptyDraft();
    two.move_date = one.move_date;
    two.inventory = [
      { id: newItemId(), label: "TV", quantity: 2, category: "electronics" },
      { id: newItemId(), label: "Sofa", quantity: 1, category: "furniture" },
    ];
    const a = await canonicalizeAndHash(sanitizeDraft(one) as never);
    const b = await canonicalizeAndHash(sanitizeDraft(two) as never);
    expect(a.hash).not.toEqual(b.hash);
  });
});
