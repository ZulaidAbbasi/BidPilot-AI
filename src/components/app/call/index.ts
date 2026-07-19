/**
 * Barrel export for the Pre-call / Live / Post-call experience.
 * Import from `@/components/app/call` in the Control Room to compose stages.
 */
export { AudioPreflight } from "./AudioPreflight";
export { PreflightPanel } from "./PreflightPanel";
export { LiveCallBar } from "./LiveCallBar";
export { CallFrictionBanner, type FrictionKind } from "./CallFrictionBanner";
export { EventDetailDrawer, type EventDetail } from "./EventDetailDrawer";
export { PostCallStepper, type PostCallProgress, type PostCallStepKey } from "./PostCallStepper";
export { useCallStage } from "./CallStage";
export { motion } from "./motion";
export {
  CALL_TYPE_LABEL,
  isRehearsal,
  type AgentActivity,
  type AudioPreflightState,
  type CallContextSummary,
  type CallMode,
  type CallStage,
  type CallType,
  type ConnectionQuality,
  type ProviderIdentity,
  type SpecIntegrity,
} from "./types";
