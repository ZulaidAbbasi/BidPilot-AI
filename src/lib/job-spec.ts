import { z } from "zod";

/**
 * BidPilot AI — moving JobSpec draft schema.
 *
 * Strict, shared source of truth for the specification editor. Providers will
 * eventually quote against a CONFIRMED version of this document; keep every
 * field defined here (never optional in a way that hides missing data). The
 * `_draft` variant loosens required fields so we can autosave in-progress
 * work — completeness is measured separately by `computeCompletion`.
 */

// ---- Enums ----------------------------------------------------------------

export const ELEVATOR_KINDS = ["none", "passenger", "service"] as const;
export const PARKING_KINDS = ["driveway", "street", "loading_dock", "unknown"] as const;
export const PACKING_LEVELS = ["none", "fragile_only", "partial", "full"] as const;
export const INSURANCE_LEVELS = ["basic", "standard", "full_value"] as const;
export const TIME_WINDOWS = ["morning", "afternoon", "evening", "flexible"] as const;
export const FRAGILE_CATEGORIES = [
  "artwork",
  "electronics",
  "glass",
  "china",
  "mirror",
  "instrument",
  "other",
] as const;
export const SPECIALTY_CATEGORIES = [
  "piano",
  "safe",
  "gun_safe",
  "pool_table",
  "hot_tub",
  "gym_equipment",
  "aquarium",
  "chandelier",
  "antique",
  "other",
] as const;

export const CUSTOMER_PRIORITIES = [
  "lowest_all_in_price",
  "estimate_certainty",
  "scope_completeness",
  "lower_deposit_risk",
  "better_cancellation",
  "evidence_quality",
] as const;
export type CustomerPriority = (typeof CUSTOMER_PRIORITIES)[number];

export const CUSTOMER_PRIORITY_LABELS: Record<CustomerPriority, string> = {
  lowest_all_in_price: "Lowest all-in price",
  estimate_certainty: "Estimate certainty",
  scope_completeness: "Scope completeness",
  lower_deposit_risk: "Lower deposit risk",
  better_cancellation: "Better cancellation",
  evidence_quality: "Evidence quality",
};

export const ADDITIONAL_STOP_PURPOSES = [
  "pickup",
  "dropoff",
  "storage",
  "other",
] as const;

// ---- Sub-schemas ----------------------------------------------------------

export const AddressSchema = z.object({
  line1: z.string().trim().min(3, "Enter a street address").max(255),
  line2: z.string().trim().max(120).optional().or(z.literal("")),
  city: z.string().trim().min(1, "City is required").max(120),
  region: z.string().trim().max(120).optional().or(z.literal("")),
  postal_code: z.string().trim().min(2, "Postal code is required").max(20),
  country: z.string().trim().min(2).max(80).default("US"),
});
export type Address = z.infer<typeof AddressSchema>;

export const AccessSchema = z.object({
  floor: z.coerce.number().int().min(-5).max(200),
  stairs_flights: z.coerce.number().int().min(0).max(50),
  elevator: z.enum(ELEVATOR_KINDS),
  elevator_reservation_required: z.boolean(),
  long_carry_meters: z.coerce.number().int().min(0).max(1000),
  parking: z.enum(PARKING_KINDS),
  parking_permit_required: z.boolean(),
  parking_notes: z.string().trim().max(500).optional().or(z.literal("")),
  access_restrictions: z.string().trim().max(1000).optional().or(z.literal("")),
});
export type Access = z.infer<typeof AccessSchema>;

export const InventoryItemSchema = z.object({
  id: z.string().min(1),
  label: z.string().trim().min(1, "Name this item").max(120),
  quantity: z.coerce.number().int().min(1).max(999),
  notes: z.string().trim().max(300).optional().or(z.literal("")),
});
export type InventoryItem = z.infer<typeof InventoryItemSchema>;

export const FragileItemSchema = z.object({
  id: z.string().min(1),
  label: z.string().trim().min(1, "Name this item").max(120),
  category: z.enum(FRAGILE_CATEGORIES),
  quantity: z.coerce.number().int().min(1).max(999),
  approx_value_usd: z.coerce.number().min(0).max(1_000_000).optional(),
  notes: z.string().trim().max(300).optional().or(z.literal("")),
});
export type FragileItem = z.infer<typeof FragileItemSchema>;

export const SpecialtyItemSchema = z.object({
  id: z.string().min(1),
  label: z.string().trim().min(1, "Name this item").max(120),
  category: z.enum(SPECIALTY_CATEGORIES),
  weight_lbs: z.coerce.number().min(0).max(10_000).optional(),
  dimensions: z.string().trim().max(120).optional().or(z.literal("")),
  requires_disassembly: z.boolean(),
  notes: z.string().trim().max(300).optional().or(z.literal("")),
});
export type SpecialtyItem = z.infer<typeof SpecialtyItemSchema>;

export const StorageSchema = z.object({
  needed: z.boolean(),
  duration_days: z.coerce.number().int().min(0).max(365).optional(),
  climate_controlled: z.boolean().optional(),
});
export type Storage = z.infer<typeof StorageSchema>;

// ---- Root spec (strict, for confirmation later) ---------------------------

export const AdditionalStopSchema = z.object({
  id: z.string().min(1),
  label: z.string().trim().min(1, "Give this stop a short label").max(80),
  address: z.string().trim().min(3, "Enter an address").max(255),
  stop_order: z.coerce.number().int().min(0).max(50),
  purpose: z.enum(ADDITIONAL_STOP_PURPOSES),
  notes: z.string().trim().max(300).optional().or(z.literal("")),
});
export type AdditionalStop = z.infer<typeof AdditionalStopSchema>;

export const ADDITIONAL_STOP_PURPOSE_LABELS: Record<
  (typeof ADDITIONAL_STOP_PURPOSES)[number],
  string
> = {
  pickup: "Pickup",
  dropoff: "Drop-off",
  storage: "Storage stop",
  other: "Other",
};


/**
 * What BidPilot's agent is authorized to do on the customer's behalf,
 * and what it must never do. Persisted as part of the confirmed spec so
 * load-call-context can hand this authority to the ElevenLabs agent.
 */
export const AgentPermissionsSchema = z.object({
  // Allowed actions
  may_request_quote: z.boolean(),
  may_request_itemization: z.boolean(),
  may_negotiate_price: z.boolean(),
  may_request_fee_waivers: z.boolean(),
  may_request_improved_terms: z.boolean(),
  may_use_verified_leverage: z.boolean(),
  may_request_written_estimates: z.boolean(),
  // Hard-forbidden actions
  may_accept_offer: z.boolean(),
  may_pay_deposit: z.boolean(),
  may_change_inventory: z.boolean(),
  may_add_paid_services: z.boolean(),
  may_reveal_max_budget: z.boolean(),
  may_sign_or_authorize: z.boolean(),
});
export type AgentPermissions = z.infer<typeof AgentPermissionsSchema>;

export function defaultAgentPermissions(): AgentPermissions {
  return {
    may_request_quote: true,
    may_request_itemization: true,
    may_negotiate_price: true,
    may_request_fee_waivers: true,
    may_request_improved_terms: true,
    may_use_verified_leverage: true,
    may_request_written_estimates: true,
    may_accept_offer: false,
    may_pay_deposit: false,
    may_change_inventory: false,
    may_add_paid_services: false,
    may_reveal_max_budget: false,
    may_sign_or_authorize: false,
  };
}

// ---- Root spec (strict, for confirmation later) ---------------------------

/**
 * The strict schema. A draft that passes this schema is complete enough to be
 * confirmed as a JobSpec version. Confirmation/hashing happens in a later
 * step — this file only defines shape.
 */
export const JobSpecSchema = z.object({
  origin: AddressSchema,
  destination: AddressSchema,
  additional_stops: z.array(AdditionalStopSchema).default([]),
  move_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a valid date"),
  preferred_time_window: z.enum(TIME_WINDOWS),

  bedroom_count: z.coerce.number().int().min(0).max(20),
  inventory: z.array(InventoryItemSchema),
  fragile_items: z.array(FragileItemSchema),
  specialty_items: z.array(SpecialtyItemSchema),

  origin_access: AccessSchema,
  destination_access: AccessSchema,

  packing_level: z.enum(PACKING_LEVELS),
  unpacking_requested: z.boolean(),
  disassembly_required: z.boolean(),
  reassembly_required: z.boolean(),

  storage: StorageSchema,

  insurance_level: z.enum(INSURANCE_LEVELS),

  // Structured priorities + explicit authority. Free-form guidance stays
  // separate from ambiguous prose in `special_instructions`.
  customer_priorities: z.array(z.enum(CUSTOMER_PRIORITIES)).max(6).default([]),
  agent_permissions: AgentPermissionsSchema,
  agent_guidance: z.string().trim().max(2000).optional().or(z.literal("")),

  special_instructions: z.string().trim().max(2000).optional().or(z.literal("")),
});
export type JobSpec = z.infer<typeof JobSpecSchema>;

// ---- Draft (loose, safe for autosave) -------------------------------------

/**
 * `JobSpecDraftSchema` is what the editor form uses. Every leaf is optional,
 * but the field TYPES are still enforced — so autosaves never crash on a
 * half-filled form, but bogus values (e.g. a string in `bedroom_count`) are
 * rejected before they ever hit the DB.
 */
const OptionalAddress = AddressSchema.partial();
const OptionalAccess = AccessSchema.partial();
const OptionalStorage = StorageSchema.partial();

export const JobSpecDraftSchema = z.object({
  origin: OptionalAddress.optional(),
  destination: OptionalAddress.optional(),
  additional_stops: z.array(AdditionalStopSchema).optional(),
  move_date: z.string().optional().or(z.literal("")),
  preferred_time_window: z.enum(TIME_WINDOWS).optional(),

  bedroom_count: z.coerce.number().int().min(0).max(20).optional(),
  inventory: z.array(InventoryItemSchema).optional(),
  fragile_items: z.array(FragileItemSchema).optional(),
  specialty_items: z.array(SpecialtyItemSchema).optional(),

  origin_access: OptionalAccess.optional(),
  destination_access: OptionalAccess.optional(),

  packing_level: z.enum(PACKING_LEVELS).optional(),
  unpacking_requested: z.boolean().optional(),
  disassembly_required: z.boolean().optional(),
  reassembly_required: z.boolean().optional(),

  storage: OptionalStorage.optional(),

  insurance_level: z.enum(INSURANCE_LEVELS).optional(),

  customer_priorities: z.array(z.enum(CUSTOMER_PRIORITIES)).max(6).optional(),
  agent_permissions: AgentPermissionsSchema.partial().optional(),
  agent_guidance: z.string().max(2000).optional().or(z.literal("")),

  special_instructions: z.string().max(2000).optional().or(z.literal("")),
});
export type JobSpecDraft = z.infer<typeof JobSpecDraftSchema>;

// ---- Defaults & helpers ---------------------------------------------------

export function emptyDraft(): JobSpecDraft {
  // Required booleans in the canonical schema default to `false` when the
  // user has not explicitly interacted with them. Never omit them: an
  // unchecked box must serialize as `false`, not `undefined`.
  return {
    inventory: [],
    fragile_items: [],
    specialty_items: [],
    additional_stops: [],
    unpacking_requested: false,
    disassembly_required: false,
    reassembly_required: false,
    storage: { needed: false, climate_controlled: false },
    customer_priorities: [],
    agent_permissions: defaultAgentPermissions(),
  };
}

/**
 * Coerces a partially-filled draft into something safe to persist:
 *  - strips `NaN` numeric leaves (blank number input) — never persist NaN.
 *  - guarantees required booleans have an explicit `false` fallback.
 * The output still satisfies `JobSpecDraftSchema` (all leaves optional).
 */
export function sanitizeDraft(input: JobSpecDraft): JobSpecDraft {
  const clone = JSON.parse(
    JSON.stringify(input, (_key, value) =>
      typeof value === "number" && Number.isNaN(value) ? undefined : value,
    ),
  ) as JobSpecDraft;
  clone.unpacking_requested = clone.unpacking_requested ?? false;
  clone.disassembly_required = clone.disassembly_required ?? false;
  clone.reassembly_required = clone.reassembly_required ?? false;
  clone.storage = {
    needed: clone.storage?.needed ?? false,
    duration_days: clone.storage?.duration_days,
    climate_controlled: clone.storage?.climate_controlled ?? false,
  };
  // Access booleans: only default when the block has been touched.
  for (const key of ["origin_access", "destination_access"] as const) {
    const a = clone[key];
    if (a && Object.keys(a).length > 0) {
      a.elevator_reservation_required = a.elevator_reservation_required ?? false;
      a.parking_permit_required = a.parking_permit_required ?? false;
    }
  }
  // Merge agent_permissions with safe defaults so confirmation always has
  // a fully-populated authority block.
  clone.agent_permissions = { ...defaultAgentPermissions(), ...(clone.agent_permissions ?? {}) };
  clone.customer_priorities = clone.customer_priorities ?? [];
  clone.additional_stops = clone.additional_stops ?? [];
  return clone;
}

function isFilledAddress(a: Partial<Address> | undefined): boolean {
  return !!(a && a.line1 && a.city && a.postal_code && a.country);
}

function isFilledAccess(a: Partial<Access> | undefined): boolean {
  return !!(
    a &&
    a.floor !== undefined &&
    a.stairs_flights !== undefined &&
    a.elevator &&
    a.elevator_reservation_required !== undefined &&
    a.long_carry_meters !== undefined &&
    a.parking &&
    a.parking_permit_required !== undefined
  );
}

/**
 * Completion percentage across the 15 top-level requirement groups. Not a
 * confidence score — it is a simple "how many required buckets are filled"
 * signal for the editor. Never exceeds 100.
 */
export function computeCompletion(draft: JobSpecDraft): number {
  const checks: boolean[] = [
    isFilledAddress(draft.origin),
    isFilledAddress(draft.destination),
    !!draft.move_date && /^\d{4}-\d{2}-\d{2}$/.test(draft.move_date),
    !!draft.preferred_time_window,
    typeof draft.bedroom_count === "number",
    (draft.inventory?.length ?? 0) > 0,
    // fragile and specialty are opt-in — presence of array (even empty) counts
    // once user has visited that section; treat "any decision made" as filled
    // by requiring an explicit non-undefined value elsewhere. Here: reward
    // when either has entries OR user has set packing_level (signals visit).
    draft.fragile_items !== undefined,
    draft.specialty_items !== undefined,
    isFilledAccess(draft.origin_access),
    isFilledAccess(draft.destination_access),
    !!draft.packing_level,
    draft.unpacking_requested !== undefined &&
      draft.disassembly_required !== undefined &&
      draft.reassembly_required !== undefined,
    draft.storage?.needed !== undefined,
    !!draft.insurance_level,
    draft.special_instructions !== undefined,
  ];
  const filled = checks.filter(Boolean).length;
  return Math.round((filled / checks.length) * 100);
}

export function newItemId(): string {
  // Non-crypto random ID is fine for local row identity in field arrays.
  return `it_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
}
