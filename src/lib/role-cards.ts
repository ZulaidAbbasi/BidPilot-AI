/**
 * Private role cards for the "Showcase — Live Voice Challenge" rehearsal
 * profiles. These are BEHAVIORAL CONSTRAINTS shown ONLY to the human
 * role-player in the operator UI. They MUST NEVER be:
 *   - injected into the ElevenLabs agent prompt or dynamic variables;
 *   - passed as tool arguments;
 *   - stored as transcript, evidence or provider commitment;
 *   - visible on the judge-facing showcase board or transcript.
 *
 * The invariant "role card never reaches the agent" is enforced by
 * `role-cards.test.ts`, which reflectively checks that no leaf field name
 * from ROLE_CARDS appears as a dynamic-variables key.
 */

import type { RehearsalStyle } from "./elevenlabs.functions";

export const SHOWCASE_PROFILES = [
  "flexible_transparent",
  "hidden_fee_lowballer",
  "stonewaller_hard_sell",
] as const;
export type ShowcaseProfile = (typeof SHOWCASE_PROFILES)[number];

export const SHOWCASE_PROFILE_TO_REHEARSAL_STYLE: Record<ShowcaseProfile, RehearsalStyle> = {
  flexible_transparent: "flexible",
  hidden_fee_lowballer: "upseller",
  stonewaller_hard_sell: "stonewaller",
};

export interface RoleCard {
  profile: ShowcaseProfile;
  title: string;
  audienceNote: string;
  behavior: string[];
  privateNumericBoundaries: string[];
  concessionRules: string[];
  forbiddenBehaviors: string[];
}

export const ROLE_CARDS: Record<ShowcaseProfile, RoleCard> = {
  flexible_transparent: {
    profile: "flexible_transparent",
    title: "Flexible & transparent provider",
    audienceNote:
      "Private role card — human role-player only. Never read aloud. Never visible to the AI agent or the judge-facing transcript.",
    behavior: [
      "Cooperative tone. Answer questions directly.",
      "Willing to itemise fees on request.",
      "Only concede price or waive a fee when the caller presents credible leverage or a genuine scope advantage.",
    ],
    privateNumericBoundaries: [
      "Pick your own opening total in a range you consider realistic before dialing.",
      "Pick your own minimum acceptable total. Do not tell the caller either number.",
      "Never go below the minimum acceptable total, even under pressure.",
    ],
    concessionRules: [
      "If leverage is cited: consider matching the competing total or waiving ONE small fee, not both.",
      "No guaranteed concession. A truthful 'that's my best price' is a valid outcome.",
    ],
    forbiddenBehaviors: [
      "Do not invent a scripted concession curve.",
      "Do not accept the customer's target if it is below your private minimum.",
    ],
  },
  hidden_fee_lowballer: {
    profile: "hidden_fee_lowballer",
    title: "Hidden-fee low-baller",
    audienceNote:
      "Private role card — human role-player only. Never read aloud. Never visible to the AI agent or the judge-facing transcript.",
    behavior: [
      "Open with an attractive base price.",
      "Initially avoid optional or conditional fees.",
      "Reveal conditional fees only when the caller asks specifically (stairs, long carry, fuel, packing materials, storage).",
      "May convert to a clearer all-in quote when explicitly challenged.",
    ],
    privateNumericBoundaries: [
      "Pick a low headline base total before dialing.",
      "Pick 2–4 conditional fees you may reveal, each with your own amount.",
      "Pick your own true all-in ceiling. Never disclose it up front.",
    ],
    concessionRules: [
      "No predetermined final price. It is acceptable to end the call with an incomplete or ambiguous quote if the caller does not probe.",
    ],
    forbiddenBehaviors: [
      "Do not invent fees you did not pre-decide.",
      "Do not admit to a hidden-fee strategy explicitly.",
    ],
  },
  stonewaller_hard_sell: {
    profile: "stonewaller_hard_sell",
    title: "Stonewaller / hard-sell",
    audienceNote:
      "Private role card — human role-player only. Never read aloud. Never visible to the AI agent or the judge-facing transcript.",
    behavior: [
      "Interrupt occasionally. Provide vague answers.",
      "You MAY ask whether the caller is a robot.",
      "You MAY push for a deposit, an in-home estimate, or an immediate commitment.",
      "You MAY provide a wide range, a callback, or decline outright.",
    ],
    privateNumericBoundaries: [
      "You are not required to give any number. If you do, choose a wide range that is not a real commitment.",
      "Deposit demand (if used): pick your own amount before dialing.",
    ],
    concessionRules: [
      "No forced successful quote. Refusal, callback or wrong-fit are valid outcomes.",
    ],
    forbiddenBehaviors: [
      "Do not eventually cave and produce a clean itemised quote to be polite.",
      "Do not accept the customer's terms just to close the call.",
    ],
  },
};

/**
 * Every leaf STRING key present in any role card. Used by
 * `role-cards.test.ts` to prove the role card never crosses the process
 * boundary into agent dynamic variables.
 */
export function collectRoleCardFieldNames(): Set<string> {
  const names = new Set<string>();
  const visit = (v: unknown): void => {
    if (v == null) return;
    if (Array.isArray(v)) {
      for (const x of v) visit(x);
      return;
    }
    if (typeof v === "object") {
      for (const k of Object.keys(v as Record<string, unknown>)) {
        names.add(k);
        visit((v as Record<string, unknown>)[k]);
      }
    }
  };
  visit(ROLE_CARDS);
  // Exclude field names that are innocuous common words also legitimately
  // used elsewhere; the invariant is about role-card-SPECIFIC identifiers.
  names.delete("profile");
  names.delete("title");
  return names;
}
