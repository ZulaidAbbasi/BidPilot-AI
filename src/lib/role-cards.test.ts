import { describe, expect, it } from "vitest";
import {
  ROLE_CARDS,
  SHOWCASE_PROFILES,
  SHOWCASE_PROFILE_TO_REHEARSAL_STYLE,
  collectRoleCardFieldNames,
} from "./role-cards";

describe("private role cards — showcase invariants", () => {
  it("exposes exactly three distinct showcase profiles", () => {
    expect(SHOWCASE_PROFILES.length).toBe(3);
    const uniq = new Set(SHOWCASE_PROFILES);
    expect(uniq.size).toBe(3);
    for (const p of SHOWCASE_PROFILES) {
      expect(ROLE_CARDS[p]).toBeTruthy();
      expect(ROLE_CARDS[p].profile).toBe(p);
    }
  });

  it("maps each showcase profile to a distinct rehearsal style", () => {
    const styles = SHOWCASE_PROFILES.map((p) => SHOWCASE_PROFILE_TO_REHEARSAL_STYLE[p]);
    expect(new Set(styles).size).toBe(3);
  });

  it("every card is behavioral, not scripted (no per-line dialogue)", () => {
    for (const p of SHOWCASE_PROFILES) {
      const card = ROLE_CARDS[p];
      // No card contains quoted dialogue that would be a script.
      const flat = [
        ...card.behavior,
        ...card.privateNumericBoundaries,
        ...card.concessionRules,
        ...card.forbiddenBehaviors,
      ].join(" ");
      expect(flat).not.toMatch(/^\s*"|"\s*\.\s*$/); // no leading/trailing wrapped-dialogue quotes as full items
      // Each card must state boundaries privately and offer no guaranteed win.
      expect(card.privateNumericBoundaries.length).toBeGreaterThan(0);
    }
  });

  it("role card field names never appear in the agent dynamic-variables key set", () => {
    // These are the ONLY keys the server injects into the ElevenLabs session
    // (mirrored from src/lib/elevenlabs.functions.ts). If a future edit pipes
    // a role-card field into that payload, this test fails. Style keys are
    // deliberately absent — the caller must be style-blind.
    const AGENT_DYNAMIC_VAR_KEYS = new Set<string>([
      "call_mode",
      "mode_directive",
      "forbidden_always",
      "negotiation_objective",
      "customer_authority",
      "negotiation_id",
      "call_id",
      "provider_id",
      "provider_name",
      "customer_first_name",
      "origin_short",
      "destination_short",
      "moving_date_spoken",
      "confirmed_spec_version",
      "confirmed_spec_hash",
      "confirmed_spec_json",
      "preferred_language",
      "customer_timezone",
      "recording_disclosure_instruction",
      "recording_disclosure_text",
      "secret__call_tool_token",
      "leverage_available",
      "leverage_provider_name",
      "leverage_total_amount",
      "leverage_currency",
      "leverage_included_services",
      "leverage_quote_id",
      "leverage_instruction",
    ]);

    expect(AGENT_DYNAMIC_VAR_KEYS.has("rehearsal_style")).toBe(false);
    expect(AGENT_DYNAMIC_VAR_KEYS.has("rehearsal_style_guidance")).toBe(false);

    const roleCardFields = collectRoleCardFieldNames();
    const mustNotLeak = [
      "audienceNote",
      "behavior",
      "privateNumericBoundaries",
      "concessionRules",
      "forbiddenBehaviors",
    ];
    for (const f of mustNotLeak) {
      expect(roleCardFields.has(f)).toBe(true);
      expect(AGENT_DYNAMIC_VAR_KEYS.has(f)).toBe(false);
    }
  });

  it("no agent-facing directive string contains counterparty persona text", async () => {
    const { QUOTE_GATHERING_DIRECTIVE, NEGOTIATION_DIRECTIVE, FORBIDDEN_ALWAYS } =
      await import("./agent-directives");
    for (const v of [QUOTE_GATHERING_DIRECTIVE, NEGOTIATION_DIRECTIVE, FORBIDDEN_ALWAYS]) {
      expect(v).not.toMatch(/Role-play/i);
    }
  });
});
