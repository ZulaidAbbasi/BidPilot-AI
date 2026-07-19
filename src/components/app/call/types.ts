/**
 * Shared types for the redesigned Pre-call / Live / Post-call experience.
 * These are frontend-only DTOs — persistence still uses the existing
 * ElevenLabs tool contracts and database schemas.
 */

export type CallType = "intake" | "quote" | "negotiation" | "rehearsal";

export type CallStage = "preflight" | "connecting" | "live" | "ending" | "processing" | "done";

export type CallMode = "real" | "rehearsal";

export type ConnectionQuality = "unknown" | "good" | "fair" | "poor";

export type AgentActivity = "idle" | "listening" | "thinking" | "speaking";

export interface ProviderIdentity {
  id: string;
  name: string;
  phone?: string | null;
  carrier?: string | null;
}

export interface SpecIntegrity {
  version: number;
  hash: string;
  shortHash: string;
  confirmed: boolean;
}

export interface CallContextSummary {
  provider: ProviderIdentity;
  callType: CallType;
  mode: CallMode;
  spec: SpecIntegrity;
  route?: { origin?: string | null; destination?: string | null };
  movingDate?: string | null;
  authority?: string | null;
  objective?: string | null;
  requiredQuestions?: string[];
  eligibleLeverage?: string[];
  unresolvedRisks?: string[];
}

export interface AudioPreflightState {
  supported: boolean;
  permission: "prompt" | "granted" | "denied" | "unknown";
  devices: { deviceId: string; label: string }[];
  selectedDeviceId: string | null;
  inputLevel: number; // 0..1
  testing: boolean;
  error?: string;
}

/** Labels shown across the UI for each call type. Real vs Rehearsal must never blur. */
export const CALL_TYPE_LABEL: Record<CallType, string> = {
  intake: "Voice intake",
  quote: "Quote gathering",
  negotiation: "Negotiation",
  rehearsal: "Rehearsal",
};

/** Rehearsal is ALWAYS visually distinct — never say "provider call" for rehearsal. */
export function isRehearsal(mode: CallMode, callType: CallType): boolean {
  return mode === "rehearsal" || callType === "rehearsal";
}
