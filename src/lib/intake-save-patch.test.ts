import { describe, expect, it } from "vitest";

import {
  normalizeIntakeValue,
  parseIntakePatchBody,
  validateAndNormalizePatches,
  validateDraftAfterPatches,
} from "./intake-patch";

describe("save-intake-patch production contract", () => {
  it("accepts and normalizes a canonical batch", () => {
    const parsed = validateAndNormalizePatches(
      parseIntakePatchBody({
        expected_revision: "1",
        idempotency_key: "voice-batch-1",
        patches: [
          { path: "moving_date", value: "July 23rd, 2026", customer_confirmed: true },
          { path: "origin_access.floor", value: "3", customer_confirmed: true },
          { path: "origin_access.elevator", value: "no elevator", customer_confirmed: true },
        ],
      }),
    );

    expect(parsed.expected_revision).toBe(1);
    expect(parsed.patches).toEqual([
      expect.objectContaining({ path: "move_date", value: "2026-07-23" }),
      expect.objectContaining({ path: "origin_access.floor", value: 3 }),
      expect.objectContaining({ path: "origin_access.elevator", value: "none" }),
    ]);
  });

  it("accepts the dashboard-friendly single-field shape", () => {
    const parsed = validateAndNormalizePatches(
      parseIntakePatchBody({
        action: "save_intake_patch",
        path: "destination_access.parking",
        value: "loading area",
        customer_confirmed: true,
      }),
    );
    expect(parsed.patches).toEqual([
      expect.objectContaining({ path: "destination_access.parking", value: "loading_dock" }),
    ]);
  });

  it("accepts patch_json as a JSON string", () => {
    const parsed = validateAndNormalizePatches(
      parseIntakePatchBody({
        patch_json: JSON.stringify([
          { op: "set", path: "services.disassembly", value: true, confirmed: true },
        ]),
      }),
    );
    expect(parsed.patches[0]).toEqual(
      expect.objectContaining({ path: "disassembly_required", value: true }),
    );
  });

  it("accepts patch as an object or JSON string", () => {
    const objectForm = validateAndNormalizePatches(
      parseIntakePatchBody({
        patch: { path: "storage.duration_days", value: "1", confirmed: true },
      }),
    );
    const stringForm = validateAndNormalizePatches(
      parseIntakePatchBody({
        patch: JSON.stringify({
          path: "storage.climate_controlled",
          value: "yes",
          confirmed: true,
        }),
      }),
    );
    expect(objectForm.patches[0].value).toBe(1);
    expect(stringForm.patches[0].value).toBe(true);
  });

  it("normalizes complete inventory and fragile arrays and supplies IDs", () => {
    const parsed = validateAndNormalizePatches(
      parseIntakePatchBody({
        patches: [
          {
            path: "inventory",
            value: JSON.stringify([
              { label: "Queen bed and mattress", quantity: 1, notes: "" },
              { label: "Medium boxes", quantity: 25 },
            ]),
            customer_confirmed: true,
          },
          {
            path: "fragile_items",
            value: [
              { label: "65-inch television", category: "electronics", quantity: 1 },
              { label: "Fragile kitchen boxes", category: "other", quantity: 5 },
            ],
            customer_confirmed: true,
          },
        ],
      }),
    );

    const inventory = parsed.patches[0].value as Array<Record<string, unknown>>;
    const fragile = parsed.patches[1].value as Array<Record<string, unknown>>;
    expect(inventory).toHaveLength(2);
    expect(inventory.every((item) => typeof item.id === "string" && item.id)).toBe(true);
    expect(fragile.every((item) => typeof item.id === "string" && item.id)).toBe(true);
  });

  it("writes array values into a valid draft atomically", () => {
    const inventory = normalizeIntakeValue("inventory", [{ label: "Sofa", quantity: 1 }]);
    const draft = validateDraftAfterPatches({}, [{ path: "inventory", value: inventory }]);
    expect(draft.inventory?.[0]?.label).toBe("Sofa");
  });

  it("requires an explicit customer confirmation flag", () => {
    expect(() => parseIntakePatchBody({ path: "move_date", value: "2026-07-23" })).toThrow();
  });

  it("rejects unconfirmed, unknown, and invalid writes", () => {
    expect(() =>
      validateAndNormalizePatches(
        parseIntakePatchBody({ path: "move_date", value: "2026-07-23", customer_confirmed: false }),
      ),
    ).toThrow("Invalid intake patch");

    expect(() =>
      validateAndNormalizePatches(
        parseIntakePatchBody({
          path: "origin_property_type",
          value: "house",
          customer_confirmed: true,
        }),
      ),
    ).toThrow("Invalid intake patch");

    expect(() =>
      validateAndNormalizePatches(
        parseIntakePatchBody({
          path: "inventory",
          value: [{ label: "Sofa", quantity: 0 }],
          customer_confirmed: true,
        }),
      ),
    ).toThrow("Invalid intake patch");
  });

  it("rejects empty bodies", () => {
    expect(() => parseIntakePatchBody({})).toThrow();
  });
});
