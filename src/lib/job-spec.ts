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
// Property type is optional and only present when the customer has told us.
// Providers rely on it for crew sizing (a townhouse with 3 flights of
// stairs quotes very differently from an elevator building) — but leaving
// it empty must never block confirmation.
export const PROPERTY_TYPES = [
  "apartment",
  "condo",
  "house",
  "townhouse",
  "storage_unit",
  "office",
  "other",
] as const;
// Distance is stored as an integer plus an explicit unit so the provider
// agent never has to guess US-vs-metric on carry estimates.
export const CARRY_UNITS = ["meters", "feet"] as const;
// Item provenance tracks WHERE a canonical field came from so Review can
// show "3 items came from voice, 2 from documents, 12 you entered" and
// so downstream ranking never confuses machine-extracted rows with
// operator-confirmed rows.
export const ITEM_PROVENANCES = ["manual", "voice", "document", "template"] as const;
export const INVENTORY_CATEGORIES = [
  "furniture",
  "electronics",
  "appliance",
  "kitchen",
  "clothing",
  "books",
  "outdoor",
  "tools",
  "misc",
] as const;

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

export const ADDITIONAL_STOP_PURPOSES = ["pickup", "dropoff", "storage", "other"] as const;

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
  // Optional descriptor of the building type — never a hard-required
  // field so the confirm step doesn't fight a customer who genuinely
  // doesn't know (e.g. loading a rental unit sight-unseen).
  property_type: z.enum(PROPERTY_TYPES).optional(),
  floor: z.coerce.number().int().min(-5).max(200),
  stairs_flights: z.coerce.number().int().min(0).max(50),
  elevator: z.enum(ELEVATOR_KINDS),
  elevator_reservation_required: z.boolean(),
  long_carry_meters: z.coerce.number().int().min(0).max(1000),
  // Explicit unit for the carry distance. Persisted alongside the
  // numeric value so imperial inputs are never silently re-labelled
  // as metric downstream. Value is stored in the field named
  // `long_carry_meters` for compatibility, but with an explicit unit
  // callers can convert or display faithfully.
  long_carry_unit: z.enum(CARRY_UNITS).default("meters"),
  parking: z.enum(PARKING_KINDS),
  parking_permit_required: z.boolean(),
  // Distinct from `parking === "loading_dock"` — a building may have a
  // dock the crew cannot reserve, or a driveway with dock-height access.
  loading_dock_available: z.boolean().optional(),
  parking_notes: z.string().trim().max(500).optional().or(z.literal("")),
  access_restrictions: z.string().trim().max(1000).optional().or(z.literal("")),
  // Free-form on-site notes distinct from restrictions (e.g. "elevator
  // padding stored with concierge", "narrow doorframe at unit").
  site_notes: z.string().trim().max(1000).optional().or(z.literal("")),
});
export type Access = z.infer<typeof AccessSchema>;

export const InventoryItemSchema = z.object({
  id: z.string().min(1),
  label: z.string().trim().min(1, "Name this item").max(120),
  // Optional so quick manual entries ("box #14") aren't blocked. When set
  // the ranker and evidence layer surface it to the provider agent.
  category: z.enum(INVENTORY_CATEGORIES).optional(),
  quantity: z.coerce.number().int().min(1).max(999),
  notes: z.string().trim().max(300).optional().or(z.literal("")),
  provenance: z.enum(ITEM_PROVENANCES).optional(),
});
export type InventoryItem = z.infer<typeof InventoryItemSchema>;

export const FragileItemSchema = z.object({
  id: z.string().min(1),
  label: z.string().trim().min(1, "Name this item").max(120),
  category: z.enum(FRAGILE_CATEGORIES),
  quantity: z.coerce.number().int().min(1).max(999),
  approx_value_usd: z.coerce.number().min(0).max(1_000_000).optional(),
  notes: z.string().trim().max(300).optional().or(z.literal("")),
  provenance: z.enum(ITEM_PROVENANCES).optional(),

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
  provenance: z.enum(ITEM_PROVENANCES).optional(),
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
  // Free-form single-line address kept as the required primary field so
  // stops written by voice/document/manual intake continue to parse. New
  // structured components below are optional and used for provider scope
  // presentation when available.
  address: z.string().trim().min(3, "Enter an address").max(255),
  street: z.string().trim().max(255).optional().or(z.literal("")),
  unit: z.string().trim().max(60).optional().or(z.literal("")),
  city: z.string().trim().max(120).optional().or(z.literal("")),
  region: z.string().trim().max(120).optional().or(z.literal("")),
  postal_code: z.string().trim().max(20).optional().or(z.literal("")),
  country: z.string().trim().max(80).optional().or(z.literal("")),
  stop_order: z.coerce.number().int().min(0).max(50),
  purpose: z.enum(ADDITIONAL_STOP_PURPOSES),
  // Free-form access instructions (gate codes, dock hours, key holder…).
  notes: z.string().trim().max(300).optional().or(z.literal("")),
  // Inventory or services touched at this stop (short tags such as
  // "sofa", "boxes", "piano", "packing" — parallel to the top-level
  // service booleans). Order preserved so the ranker sees stops the way
  // the customer entered them.
  services: z.array(z.string().trim().min(1).max(80)).max(40).optional(),
  // Optional per-stop time restriction ("after 2pm", "before 10am",
  // "Sat only"). Kept as free text so voice/document intake can pass
  // through provider constraints without a schema fight.
  time_restriction: z.string().trim().max(120).optional().or(z.literal("")),
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
  move_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a valid date"),
  preferred_time_window: z.enum(TIME_WINDOWS),

  bedroom_count: z.coerce.number().int().min(0).max(20),
  inventory: z.array(InventoryItemSchema),
  fragile_items: z.array(FragileItemSchema),
  specialty_items: z.array(SpecialtyItemSchema),

  origin_access: AccessSchema,
  destination_access: AccessSchema,

  packing_level: z.enum(PACKING_LEVELS),
  // Free-text list of items or notes the customer wants disclosed when
  // packing_level === "partial". Optional so full/none serialize
  // distinctly (an empty string here is not equivalent to omitting the
  // key from the canonical hash).
  partial_packing_notes: z.string().trim().max(1000).optional().or(z.literal("")),
  unpacking_requested: z.boolean(),
  disassembly_required: z.boolean(),
  reassembly_required: z.boolean(),

  storage: StorageSchema,

  insurance_level: z.enum(INSURANCE_LEVELS),

  // Structured priorities + explicit authority. Free-form guidance stays
  // separate from ambiguous prose in `special_instructions`.
  customer_priorities: z
    .array(z.enum(CUSTOMER_PRIORITIES))
    .min(1, "Select at least one priority before confirming")
    .max(6),
  agent_permissions: AgentPermissionsSchema,
  agent_guidance: z.string().trim().max(2000).optional().or(z.literal("")),

  special_instructions: z.string().trim().max(2000).optional().or(z.literal("")),
}).superRefine((val, ctx) => {
  // Services conditional validation: storage duration is only required
  // when storage is needed. When storage.needed is false, duration_days
  // and climate_controlled are ignored — false values still persist.
  if (val.storage.needed === true) {
    if (typeof val.storage.duration_days !== "number" || val.storage.duration_days <= 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["storage", "duration_days"],
        message: "Enter how many days of storage you need",
      });
    }
  }
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
  partial_packing_notes: z.string().max(1000).optional().or(z.literal("")),
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
    origin_access: {
      elevator_reservation_required: false,
      parking_permit_required: false,
      // Safe zero-defaults: absence of stairs / long carry unambiguously
      // means zero. Floor, bedroom count, and other unknown customer
      // facts are NOT defaulted — those must be entered explicitly.
      stairs_flights: 0,
      long_carry_meters: 0,
    },
    destination_access: {
      elevator_reservation_required: false,
      parking_permit_required: false,
      stairs_flights: 0,
      long_carry_meters: 0,
    },
    customer_priorities: [],
    agent_permissions: defaultAgentPermissions(),
  };
}

/**
 * Coerces a partially-filled draft into something safe to persist:
 *  - strips `NaN` numeric leaves (blank number input) — never persist NaN.
 *  - guarantees required booleans have an explicit `false` fallback so
 *    unchecked boxes are saved as `false` (never stripped) and pass strict
 *    typeof-based validation.
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
  const storageNeeded = clone.storage?.needed ?? false;
  clone.storage = {
    needed: storageNeeded,
    // When storage is not needed, duration and climate flag are irrelevant.
    // Drop duration entirely (canonical schema treats it as absent) and
    // force climate_controlled to false so Review can't report either
    // field as missing or inconsistent.
    duration_days: storageNeeded ? clone.storage?.duration_days : undefined,
    climate_controlled: storageNeeded ? (clone.storage?.climate_controlled ?? false) : false,
  };
  // Access booleans are required by the canonical schema. Always initialize
  // an explicit `false` so an unchecked box is persisted (not stripped) and
  // Review does not falsely mark the field as missing. Stairs and long
  // carry are safe-zero fields — "no stairs" / "no long carry" is the
  // dominant real-world case, so normalize any blank/null/NaN input to 0.
  for (const key of ["origin_access", "destination_access"] as const) {
    const existing = clone[key] ?? {};
    const stairs = normalizeSafeZero(existing.stairs_flights);
    const carry = normalizeSafeZero(existing.long_carry_meters);
    const elevator = existing.elevator;
    clone[key] = {
      ...existing,
      elevator_reservation_required:
        // Elevator "none" ⇒ no reservation possible. Force false so the
        // agent never asks providers to book a non-existent elevator.
        elevator === "none" ? false : (existing.elevator_reservation_required ?? false),
      parking_permit_required: existing.parking_permit_required ?? false,
      stairs_flights: stairs,
      long_carry_meters: carry,
    };
  }
  // Merge agent_permissions with safe defaults so confirmation always has
  // a fully-populated authority block.
  clone.agent_permissions = { ...defaultAgentPermissions(), ...(clone.agent_permissions ?? {}) };
  clone.customer_priorities = clone.customer_priorities ?? [];
  clone.additional_stops = clone.additional_stops ?? [];
  return clone;
}

/**
 * Normalize a "safe-zero" numeric field (stairs, long carry). Empty
 * strings, null, undefined, and NaN all collapse to `0`. Negative
 * values and non-integers are rejected by returning `undefined` so the
 * strict schema surfaces the issue at Review — never silently coerced.
 */
function normalizeSafeZero(value: unknown): number | undefined {
  if (value === "" || value == null) return 0;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return undefined;
  if (!Number.isInteger(n)) return undefined;
  return n;
}


/**
 * Completion percentage. Historically this file also owned a bespoke
 * "how many buckets look filled" heuristic — but that let Review show
 * 100% for drafts Confirm-and-Lock still rejected (and vice versa).
 *
 * The single source of truth is now `job-spec-validation.ts`, which runs
 * the sanitized draft through the strict `JobSpecSchema`. Re-export it
 * here so all existing callers keep working with no import churn.
 */
export { computeCompletion } from "./job-spec-validation";


export function newItemId(): string {
  // Non-crypto random ID is fine for local row identity in field arrays.
  return `it_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
}
