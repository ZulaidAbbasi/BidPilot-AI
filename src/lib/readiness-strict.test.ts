import { describe, expect, it } from "vitest";

/**
 * Strict AND readiness proofs for voice and document intake.
 * Mirrors the logic in `getChallengeReadiness` (see src/lib/report.functions.ts):
 *   voice PASS  ⇔ ∃ intake_sessions row for negotiation
 *                 ∧ ∃ session.status = "completed"
 *                 ∧ ∃ draft field with provenance.source = "voice"
 *                 ∧ draft belongs to this negotiation
 *   document PASS ⇔ draft belongs to negotiation
 *                   ∧ ∃ draft field with provenance.source ∈ {document, document_extraction}
 */

type Provenance = Record<string, { source: string }>;
type Session = { negotiation_id: string; status: string };

function voicePasses(opts: {
  negotiationId: string;
  draft: { negotiation_id: string; field_provenance: Provenance } | null;
  sessions: Session[];
}): { pass: boolean; detail: string } {
  const { negotiationId, draft, sessions } = opts;
  if (!draft || draft.negotiation_id !== negotiationId) {
    return { pass: false, detail: "Draft missing or from another negotiation." };
  }
  const completed = sessions.filter(
    (s) => s.negotiation_id === negotiationId && s.status === "completed",
  );
  const voiceFields = Object.entries(draft.field_provenance).filter(
    ([, v]) => v.source === "voice",
  );
  const pass = completed.length > 0 && voiceFields.length > 0;
  return {
    pass,
    detail: pass
      ? `${completed.length} completed voice intake session(s) contributed ${voiceFields.length} accepted field(s).`
      : completed.length === 0
        ? "No completed voice intake session for this negotiation."
        : "Completed voice session contributed zero accepted voice-provenance fields.",
  };
}

function documentPasses(opts: {
  negotiationId: string;
  draft: { negotiation_id: string; field_provenance: Provenance } | null;
}) {
  const { negotiationId, draft } = opts;
  if (!draft || draft.negotiation_id !== negotiationId) return false;
  return Object.values(draft.field_provenance).some(
    (v) => v.source === "document" || v.source === "document_extraction",
  );
}

describe("voice readiness — strict AND", () => {
  const negotiationId = "neg-1";
  const draftWithVoice = {
    negotiation_id: negotiationId,
    field_provenance: {
      bedrooms: { source: "voice" },
      moving_date: { source: "voice" },
    } as Provenance,
  };

  it("PASS when completed session AND >=1 voice-provenance field exist", () => {
    const r = voicePasses({
      negotiationId,
      draft: draftWithVoice,
      sessions: [{ negotiation_id: negotiationId, status: "completed" }],
    });
    expect(r.pass).toBe(true);
    expect(r.detail).toMatch(/completed voice intake session/);
  });

  it("FAIL: completed session but zero voice-provenance fields", () => {
    const r = voicePasses({
      negotiationId,
      draft: { negotiation_id: negotiationId, field_provenance: {} },
      sessions: [{ negotiation_id: negotiationId, status: "completed" }],
    });
    expect(r.pass).toBe(false);
    expect(r.detail).toMatch(/zero accepted/);
  });

  it("FAIL: voice-provenance fields exist but no completed session", () => {
    const r = voicePasses({
      negotiationId,
      draft: draftWithVoice,
      sessions: [{ negotiation_id: negotiationId, status: "in_progress" }],
    });
    expect(r.pass).toBe(false);
    expect(r.detail).toMatch(/No completed voice intake/);
  });

  it("FAIL: session belongs to a different negotiation", () => {
    const r = voicePasses({
      negotiationId,
      draft: draftWithVoice,
      sessions: [{ negotiation_id: "other-neg", status: "completed" }],
    });
    expect(r.pass).toBe(false);
  });
});

describe("document readiness — strict AND", () => {
  const negotiationId = "neg-2";

  it("PASS when at least one document-sourced field on the negotiation's draft", () => {
    const draft = {
      negotiation_id: negotiationId,
      field_provenance: { total_volume: { source: "document" } } as Provenance,
    };
    expect(documentPasses({ negotiationId, draft })).toBe(true);
  });

  it("FAIL when no document-sourced fields", () => {
    const draft = {
      negotiation_id: negotiationId,
      field_provenance: { total_volume: { source: "manual" } } as Provenance,
    };
    expect(documentPasses({ negotiationId, draft })).toBe(false);
  });

  it("FAIL when the draft belongs to a different negotiation", () => {
    const draft = {
      negotiation_id: "wrong-neg",
      field_provenance: { total_volume: { source: "document" } } as Provenance,
    };
    expect(documentPasses({ negotiationId, draft })).toBe(false);
  });
});

describe("confirmed-spec provenance lineage", () => {
  /**
   * When the user confirms the spec, only fields present on the draft at
   * confirmation time are captured into the immutable specification. Removing
   * a voice/document field from the draft after confirmation must NOT retro-
   * pass readiness against the confirmed spec — readiness is derived from the
   * current draft provenance and the current intake sessions, so removing a
   * field flips voice readiness back to FAIL.
   */
  it("removing the last voice field from the draft turns voice readiness back to FAIL", () => {
    const negotiationId = "neg-3";
    const sessions: Session[] = [
      { negotiation_id: negotiationId, status: "completed" },
    ];
    const before = voicePasses({
      negotiationId,
      draft: {
        negotiation_id: negotiationId,
        field_provenance: { bedrooms: { source: "voice" } },
      },
      sessions,
    });
    expect(before.pass).toBe(true);
    const after = voicePasses({
      negotiationId,
      draft: { negotiation_id: negotiationId, field_provenance: {} },
      sessions,
    });
    expect(after.pass).toBe(false);
  });
});
