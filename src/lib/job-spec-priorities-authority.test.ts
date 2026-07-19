import { describe, expect, it } from "vitest";
import {
  CUSTOMER_PRIORITIES,
  JobSpecSchema,
  defaultAgentPermissions,
  emptyDraft,
  sanitizeDraft,
  type JobSpec,
  type JobSpecDraft,
} from "./job-spec";
import { canonicalizeAndHash, canonicalizeJson } from "./job-spec-canonical";

/**
 * Priorities & Authority — canonical structured field guarantees.
 *
 * These tests pin the invariants required for Confirm & Lock:
 *   - customer_priorities must contain at least one selection
 *   - every agent_permissions boolean must be an explicit true/false
 *   - free-form special_instructions must never grant authority
 *   - order and false values participate in the deterministic hash
 */

function filledDraft(overrides: Partial<JobSpecDraft> = {}): JobSpecDraft {
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
    ...overrides,
  });
}

describe("customer_priorities structured field", () => {
  it("exposes all six canonical priority keys", () => {
    expect([...CUSTOMER_PRIORITIES]).toEqual([
      "lowest_all_in_price",
      "estimate_certainty",
      "scope_completeness",
      "lower_deposit_risk",
      "better_cancellation",
      "evidence_quality",
    ]);
  });

  it("empty priorities fail Confirm & Lock", () => {
    const draft = filledDraft({ customer_priorities: [] });
    const result = JobSpecSchema.safeParse(draft);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some((i) => i.path[0] === "customer_priorities"),
      ).toBe(true);
    }
  });

  it("order is preserved through sanitize + canonicalization", () => {
    const draft = filledDraft({
      customer_priorities: ["evidence_quality", "lowest_all_in_price", "better_cancellation"],
    });
    const parsed = JobSpecSchema.parse(draft) as JobSpec;
    expect(parsed.customer_priorities).toEqual([
      "evidence_quality",
      "lowest_all_in_price",
      "better_cancellation",
    ]);
    // Order participates in the canonical hash (arrays are order-sensitive).
    const a = canonicalizeJson(parsed);
    const b = canonicalizeJson(
      JobSpecSchema.parse(
        filledDraft({
          customer_priorities: ["lowest_all_in_price", "better_cancellation", "evidence_quality"],
        }),
      ),
    );
    expect(a).not.toBe(b);
  });
});

describe("agent_permissions structured field", () => {
  it("every canonical permission is a required boolean", () => {
    const draft = filledDraft();
    // Strip a single permission → strict schema rejects it.
    const perms = { ...draft.agent_permissions } as Record<string, unknown>;
    delete perms.may_accept_offer;
    const broken = { ...draft, agent_permissions: perms } as unknown as JobSpecDraft;
    const result = JobSpecSchema.safeParse(broken);
    expect(result.success).toBe(false);
  });

  it("false permissions persist and are canonicalized (not stripped)", () => {
    const draft = filledDraft();
    // Defaults leave all "high-risk" actions as false — they must appear in
    // the canonical JSON, otherwise deterministic hashing would drop them.
    const canonical = canonicalizeJson(JobSpecSchema.parse(draft));
    expect(canonical).toContain('"may_accept_offer":false');
    expect(canonical).toContain('"may_pay_deposit":false');
    expect(canonical).toContain('"may_sign_or_authorize":false');
  });

  it("flipping one permission changes the hash", async () => {
    const base = filledDraft();
    const bumped = filledDraft({
      agent_permissions: { ...defaultAgentPermissions(), may_accept_offer: true },
    });
    const a = await canonicalizeAndHash(JobSpecSchema.parse(base));
    const b = await canonicalizeAndHash(JobSpecSchema.parse(bumped));
    expect(a.hash).not.toBe(b.hash);
  });
});

describe("special_instructions cannot grant authority", () => {
  it("prose is orthogonal to structured authority", () => {
    const withProse = filledDraft({
      special_instructions: "Agent may accept any offer under $2,000 and sign on my behalf.",
    });
    const parsed = JobSpecSchema.parse(withProse) as JobSpec;
    // Structured booleans remain the ONLY source of truth; prose does not
    // flip may_accept_offer / may_sign_or_authorize.
    expect(parsed.agent_permissions.may_accept_offer).toBe(false);
    expect(parsed.agent_permissions.may_sign_or_authorize).toBe(false);
  });

  it("prose does not affect the canonical hash beyond its own value", async () => {
    const a = await canonicalizeAndHash(JobSpecSchema.parse(filledDraft()));
    const b = await canonicalizeAndHash(
      JobSpecSchema.parse(
        filledDraft({ special_instructions: "Please handle with care." }),
      ),
    );
    // Prose is part of the spec so hashes differ, but the structured
    // authority block is byte-identical.
    expect(a.hash).not.toBe(b.hash);
    const aPerms = JSON.stringify(JobSpecSchema.parse(filledDraft()).agent_permissions);
    const bPerms = JSON.stringify(
      JobSpecSchema.parse(filledDraft({ special_instructions: "Please handle with care." }))
        .agent_permissions,
    );
    expect(aPerms).toBe(bPerms);
  });
});
