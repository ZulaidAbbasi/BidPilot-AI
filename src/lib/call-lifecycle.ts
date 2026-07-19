/**
 * Pure derivation of the visible call lifecycle from persisted DB state + the
 * live ElevenLabs client status. Kept side-effect-free and framework-free so
 * it can be unit-tested and reused across surfaces.
 *
 * Invariants enforced here (see turn A spec):
 *   - LIVE never shows when session_ended_at is set
 *   - LIVE never shows when the persisted status is ending / processing /
 *     completed / needs_review / failed
 *   - LIVE never shows when the ElevenLabs client has disconnected
 *   - Timer runs only while the phase is genuinely "live"
 *   - Completed / needs_review / failed never resume a timer
 */

export type PersistedCallStatus =
  | "scheduled"
  | "context_loading"
  | "connecting"
  | "in_progress"
  | "quote_captured"
  | "negotiating"
  | "ending"
  | "processing"
  | "completed"
  | "needs_review"
  | "failed";

export type ClientSessionStatus = "disconnected" | "connecting" | "connected";

export type LifecyclePhase =
  | "ready"
  | "loading_context"
  | "connecting"
  | "live"
  | "ending"
  | "processing"
  | "completed"
  | "needs_review"
  | "failed";

export type LifecycleTone = "neutral" | "info" | "verified" | "warn" | "danger";

export interface LifecycleInput {
  /** Persisted call.status; null when no call row exists yet. */
  persistedStatus: PersistedCallStatus | null;
  /** calls.session_ended_at (or ended_at) — any truthy value ends LIVE. */
  sessionEndedAt: string | null;
  /** calls.reconciled_at. */
  reconciledAt: string | null;
  /** ElevenLabs SDK conversation status. */
  clientStatus: ClientSessionStatus;
  /** Local UI hint used only when there is no persisted row yet. */
  localHint?: "idle" | "requesting_mic" | "connecting" | "ending" | "error";
}

export interface LifecycleView {
  phase: LifecyclePhase;
  label: string;
  tone: LifecycleTone;
  /** True only when the call is genuinely live. Never true after any end signal. */
  isLive: boolean;
  /** True only while the wall-clock timer should tick. */
  timerRunning: boolean;
  /** True when the call has reached a terminal persisted state. */
  isTerminal: boolean;
}

const TERMINAL: ReadonlySet<PersistedCallStatus> = new Set([
  "completed",
  "needs_review",
  "failed",
]);

const POST_LIVE: ReadonlySet<PersistedCallStatus> = new Set([
  "ending",
  "processing",
  "completed",
  "needs_review",
  "failed",
]);

const PHASE_META: Record<LifecyclePhase, { label: string; tone: LifecycleTone }> = {
  ready: { label: "Ready", tone: "neutral" },
  loading_context: { label: "Loading context", tone: "info" },
  connecting: { label: "Connecting", tone: "info" },
  live: { label: "Live", tone: "verified" },
  ending: { label: "Ending", tone: "warn" },
  processing: { label: "Processing", tone: "info" },
  completed: { label: "Completed", tone: "verified" },
  needs_review: { label: "Needs review", tone: "warn" },
  failed: { label: "Failed", tone: "danger" },
};

/** Pure lifecycle derivation. See file header for invariants. */
export function deriveLifecycle(input: LifecycleInput): LifecycleView {
  const { persistedStatus, sessionEndedAt, clientStatus, localHint } = input;

  let phase: LifecyclePhase;

  // Terminal persisted states always win.
  if (persistedStatus && TERMINAL.has(persistedStatus)) {
    phase = persistedStatus as LifecyclePhase;
  } else if (persistedStatus === "processing") {
    phase = "processing";
  } else if (persistedStatus === "ending" || sessionEndedAt) {
    // Any end signal — persisted "ending" OR any session_ended_at — forces us
    // out of LIVE regardless of client state.
    phase = "ending";
  } else if (
    persistedStatus === "in_progress" ||
    persistedStatus === "quote_captured" ||
    persistedStatus === "negotiating"
  ) {
    // Server thinks we're mid-call. Downgrade to "ending" if the client has
    // dropped — the UI must not lie about a live socket.
    phase = clientStatus === "connected" ? "live" : "ending";
  } else if (persistedStatus === "connecting") {
    phase = clientStatus === "connected" ? "live" : "connecting";
  } else if (persistedStatus === "context_loading") {
    phase = "loading_context";
  } else if (persistedStatus === "scheduled") {
    phase = "ready";
  } else {
    // No persisted row yet — fall back to local UI hint.
    switch (localHint) {
      case "requesting_mic":
      case "connecting":
        phase = "connecting";
        break;
      case "ending":
        phase = "ending";
        break;
      default:
        phase = "ready";
    }
  }

  // Final safety net: if any post-live signal is present, never expose LIVE.
  const anyEndSignal =
    !!sessionEndedAt || (persistedStatus != null && POST_LIVE.has(persistedStatus));
  const isLive = phase === "live" && !anyEndSignal && clientStatus === "connected";

  const isTerminal = persistedStatus != null && TERMINAL.has(persistedStatus);
  const timerRunning = isLive; // timer must not tick during processing/ending/terminal

  const meta = PHASE_META[phase];
  return {
    phase,
    label: meta.label,
    tone: meta.tone,
    isLive,
    timerRunning,
    isTerminal,
  };
}

/** Truthful transcript-source label. */
export function labelTranscriptSource(source: string | null | undefined): string {
  switch (source) {
    case "webhook":
      return "Webhook received";
    case "fallback":
      return "Transcript fetched";
    case "live":
      return "Live transcript";
    case "none":
    case null:
    case undefined:
      return "Not available";
    default:
      return source;
  }
}
