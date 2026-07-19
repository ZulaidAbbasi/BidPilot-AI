import { describe, expect, it } from "vitest";
import {
  QUOTE_GATHERING_DIRECTIVE,
  NEGOTIATION_DIRECTIVE,
  FORBIDDEN_ALWAYS,
  directiveForMode,
  buildLeverageCitation,
} from "./agent-directives";

describe("mode-strict agent directives", () => {
  it("QUOTE_GATHERING forbids leverage/competitor use and does not seed one", () => {
    const d = QUOTE_GATHERING_DIRECTIVE.toLowerCase();
    // Words appear ONLY inside the strict-forbidden clause, not as an
    // instruction to use leverage or cite a competitor.
    expect(d).toMatch(/mentioning competitors, leverage/);
    expect(d).not.toMatch(/you have|you may cite|verified competing quote|use it to ask/);
    expect(d).not.toMatch(/target price|target discount|aim for/);
    expect(d).toMatch(/interviewer/);
    expect(d).toMatch(/one .*question at a time/);
    // Forbids narrating provider price
    expect(d).toMatch(/answering a question on behalf of the provider/);
  });

  it("NEGOTIATION requires a verified competing quote and forbids invention", () => {
    const d = NEGOTIATION_DIRECTIVE.toLowerCase();
    expect(d).toMatch(/verified competing quote/);
    expect(d).toMatch(/same confirmed specification|same confirmed spec/);
    expect(d).toMatch(/inventing a competing offer/);
    // No predetermined target price / target discount / forced concession
    expect(d).not.toMatch(/target price|target discount|aim for|target of \$/);
    // Refusal is an acceptable outcome — not a failure to manufacture around
    expect(d).toMatch(/refusal or unchanged offer.*acceptable/);
  });

  it("FORBIDDEN_ALWAYS bars invention and agent-computed savings", () => {
    const d = FORBIDDEN_ALWAYS.toLowerCase();
    expect(d).toMatch(/do not invent/);
    expect(d).toMatch(/server computes savings/);
  });

  it("directiveForMode maps modes to the correct directive", () => {
    expect(directiveForMode("QUOTE_GATHERING")).toBe(QUOTE_GATHERING_DIRECTIVE);
    expect(directiveForMode("NEGOTIATION")).toBe(NEGOTIATION_DIRECTIVE);
  });

  it("buildLeverageCitation only quotes the exact recorded competing total", () => {
    const cite = buildLeverageCitation({
      providerName: "AtoB Movers",
      currency: "USD",
      totalAmount: 1350,
      includedServices: ["labor", "transport"],
    });
    expect(cite).toContain("AtoB Movers");
    expect(cite).toContain("USD 1350");
    expect(cite).toMatch(/exact recorded total/i);
    expect(cite).toMatch(/must not cite any\s+other competitor/i);
    expect(cite).toMatch(/must not quote a lower number/i);
  });

  it("buildLeverageCitation with a missing total explicitly refuses to invent one", () => {
    const cite = buildLeverageCitation({
      providerName: "AtoB Movers",
      currency: "USD",
      totalAmount: null,
      includedServices: [],
    });
    expect(cite).toMatch(/do not invent one/i);
  });

  it("buildLeverageCitation returns empty when no provider is supplied (never leaks a stub)", () => {
    expect(
      buildLeverageCitation({
        providerName: "",
        currency: "USD",
        totalAmount: null,
        includedServices: [],
      }),
    ).toBe("");
  });
});
