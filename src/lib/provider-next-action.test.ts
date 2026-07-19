/**
 * Provider Add — Next Action helper tests.
 *
 * Proves the anti-screenplay + no-auto-call + reuse-shared-eligibility
 * invariants defined in `provider-next-action.ts`.
 */

import { describe, it, expect } from "vitest";
import {
  DEFAULT_NEXT_ACTION,
  NEXT_ACTIONS,
  NEXT_ACTION_META,
  buildControlRoomSearch,
  evaluateLeverageOptions,
  isPlaceholderProviderValue,
  resolveNextActionSubmission,
  sanitizeProviderInput,
  type LeverageQuoteRow,
} from "./provider-next-action";
import { checkLeverageEligibility } from "./leverage-eligibility.server";

const NEG = "00000000-0000-0000-0000-0000000000ne";
const SPEC_HASH = "hash-current";
const TARGET_PROVIDER = "provider-target";
const OTHER_PROVIDER = "provider-other";

function baseCandidate(overrides: Partial<LeverageQuoteRow> = {}): LeverageQuoteRow {
  return {
    id: "q1",
    provider_id: OTHER_PROVIDER,
    provider_name: "Other Movers",
    spec_hash: SPEC_HASH,
    quote_stage: "FINAL",
    final_confirmed_at: "2026-07-01T00:00:00Z",
    verification_status: "verified",
    valid_until: null,
    total_amount: 1500,
    currency: "USD",
    captured_at: "2026-07-01T00:00:00Z",
    call: { status: "completed", needs_review: false },
    evidence: [{ evidence_type: "price_total", support_status: "supported" }],
    ...overrides,
  };
}

describe("provider next-action helpers", () => {
  it("default next action is Quote Gathering", () => {
    expect(DEFAULT_NEXT_ACTION).toBe("quote_gathering");
    expect(NEXT_ACTION_META.quote_gathering.submitLabel).toBe("Add & prepare quote call");
    expect(NEXT_ACTION_META.negotiation.submitLabel).toBe("Add & prepare negotiation");
    expect(NEXT_ACTION_META.add_only.submitLabel).toBe("Add provider");
  });

  it("has exactly three next actions and no rehearsal/style field", () => {
    expect([...NEXT_ACTIONS].sort()).toEqual(["add_only", "negotiation", "quote_gathering"]);
    // Anti-screenplay: no rehearsal_style / role-card key must appear anywhere in the meta.
    const serialized = JSON.stringify(NEXT_ACTION_META).toLowerCase();
    for (const forbidden of [
      "rehearsal_style",
      "role-play",
      "stonewaller",
      "upseller",
      "hidden fee",
      "lowball",
      "concession policy",
      "minimum price",
    ]) {
      expect(serialized.includes(forbidden)).toBe(false);
    }
  });

  it("placeholder values are never persisted", () => {
    expect(isPlaceholderProviderValue("phone", "+1 555 123 4567")).toBe(true);
    expect(isPlaceholderProviderValue("website", "acmemoving.com")).toBe(true);
    expect(isPlaceholderProviderValue("location", "Brooklyn, NY")).toBe(true);
    const sanitized = sanitizeProviderInput({
      name: "  Real Mover  ",
      phone: "+1 555 123 4567",
      website: "acmemoving.com",
      location: "Brooklyn, NY",
    });
    expect(sanitized).toEqual({
      name: "Real Mover",
      phone: null,
      website: null,
      location: null,
    });
  });

  it("real values pass through sanitization untouched", () => {
    expect(
      sanitizeProviderInput({
        name: "Real Mover",
        phone: "+1 305 555 0198",
        website: "realmovers.io",
        location: "Miami, FL",
      }),
    ).toEqual({
      name: "Real Mover",
      phone: "+1 305 555 0198",
      website: "realmovers.io",
      location: "Miami, FL",
    });
  });

  it("Add-provider-only produces no call mode and no navigation", () => {
    const r = resolveNextActionSubmission({
      nextAction: "add_only",
      providerName: "X",
      selectedLeverageQuoteId: null,
      eligibleLeverageIds: [],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.submission.callMode).toBeNull();
      expect(r.submission.leverageQuoteId).toBeNull();
      expect(
        buildControlRoomSearch({ providerId: "p1", submission: r.submission }),
      ).toBeNull();
    }
  });

  it("Quote Gathering resolves to QUOTE_GATHERING with no leverage", () => {
    const r = resolveNextActionSubmission({
      nextAction: "quote_gathering",
      providerName: "X",
      selectedLeverageQuoteId: null,
      eligibleLeverageIds: [],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.submission.callMode).toBe("QUOTE_GATHERING");
      expect(r.submission.leverageQuoteId).toBeNull();
      expect(buildControlRoomSearch({ providerId: "p1", submission: r.submission })).toEqual({
        providerId: "p1",
        mode: "QUOTE_GATHERING",
      });
    }
  });

  it("Negotiation without a selected leverage quote fails validation", () => {
    const r = resolveNextActionSubmission({
      nextAction: "negotiation",
      providerName: "X",
      selectedLeverageQuoteId: null,
      eligibleLeverageIds: ["q1"],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("negotiation_requires_leverage");
  });

  it("Negotiation with an ineligible quote never silently falls back to Quote Gathering", () => {
    const r = resolveNextActionSubmission({
      nextAction: "negotiation",
      providerName: "X",
      selectedLeverageQuoteId: "q1",
      eligibleLeverageIds: [],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("leverage_not_eligible");
  });

  it("Valid negotiation persists the selected leverage quote id in the search", () => {
    const r = resolveNextActionSubmission({
      nextAction: "negotiation",
      providerName: "X",
      selectedLeverageQuoteId: "q1",
      eligibleLeverageIds: ["q1"],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.submission.callMode).toBe("NEGOTIATION");
      expect(r.submission.leverageQuoteId).toBe("q1");
      expect(buildControlRoomSearch({ providerId: "p1", submission: r.submission })).toEqual({
        providerId: "p1",
        mode: "NEGOTIATION",
        leverageQuoteId: "q1",
      });
    }
  });
});

describe("evaluateLeverageOptions — reuses shared eligibility", () => {
  it("delegates to checkLeverageEligibility (same accept/reject)", () => {
    const q = baseCandidate();
    const shared = checkLeverageEligibility({
      quote: {
        id: q.id,
        provider_id: q.provider_id,
        spec_hash: q.spec_hash,
        quote_stage: q.quote_stage,
        final_confirmed_at: q.final_confirmed_at,
        verification_status: q.verification_status,
        valid_until: q.valid_until,
        negotiation_id: NEG,
      },
      call: q.call,
      evidence: q.evidence,
      currentProviderId: TARGET_PROVIDER,
      currentSpecHash: SPEC_HASH,
    });
    const evald = evaluateLeverageOptions({
      candidates: [q],
      currentProviderId: TARGET_PROVIDER,
      currentSpecHash: SPEC_HASH,
      currentNegotiationId: NEG,
    });
    expect(shared.eligible).toBe(true);
    expect(evald.eligible.map((e) => e.id)).toEqual(["q1"]);
    expect(evald.disabledReason).toBeNull();
  });

  it("shows a disabled reason when no candidates exist", () => {
    const evald = evaluateLeverageOptions({
      candidates: [],
      currentProviderId: TARGET_PROVIDER,
      currentSpecHash: SPEC_HASH,
      currentNegotiationId: NEG,
    });
    expect(evald.eligible).toHaveLength(0);
    expect(evald.disabledReason).toMatch(/No verified comparable quote is available yet/i);
    expect(evald.disabledReason).toMatch(/Complete Quote Gathering/i);
  });

  it("rejects same-provider leverage", () => {
    const evald = evaluateLeverageOptions({
      candidates: [baseCandidate({ provider_id: TARGET_PROVIDER })],
      currentProviderId: TARGET_PROVIDER,
      currentSpecHash: SPEC_HASH,
      currentNegotiationId: NEG,
    });
    expect(evald.eligible).toHaveLength(0);
    expect(evald.ineligibleReasonsById.get("q1")).toBe("same_provider");
  });

  it("rejects different-spec leverage", () => {
    const evald = evaluateLeverageOptions({
      candidates: [baseCandidate({ spec_hash: "hash-old" })],
      currentProviderId: TARGET_PROVIDER,
      currentSpecHash: SPEC_HASH,
      currentNegotiationId: NEG,
    });
    expect(evald.eligible).toHaveLength(0);
    expect(evald.ineligibleReasonsById.get("q1")).toBe("different_spec");
  });

  it("rejects a call that still needs review", () => {
    const evald = evaluateLeverageOptions({
      candidates: [
        baseCandidate({ call: { status: "completed", needs_review: true } }),
      ],
      currentProviderId: TARGET_PROVIDER,
      currentSpecHash: SPEC_HASH,
      currentNegotiationId: NEG,
    });
    expect(evald.ineligibleReasonsById.get("q1")).toBe("call_needs_review");
  });

  it("rejects a flagged quote", () => {
    const evald = evaluateLeverageOptions({
      candidates: [baseCandidate({ verification_status: "flagged" })],
      currentProviderId: TARGET_PROVIDER,
      currentSpecHash: SPEC_HASH,
      currentNegotiationId: NEG,
    });
    expect(evald.ineligibleReasonsById.get("q1")).toBe("flagged");
  });

  it("rejects an expired quote", () => {
    const evald = evaluateLeverageOptions({
      candidates: [
        baseCandidate({ valid_until: "2020-01-01T00:00:00Z" }),
      ],
      currentProviderId: TARGET_PROVIDER,
      currentSpecHash: SPEC_HASH,
      currentNegotiationId: NEG,
    });
    expect(evald.ineligibleReasonsById.get("q1")).toBe("expired");
  });
});
