/**
 * Canonical voice-intake write paths.
 *
 * Every accepted path maps to a real JobSpecDraft field. Legacy dashboard
 * names are normalized before authorization and validation. Keeping this list
 * aligned with JobSpecDraftSchema prevents the agent from asking for or saving
 * fields that disappear at Confirm & Lock time.
 */

export type ProvenanceSource = "manual" | "document" | "voice";

export interface FieldProvenance {
  source: ProvenanceSource;
  updated_at: string;
  origin_ref?: string;
}

export const INTAKE_ALLOWED_PATHS: readonly string[] = [
  // Addresses and schedule
  "origin.line1",
  "origin.line2",
  "origin.city",
  "origin.region",
  "origin.postal_code",
  "origin.country",
  "destination.line1",
  "destination.line2",
  "destination.city",
  "destination.region",
  "destination.postal_code",
  "destination.country",
  "move_date",
  "preferred_time_window",
  "bedroom_count",
  "additional_stops",

  // Inventory groups are written atomically as validated arrays.
  "inventory",
  "fragile_items",
  "specialty_items",

  // Access
  "origin_access.floor",
  "origin_access.stairs_flights",
  "origin_access.elevator",
  "origin_access.elevator_reservation_required",
  "origin_access.long_carry_meters",
  "origin_access.parking",
  "origin_access.parking_permit_required",
  "origin_access.parking_notes",
  "origin_access.access_restrictions",
  "destination_access.floor",
  "destination_access.stairs_flights",
  "destination_access.elevator",
  "destination_access.elevator_reservation_required",
  "destination_access.long_carry_meters",
  "destination_access.parking",
  "destination_access.parking_permit_required",
  "destination_access.parking_notes",
  "destination_access.access_restrictions",

  // Services
  "packing_level",
  "unpacking_requested",
  "disassembly_required",
  "reassembly_required",
  "storage.needed",
  "storage.duration_days",
  "storage.climate_controlled",
  "insurance_level",

  // Priorities and authority
  "customer_priorities",
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
  "agent_guidance",
  "special_instructions",
] as const;

const ALLOWED_SET = new Set(INTAKE_ALLOWED_PATHS);

/** Legacy ElevenLabs parameter names that have existed in earlier prompts. */
export const INTAKE_PATH_ALIASES: Readonly<Record<string, string>> = {
  moving_date: "move_date",
  time_window: "preferred_time_window",
  bedrooms: "bedroom_count",
  "protection.insurance_level": "insurance_level",
  "services.packing_level": "packing_level",
  "services.unpacking": "unpacking_requested",
  "services.disassembly": "disassembly_required",
  "services.reassembly": "reassembly_required",
  "services.storage_required": "storage.needed",
  "services.storage_duration_days": "storage.duration_days",
  "services.climate_controlled": "storage.climate_controlled",
  "services.insurance_level": "insurance_level",
  notes: "special_instructions",
};

export function normalizeIntakePath(path: string): string {
  return INTAKE_PATH_ALIASES[path] ?? path;
}

const DANGEROUS_SEGMENTS = new Set(["__proto__", "constructor", "prototype"]);

export function isAllowedPath(path: string): boolean {
  if (typeof path !== "string" || !path) return false;
  const normalized = normalizeIntakePath(path);
  const segments = normalized.split(".");
  for (const segment of segments) {
    if (!segment || DANGEROUS_SEGMENTS.has(segment)) return false;
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(segment)) return false;
  }
  return ALLOWED_SET.has(normalized);
}

export function setAtPath<T extends Record<string, unknown>>(
  root: T,
  path: string,
  value: unknown,
): T {
  const segments = path.split(".");
  const next: Record<string, unknown> = { ...root };
  let cursor: Record<string, unknown> = next;
  for (let index = 0; index < segments.length - 1; index++) {
    const segment = segments[index]!;
    if (DANGEROUS_SEGMENTS.has(segment)) throw new Error("forbidden_segment");
    const existing = cursor[segment];
    const clone =
      existing && typeof existing === "object" && !Array.isArray(existing)
        ? { ...(existing as Record<string, unknown>) }
        : {};
    cursor[segment] = clone;
    cursor = clone;
  }
  const last = segments[segments.length - 1]!;
  if (DANGEROUS_SEGMENTS.has(last)) throw new Error("forbidden_segment");
  cursor[last] = value;
  return next as T;
}

export function getAtPath(root: unknown, path: string): unknown {
  const segments = path.split(".");
  let cursor: unknown = root;
  for (const segment of segments) {
    if (cursor == null || typeof cursor !== "object") return undefined;
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  return cursor;
}

/** Return provenance paths for every scalar leaf under a merged top-level value. */
export function flattenLeafPaths(value: unknown, prefix: string): string[] {
  if (Array.isArray(value)) return [prefix];
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return [prefix];
    return entries.flatMap(([key, child]) => flattenLeafPaths(child, `${prefix}.${key}`));
  }
  return [prefix];
}
