import { z } from "zod";

import {
  ADDITIONAL_STOP_PURPOSES,
  CUSTOMER_PRIORITIES,
  ELEVATOR_KINDS,
  FRAGILE_CATEGORIES,
  INSURANCE_LEVELS,
  InventoryItemSchema,
  FragileItemSchema,
  SpecialtyItemSchema,
  AdditionalStopSchema,
  PACKING_LEVELS,
  PARKING_KINDS,
  SPECIALTY_CATEGORIES,
  TIME_WINDOWS,
  JobSpecDraftSchema,
  newItemId,
  type JobSpecDraft,
} from "@/lib/job-spec";
import { isAllowedPath, normalizeIntakePath, setAtPath } from "@/lib/intake-schema";

export const ConflictDecision = z.enum(["accept_manual", "accept_document", "accept_voice"]);

export type ConflictDecisionValue = z.infer<typeof ConflictDecision>;

const PatchEntry = z.object({
  path: z.string().min(1).max(160),
  value: z.unknown(),
  customer_confirmed: z.boolean(),
  conflict_decision: ConflictDecision.optional(),
});

const LegacyPatchEntry = z.object({
  op: z.literal("set").optional(),
  path: z.string().min(1).max(160),
  value: z.unknown(),
  source: z.string().optional(),
  confirmed: z.boolean().optional(),
  customer_confirmed: z.boolean().optional(),
  conflict_decision: ConflictDecision.optional(),
});

function parseJsonish(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed) return value;
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return value;
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

function parsePatchJson(value: unknown): unknown {
  const parsed = parseJsonish(value);
  if (Array.isArray(parsed)) return parsed;
  if (parsed && typeof parsed === "object") return [parsed];
  return parsed;
}

const BaseFields = {
  action: z.string().optional(),
  intake_session_id: z.string().uuid().optional(),
  negotiation_id: z.string().uuid().optional(),
  expected_revision: z.coerce.number().int().nonnegative().optional(),
  expected_draft_revision: z.coerce.number().int().nonnegative().optional(),
  idempotency_key: z.string().min(1).max(240).optional(),
};

const BodySchema = z.union([
  z
    .object({
      ...BaseFields,
      patches: z.preprocess(parseJsonish, z.array(PatchEntry).min(1).max(30)),
    })
    .passthrough()
    .transform((v) => ({
      action: v.action,
      intake_session_id: v.intake_session_id,
      negotiation_id: v.negotiation_id,
      expected_revision: v.expected_revision ?? v.expected_draft_revision,
      idempotency_key: v.idempotency_key,
      patches: v.patches,
    })),
  z
    .object({
      ...BaseFields,
      path: z.string().min(1).max(160),
      value: z.unknown(),
      customer_confirmed: z.boolean(),
      conflict_decision: ConflictDecision.optional(),
    })
    .passthrough()
    .transform((v) => ({
      action: v.action,
      intake_session_id: v.intake_session_id,
      negotiation_id: v.negotiation_id,
      expected_revision: v.expected_revision ?? v.expected_draft_revision,
      idempotency_key: v.idempotency_key,
      patches: [
        {
          path: v.path,
          value: v.value,
          customer_confirmed: v.customer_confirmed,
          conflict_decision: v.conflict_decision,
        },
      ],
    })),
  z
    .object({
      ...BaseFields,
      customer_confirmed: z.boolean().optional().default(true),
      patch_json: z.preprocess(parsePatchJson, z.array(LegacyPatchEntry).min(1).max(30)),
    })
    .passthrough()
    .transform((v) => ({
      action: v.action,
      intake_session_id: v.intake_session_id,
      negotiation_id: v.negotiation_id,
      expected_revision: v.expected_revision ?? v.expected_draft_revision,
      idempotency_key: v.idempotency_key,
      patches: v.patch_json.map((p) => ({
        path: p.path,
        value: p.value,
        customer_confirmed: p.customer_confirmed ?? p.confirmed ?? v.customer_confirmed ?? false,
        conflict_decision: p.conflict_decision,
      })),
    })),
  // Dashboard-friendly shape: one JSON-string property named `patch`.
  z
    .object({
      ...BaseFields,
      patch: z.preprocess(parsePatchJson, z.array(LegacyPatchEntry).min(1).max(30)),
    })
    .passthrough()
    .transform((v) => ({
      action: v.action,
      intake_session_id: v.intake_session_id,
      negotiation_id: v.negotiation_id,
      expected_revision: v.expected_revision ?? v.expected_draft_revision,
      idempotency_key: v.idempotency_key,
      patches: v.patch.map((p) => ({
        path: p.path,
        value: p.value,
        customer_confirmed: p.customer_confirmed ?? p.confirmed ?? false,
        conflict_decision: p.conflict_decision,
      })),
    })),
]);

export type ParsedIntakePatchBody = z.infer<typeof BodySchema>;

export function parseIntakePatchBody(input: unknown): ParsedIntakePatchBody {
  const parsed = BodySchema.parse(input);
  return {
    ...parsed,
    patches: parsed.patches.map((p) => ({
      ...p,
      path: normalizeIntakePath(p.path.trim()),
    })),
  };
}

function asBoolean(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const v = value.trim().toLowerCase();
    if (["true", "yes", "y", "1", "required", "needed"].includes(v)) return true;
    if (["false", "no", "n", "0", "not required", "not needed"].includes(v)) return false;
  }
  throw new Error("Expected a boolean value");
}

function asInteger(value: unknown, min: number, max: number): number {
  const n = typeof value === "number" ? value : Number(String(value).trim());
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new Error(`Expected an integer from ${min} to ${max}`);
  }
  return n;
}

function asString(value: unknown, max = 2000): string {
  if (value === null || value === undefined) return "";
  const s = String(value).trim();
  if (s.length > max) throw new Error(`Value exceeds ${max} characters`);
  return s;
}

function normalizeEnum<T extends readonly string[]>(
  value: unknown,
  allowed: T,
  aliases: Record<string, T[number]> = {},
): T[number] {
  const raw = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  const mapped = aliases[raw] ?? raw;
  if (!(allowed as readonly string[]).includes(mapped)) {
    throw new Error(`Expected one of: ${allowed.join(", ")}`);
  }
  return mapped as T[number];
}

function normalizeDate(value: unknown): string {
  const raw = String(value ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const d = new Date(`${raw}T00:00:00Z`);
    if (!Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === raw) return raw;
  }

  const cleaned = raw
    .replace(/(\d)(st|nd|rd|th)\b/gi, "$1")
    .replace(/,/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const d = new Date(cleaned);
  if (Number.isNaN(d.getTime())) throw new Error("Expected a valid date such as 2026-08-15");
  return d.toISOString().slice(0, 10);
}

function ensureArray(value: unknown): unknown[] {
  const parsed = parseJsonish(value);
  if (!Array.isArray(parsed)) throw new Error("Expected a JSON array");
  return parsed;
}

function withIds(value: unknown): unknown[] {
  return ensureArray(value).map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return item;
    const row = item as Record<string, unknown>;
    return { ...row, id: typeof row.id === "string" && row.id ? row.id : newItemId() };
  });
}

const PERMISSION_PATHS = new Set([
  "agent_permissions.may_request_quote",
  "agent_permissions.may_request_itemization",
  "agent_permissions.may_negotiate_price",
  "agent_permissions.may_request_fee_waivers",
  "agent_permissions.may_request_improved_terms",
  "agent_permissions.may_use_verified_leverage",
  "agent_permissions.may_request_written_estimates",
  "agent_permissions.may_accept_offer",
  "agent_permissions.may_pay_deposit",
  "agent_permissions.may_change_inventory",
  "agent_permissions.may_add_paid_services",
  "agent_permissions.may_reveal_max_budget",
  "agent_permissions.may_sign_or_authorize",
]);

export function normalizeIntakeValue(path: string, input: unknown): unknown {
  const value = parseJsonish(input);

  if (path === "move_date") return normalizeDate(value);
  if (path === "preferred_time_window") {
    return normalizeEnum(value, TIME_WINDOWS, {
      am: "morning",
      pm: "afternoon",
      "8_00_am_to_12_00_pm": "morning",
      "8am_to_12pm": "morning",
    });
  }
  if (path === "bedroom_count") return asInteger(value, 0, 20);

  if (path.endsWith(".floor")) return asInteger(value, -5, 200);
  if (path.endsWith(".stairs_flights")) return asInteger(value, 0, 50);
  if (path.endsWith(".long_carry_meters")) return asInteger(value, 0, 1000);
  if (path.endsWith(".elevator_reservation_required")) return asBoolean(value);
  if (path.endsWith(".parking_permit_required")) return asBoolean(value);
  if (path.endsWith(".elevator")) {
    return normalizeEnum(value, ELEVATOR_KINDS, {
      no: "none",
      no_elevator: "none",
      none_available: "none",
      passenger_elevator: "passenger",
      elevator: "passenger",
      service_elevator: "service",
    });
  }
  if (path.endsWith(".parking")) {
    return normalizeEnum(value, PARKING_KINDS, {
      street_parking: "street",
      driveway_parking: "driveway",
      loading_area: "loading_dock",
      loading_zone: "loading_dock",
      loading_dock_available: "loading_dock",
    });
  }

  if (
    path === "unpacking_requested" ||
    path === "disassembly_required" ||
    path === "reassembly_required" ||
    path === "storage.needed" ||
    path === "storage.climate_controlled" ||
    PERMISSION_PATHS.has(path)
  ) {
    return asBoolean(value);
  }
  if (path === "storage.duration_days") return asInteger(value, 0, 365);
  if (path === "packing_level") return normalizeEnum(value, PACKING_LEVELS);
  if (path === "insurance_level") {
    return normalizeEnum(value, INSURANCE_LEVELS, {
      full_value_protection: "full_value",
      full_value_insurance: "full_value",
      full: "full_value",
    });
  }

  if (path === "inventory") return z.array(InventoryItemSchema).parse(withIds(value));
  if (path === "fragile_items") return z.array(FragileItemSchema).parse(withIds(value));
  if (path === "specialty_items") return z.array(SpecialtyItemSchema).parse(withIds(value));
  if (path === "additional_stops") return z.array(AdditionalStopSchema).parse(withIds(value));

  if (path === "customer_priorities") {
    const raw = ensureArray(value).map((v) =>
      String(v)
        .trim()
        .toLowerCase()
        .replace(/[\s-]+/g, "_"),
    );
    return z.array(z.enum(CUSTOMER_PRIORITIES)).max(6).parse(raw);
  }

  if (path.endsWith(".country")) {
    const s = asString(value, 80);
    if (s.toLowerCase() === "united_states" || s.toLowerCase() === "united states") return "US";
    return s;
  }

  if (
    path.endsWith(".line1") ||
    path.endsWith(".line2") ||
    path.endsWith(".city") ||
    path.endsWith(".region") ||
    path.endsWith(".postal_code") ||
    path.endsWith(".parking_notes") ||
    path.endsWith(".access_restrictions") ||
    path === "agent_guidance" ||
    path === "special_instructions"
  ) {
    return asString(
      value,
      path.includes("instructions") || path === "agent_guidance" ? 2000 : 1000,
    );
  }

  return value;
}

export function validateAndNormalizePatches(body: ParsedIntakePatchBody): ParsedIntakePatchBody {
  const rejected: { path: string; reason: string }[] = [];
  const patches = body.patches.map((patch) => {
    if (!patch.customer_confirmed) {
      rejected.push({ path: patch.path, reason: "customer_not_confirmed" });
      return patch;
    }
    if (!isAllowedPath(patch.path)) {
      rejected.push({ path: patch.path, reason: "unknown_path" });
      return patch;
    }
    try {
      return { ...patch, value: normalizeIntakeValue(patch.path, patch.value) };
    } catch (error) {
      rejected.push({
        path: patch.path,
        reason: error instanceof Error ? error.message : "invalid_value",
      });
      return patch;
    }
  });
  if (rejected.length) {
    const error = new Error("Invalid intake patch") as Error & {
      code?: string;
      rejected?: { path: string; reason: string }[];
    };
    error.code = "invalid_patch";
    error.rejected = rejected;
    throw error;
  }
  return { ...body, patches };
}

export function validateDraftAfterPatches(
  draft: Record<string, unknown>,
  patches: { path: string; value: unknown }[],
): JobSpecDraft {
  let next = { ...draft };
  for (const patch of patches) next = setAtPath(next, patch.path, patch.value);
  const parsed = JobSpecDraftSchema.safeParse(next);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .slice(0, 8)
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("; ");
    throw new Error(`Draft validation failed: ${detail}`);
  }
  return parsed.data;
}

export const INTAKE_TOOL_ENUMS = {
  elevator: ELEVATOR_KINDS,
  parking: PARKING_KINDS,
  packing_level: PACKING_LEVELS,
  insurance_level: INSURANCE_LEVELS,
  time_window: TIME_WINDOWS,
  customer_priorities: CUSTOMER_PRIORITIES,
  fragile_categories: FRAGILE_CATEGORIES,
  specialty_categories: SPECIALTY_CATEGORIES,
  additional_stop_purposes: ADDITIONAL_STOP_PURPOSES,
};
