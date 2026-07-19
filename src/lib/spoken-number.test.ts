import { describe, expect, it } from "vitest";
import { parseSpokenAmount, reconcileSpokenAmount } from "./spoken-number";

describe("parseSpokenAmount", () => {
  it("parses digit forms", () => {
    expect(parseSpokenAmount("$1,500")).toBe(1500);
    expect(parseSpokenAmount("1500")).toBe(1500);
    expect(parseSpokenAmount("1,350.00")).toBe(1350);
    expect(parseSpokenAmount("2k")).toBe(2000);
  });

  it("parses hundred phrases", () => {
    expect(parseSpokenAmount("fifteen hundred")).toBe(1500);
    expect(parseSpokenAmount("fifteen hundred dollars")).toBe(1500);
    expect(parseSpokenAmount("thirteen hundred fifty")).toBe(1350);
    expect(parseSpokenAmount("thirteen hundred and fifty")).toBe(1350);
    expect(parseSpokenAmount("five hundred")).toBe(500);
  });

  it("parses thousand phrases without dropping the thousand", () => {
    expect(parseSpokenAmount("one thousand five hundred")).toBe(1500);
    expect(parseSpokenAmount("one thousand three hundred fifty")).toBe(1350);
    expect(parseSpokenAmount("two thousand")).toBe(2000);
    expect(parseSpokenAmount("two thousand two hundred")).toBe(2200);
  });

  it("returns null for gibberish", () => {
    expect(parseSpokenAmount("")).toBeNull();
    expect(parseSpokenAmount("abcdef")).toBeNull();
    expect(parseSpokenAmount(null)).toBeNull();
  });

  it("clamps absurd values", () => {
    expect(parseSpokenAmount("-5")).toBeNull();
    expect(parseSpokenAmount("100000000")).toBeNull();
  });
});

describe("reconcileSpokenAmount", () => {
  it("overrides bad numeric with word-form when agent dropped the thousand", () => {
    // Real production bug: agent said "fifteen hundred", extracted 500.
    const r = reconcileSpokenAmount(500, "fifteen hundred dollars");
    expect(r.amount).toBe(1500);
    expect(r.source).toBe("words_override");
  });

  it("prefers explicit numeric when both agree in magnitude", () => {
    expect(reconcileSpokenAmount(1500, "fifteen hundred").amount).toBe(1500);
    expect(reconcileSpokenAmount(1350, "thirteen hundred and fifty").amount).toBe(1350);
  });

  it("uses word-form when numeric missing", () => {
    expect(reconcileSpokenAmount(null, "fifteen hundred").amount).toBe(1500);
  });

  it("returns null when nothing usable is present", () => {
    expect(reconcileSpokenAmount(null, null).amount).toBeNull();
  });
});
