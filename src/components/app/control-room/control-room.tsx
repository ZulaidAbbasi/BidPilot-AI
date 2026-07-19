/**
 * Agent Control Room — the primary hero surface for BidPilot.
 *
 * All information here is derived from real database records:
 *   - calls, call_transcripts, agent_events, call_webhook_events
 *   - providers, job_specs, quotes, quote_line_items, quote_evidence
 * The only client-side runtime state is the ElevenLabs SDK session and the
 * timer/mic UI state around it. No synthetic activity.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useConversation } from "@elevenlabs/react";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  BadgeCheck,
  Building2,
  CheckCircle2,
  ChevronDown,
  ClipboardList,
  Clock,
  DollarSign,
  FileText,
  FlaskConical,
  Info,
  Lock,
  MessageSquare,
  Mic,
  MicOff,
  Phone,
  PhoneCall,
  PhoneOff,
  Radio,
  Search,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Waves,
  Wrench,
  XCircle,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/app/status-badge";
import { supabase } from "@/integrations/supabase/client";
import {
  attachConversationId,
  endProviderRehearsal,
  startProviderRehearsal,
} from "@/lib/elevenlabs.functions";
import { shortHash } from "@/lib/job-spec-canonical";
import { cn } from "@/lib/utils";

// ─── Types ──────────────────────────────────────────────────────────────────

type UiState =
  | { kind: "idle" }
  | { kind: "requesting_mic" }
  | { kind: "connecting" }
  | { kind: "connected" }
  | { kind: "ending" }
  | { kind: "error"; code: FriendlyErrorCode; detail?: string };

type FriendlyErrorCode =
  | "mic_denied"
  | "elevenlabs_failed"
  | "context_load_failed"
  | "invalid_spec"
  | "token_expired"
  | "rate_limited"
  | "unknown";

type RightTab = "quote" | "progress" | "evidence" | "risk" | "outcome";
type MobileTab = "context" | "transcript" | "intel";

type TranscriptRow = {
  id: string;
  speaker: "agent" | "user" | "provider" | "system" | "tool";
  text: string;
  started_at_ms: number | null;
  sequence_number: number;
  created_at: string;
};

type AgentEventRow = {
  id: string;
  event_type: string | null;
  event_status: string | null;
  summary: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
};

type QuoteRow = {
  id: string;
  quote_stage: string;
  currency: string;
  total_amount: number | null;
  low_amount: number | null;
  high_amount: number | null;
  estimate_type: string | null;
  valid_until: string | null;
  deposit_amount: number | null;
  deposit_refundable: boolean | null;
  terms: string | null;
  included_services: unknown[];
  excluded_services: unknown[];
  price_change_conditions: string | null;
  captured_at: string;
  verification_status: string;
};

type LineItemRow = {
  id: string;
  category: string;
  label: string;
  amount: number | null;
  currency: string;
  included: boolean;
  conditional: boolean;
  condition_text: string | null;
  provider_words: string | null;
};

type EvidenceRow = {
  id: string;
  evidence_type: string;
  support_status: "supported" | "unsupported" | "contradictory" | "missing_evidence";
  extracted_text: string | null;
  quote_line_item_id: string | null;
  timestamp_ms: number | null;
};

type CallRow = {
  id: string;
  status: string | null;
  external_call_id: string | null;
  started_at: string | null;
  ended_at: string | null;
  webhook_received_at: string | null;
  final_outcome: string | null;
  outcome_finalized_at: string | null;
  verified_savings_amount: number | null;
  verified_price_changed: boolean | null;
  verified_terms_changed: boolean | null;
  needs_review: boolean;
  reconciled_at: string | null;
  failure_reason: string | null;
  metadata: Record<string, unknown> | null;
};

// ─── Helpers ────────────────────────────────────────────────────────────────

const fmtMoney = (n: number | null | undefined, currency = "USD") =>
  n == null
    ? "—"
    : new Intl.NumberFormat("en-US", {
        style: "currency",
        currency,
        maximumFractionDigits: 0,
      }).format(n);

const fmtDuration = (seconds: number) => {
  const mm = String(Math.floor(seconds / 60)).padStart(2, "0");
  const ss = String(seconds % 60).padStart(2, "0");
  return `${mm}:${ss}`;
};

const fmtTime = (iso: string) =>
  new Date(iso).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

const humanizeToolName = (name: string) => {
  switch (name) {
    case "load_call_context":
    case "CONTEXT_LOADED":
      return "Loaded call context";
    case "SPEC_VERIFIED":
      return "Verified specification hash";
    case "save_quote_snapshot":
    case "QUOTE_CAPTURED":
      return "Saved quote snapshot";
    case "save_quote_line_item":
    case "QUOTE_LINE_ITEM_SAVED":
      return "Saved quote line item";
    case "finalize_call_outcome":
    case "CALL_FINALIZED":
      return "Finalized call outcome";
    case "call_started":
      return "Call started";
    case "call_ended_client":
      return "Call ended by operator";
    default:
      return name.replace(/_/g, " ").toLowerCase();
  }
};

const classifyError = (msg: string): FriendlyErrorCode => {
  const m = msg.toLowerCase();
  if (m.includes("permission") || m.includes("microphone") || m.includes("notallowed"))
    return "mic_denied";
  if (m.includes("spec")) return "invalid_spec";
  if (m.includes("token")) return "token_expired";
  if (m.includes("rate")) return "rate_limited";
  if (m.includes("elevenlabs") || m.includes("signed") || m.includes("network"))
    return "elevenlabs_failed";
  if (m.includes("context")) return "context_load_failed";
  return "unknown";
};

const friendlyErrorMessage = (code: FriendlyErrorCode) => {
  switch (code) {
    case "mic_denied":
      return "Microphone access was denied. Enable microphone permission for this site in your browser settings and try again.";
    case "elevenlabs_failed":
      return "We couldn't reach the voice service. Check your connection and try again in a moment.";
    case "context_load_failed":
      return "The call context failed to load. The agent could not authenticate against BidPilot.";
    case "invalid_spec":
      return "The confirmed specification isn't ready. Return to Specification and confirm before starting a call.";
    case "token_expired":
      return "This call's authentication window has expired. End the call and start a new one.";
    case "rate_limited":
      return "We've temporarily paused this action to protect the system. Wait a moment and try again.";
    default:
      return "Something didn't work. Try again in a moment.";
  }
};

type MicrophoneDevice = { deviceId: string; label: string };

type MicrophoneSelection = {
  deviceId: string | null;
  label: string;
  devices: MicrophoneDevice[];
};

async function enumerateMicrophones(): Promise<MicrophoneDevice[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  try {
    const all = await navigator.mediaDevices.enumerateDevices();
    return all
      .filter((d) => d.kind === "audioinput" && d.deviceId)
      .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Microphone ${i + 1}` }));
  } catch {
    return [];
  }
}

async function requestWorkingMicrophone(preferredDeviceId?: string | null): Promise<MicrophoneSelection> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("Microphone access is not supported in this browser");
  }

  const constraints: MediaStreamConstraints = {
    audio: preferredDeviceId
      ? { deviceId: { exact: preferredDeviceId }, echoCancellation: true, noiseSuppression: true, autoGainControl: true }
      : { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  };
  const stream = await navigator.mediaDevices.getUserMedia(constraints);

  try {
    const track = stream.getAudioTracks()[0];
    if (!track || track.readyState !== "live" || !track.enabled) {
      throw new Error("No active microphone track was available");
    }
    const settings = track.getSettings();
    const devices = await enumerateMicrophones();
    return {
      deviceId: settings.deviceId ?? preferredDeviceId ?? null,
      label: track.label || "Default microphone",
      devices,
    };
  } finally {
    // Preflight only — SDK opens the real stream.
    stream.getTracks().forEach((track) => track.stop());
  }
}


// ─── Root component ─────────────────────────────────────────────────────────

export function AgentControlRoom({ negotiationId }: { negotiationId: string }) {
  const gate = useQuery({
    queryKey: ["cr-gate", negotiationId],
    queryFn: async () => {
      const [{ data: specs }, { data: provs }] = await Promise.all([
        supabase
          .from("job_specs")
          .select("version, specification_hash")
          .eq("negotiation_id", negotiationId)
          .eq("confirmed", true)
          .order("version", { ascending: false })
          .limit(1),
        supabase
          .from("providers")
          .select("id, name, phone, source, location")
          .eq("negotiation_id", negotiationId)
          .order("created_at", { ascending: true }),
      ]);
      return {
        latestSpec: specs?.[0] ?? null,
        providers: provs ?? [],
      };
    },
  });

  if (gate.isLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center px-4 text-sm text-muted-foreground">
        <span className="inline-flex size-4 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-foreground" />
        <span className="ml-3">Preparing Control Room…</span>
      </div>
    );
  }

  const latestSpec = gate.data?.latestSpec;
  const providers = gate.data?.providers ?? [];

  if (!latestSpec) {
    return (
      <GateEmpty
        icon={ShieldCheck}
        title="Confirm the specification first"
        body="The Control Room requires a hash-locked JobSpec. Confirm the specification to unlock live provider calls."
      />
    );
  }
  if (providers.length === 0) {
    return (
      <GateEmpty
        icon={Building2}
        title="Add at least one provider"
        body="Add a provider to this negotiation so BidPilot has a target to call."
      />
    );
  }

  return (
    <ControlRoom
      negotiationId={negotiationId}
      providers={providers}
      specVersion={latestSpec.version}
      specHash={latestSpec.specification_hash ?? ""}
    />
  );
}

function GateEmpty({
  icon: Icon,
  title,
  body,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  body: string;
}) {
  return (
    <div className="mx-4 my-8 flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card px-6 py-16 text-center sm:mx-8">
      <div className="flex size-11 items-center justify-center rounded-lg bg-muted text-muted-foreground">
        <Icon className="size-5" />
      </div>
      <h3 className="mt-4 text-base font-semibold">{title}</h3>
      <p className="mt-1.5 max-w-md text-sm text-muted-foreground">{body}</p>
    </div>
  );
}

// ─── Control Room shell ─────────────────────────────────────────────────────

function ControlRoom({
  negotiationId,
  providers,
  specVersion,
  specHash,
}: {
  negotiationId: string;
  providers: Array<{
    id: string;
    name: string;
    phone: string | null;
    source: string | null;
    location: string | null;
  }>;
  specVersion: number;
  specHash: string;
}) {
  const queryClient = useQueryClient();
  const startFn = useServerFn(startProviderRehearsal);
  const attachFn = useServerFn(attachConversationId);
  const endFn = useServerFn(endProviderRehearsal);

  const [providerId, setProviderId] = useState(providers[0].id);
  const [ui, setUi] = useState<UiState>({ kind: "idle" });
  const [callId, setCallId] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [micInputLevel, setMicInputLevel] = useState(0);
  const [micSignalSeen, setMicSignalSeen] = useState(false);
  const [micDeviceLabel, setMicDeviceLabel] = useState("Default microphone");
  const [micDevices, setMicDevices] = useState<MicrophoneDevice[]>([]);
  const [selectedMicId, setSelectedMicId] = useState<string | null>(null);
  const [mobileTab, setMobileTab] = useState<MobileTab>("transcript");

  useEffect(() => {
    let cancelled = false;
    enumerateMicrophones().then((devs) => {
      if (!cancelled) {
        setMicDevices(devs);
        if (!selectedMicId && devs[0]?.deviceId) setSelectedMicId(devs[0].deviceId);
      }
    });
    const listener = () => enumerateMicrophones().then((d) => !cancelled && setMicDevices(d));
    navigator.mediaDevices?.addEventListener?.("devicechange", listener);
    return () => {
      cancelled = true;
      navigator.mediaDevices?.removeEventListener?.("devicechange", listener);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);


  const startedAtRef = useRef<number | null>(null);
  const callIdRef = useRef<string | null>(null);
  const micDeviceIdRef = useRef<string | null>(null);

  const provider = useMemo(
    () => providers.find((p) => p.id === providerId) ?? providers[0],
    [providerId, providers],
  );

  const conversation = useConversation({
    onConnect: (payload: unknown) => {
      const id =
        (payload as { conversationId?: string; id?: string })?.conversationId ??
        (payload as { id?: string })?.id ??
        null;
      setUi({ kind: "connected" });
      setMicSignalSeen(false);
      if (id) setConversationId(id);

      // Use refs here: onConnect may fire before React has committed the
      // setCallId state update from start(), which previously caused the
      // conversation id to be left unattached intermittently.
      const activeCallId = callIdRef.current;
      if (id && activeCallId) {
        attachFn({ data: { callId: activeCallId, conversationId: id } }).catch(() => {
          /* soft-fail; webhook still links via external_call_id */
        });
      }

      // Explicitly unmute the SDK input and bind the exact device that passed
      // the preflight check. setVolume controls speaker output, not the mic.
      conversation.setMuted(false);
      const inputDeviceId = micDeviceIdRef.current;
      if (inputDeviceId) {
        conversation
          .changeInputDevice({ inputDeviceId, format: "pcm", sampleRate: 16000 })
          .catch(() => {
            /* Browser default remains active if device rebinding is unsupported. */
          });
      }
    },
    onDisconnect: () => {
      setUi((prev) => (prev.kind === "error" ? prev : { kind: "idle" }));
      startedAtRef.current = null;
      setMicInputLevel(0);
      callIdRef.current = null;
    },
    onError: (error: unknown) => {
      const message =
        typeof error === "string"
          ? error
          : ((error as { message?: string })?.message ?? "Conversation error");
      setUi({ kind: "error", code: classifyError(message), detail: message });
    },
    onMessage: () => {
      /* transcripts arrive server-side via webhook; UI reads DB */
    },
  });

  // Elapsed timer while connected.
  useEffect(() => {
    if (ui.kind !== "connected") return;
    startedAtRef.current ??= Date.now();
    const t = setInterval(() => {
      if (startedAtRef.current) {
        setElapsed(Math.floor((Date.now() - startedAtRef.current) / 1000));
      }
    }, 1000);
    return () => clearInterval(t);
  }, [ui.kind]);

  // Continuously verify that ElevenLabs is receiving a real input signal.
  // This makes a wrong/blocked microphone immediately visible instead of
  // looking like an agent problem.
  useEffect(() => {
    if (conversation.status !== "connected") {
      setMicInputLevel(0);
      return;
    }
    const t = window.setInterval(() => {
      try {
        const level = Math.max(0, Math.min(1, conversation.getInputVolume()));
        setMicInputLevel(level);
        if (level > 0.015) setMicSignalSeen(true);
      } catch {
        setMicInputLevel(0);
      }
    }, 160);
    return () => window.clearInterval(t);
  }, [conversation, conversation.status]);

  const status = conversation.status;
  const isSpeaking = conversation.isSpeaking;
  const isLive = status === "connected";
  const isActive = isLive || ui.kind === "connecting" || ui.kind === "ending";

  const start = useCallback(async () => {
    setConversationId(null);
    setCallId(null);
    setElapsed(0);
    setMicSignalSeen(false);
    setMicInputLevel(0);
    setUi({ kind: "requesting_mic" });
    try {
      const microphone = await requestWorkingMicrophone(selectedMicId);
      micDeviceIdRef.current = microphone.deviceId;
      setMicDeviceLabel(microphone.label);
      setMicDevices(microphone.devices);
      if (!selectedMicId && microphone.deviceId) setSelectedMicId(microphone.deviceId);

    } catch (err) {
      const msg = err instanceof Error ? err.message : "Microphone permission was denied";
      setUi({ kind: "error", code: "mic_denied", detail: msg });
      return;
    }
    setUi({ kind: "connecting" });
    try {
      const result = await startFn({ data: { negotiationId, providerId } });
      callIdRef.current = result.callId;
      setCallId(result.callId);
      conversation.startSession({
        conversationToken: result.conversationToken,
        connectionType: "webrtc",
        dynamicVariables: result.dynamicVariables,
      });
      queryClient.invalidateQueries({ queryKey: ["cr-call", result.callId] });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to start call";
      setUi({ kind: "error", code: classifyError(msg), detail: msg });
    }
  }, [conversation, negotiationId, providerId, queryClient, startFn]);

  const stop = useCallback(async () => {
    setUi({ kind: "ending" });
    try {
      await conversation.endSession();
    } catch {
      /* ignore */
    }
    if (callId) {
      try {
        await endFn({ data: { callId, reason: "Ended by operator" } });
      } catch {
        /* ignore */
      }
    }
    queryClient.invalidateQueries({ queryKey: ["cr-call", callId] });
    setUi({ kind: "idle" });
    startedAtRef.current = null;
    callIdRef.current = null;
    setMicInputLevel(0);
  }, [callId, conversation, endFn, queryClient]);

  const toggleMute = useCallback(() => {
    // setVolume changes the agent/speaker output. Microphone mute must use
    // ElevenLabs' input controller.
    conversation.setMuted(!conversation.isMuted);
  }, [conversation]);

  // ─── Sticky header ───────────────────────────────────────────────────────
  const header = (
    <StickyCallHeader
      isLive={isLive}
      isActive={isActive}
      elapsed={elapsed}
      providerName={provider?.name ?? "—"}
      specVersion={specVersion}
      specHash={specHash}
      ui={ui}
      isSpeaking={isSpeaking}
      onStart={start}
      onStop={stop}
      onToggleMute={toggleMute}
      muted={conversation.isMuted}
      micInputLevel={micInputLevel}
      micDeviceLabel={micDeviceLabel}
    />
  );

  // Provider selector shown when idle
  const providerSelector = !isActive && ui.kind !== "requesting_mic" && (
    <div className="flex flex-wrap items-end gap-2 border-b border-border/70 bg-surface-2/50 px-4 py-3 sm:px-6">
      <div className="min-w-[220px] flex-1">
        <label className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Practice against
        </label>
        <Select value={providerId} onValueChange={setProviderId}>
          <SelectTrigger className="h-9">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {providers.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {micDevices.length > 0 && (
        <div className="min-w-[200px] flex-1">
          <label className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Microphone
          </label>
          <Select
            value={selectedMicId ?? micDevices[0]?.deviceId ?? ""}
            onValueChange={(v) => setSelectedMicId(v)}
          >
            <SelectTrigger className="h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {micDevices.map((d) => (
                <SelectItem key={d.deviceId} value={d.deviceId}>
                  {d.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      <RehearsalPill />
    </div>
  );


  const leftPanel = (
    <LeftPanel
      provider={provider}
      specVersion={specVersion}
      specHash={specHash}
      callId={callId}
      isLive={isLive}
      elapsed={elapsed}
    />
  );
  const centerPanel = (
    <CenterPanel callId={callId} isLive={isLive} isSpeaking={isSpeaking} ui={ui} />
  );
  const rightPanel = <RightPanel negotiationId={negotiationId} callId={callId} />;

  return (
    <div className="flex flex-col">
      {header}
      {providerSelector}
      {isLive && elapsed >= 6 && !conversation.isMuted && !micSignalSeen ? (
        <Alert className="m-3 border-warn/50 bg-warn-soft sm:mx-6">
          <MicOff className="size-4" />
          <AlertTitle>No microphone signal detected</AlertTitle>
          <AlertDescription>
            Speak near <strong>{micDeviceLabel}</strong>. If the meter stays empty, choose the
            correct microphone in Chrome site settings, then end and restart the rehearsal.
          </AlertDescription>
        </Alert>
      ) : null}
      {ui.kind === "error" && (
        <FailureBanner
          code={ui.code}
          detail={ui.detail}
          onDismiss={() => setUi({ kind: "idle" })}
        />
      )}

      {/* Desktop 3-panel layout */}
      <div className="hidden xl:grid xl:grid-cols-[320px_minmax(0,1fr)_380px] 2xl:grid-cols-[340px_minmax(0,1fr)_420px]">
        <div className="border-r border-border/70 bg-surface-2/40">{leftPanel}</div>
        <div className="min-h-[calc(100dvh-14rem)] bg-background">{centerPanel}</div>
        <div className="border-l border-border/70 bg-surface-2/40">{rightPanel}</div>
      </div>

      {/* Compact tabbed layout (below xl) */}
      <div className="xl:hidden">
        <div className="sticky top-[3.5rem] z-20 flex border-b border-border/70 bg-background/95 backdrop-blur">
          {(
            [
              { id: "context", label: "Context", icon: Info },
              { id: "transcript", label: "Live", icon: MessageSquare },
              { id: "intel", label: "Intel", icon: Sparkles },
            ] as const
          ).map((t) => {
            const active = mobileTab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setMobileTab(t.id)}
                className={cn(
                  "flex-1 border-b-2 px-3 py-2.5 text-xs font-medium transition-colors",
                  active
                    ? "border-navy text-foreground"
                    : "border-transparent text-muted-foreground",
                )}
              >
                <t.icon className="mr-1 inline size-3.5" />
                {t.label}
              </button>
            );
          })}
        </div>
        {mobileTab === "context" && leftPanel}
        {mobileTab === "transcript" && centerPanel}
        {mobileTab === "intel" && rightPanel}
      </div>
    </div>
  );
}

// ─── Sticky call header ─────────────────────────────────────────────────────

function StickyCallHeader({
  isLive,
  isActive,
  elapsed,
  providerName,
  specVersion,
  specHash,
  ui,
  isSpeaking,
  onStart,
  onStop,
  onToggleMute,
  muted,
  micInputLevel,
  micDeviceLabel,
}: {
  isLive: boolean;
  isActive: boolean;
  elapsed: number;
  providerName: string;
  specVersion: number;
  specHash: string;
  ui: UiState;
  isSpeaking: boolean;
  onStart: () => void;
  onStop: () => void;
  onToggleMute: () => void;
  muted: boolean;
  micInputLevel: number;
  micDeviceLabel: string;
}) {
  const stateLabel = (() => {
    if (ui.kind === "error") return "Error";
    if (ui.kind === "ending") return "Ending…";
    if (ui.kind === "requesting_mic") return "Requesting mic…";
    if (ui.kind === "connecting") return "Connecting…";
    if (isLive) return isSpeaking ? "Agent speaking" : "Listening";
    return "Ready";
  })();

  return (
    <div className="sticky top-0 z-30 border-b border-border/70 bg-background/95 backdrop-blur">
      <div className="flex items-center gap-3 px-4 py-2.5 sm:px-6">
        <div
          className={cn(
            "inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em]",
            isLive
              ? "border-verified/40 bg-verified-soft text-verified"
              : ui.kind === "error"
                ? "border-risk/40 bg-risk-soft text-risk"
                : "border-border bg-card text-muted-foreground",
          )}
        >
          <span
            className={cn(
              "size-1.5 rounded-full",
              isLive
                ? "animate-pulse bg-verified"
                : ui.kind === "error"
                  ? "bg-risk"
                  : "bg-muted-foreground/50",
            )}
          />
          {isLive ? "Live" : ui.kind === "error" ? "Error" : "Ready"}
        </div>

        <div className="flex min-w-0 flex-1 items-center gap-2 text-sm">
          <Phone className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate font-medium">{providerName}</span>
          <span className="hidden text-muted-foreground sm:inline">·</span>
          <span className="hidden text-xs text-muted-foreground sm:inline">
            Rehearsal · Quote gathering
          </span>
        </div>

        <div className="hidden items-center gap-3 text-xs md:flex">
          <span className="inline-flex items-center gap-1 text-muted-foreground">
            <Clock className="size-3.5" />
            <span className="font-mono tabular-nums text-foreground">{fmtDuration(elapsed)}</span>
          </span>
          <ConnectionQualityDot
            state={
              ui.kind === "connecting"
                ? "connecting"
                : isLive
                  ? "good"
                  : ui.kind === "error"
                    ? "bad"
                    : "idle"
            }
          />
          <StatusBadge tone="verified">
            Spec v{specVersion} · {shortHash(specHash || "", 6)}
          </StatusBadge>
          <span className="text-xs text-muted-foreground">{stateLabel}</span>
          {isLive ? (
            <span
              className="inline-flex items-center gap-1.5 text-[10px] text-muted-foreground"
              title={`Input: ${micDeviceLabel}`}
              aria-label={`Microphone input level ${Math.round(micInputLevel * 100)} percent`}
            >
              <Mic className="size-3" />
              <span className="h-1.5 w-14 overflow-hidden rounded-full bg-muted">
                <span
                  className="block h-full rounded-full bg-verified transition-[width] duration-150"
                  style={{ width: `${Math.max(3, Math.round(micInputLevel * 100))}%` }}
                />
              </span>
            </span>
          ) : null}
        </div>

        <div className="flex items-center gap-1.5">
          {isActive ? (
            <>
              <Button
                size="sm"
                variant="outline"
                onClick={onToggleMute}
                disabled={!isLive}
                className="h-8"
              >
                {muted ? <MicOff className="size-3.5" /> : <Mic className="size-3.5" />}
              </Button>
              <Button
                size="sm"
                variant="destructive"
                onClick={onStop}
                disabled={ui.kind === "ending"}
                className="h-8"
              >
                <PhoneOff className="mr-1.5 size-3.5" />
                End
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              onClick={onStart}
              disabled={ui.kind === "requesting_mic"}
              className="h-8"
            >
              <PhoneCall className="mr-1.5 size-3.5" />
              Start rehearsal
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function ConnectionQualityDot({ state }: { state: "idle" | "connecting" | "good" | "bad" }) {
  const tone =
    state === "good"
      ? "bg-verified"
      : state === "bad"
        ? "bg-risk"
        : state === "connecting"
          ? "bg-warn"
          : "bg-muted-foreground/40";
  return (
    <span className="inline-flex items-center gap-1 text-muted-foreground">
      <Waves className="size-3.5" />
      <span className={cn("size-1.5 rounded-full", tone)} />
    </span>
  );
}

function RehearsalPill() {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-warn/40 bg-warn-soft px-2.5 py-1 text-[11px] font-semibold text-warn-foreground">
      <FlaskConical className="size-3" />
      Rehearsal — role-play, not a real provider
    </span>
  );
}

// ─── Left panel: call & provider context ────────────────────────────────────

function LeftPanel({
  provider,
  specVersion,
  specHash,
  callId,
  isLive,
  elapsed,
}: {
  provider: { name: string; phone: string | null; source: string | null; location: string | null };
  specVersion: number;
  specHash: string;
  callId: string | null;
  isLive: boolean;
  elapsed: number;
}) {
  const negotiation = useQuery({
    queryKey: ["cr-call", callId, "context"],
    enabled: !!callId,
    refetchInterval: isLive ? 4000 : false,
    queryFn: async () => {
      if (!callId) return null;
      const [{ data: call }, { data: ctxEv }, { data: specEv }] = await Promise.all([
        supabase
          .from("calls")
          .select("status, external_call_id, started_at, metadata")
          .eq("id", callId)
          .maybeSingle(),
        supabase
          .from("agent_events")
          .select("event_status")
          .eq("call_id", callId)
          .eq("event_type", "CONTEXT_LOADED")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from("agent_events")
          .select("event_status")
          .eq("call_id", callId)
          .eq("event_type", "SPEC_VERIFIED")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);
      return {
        call,
        contextLoaded: ctxEv?.event_status === "success",
        specVerified: specEv?.event_status === "success",
      };
    },
  });

  const source = provider.source ?? "unknown";
  const sourceTone: "verified" | "warn" | "neutral" =
    source === "carrier" ? "verified" : source === "broker" ? "warn" : "neutral";

  return (
    <div className="flex flex-col divide-y divide-border/60">
      <Section title="Provider" icon={Building2}>
        <div className="space-y-1.5 text-sm">
          <div className="font-medium">{provider.name}</div>
          {provider.phone && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Phone className="size-3" />
              <span className="font-mono">{provider.phone}</span>
            </div>
          )}
          {provider.location && (
            <div className="text-xs text-muted-foreground">{provider.location}</div>
          )}
          <div className="pt-1">
            <StatusBadge tone={sourceTone}>{source}</StatusBadge>
          </div>
        </div>
      </Section>

      <Section title="Call" icon={Radio}>
        <KeyRow
          label="Status"
          value={
            <StatusBadge tone={isLive ? "verified" : "neutral"}>
              {negotiation.data?.call?.status ?? (isLive ? "in_progress" : "not started")}
            </StatusBadge>
          }
        />
        <KeyRow
          label="Duration"
          value={<span className="font-mono">{fmtDuration(elapsed)}</span>}
        />
        {negotiation.data?.call?.external_call_id && (
          <KeyRow
            label="Conversation"
            value={
              <code className="text-[11px] font-mono text-muted-foreground">
                {negotiation.data.call.external_call_id.slice(0, 12)}…
              </code>
            }
          />
        )}
      </Section>

      <Section title="Confirmed specification" icon={ShieldCheck}>
        <KeyRow label="Version" value={<StatusBadge tone="verified">v{specVersion}</StatusBadge>} />
        <KeyRow
          label="Hash"
          value={
            <code className="text-[11px] font-mono text-muted-foreground">
              {shortHash(specHash || "", 12)}
            </code>
          }
        />
        <KeyRow
          label="Loaded to agent"
          value={
            callId ? (
              <StatusBadge tone={negotiation.data?.contextLoaded ? "verified" : "warn"}>
                {negotiation.data?.contextLoaded ? "Confirmed" : "Pending"}
              </StatusBadge>
            ) : (
              <span className="text-xs text-muted-foreground">—</span>
            )
          }
        />
        <KeyRow
          label="Hash verified"
          value={
            callId ? (
              <StatusBadge tone={negotiation.data?.specVerified ? "verified" : "warn"}>
                {negotiation.data?.specVerified ? "Match" : "Pending"}
              </StatusBadge>
            ) : (
              <span className="text-xs text-muted-foreground">—</span>
            )
          }
        />
      </Section>
    </div>
  );
}

function Section({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <div className="px-4 py-3 sm:px-5">
      <div className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        <Icon className="size-3" />
        {title}
      </div>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

function KeyRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className="min-w-0 truncate text-right text-foreground">{value}</span>
    </div>
  );
}

// ─── Center panel: live transcript + tool timeline ──────────────────────────

type TimelineItem =
  | { kind: "transcript"; row: TranscriptRow; at: string }
  | { kind: "tool"; row: AgentEventRow; at: string };

function CenterPanel({
  callId,
  isLive,
  isSpeaking,
  ui,
}: {
  callId: string | null;
  isLive: boolean;
  isSpeaking: boolean;
  ui: UiState;
}) {
  const [autoScroll, setAutoScroll] = useState(true);
  const [search, setSearch] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  const data = useQuery({
    queryKey: ["cr-timeline", callId],
    enabled: !!callId,
    refetchInterval: isLive ? 2500 : callId ? 6000 : false,
    queryFn: async () => {
      if (!callId) return { transcripts: [], events: [] };
      const [{ data: transcripts }, { data: events }] = await Promise.all([
        supabase
          .from("call_transcripts")
          .select("id, speaker, text, started_at_ms, sequence_number, created_at")
          .eq("call_id", callId)
          .order("sequence_number", { ascending: true }),
        supabase
          .from("agent_events")
          .select("id, event_type, event_status, summary, metadata, created_at")
          .eq("call_id", callId)
          .order("created_at", { ascending: true }),
      ]);
      return {
        transcripts: (transcripts ?? []) as TranscriptRow[],
        events: (events ?? []) as AgentEventRow[],
      };
    },
  });

  const items: TimelineItem[] = useMemo(() => {
    const list: TimelineItem[] = [];
    for (const row of data.data?.transcripts ?? []) {
      list.push({ kind: "transcript", row, at: row.created_at });
    }
    for (const row of data.data?.events ?? []) {
      // Only render meaningful tool/lifecycle events in the timeline.
      const t = row.event_type ?? "";
      if (
        t === "CONTEXT_LOADED" ||
        t === "SPEC_VERIFIED" ||
        t === "QUOTE_CAPTURED" ||
        t === "QUOTE_LINE_ITEM_SAVED" ||
        t === "CALL_FINALIZED" ||
        t === "call_started" ||
        t === "call_ended_client"
      ) {
        list.push({ kind: "tool", row, at: row.created_at });
      }
    }
    list.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
    return list;
  }, [data.data]);

  const filtered = useMemo(() => {
    if (!search.trim()) return items;
    const q = search.trim().toLowerCase();
    return items.filter((i) => {
      if (i.kind === "transcript") return i.row.text.toLowerCase().includes(q);
      return (
        (i.row.summary ?? "").toLowerCase().includes(q) ||
        (i.row.event_type ?? "").toLowerCase().includes(q)
      );
    });
  }, [items, search]);

  useEffect(() => {
    if (!autoScroll || !scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [filtered, autoScroll]);

  return (
    <div className="flex h-full flex-col">
      {/* Speaking indicator + waveform */}
      <div className="flex items-center justify-between gap-3 border-b border-border/70 bg-surface-2/50 px-4 py-2.5 sm:px-6">
        <div className="flex items-center gap-2 text-xs">
          <SpeakingIndicator isLive={isLive} isSpeaking={isSpeaking} />
        </div>
        <div className="flex items-center gap-2">
          {!isLive && callId && (
            <div className="relative">
              <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search transcript"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-8 w-48 pl-7 text-xs"
              />
            </div>
          )}
          <button
            onClick={() => setAutoScroll((v) => !v)}
            className={cn(
              "rounded-md border px-2 py-1 text-[11px] font-medium transition-colors",
              autoScroll
                ? "border-verified/40 bg-verified-soft text-verified"
                : "border-border bg-card text-muted-foreground hover:text-foreground",
            )}
          >
            {autoScroll ? "Auto-scroll on" : "Auto-scroll paused"}
          </button>
        </div>
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto px-4 py-4 sm:px-6">
        {!callId ? (
          <EmptyTranscript
            title="No live call yet"
            body="Start a rehearsal from the header. The agent's questions and the provider's answers stream in here in real time."
          />
        ) : filtered.length === 0 ? (
          <EmptyTranscript
            title={
              data.isLoading
                ? "Warming up…"
                : isLive
                  ? "Waiting for the first exchange"
                  : "Transcript is processing"
            }
            body={
              isLive
                ? "As soon as either side speaks, the words appear here with speaker labels and timestamps."
                : "Verified transcripts arrive after the ElevenLabs post-call webhook — usually within seconds of ending the call."
            }
          />
        ) : (
          <div className="space-y-3">
            {filtered.map((item, i) =>
              item.kind === "transcript" ? (
                <TranscriptBubble key={item.row.id} row={item.row} />
              ) : (
                <TimelineToolCard key={item.row.id} row={item.row} idx={i} />
              ),
            )}
            {ui.kind === "connecting" && (
              <div className="text-center text-xs text-muted-foreground">
                Connecting to voice service…
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function SpeakingIndicator({ isLive, isSpeaking }: { isLive: boolean; isSpeaking: boolean }) {
  if (!isLive) {
    return (
      <span className="inline-flex items-center gap-1.5 text-muted-foreground">
        <Activity className="size-3.5" />
        Idle
      </span>
    );
  }
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 rounded-full px-2.5 py-1 text-[11px] font-semibold",
        isSpeaking ? "bg-navy text-primary-foreground" : "bg-verified-soft text-verified",
      )}
    >
      <span className="flex items-end gap-0.5">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className={cn(
              "w-0.5 rounded-full",
              isSpeaking ? "animate-pulse bg-primary-foreground/80" : "bg-verified/80",
            )}
            style={{
              height: isSpeaking ? `${6 + ((i * 3) % 6)}px` : "4px",
              animationDelay: `${i * 120}ms`,
            }}
          />
        ))}
      </span>
      {isSpeaking ? "Agent speaking" : "Listening for provider"}
    </span>
  );
}

function TranscriptBubble({ row }: { row: TranscriptRow }) {
  const speakerMeta = {
    agent: { label: "BidPilot", tone: "bg-navy text-primary-foreground", align: "self-start" },
    user: { label: "You", tone: "bg-accent text-accent-foreground", align: "self-end" },
    provider: { label: "Provider", tone: "bg-card border border-border", align: "self-start" },
    system: { label: "System", tone: "bg-muted text-muted-foreground", align: "self-start" },
    tool: { label: "Tool", tone: "bg-muted text-muted-foreground", align: "self-start" },
  }[row.speaker];
  const timestamp =
    row.started_at_ms != null
      ? `${Math.floor(row.started_at_ms / 1000)}s`
      : fmtTime(row.created_at);

  return (
    <div
      className={cn(
        "flex flex-col gap-1",
        speakerMeta.align.includes("end") ? "items-end" : "items-start",
      )}
    >
      <div className="flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
        <span>{speakerMeta.label}</span>
        <span className="font-mono">{timestamp}</span>
      </div>
      <div
        className={cn("max-w-[85%] rounded-lg px-3 py-2 text-sm leading-relaxed", speakerMeta.tone)}
      >
        {row.text}
      </div>
    </div>
  );
}

function TimelineToolCard({ row, idx }: { row: AgentEventRow; idx: number }) {
  const [open, setOpen] = useState(false);
  const success = row.event_status === "success";
  const t = row.event_type ?? "event";
  const meta = row.metadata ?? {};
  const readable = safeReadableResult(t, meta);

  return (
    <div className="rounded-lg border border-border/70 bg-surface-2/60">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
      >
        <span
          className={cn(
            "flex size-6 shrink-0 items-center justify-center rounded-md",
            success ? "bg-verified-soft text-verified" : "bg-warn-soft text-warn-foreground",
          )}
        >
          {success ? <CheckCircle2 className="size-3.5" /> : <AlertTriangle className="size-3.5" />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-xs font-medium">{humanizeToolName(t)}</div>
          {readable && !open && (
            <div className="truncate text-[11px] text-muted-foreground">{readable}</div>
          )}
        </div>
        <span className="font-mono text-[10px] text-muted-foreground">#{idx + 1}</span>
        <span className="text-[10px] text-muted-foreground">{fmtTime(row.created_at)}</span>
        <ChevronDown
          className={cn(
            "size-3.5 text-muted-foreground transition-transform",
            open && "rotate-180",
          )}
        />
      </button>
      {open && (
        <div className="border-t border-border/60 bg-background px-3 py-2 text-[11px] text-muted-foreground">
          {row.summary && <div className="mb-1 text-foreground">{row.summary}</div>}
          {readable && <div>{readable}</div>}
          {!readable && !row.summary && <div>No additional detail.</div>}
        </div>
      )}
    </div>
  );
}

/** Render only whitelisted metadata fields. Never surface tokens/hashes/payloads. */
function safeReadableResult(eventType: string, meta: Record<string, unknown>): string | null {
  const parts: string[] = [];
  const num = (k: string) => (typeof meta[k] === "number" ? (meta[k] as number) : null);
  const bool = (k: string) => (typeof meta[k] === "boolean" ? (meta[k] as boolean) : null);
  const str = (k: string) => (typeof meta[k] === "string" ? (meta[k] as string) : null);

  if (eventType === "QUOTE_CAPTURED") {
    const stage = str("quote_stage");
    const total = num("total_amount");
    if (stage) parts.push(stage);
    if (total != null) parts.push(fmtMoney(total, str("currency") ?? "USD"));
  } else if (eventType === "QUOTE_LINE_ITEM_SAVED") {
    const label = str("label");
    const amt = num("amount");
    if (label) parts.push(label);
    if (amt != null) parts.push(fmtMoney(amt));
  } else if (eventType === "CALL_FINALIZED") {
    const rf = num("red_flags_count");
    const co = num("provider_commitments_count");
    const uq = num("unresolved_questions_count");
    if (rf != null) parts.push(`${rf} red flag${rf === 1 ? "" : "s"}`);
    if (co != null) parts.push(`${co} commitment${co === 1 ? "" : "s"}`);
    if (uq != null) parts.push(`${uq} unresolved`);
  } else if (eventType === "CONTEXT_LOADED") {
    const v = num("confirmed_spec_version");
    if (v != null) parts.push(`Spec v${v}`);
  } else if (eventType === "SPEC_VERIFIED") {
    const match = bool("hash_match");
    if (match != null) parts.push(match ? "Hash match" : "Hash mismatch");
  }
  return parts.length ? parts.join(" · ") : null;
}

function EmptyTranscript({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex h-full min-h-[280px] flex-col items-center justify-center text-center">
      <div className="flex size-11 items-center justify-center rounded-lg bg-muted text-muted-foreground">
        <MessageSquare className="size-5" />
      </div>
      <h3 className="mt-3 text-sm font-semibold">{title}</h3>
      <p className="mt-1 max-w-md text-xs text-muted-foreground">{body}</p>
    </div>
  );
}

// ─── Right panel: intelligence tabs ─────────────────────────────────────────

function RightPanel({ negotiationId, callId }: { negotiationId: string; callId: string | null }) {
  const [tab, setTab] = useState<RightTab>("quote");

  const intel = useQuery({
    queryKey: ["cr-intel", negotiationId, callId],
    refetchInterval: 4000,
    queryFn: async () => {
      const [{ data: quotes }, { data: call }, { data: finalizeEvents }] = await Promise.all([
        supabase
          .from("quotes")
          .select(
            "id, quote_stage, currency, total_amount, low_amount, high_amount, estimate_type, valid_until, deposit_amount, deposit_refundable, terms, included_services, excluded_services, price_change_conditions, captured_at, verification_status",
          )
          .eq("negotiation_id", negotiationId)
          .order("captured_at", { ascending: false })
          .limit(20),
        callId
          ? supabase
              .from("calls")
              .select(
                "id, status, external_call_id, started_at, ended_at, webhook_received_at, final_outcome, outcome_finalized_at, verified_savings_amount, verified_price_changed, verified_terms_changed, needs_review, reconciled_at, failure_reason, metadata",
              )
              .eq("id", callId)
              .maybeSingle()
          : Promise.resolve({ data: null }),
        callId
          ? supabase
              .from("agent_events")
              .select("id, metadata, created_at")
              .eq("call_id", callId)
              .eq("event_type", "CALL_FINALIZED")
              .order("created_at", { ascending: false })
              .limit(1)
          : Promise.resolve({
              data: [] as Array<{
                id: string;
                metadata: Record<string, unknown>;
                created_at: string;
              }>,
            }),
      ]);
      const quotesTyped = (quotes ?? []) as QuoteRow[];
      let lineItems: LineItemRow[] = [];
      let evidence: EvidenceRow[] = [];
      const latestQuote = quotesTyped[0];
      if (latestQuote) {
        const [{ data: items }, { data: ev }] = await Promise.all([
          supabase
            .from("quote_line_items")
            .select(
              "id, category, label, amount, currency, included, conditional, condition_text, provider_words",
            )
            .eq("quote_id", latestQuote.id)
            .order("created_at", { ascending: true }),
          supabase
            .from("quote_evidence")
            .select(
              "id, evidence_type, support_status, extracted_text, quote_line_item_id, timestamp_ms",
            )
            .eq("quote_id", latestQuote.id),
        ]);
        lineItems = (items ?? []) as LineItemRow[];
        evidence = (ev ?? []) as EvidenceRow[];
      }
      const finalizeEvent =
        ((finalizeEvents ?? []) as Array<{ metadata: Record<string, unknown> }>)[0] ?? null;
      return {
        quotes: quotesTyped,
        latestQuote: latestQuote ?? null,
        lineItems,
        evidence,
        call: (call as CallRow | null) ?? null,
        finalizeEvent,
      };
    },
  });

  const tabs: Array<{
    id: RightTab;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
  }> = [
    { id: "quote", label: "Quote", icon: DollarSign },
    { id: "progress", label: "Progress", icon: ClipboardList },
    { id: "evidence", label: "Evidence", icon: FileText },
    { id: "risk", label: "Risk", icon: ShieldAlert },
    { id: "outcome", label: "Outcome", icon: BadgeCheck },
  ];

  return (
    <div className="flex h-full flex-col">
      <div className="flex overflow-x-auto border-b border-border/70">
        {tabs.map((t) => {
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                "flex flex-1 items-center justify-center gap-1 whitespace-nowrap border-b-2 px-1.5 py-2.5 text-[11px] font-semibold uppercase tracking-[0.06em] transition-colors",
                active
                  ? "border-navy text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              <t.icon className="size-3 shrink-0" />
              <span className="truncate">{t.label}</span>
            </button>
          );
        })}
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-4 py-4">
        {tab === "quote" && (
          <QuoteCaptureTab
            quotes={intel.data?.quotes ?? []}
            latest={intel.data?.latestQuote ?? null}
            lineItems={intel.data?.lineItems ?? []}
            evidence={intel.data?.evidence ?? []}
          />
        )}
        {tab === "progress" && (
          <ProgressTab quotes={intel.data?.quotes ?? []} call={intel.data?.call ?? null} />
        )}
        {tab === "evidence" && (
          <EvidenceTab
            evidence={intel.data?.evidence ?? []}
            lineItems={intel.data?.lineItems ?? []}
          />
        )}
        {tab === "risk" && (
          <RiskTab
            latest={intel.data?.latestQuote ?? null}
            lineItems={intel.data?.lineItems ?? []}
            evidence={intel.data?.evidence ?? []}
            call={intel.data?.call ?? null}
          />
        )}
        {tab === "outcome" && (
          <OutcomeTab
            call={intel.data?.call ?? null}
            quotes={intel.data?.quotes ?? []}
            finalizeEvent={intel.data?.finalizeEvent ?? null}
          />
        )}
      </div>
    </div>
  );
}

// ─── Quote capture ──────────────────────────────────────────────────────────

function QuoteCaptureTab({
  quotes,
  latest,
  lineItems,
  evidence,
}: {
  quotes: QuoteRow[];
  latest: QuoteRow | null;
  lineItems: LineItemRow[];
  evidence: EvidenceRow[];
}) {
  if (!latest) {
    return (
      <IntelEmpty
        icon={DollarSign}
        title="No quote captured yet"
        body="Once the provider states a price, the agent calls save_quote_snapshot and the itemized quote appears here."
      />
    );
  }
  const stageTone: "verified" | "warn" | "neutral" =
    latest.quote_stage === "FINAL"
      ? "verified"
      : latest.quote_stage === "REVISED"
        ? "warn"
        : "neutral";

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <StatusBadge tone={stageTone}>
          {latest.quote_stage.toLowerCase()} quote · {quotes.length} snapshot
          {quotes.length === 1 ? "" : "s"}
        </StatusBadge>

        <StatusBadge tone={latest.verification_status === "verified" ? "verified" : "warn"}>
          {latest.verification_status}
        </StatusBadge>
      </div>

      <div className="rounded-lg border border-border/70 bg-card p-3">
        <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Total
        </div>
        <div className="mt-1 text-2xl font-semibold tabular-nums">
          {fmtMoney(latest.total_amount, latest.currency)}
        </div>
        {latest.low_amount != null && latest.high_amount != null && (
          <div className="mt-0.5 text-xs text-muted-foreground">
            Range {fmtMoney(latest.low_amount, latest.currency)} –{" "}
            {fmtMoney(latest.high_amount, latest.currency)}
          </div>
        )}
        <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
          {latest.estimate_type && <StatusBadge tone="neutral">{latest.estimate_type}</StatusBadge>}
          <StatusBadge tone="neutral">{latest.currency}</StatusBadge>
          {latest.valid_until && (
            <StatusBadge tone="neutral">Valid until {latest.valid_until}</StatusBadge>
          )}
        </div>
      </div>

      <QuoteField
        label="Deposit"
        value={fmtMoney(latest.deposit_amount, latest.currency)}
        badge={
          latest.deposit_amount != null
            ? latest.deposit_refundable === true
              ? { text: "Refundable", tone: "verified" }
              : latest.deposit_refundable === false
                ? { text: "Non-refundable", tone: "warn" }
                : null
            : null
        }
        supportFromEvidence={evidence.find((e) => e.evidence_type === "term")}
      />
      <QuoteField
        label="Cancellation / terms"
        value={latest.terms ?? "—"}
        supportFromEvidence={evidence.find((e) => e.evidence_type === "term")}
      />
      <QuoteField
        label="Price change conditions"
        value={latest.price_change_conditions ?? "None stated"}
        supportFromEvidence={evidence.find((e) => e.evidence_type === "condition")}
      />

      <div>
        <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Line items ({lineItems.length})
        </div>
        {lineItems.length === 0 ? (
          <div className="rounded-md border border-dashed border-border bg-surface-2/40 px-3 py-3 text-xs text-muted-foreground">
            No itemization captured yet.
          </div>
        ) : (
          <div className="space-y-1">
            {lineItems.map((li) => {
              const ev = evidence.find((e) => e.quote_line_item_id === li.id);
              return (
                <div
                  key={li.id}
                  className="flex items-start justify-between gap-2 rounded-md border border-border/60 bg-card px-2.5 py-2 text-xs"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="font-medium">{li.label}</span>
                      {li.conditional && <StatusBadge tone="warn">conditional</StatusBadge>}
                      {!li.included && <StatusBadge tone="risk">excluded</StatusBadge>}
                    </div>
                    <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      {li.category}
                    </div>
                    {li.condition_text && (
                      <div className="mt-0.5 text-[11px] italic text-muted-foreground">
                        “{li.condition_text}”
                      </div>
                    )}
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="font-mono tabular-nums">{fmtMoney(li.amount, li.currency)}</div>
                    <EvidenceDot status={ev?.support_status ?? "missing_evidence"} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {(latest.included_services?.length ?? 0) > 0 && (
        <ChipList
          label="Included services"
          items={latest.included_services as string[]}
          tone="verified"
        />
      )}
      {(latest.excluded_services?.length ?? 0) > 0 && (
        <ChipList
          label="Excluded services"
          items={latest.excluded_services as string[]}
          tone="warn"
        />
      )}
    </div>
  );
}

function QuoteField({
  label,
  value,
  badge,
  supportFromEvidence,
}: {
  label: string;
  value: React.ReactNode;
  badge?: { text: string; tone: "verified" | "warn" | "risk" | "neutral" } | null;
  supportFromEvidence?: EvidenceRow;
}) {
  return (
    <div className="rounded-md border border-border/60 bg-card px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          {label}
        </div>
        <EvidenceDot status={supportFromEvidence?.support_status ?? "missing_evidence"} />
      </div>
      <div className="mt-0.5 flex items-center gap-2 text-sm">
        <span className="min-w-0 truncate">{value}</span>
        {badge && <StatusBadge tone={badge.tone}>{badge.text}</StatusBadge>}
      </div>
    </div>
  );
}

function EvidenceDot({
  status,
}: {
  status: "supported" | "unsupported" | "contradictory" | "missing_evidence";
}) {
  const map = {
    supported: { tone: "verified" as const, label: "Supported" },
    unsupported: { tone: "warn" as const, label: "Unverified" },
    contradictory: { tone: "risk" as const, label: "Contradictory" },
    missing_evidence: { tone: "neutral" as const, label: "Missing evidence" },
  };
  const m = map[status];
  return <StatusBadge tone={m.tone}>{m.label}</StatusBadge>;
}

function ChipList({
  label,
  items,
  tone,
}: {
  label: string;
  items: string[];
  tone: "verified" | "warn" | "neutral";
}) {
  return (
    <div>
      <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </div>
      <div className="flex flex-wrap gap-1">
        {items.map((s, i) => (
          <StatusBadge key={i} tone={tone}>
            {String(s)}
          </StatusBadge>
        ))}
      </div>
    </div>
  );
}

// ─── Progress / Timeline ────────────────────────────────────────────────────

function ProgressTab({ quotes, call }: { quotes: QuoteRow[]; call: CallRow | null }) {
  // Derive events strictly from real records.
  const events: Array<{ label: string; at: string; tone: "verified" | "warn" | "neutral" }> = [];
  const sortedQuotes = [...quotes].sort(
    (a, b) => new Date(a.captured_at).getTime() - new Date(b.captured_at).getTime(),
  );
  const initial = sortedQuotes[0];
  const revised = sortedQuotes.find((q) => q.quote_stage === "REVISED");
  const final = sortedQuotes.find((q) => q.quote_stage === "FINAL");

  if (initial)
    events.push({ label: "Initial quote captured", at: initial.captured_at, tone: "neutral" });
  if (revised)
    events.push({ label: "Revised quote captured", at: revised.captured_at, tone: "warn" });
  if (final)
    events.push({ label: "Final quote confirmed", at: final.captured_at, tone: "verified" });
  if (call?.reconciled_at)
    events.push({ label: "Transcript reconciled", at: call.reconciled_at, tone: "verified" });
  if (call?.outcome_finalized_at)
    events.push({ label: "Outcome finalized", at: call.outcome_finalized_at, tone: "verified" });

  if (events.length === 0) {
    return (
      <IntelEmpty
        icon={ClipboardList}
        title="Negotiation hasn't started"
        body="Real events appear here as the agent captures a quote, uses leverage, and finalizes an outcome."
      />
    );
  }

  return (
    <ol className="relative ml-2 space-y-4 border-l border-border/60 pl-4">
      {events.map((e, i) => (
        <li key={i} className="relative">
          <span
            className={cn(
              "absolute -left-[21px] top-1 size-2.5 rounded-full ring-4 ring-background",
              e.tone === "verified"
                ? "bg-verified"
                : e.tone === "warn"
                  ? "bg-warn"
                  : "bg-muted-foreground/60",
            )}
          />
          <div className="text-sm font-medium">{e.label}</div>
          <div className="text-[11px] text-muted-foreground">{new Date(e.at).toLocaleString()}</div>
        </li>
      ))}
    </ol>
  );
}

// ─── Evidence ───────────────────────────────────────────────────────────────

function EvidenceTab({
  evidence,
  lineItems,
}: {
  evidence: EvidenceRow[];
  lineItems: LineItemRow[];
}) {
  if (evidence.length === 0) {
    return (
      <IntelEmpty
        icon={FileText}
        title="No evidence linked yet"
        body="After the post-call webhook reconciles the transcript, each quoted field is linked to the exact provider utterance that supports it."
      />
    );
  }
  return (
    <div className="space-y-2">
      {evidence.map((e) => {
        const linked = lineItems.find((l) => l.id === e.quote_line_item_id);
        return (
          <div key={e.id} className="rounded-md border border-border/60 bg-card p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                {e.evidence_type}
                {linked && <span className="ml-1.5 text-foreground">· {linked.label}</span>}
              </div>
              <EvidenceDot status={e.support_status} />
            </div>
            {e.extracted_text && (
              <blockquote className="mt-1.5 border-l-2 border-border pl-2 text-xs italic text-muted-foreground">
                “{e.extracted_text}”
              </blockquote>
            )}
            {e.timestamp_ms != null && (
              <div className="mt-1 font-mono text-[10px] text-muted-foreground">
                @ {Math.floor(e.timestamp_ms / 1000)}s
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Risk detection ─────────────────────────────────────────────────────────

function RiskTab({
  latest,
  lineItems,
  evidence,
  call,
}: {
  latest: QuoteRow | null;
  lineItems: LineItemRow[];
  evidence: EvidenceRow[];
  call: CallRow | null;
}) {
  const risks: Array<{
    key: string;
    label: string;
    tone: "warn" | "risk";
    detail: string;
  }> = [];

  if (latest) {
    if (latest.estimate_type === "non_binding" || latest.estimate_type === null) {
      risks.push({
        key: "non_binding",
        label: "Non-binding estimate",
        tone: "warn",
        detail:
          "The provider hasn't committed to a binding total. Actual charges may exceed this quote.",
      });
    }
    if (lineItems.length === 0 && latest.total_amount != null) {
      risks.push({
        key: "missing_items",
        label: "Missing itemization",
        tone: "warn",
        detail:
          "A total was quoted but no line items were captured. Ask for a written itemized breakdown.",
      });
    }
    if (latest.deposit_amount != null && latest.total_amount != null) {
      const ratio = latest.deposit_amount / (latest.total_amount || 1);
      if (ratio > 0.25) {
        risks.push({
          key: "high_deposit",
          label: "High deposit",
          tone: "warn",
          detail: `Deposit is ${(ratio * 100).toFixed(0)}% of the total.`,
        });
      }
      if (latest.deposit_refundable === false) {
        risks.push({
          key: "non_refundable",
          label: "Non-refundable deposit",
          tone: "risk",
          detail:
            "Provider has said the deposit is non-refundable. Cancellation risk sits with the customer.",
        });
      }
    }
    if (latest.price_change_conditions) {
      risks.push({
        key: "hidden_fees",
        label: "Hidden-fee condition",
        tone: "warn",
        detail: latest.price_change_conditions,
      });
    }
  }
  if (evidence.some((e) => e.support_status === "contradictory")) {
    risks.push({
      key: "contradictory",
      label: "Contradictory amount",
      tone: "risk",
      detail: "At least one captured field contradicts what the provider said in the transcript.",
    });
  }
  if (evidence.some((e) => e.support_status === "missing_evidence")) {
    risks.push({
      key: "missing_evidence",
      label: "Missing written estimate",
      tone: "warn",
      detail:
        "Some captured quote fields have no supporting transcript passage. Request a written estimate.",
    });
  }
  if (call?.needs_review) {
    risks.push({
      key: "needs_review",
      label: "Transcript mismatch — needs review",
      tone: "risk",
      detail: "Reconciliation flagged this call for human review.",
    });
  }

  if (risks.length === 0) {
    return (
      <IntelEmpty
        icon={ShieldCheck}
        title="No red flags detected"
        body="Risks are computed from the real quote, line items, evidence links, and reconciliation results."
      />
    );
  }

  return (
    <div className="space-y-2">
      {risks.map((r) => (
        <RiskCard key={r.key} label={r.label} tone={r.tone} detail={r.detail} />
      ))}
    </div>
  );
}

function RiskCard({
  label,
  tone,
  detail,
}: {
  label: string;
  tone: "warn" | "risk";
  detail: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div
      className={cn(
        "rounded-md border",
        tone === "risk" ? "border-risk/40 bg-risk-soft/50" : "border-warn/40 bg-warn-soft/60",
      )}
    >
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left"
      >
        <div className="flex items-center gap-2 text-xs font-medium">
          {tone === "risk" ? (
            <XCircle className="size-3.5 text-risk" />
          ) : (
            <AlertTriangle className="size-3.5 text-warn-foreground" />
          )}
          {label}
        </div>
        <ChevronDown
          className={cn(
            "size-3.5 text-muted-foreground transition-transform",
            open && "rotate-180",
          )}
        />
      </button>
      {open && (
        <div className="border-t border-border/60 bg-background/60 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
          {detail}
        </div>
      )}
    </div>
  );
}

// ─── Outcome ────────────────────────────────────────────────────────────────

function OutcomeTab({
  call,
  quotes,
  finalizeEvent,
}: {
  call: CallRow | null;
  quotes: QuoteRow[];
  finalizeEvent: { metadata: Record<string, unknown> } | null;
}) {
  if (!call?.outcome_finalized_at && !call?.webhook_received_at) {
    return (
      <IntelEmpty
        icon={BadgeCheck}
        title="Outcome not finalized"
        body="After the ElevenLabs webhook lands, BidPilot reconciles the transcript and finalizes the outcome. Verified savings show here."
      />
    );
  }
  const initial = [...quotes].reverse()[0]?.total_amount ?? null;
  const finalAmt =
    quotes.find((q) => q.quote_stage === "FINAL")?.total_amount ?? quotes[0]?.total_amount ?? null;

  const meta = finalizeEvent?.metadata ?? {};
  const asStrList = (v: unknown): string[] =>
    Array.isArray(v)
      ? v.filter((x): x is string => typeof x === "string" && x.trim().length > 0)
      : [];
  const commitments = asStrList(meta["provider_commitments"]);
  const unresolved = asStrList(meta["unresolved_questions"]);
  const redFlags = asStrList(meta["red_flags"]);
  const changedTerms = asStrList(meta["changed_terms"]);
  const summary = typeof meta["summary"] === "string" ? (meta["summary"] as string) : null;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <MetricBox
          label="Outcome"
          value={call.final_outcome ?? "—"}
          tone={call.needs_review ? "warn" : "verified"}
        />
        <MetricBox
          label="Verified savings"
          value={fmtMoney(call.verified_savings_amount)}
          tone={(call.verified_savings_amount ?? 0) > 0 ? "verified" : "neutral"}
        />
        <MetricBox label="Initial amount" value={fmtMoney(initial)} tone="neutral" />
        <MetricBox label="Final amount" value={fmtMoney(finalAmt)} tone="neutral" />
      </div>

      <div className="flex flex-wrap gap-1.5">
        <StatusBadge tone={call.verified_price_changed ? "verified" : "neutral"}>
          Price {call.verified_price_changed ? "changed" : "unchanged"}
        </StatusBadge>
        <StatusBadge tone={call.verified_terms_changed ? "verified" : "neutral"}>
          Terms {call.verified_terms_changed ? "changed" : "unchanged"}
        </StatusBadge>
        <StatusBadge tone={call.webhook_received_at ? "verified" : "warn"}>
          {call.webhook_received_at ? "Webhook received" : "Webhook pending"}
        </StatusBadge>
        <StatusBadge tone={call.reconciled_at ? "verified" : "warn"}>
          {call.reconciled_at ? "Reconciled" : "Reconciliation pending"}
        </StatusBadge>
        {call.needs_review && <StatusBadge tone="risk">Needs review</StatusBadge>}
      </div>

      {summary && (
        <div className="rounded-md border border-border/60 bg-card p-3 text-xs leading-relaxed text-muted-foreground">
          {summary}
        </div>
      )}

      {commitments.length > 0 && (
        <ListBlock
          label="Provider commitments"
          items={commitments}
          icon={BadgeCheck}
          tone="verified"
        />
      )}
      {changedTerms.length > 0 && (
        <ListBlock label="Changed terms" items={changedTerms} icon={ArrowRight} tone="verified" />
      )}
      {unresolved.length > 0 && (
        <ListBlock
          label="Unresolved questions"
          items={unresolved}
          icon={ClipboardList}
          tone="warn"
        />
      )}
      {redFlags.length > 0 && (
        <ListBlock label="Red flags" items={redFlags} icon={ShieldAlert} tone="risk" />
      )}

      {commitments.length + unresolved.length + redFlags.length + changedTerms.length === 0 && (
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          The agent reported no commitments, unresolved questions, red flags, or changed terms for
          this call.
        </p>
      )}
    </div>
  );
}

function MetricBox({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "verified" | "warn" | "neutral";
}) {
  const color =
    tone === "verified"
      ? "text-verified"
      : tone === "warn"
        ? "text-warn-foreground"
        : "text-foreground";
  return (
    <div className="rounded-md border border-border/60 bg-card px-3 py-2">
      <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </div>
      <div className={cn("mt-0.5 text-lg font-semibold tabular-nums", color)}>{value}</div>
    </div>
  );
}

function ListBlock({
  label,
  items,
  icon: Icon,
  tone,
}: {
  label: string;
  items: string[];
  icon: React.ComponentType<{ className?: string }>;
  tone: "verified" | "warn" | "risk";
}) {
  const color =
    tone === "verified" ? "text-verified" : tone === "warn" ? "text-warn-foreground" : "text-risk";
  return (
    <div>
      <div className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        <Icon className={cn("size-3", color)} />
        {label}
      </div>
      <ul className="space-y-1 text-xs">
        {items.map((s, i) => (
          <li key={i} className="flex items-start gap-1.5">
            <ArrowRight className="mt-0.5 size-3 text-muted-foreground" />
            <span>{String(s)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function IntelEmpty({
  icon: Icon,
  title,
  body,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  body: string;
}) {
  return (
    <div className="flex h-full min-h-[240px] flex-col items-center justify-center text-center">
      <div className="flex size-10 items-center justify-center rounded-lg bg-muted text-muted-foreground">
        <Icon className="size-4" />
      </div>
      <h3 className="mt-3 text-sm font-semibold">{title}</h3>
      <p className="mt-1 max-w-xs text-xs text-muted-foreground">{body}</p>
    </div>
  );
}

// ─── Failure banner ─────────────────────────────────────────────────────────

function FailureBanner({
  code,
  detail,
  onDismiss,
}: {
  code: FriendlyErrorCode;
  detail?: string;
  onDismiss: () => void;
}) {
  return (
    <div className="border-b border-risk/30 bg-risk-soft/60 px-4 py-2.5 sm:px-6">
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-risk" />
        <div className="flex-1">
          <div className="text-sm font-semibold text-navy">{errorTitle(code)}</div>
          <div className="text-xs text-muted-foreground">{friendlyErrorMessage(code)}</div>
        </div>
        <Button size="sm" variant="ghost" onClick={onDismiss} className="h-7">
          Dismiss
        </Button>
      </div>
    </div>
  );
}

function errorTitle(code: FriendlyErrorCode) {
  switch (code) {
    case "mic_denied":
      return "Microphone access denied";
    case "elevenlabs_failed":
      return "Voice service unreachable";
    case "context_load_failed":
      return "Context failed to load";
    case "invalid_spec":
      return "Specification unavailable";
    case "token_expired":
      return "Session expired";
    case "rate_limited":
      return "Rate limited";
    default:
      return "Something didn't work";
  }
}
