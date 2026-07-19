/**
 * Human-friendly error rendering for JobSpec validation issues.
 *
 * Zod issue paths (`origin_access.stairs_flights`) and Zod internals
 * (`Expected number, received nan`) are not appropriate UI copy. This
 * module maps every canonical path to a plain-English label + the wizard
 * step where the field lives, and rewrites common error messages.
 */
import type { ZodIssue } from "zod";

export type WizardStep = 1 | 2 | 3 | 4 | 5 | 6;

const LABELS: Record<string, { label: string; step: WizardStep }> = {
  origin: { label: "Origin address", step: 1 },
  "origin.line1": { label: "Origin street address", step: 1 },
  "origin.city": { label: "Origin city", step: 1 },
  "origin.region": { label: "Origin state / region", step: 1 },
  "origin.postal_code": { label: "Origin postal code", step: 1 },
  "origin.country": { label: "Origin country", step: 1 },
  destination: { label: "Destination address", step: 1 },
  "destination.line1": { label: "Destination street address", step: 1 },
  "destination.city": { label: "Destination city", step: 1 },
  "destination.region": { label: "Destination state / region", step: 1 },
  "destination.postal_code": { label: "Destination postal code", step: 1 },
  "destination.country": { label: "Destination country", step: 1 },
  move_date: { label: "Move date", step: 1 },
  preferred_time_window: { label: "Preferred time window", step: 1 },

  bedroom_count: { label: "Bedroom count", step: 3 },

  "origin_access.floor": { label: "Origin floor", step: 2 },
  "origin_access.stairs_flights": { label: "Origin stair flights", step: 2 },
  "origin_access.elevator": { label: "Origin elevator", step: 2 },
  "origin_access.elevator_reservation_required": {
    label: "Origin elevator reservation",
    step: 2,
  },
  "origin_access.long_carry_meters": { label: "Origin long carry (meters)", step: 2 },
  "origin_access.parking": { label: "Origin parking", step: 2 },
  "origin_access.parking_permit_required": {
    label: "Origin parking permit required",
    step: 2,
  },
  "destination_access.floor": { label: "Destination floor", step: 2 },
  "destination_access.stairs_flights": {
    label: "Destination stair flights",
    step: 2,
  },
  "destination_access.elevator": { label: "Destination elevator", step: 2 },
  "destination_access.elevator_reservation_required": {
    label: "Destination elevator reservation",
    step: 2,
  },
  "destination_access.long_carry_meters": {
    label: "Destination long carry (meters)",
    step: 2,
  },
  "destination_access.parking": { label: "Destination parking", step: 2 },
  "destination_access.parking_permit_required": {
    label: "Destination parking permit required",
    step: 2,
  },

  packing_level: { label: "Packing level", step: 4 },
  unpacking_requested: { label: "Unpacking at destination", step: 4 },
  disassembly_required: { label: "Disassembly at origin", step: 4 },
  reassembly_required: { label: "Reassembly at destination", step: 4 },
  "storage.needed": { label: "Storage needed", step: 4 },
  "storage.duration_days": { label: "Storage duration (days)", step: 4 },
  "storage.climate_controlled": { label: "Climate controlled storage", step: 4 },

  insurance_level: { label: "Insurance level", step: 5 },
  special_instructions: { label: "Priorities & instructions", step: 5 },
};

function humanisePath(p: string): string {
  return p
    .replace(/\.(\d+)\./g, " #$1 ")
    .replace(/\.(\d+)$/g, " #$1")
    .replace(/[._]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function labelForPath(path: string): string {
  const entry = LABELS[path];
  if (entry) return entry.label;
  if (path.startsWith("inventory"))
    return `Inventory ${humanisePath(path.slice("inventory".length))}`;
  if (path.startsWith("fragile_items"))
    return `Fragile ${humanisePath(path.slice("fragile_items".length))}`;
  if (path.startsWith("specialty_items"))
    return `Specialty ${humanisePath(path.slice("specialty_items".length))}`;
  return humanisePath(path) || "This field";
}

export function stepForPath(path: string): WizardStep {
  const entry = LABELS[path];
  if (entry) return entry.step;
  if (
    path.startsWith("inventory") ||
    path.startsWith("fragile_items") ||
    path.startsWith("specialty_items")
  )
    return 3;
  if (path.startsWith("origin_access") || path.startsWith("destination_access")) return 2;
  if (
    path.startsWith("origin") ||
    path.startsWith("destination") ||
    path === "move_date" ||
    path === "preferred_time_window"
  )
    return 1;
  if (
    path.startsWith("storage") ||
    path === "packing_level" ||
    path === "unpacking_requested" ||
    path === "disassembly_required" ||
    path === "reassembly_required"
  )
    return 4;
  if (path === "insurance_level" || path === "special_instructions") return 5;
  return 6;
}

export function friendlyMessage(path: string, message: string): string {
  const label = labelForPath(path);
  const m = message ?? "";
  if (/nan/i.test(m) || /Expected number/i.test(m)) {
    return `${label}: enter a number or leave blank.`;
  }
  if (/Enter a valid date|Invalid date/i.test(m)) {
    return `${label}: pick a valid date.`;
  }
  if (/Move date must be today or later/i.test(m)) {
    return `${label} must be today or a future date.`;
  }
  if (/^Required$/i.test(m) || /Invalid input: expected/i.test(m)) {
    return `${label} is required.`;
  }
  if (/Invalid enum/i.test(m)) {
    return `${label}: choose one of the available options.`;
  }
  return `${label}: ${m}`;
}

export type FriendlyIssue = {
  path: string;
  label: string;
  message: string;
  step: WizardStep;
};

export function friendlyIssues(
  issues: readonly (ZodIssue | { path: (string | number)[]; message: string })[],
): FriendlyIssue[] {
  const seen = new Set<string>();
  const out: FriendlyIssue[] = [];
  for (const issue of issues) {
    const path = issue.path.map(String).join(".") || "(root)";
    const key = `${path}::${issue.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      path,
      label: labelForPath(path),
      message: friendlyMessage(path, issue.message),
      step: stepForPath(path),
    });
  }
  return out;
}

