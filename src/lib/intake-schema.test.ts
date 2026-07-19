import { describe, expect, it } from "vitest";

import {
  getAtPath,
  INTAKE_ALLOWED_PATHS,
  isAllowedPath,
  normalizeIntakePath,
  setAtPath,
} from "./intake-schema";

describe("intake-schema", () => {
  it("accepts every canonical write path", () => {
    for (const path of INTAKE_ALLOWED_PATHS) expect(isAllowedPath(path)).toBe(true);
  });

  it("rejects unknown and non-schema paths", () => {
    expect(isAllowedPath("not_a_field")).toBe(false);
    expect(isAllowedPath("origin.secret")).toBe(false);
    expect(isAllowedPath("origin_property_type")).toBe(false);
    expect(isAllowedPath("destination_property_type")).toBe(false);
    expect(isAllowedPath("must_haves")).toBe(false);
    expect(isAllowedPath("deal_breakers")).toBe(false);
  });

  it("rejects prototype-pollution paths", () => {
    expect(isAllowedPath("__proto__.polluted")).toBe(false);
    expect(isAllowedPath("origin.__proto__")).toBe(false);
    expect(isAllowedPath("constructor.prototype")).toBe(false);
    expect(isAllowedPath("origin.constructor")).toBe(false);
    expect(isAllowedPath("origin..city")).toBe(false);
  });

  it("requires array-valued fields to be written atomically", () => {
    expect(isAllowedPath("customer_priorities")).toBe(true);
    expect(isAllowedPath("customer_priorities.0")).toBe(false);
    expect(isAllowedPath("inventory")).toBe(true);
    expect(isAllowedPath("inventory.0.label")).toBe(false);
    expect(isAllowedPath("fragile_items.0")).toBe(false);
  });

  it("normalizes supported legacy aliases to real draft paths", () => {
    expect(isAllowedPath("moving_date")).toBe(true);
    expect(normalizeIntakePath("moving_date")).toBe("move_date");
    expect(normalizeIntakePath("time_window")).toBe("preferred_time_window");
    expect(normalizeIntakePath("services.packing_level")).toBe("packing_level");
    expect(normalizeIntakePath("protection.insurance_level")).toBe("insurance_level");
    expect(normalizeIntakePath("notes")).toBe("special_instructions");
  });

  it("setAtPath writes nested values immutably", () => {
    const before = { origin: { city: "Boston" } };
    const after = setAtPath(before, "origin.postal_code", "02118");
    expect(getAtPath(after, "origin.city")).toBe("Boston");
    expect(getAtPath(after, "origin.postal_code")).toBe("02118");
    expect((before.origin as Record<string, unknown>).postal_code).toBeUndefined();
  });

  it("setAtPath refuses forbidden segments", () => {
    expect(() => setAtPath({}, "__proto__.polluted", true)).toThrow();
    expect(() => setAtPath({}, "constructor.evil", true)).toThrow();
  });

  it("does not pollute Object.prototype", () => {
    try {
      setAtPath({}, "__proto__.polluted", "x");
    } catch {
      // Expected.
    }
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});
