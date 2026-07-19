import { describe, expect, it } from "vitest";
import { canonicalizeAndHash, canonicalizeJson, sha256Hex, shortHash } from "./job-spec-canonical";
import { defaultAgentPermissions } from "./job-spec";
import type { JobSpec } from "./job-spec";

/**
 * Tests for canonicalization + hashing behavior. These are pure, so they do
 * not require a database or a running server. Concurrent-version-creation,
 * ownership, and immutability tests run against Postgres in
 * supabase/tests/confirm-job-spec.sql (executed via `npm run test:db`).
 */

const baseSpec: JobSpec = {
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
  move_date: "2099-01-15",
  preferred_time_window: "morning",
  bedroom_count: 2,
  inventory: [
    { id: "a", label: "Sofa", quantity: 1 },
    { id: "b", label: "Bed frame", quantity: 2 },
  ],
  fragile_items: [],
  specialty_items: [],
  origin_access: {
    floor: 3,
    stairs_flights: 1,
    elevator: "passenger",
    elevator_reservation_required: false,
    long_carry_meters: 10,
    parking: "street",
    parking_permit_required: false,
  } as JobSpec["origin_access"],
  destination_access: {
    floor: 1,
    stairs_flights: 0,
    elevator: "none",
    elevator_reservation_required: false,
    long_carry_meters: 5,
    parking: "driveway",
    parking_permit_required: false,
  } as JobSpec["destination_access"],
  packing_level: "partial",
  unpacking_requested: false,
  disassembly_required: true,
  reassembly_required: true,
  storage: { needed: false },
  insurance_level: "standard",
  additional_stops: [],
  customer_priorities: [],
  agent_permissions: defaultAgentPermissions(),
  special_instructions: "Ring the bell twice.",
};

describe("canonicalizeJson", () => {
  it("sorts object keys deterministically at every depth", () => {
    const a = { b: 1, a: { z: 2, y: 1 } };
    const b = { a: { y: 1, z: 2 }, b: 1 };
    expect(canonicalizeJson(a)).toBe(canonicalizeJson(b));
    expect(canonicalizeJson(a)).toBe('{"a":{"y":1,"z":2},"b":1}');
  });

  it("preserves array order (order is semantic)", () => {
    expect(canonicalizeJson([2, 1, 3])).toBe("[2,1,3]");
    expect(canonicalizeJson([2, 1, 3])).not.toBe(canonicalizeJson([1, 2, 3]));
  });

  it("omits undefined but preserves null", () => {
    expect(canonicalizeJson({ a: undefined, b: null })).toBe('{"b":null}');
  });

  it("throws on non-finite numbers", () => {
    expect(() => canonicalizeJson({ x: Infinity })).toThrow();
    expect(() => canonicalizeJson({ x: Number.NaN })).toThrow();
  });
});

describe("sha256Hex", () => {
  it("matches known vectors", async () => {
    // NIST test vectors.
    expect(await sha256Hex("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
    expect(await sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("is deterministic", async () => {
    const a = await sha256Hex("hello world");
    const b = await sha256Hex("hello world");
    expect(a).toBe(b);
  });
});

describe("canonicalizeAndHash on JobSpec", () => {
  it("produces identical hashes for shuffled but semantically equal specs", async () => {
    // Shuffle top-level and nested keys.
    const shuffled: JobSpec = {
      insurance_level: baseSpec.insurance_level,
      reassembly_required: baseSpec.reassembly_required,
      disassembly_required: baseSpec.disassembly_required,
      unpacking_requested: baseSpec.unpacking_requested,
      packing_level: baseSpec.packing_level,
      destination_access: {
        parking_permit_required: baseSpec.destination_access.parking_permit_required,
        parking: baseSpec.destination_access.parking,
        long_carry_meters: baseSpec.destination_access.long_carry_meters,
        elevator_reservation_required:
          baseSpec.destination_access.elevator_reservation_required,
        elevator: baseSpec.destination_access.elevator,
        stairs_flights: baseSpec.destination_access.stairs_flights,
        floor: baseSpec.destination_access.floor,
      } as JobSpec["destination_access"],
      origin_access: baseSpec.origin_access,
      specialty_items: baseSpec.specialty_items,
      fragile_items: baseSpec.fragile_items,
      inventory: baseSpec.inventory,
      bedroom_count: baseSpec.bedroom_count,
      preferred_time_window: baseSpec.preferred_time_window,
      move_date: baseSpec.move_date,
      destination: baseSpec.destination,
      origin: baseSpec.origin,
      storage: baseSpec.storage,
      additional_stops: baseSpec.additional_stops,
      customer_priorities: baseSpec.customer_priorities,
      agent_permissions: baseSpec.agent_permissions,
      special_instructions: baseSpec.special_instructions,
    };
    const a = await canonicalizeAndHash(baseSpec);
    const b = await canonicalizeAndHash(shuffled);
    expect(a.hash).toBe(b.hash);
    expect(a.canonical).toBe(b.canonical);
  });

  it("changes hash when a leaf value changes", async () => {
    const a = await canonicalizeAndHash(baseSpec);
    const b = await canonicalizeAndHash({ ...baseSpec, bedroom_count: 3 });
    expect(a.hash).not.toBe(b.hash);
  });

  it("changes hash when array order changes", async () => {
    const a = await canonicalizeAndHash(baseSpec);
    const reordered: JobSpec = {
      ...baseSpec,
      inventory: [...baseSpec.inventory].reverse(),
    };
    const b = await canonicalizeAndHash(reordered);
    expect(a.hash).not.toBe(b.hash);
  });

  it("produces a 64-char lowercase hex string", async () => {
    const { hash } = await canonicalizeAndHash(baseSpec);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("shortHash", () => {
  it("returns the requested prefix length", () => {
    expect(shortHash("abcdef1234567890", 6)).toBe("abcdef");
    expect(shortHash("abcdef1234567890").length).toBe(10);
  });
});
