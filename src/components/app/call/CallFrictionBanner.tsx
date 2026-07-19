import {
  AlertTriangle,
  CircleAlert,
  Info,
  MicOff,
  PhoneMissed,
  RefreshCw,
  Voicemail,
  Wifi,
  WifiOff,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type FrictionKind =
  | "mic_denied"
  | "poor_network"
  | "tool_save_failed"
  | "transcript_delay"
  | "webhook_delay"
  | "provider_refused"
  | "callback_requested"
  | "voicemail"
  | "disconnected"
  | "wrong_number"
  | "provider_interrupted"
  | "asked_if_ai"
  | "transfer"
  | "provider_unavailable";

interface FrictionMeta {
  title: string;
  what: string;
  saved: "yes" | "partial" | "no" | "n/a";
  next: string;
  icon: React.ComponentType<{ className?: string }>;
  tone: "warn" | "risk" | "info";
}

const META: Record<FrictionKind, FrictionMeta> = {
  mic_denied: {
    title: "Microphone access is blocked",
    what: "Your browser refused to share the mic.",
    saved: "n/a",
    next: "Grant mic access in the browser site settings, then reload.",
    icon: MicOff,
    tone: "risk",
  },
  poor_network: {
    title: "Poor network connection",
    what: "The connection to the voice agent degraded.",
    saved: "partial",
    next: "Stay put — the session may recover. If it drops, we save whatever the agent already captured.",
    icon: WifiOff,
    tone: "warn",
  },
  tool_save_failed: {
    title: "Tool save failed",
    what: "The agent could not persist a quote or line item.",
    saved: "no",
    next: "The transcript still records the value. Retry reconciliation after the call.",
    icon: CircleAlert,
    tone: "risk",
  },
  transcript_delay: {
    title: "Transcript is arriving late",
    what: "Speech-to-text is running behind by a few seconds.",
    saved: "yes",
    next: "Keep talking — the transcript will catch up.",
    icon: Info,
    tone: "info",
  },
  webhook_delay: {
    title: "Post-call processing is queued",
    what: "The provider webhook is still delivering the final transcript.",
    saved: "yes",
    next: "Processing usually completes within 30 seconds.",
    icon: RefreshCw,
    tone: "info",
  },
  provider_refused: {
    title: "Provider refused to give a quote",
    what: "The provider will not commit to numbers on this call.",
    saved: "partial",
    next: "Log the refusal, then try leverage from another provider or schedule a callback.",
    icon: AlertTriangle,
    tone: "warn",
  },
  callback_requested: {
    title: "Provider requested a callback",
    what: "They want to follow up at a specific time.",
    saved: "yes",
    next: "Schedule the callback and mark this negotiation for follow-up.",
    icon: Info,
    tone: "info",
  },
  voicemail: {
    title: "Reached voicemail",
    what: "The agent hit voicemail instead of a live person.",
    saved: "n/a",
    next: "No quote was captured. Try again during business hours or use a different number.",
    icon: Voicemail,
    tone: "warn",
  },
  disconnected: {
    title: "Call was disconnected",
    what: "The connection dropped unexpectedly.",
    saved: "partial",
    next: "Anything captured before the drop is saved. Reconnect or start a new call.",
    icon: PhoneMissed,
    tone: "risk",
  },
  wrong_number: {
    title: "Wrong number",
    what: "The person on the line is not the intended provider.",
    saved: "no",
    next: "End the call and verify the provider's phone number.",
    icon: AlertTriangle,
    tone: "warn",
  },
  provider_interrupted: {
    title: "Provider interrupted the agent",
    what: "The provider spoke over the agent (barge-in).",
    saved: "partial",
    next: "The agent will re-anchor to the current question.",
    icon: Info,
    tone: "info",
  },
  asked_if_ai: {
    title: "Provider asked if this is an AI",
    what: "The agent will disclose it is an AI assistant per policy.",
    saved: "n/a",
    next: "No action needed — this is expected behavior.",
    icon: Info,
    tone: "info",
  },
  transfer: {
    title: "Provider is transferring the call",
    what: "You may be routed to a different representative.",
    saved: "yes",
    next: "The agent will re-introduce itself and continue.",
    icon: Info,
    tone: "info",
  },
  provider_unavailable: {
    title: "Provider is unavailable",
    what: "No one answered or the line is busy.",
    saved: "n/a",
    next: "Try again later or move on to another provider.",
    icon: WifiOff,
    tone: "warn",
  },
};

interface Props {
  kind: FrictionKind;
  onRetry?: () => void;
  retryLabel?: string;
  onDismiss?: () => void;
}

export function CallFrictionBanner({ kind, onRetry, retryLabel, onDismiss }: Props) {
  const m = META[kind];
  const Icon = m.icon;
  const savedLabel =
    m.saved === "yes"
      ? "Data was saved"
      : m.saved === "partial"
        ? "Partially saved"
        : m.saved === "no"
          ? "Nothing was saved"
          : "No data expected";
  const savedTone =
    m.saved === "yes"
      ? "text-verified"
      : m.saved === "partial"
        ? "text-warn"
        : m.saved === "no"
          ? "text-risk"
          : "text-muted-foreground";

  return (
    <Alert
      className={cn(
        "border",
        m.tone === "risk"
          ? "border-risk/40 bg-risk-soft/40"
          : m.tone === "warn"
            ? "border-warn/40 bg-warn-soft/40"
            : "border-border/70 bg-muted/40",
      )}
    >
      <Icon
        className={cn(
          "size-4",
          m.tone === "risk"
            ? "text-risk"
            : m.tone === "warn"
              ? "text-warn"
              : "text-muted-foreground",
        )}
      />
      <AlertTitle className="flex items-center justify-between gap-2">
        <span>{m.title}</span>
        <span className={cn("font-mono text-[10px] uppercase tracking-[0.14em]", savedTone)}>
          {savedLabel}
        </span>
      </AlertTitle>
      <AlertDescription>
        <p className="text-sm">{m.what}</p>
        <p className="mt-1 text-xs text-muted-foreground">{m.next}</p>
        {(onRetry || onDismiss) && (
          <div className="mt-2 flex gap-2">
            {onRetry && (
              <Button type="button" size="sm" variant="outline" onClick={onRetry}>
                <RefreshCw className="mr-1.5 size-3.5" /> {retryLabel ?? "Retry"}
              </Button>
            )}
            {onDismiss && (
              <Button type="button" size="sm" variant="ghost" onClick={onDismiss}>
                Dismiss
              </Button>
            )}
          </div>
        )}
      </AlertDescription>
    </Alert>
  );
}
