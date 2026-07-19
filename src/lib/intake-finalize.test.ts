import { describe, expect, it } from "vitest";

import { mergeIntakeFieldLists, parseFinalizeIntakeBody } from "./intake-finalize";

describe("finalize-intake-session production contract", () => {
  it("accepts the minimal dashboard payload", () => {
    expect(parseFinalizeIntakeBody({ action: "finalize_intake_session" })).toEqual(
      expect.objectContaining({ action: "finalize_intake_session" }),
    );
  });

  it("parses string booleans without treating 'false' as true", () => {
    expect(parseFinalizeIntakeBody({ completed_with_errors: "false" }).completed_with_errors).toBe(
      false,
    );
    expect(parseFinalizeIntakeBody({ completed_with_errors: "true" }).completed_with_errors).toBe(
      true,
    );
  });

  it("does not require a conversation id or field arrays", () => {
    const parsed = parseFinalizeIntakeBody({ summary: "Review and lock the draft." });
    expect(parsed.conversation_id).toBeUndefined();
    expect(parsed.captured_fields).toBeUndefined();
    expect(parsed.unresolved_fields).toBeUndefined();
  });

  it("accepts arrays and transcript as JSON strings", () => {
    const parsed = parseFinalizeIntakeBody({
      captured_fields: '["move_date","inventory"]',
      unresolved_fields: '["origin_access.parking"]',
      transcript: '[{"role":"agent","text":"Hello"}]',
    });
    expect(parsed.captured_fields).toEqual(["move_date", "inventory"]);
    expect(parsed.unresolved_fields).toEqual(["origin_access.parking"]);
    expect(parsed.transcript).toEqual([{ role: "agent", text: "Hello" }]);
  });

  it("merges without erasing previously captured fields", () => {
    expect(mergeIntakeFieldLists(["move_date", "inventory"], undefined)).toEqual([
      "move_date",
      "inventory",
    ]);
    expect(mergeIntakeFieldLists(["move_date"], ["move_date", "packing_level"])).toEqual([
      "move_date",
      "packing_level",
    ]);
  });
});
