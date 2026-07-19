import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useConversation } from "@elevenlabs/react";
import {
  AlertTriangle,
  Info,
  Loader2,
  Lock,
  Mic,
  MicOff,
  PhoneCall,
  PhoneOff,
  Radio,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import {
  attachConversationId,
  endProviderRehearsal,
  REHEARSAL_STYLES,
  startProviderRehearsal,
  type CallMode,
  type RehearsalStyle,
} from "@/lib/elevenlabs.functions";
import { shortHash } from "@/lib/job-spec-canonical";

const REHEARSAL_STYLE_META: Record<
  RehearsalStyle,
  { label: string; description: string }
> = {
  flexible: {
    label: "Flexible",
    description: "Itemised quote up front; may lower price with verified leverage.",
  },
  stonewaller: {
    label: "Stonewaller",
    description: "Refuses to quote on the call; vague answers, pushes for callback.",
  },
  upseller: {
    label: "Upseller / hidden fees",
    description: "Low base quote, then reveals stair, packing, deposit and other fees.",
  },
};

type UiState =
  | { kind: "idle" }
  | { kind: "requesting_mic" }
  | { kind: "connecting" }
  | { kind: "connected" }
  | { kind: "ending" }
  | { kind: "error"; message: string };

type EventLine = { at: number; kind: string; detail?: string };

export function ProviderRehearsalPanel({ negotiationId }: { negotiationId: string }) {
  const gate = useQuery({
    queryKey: ["provider-rehearsal-gate", negotiationId],
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
          .select("id, name")
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
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Provider call rehearsal</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          <Loader2 className="mr-2 inline size-4 animate-spin" /> Checking readiness…
        </CardContent>
      </Card>
    );
  }

  const latestSpec = gate.data?.latestSpec;
  const providers = gate.data?.providers ?? [];

  if (!latestSpec) {
    return (
      <LockedCard
        title="Confirm the specification first"
        body="A hash-locked JobSpec is required before you can rehearse a provider call. Confirm the spec, then return here."
      />
    );
  }
  if (providers.length === 0) {
    return (
      <LockedCard
        title="Add a provider first"
        body="Add at least one provider to this negotiation so the rehearsal has a target."
      />
    );
  }

  return (
    <RehearsalRunner
      negotiationId={negotiationId}
      providers={providers}
      specVersion={latestSpec.version}
      specHash={latestSpec.specification_hash ?? ""}
    />
  );
}

function LockedCard({ title, body }: { title: string; body: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Lock className="size-4 text-muted-foreground" />
          Provider call rehearsal
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm text-muted-foreground">
        <p className="font-medium text-foreground">{title}</p>
        <p>{body}</p>
      </CardContent>
    </Card>
  );
}

function RehearsalRunner({
  negotiationId,
  providers,
  specVersion,
  specHash,
}: {
  negotiationId: string;
  providers: Array<{ id: string; name: string }>;
  specVersion: number;
  specHash: string;
}) {
  const queryClient = useQueryClient();
  const startFn = useServerFn(startProviderRehearsal);
  const attachFn = useServerFn(attachConversationId);
  const endFn = useServerFn(endProviderRehearsal);

  const [providerId, setProviderId] = useState<string>(providers[0].id);
  const [rehearsalStyle, setRehearsalStyle] = useState<RehearsalStyle | "none">("none");
  const [callMode, setCallMode] = useState<CallMode>("QUOTE_GATHERING");
  const [leverageQuoteId, setLeverageQuoteId] = useState<string>("");
  const [ui, setUi] = useState<UiState>({ kind: "idle" });
  const [events, setEvents] = useState<EventLine[]>([]);
  const [callId, setCallId] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [dynamicContextReady, setDynamicContextReady] = useState(false);
  const startedAtRef = useRef<number | null>(null);
  const callIdRef = useRef<string | null>(null);
  const micDeviceIdRef = useRef<string | null>(null);

  // Verified quotes eligible as leverage: any quote saved against the current
  // confirmed spec, from a provider OTHER than the one being called.
  const leverageOptions = useQuery({
    enabled: callMode === "NEGOTIATION",
    queryKey: ["leverage-quotes", negotiationId, providerId, specHash],
    queryFn: async () => {
      const { data } = await supabase
        .from("quotes")
        .select(
          "id, total_amount, currency, quote_stage, captured_at, spec_hash, provider_id, providers(name)",
        )
        .eq("negotiation_id", negotiationId)
        .eq("spec_hash", specHash)
        .neq("provider_id", providerId)
        .order("captured_at", { ascending: false });
      return (data ?? []) as Array<{
        id: string;
        total_amount: number | null;
        currency: string;
        quote_stage: string;
        captured_at: string;
        provider_id: string;
        providers: { name: string } | null;
      }>;
    },
  });

  const pushEvent = useCallback((kind: string, detail?: string) => {
    setEvents((prev) => [...prev.slice(-49), { at: Date.now(), kind, detail }]);
  }, []);

  // Poll the call + related agent_events to surface tool-load and webhook state.
  const callStatus = useQuery({
    enabled: !!callId,
    refetchInterval: 3000,
    queryKey: ["call-status", callId],
    queryFn: async () => {
      if (!callId) return null;
      const [{ data: call }, { data: evs }, { data: finEv }, { data: transcripts }] =
        await Promise.all([
          supabase
            .from("calls")
            .select(
              "id, status, webhook_received_at, external_call_id, final_outcome, verified_savings_amount, verified_price_changed, verified_terms_changed, needs_review, reconciled_at",
            )
            .eq("id", callId)
            .maybeSingle(),
          supabase
            .from("agent_events")
            .select("event_type, event_status, created_at")
            .eq("call_id", callId)
            .in("event_type", ["CONTEXT_LOADED", "SPEC_VERIFIED"])
            .order("created_at", { ascending: false })
            .limit(10),
          supabase
            .from("agent_events")
            .select("metadata, created_at")
            .eq("call_id", callId)
            .eq("event_type", "CALL_FINALIZED")
            .order("created_at", { ascending: false })
            .limit(1),
          supabase
            .from("call_transcripts")
            .select("id", { count: "exact", head: true })
            .eq("call_id", callId),
        ]);
      const contextLoaded = evs?.find((e) => e.event_type === "CONTEXT_LOADED");
      const specVerified = evs?.find((e) => e.event_type === "SPEC_VERIFIED");
      const finMeta = (finEv?.[0]?.metadata ?? null) as {
        red_flags_count?: number;
        provider_commitments_count?: number;
        unresolved_questions_count?: number;
        validation?: { contradictions?: number };
      } | null;
      return {
        webhookReceivedAt: call?.webhook_received_at ?? null,
        externalCallId: call?.external_call_id ?? null,
        callStatus: call?.status ?? null,
        finalOutcome: call?.final_outcome ?? null,
        verifiedSavings: call?.verified_savings_amount ?? null,
        verifiedPriceChanged: call?.verified_price_changed ?? null,
        verifiedTermsChanged: call?.verified_terms_changed ?? null,
        needsReview: call?.needs_review ?? false,
        reconciledAt: call?.reconciled_at ?? null,
        redFlags: finMeta?.red_flags_count ?? 0,
        commitments: finMeta?.provider_commitments_count ?? 0,
        unresolved: finMeta?.unresolved_questions_count ?? 0,
        contradictions: finMeta?.validation?.contradictions ?? 0,
        transcriptCount:
          (transcripts as unknown as { count?: number } | null)?.count ?? 0,
        contextTool: contextLoaded
          ? contextLoaded.event_status === "success"
            ? "success"
            : "failure"
          : ("pending" as const),
        specVerified: specVerified
          ? specVerified.event_status === "success"
            ? "success"
            : "failure"
          : ("pending" as const),
      };
    },
  });

  const conversation = useConversation({
    onConnect: (payload: unknown) => {
      const id =
        (payload as { conversationId?: string; id?: string })?.conversationId ??
        (payload as { id?: string })?.id ??
        null;
      pushEvent("connected", id ?? undefined);
      setUi({ kind: "connected" });
      if (id) setConversationId(id);
      const activeCallId = callIdRef.current;
      if (id && activeCallId) {
        attachFn({ data: { callId: activeCallId, conversationId: id } }).catch((err) => {
          pushEvent("attach_error", String(err?.message ?? err));
        });
      }

      // Explicitly unmute the SDK input and bind the exact device that passed
      // the preflight. setVolume controls speaker output, not the mic.
      conversation.setMuted(false);
      const inputDeviceId = micDeviceIdRef.current;
      if (inputDeviceId) {
        conversation
          .changeInputDevice({ inputDeviceId, format: "pcm", sampleRate: 16000 })
          .catch(() => {
            /* browser default remains active */
          });
      }
    },
    onDisconnect: () => {
      pushEvent("disconnected");
      setUi((prev) => (prev.kind === "error" ? prev : { kind: "idle" }));
      startedAtRef.current = null;
    },
    onError: (error: unknown) => {
      const message =
        typeof error === "string"
          ? error
          : ((error as { message?: string })?.message ?? "Conversation error");
      pushEvent("error", message);
      setUi({ kind: "error", message });
    },
    onMessage: (msg: unknown) => {
      const type = (msg as { type?: string; source?: string })?.type ?? "message";
      pushEvent(String(type));
    },
  });

  // Timer while connected.
  useEffect(() => {
    if (ui.kind !== "connected") return;
    startedAtRef.current ??= Date.now();
    const interval = setInterval(() => {
      if (startedAtRef.current) {
        setElapsed(Math.floor((Date.now() - startedAtRef.current) / 1000));
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [ui.kind]);

  const status = conversation.status; // "connected" | "disconnected" | "connecting"
  const isSpeaking = conversation.isSpeaking;

  const start = useCallback(async () => {
    setEvents([]);
    setConversationId(null);
    setElapsed(0);
    setDynamicContextReady(false);
    setUi({ kind: "requesting_mic" });
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      const track = stream.getAudioTracks()[0];
      if (!track || track.readyState !== "live" || !track.enabled) {
        stream.getTracks().forEach((t) => t.stop());
        throw new Error("No active microphone track was available");
      }
      micDeviceIdRef.current = track.getSettings().deviceId ?? null;
      // Preflight only — ElevenLabs opens its own WebRTC input stream.
      stream.getTracks().forEach((t) => t.stop());
    } catch (err) {
      const message = err instanceof Error ? err.message : "Microphone permission was denied";
      setUi({ kind: "error", message });
      pushEvent("mic_denied", message);
      return;
    }
    setUi({ kind: "connecting" });
    pushEvent("requesting_signed_url");
    try {
      const result = await startFn({
        data: {
          negotiationId,
          providerId,
          rehearsalStyle: rehearsalStyle === "none" ? undefined : rehearsalStyle,
          callMode,
          leverageQuoteId:
            callMode === "NEGOTIATION" && leverageQuoteId ? leverageQuoteId : undefined,
        },
      });
      callIdRef.current = result.callId;
      setCallId(result.callId);
      setDynamicContextReady(true);
      pushEvent("dynamic_context_ready", `v${result.confirmedSpecVersion}`);
      pushEvent("call_record_created", result.callId);
      await conversation.startSession({
        conversationToken: result.conversationToken,
        connectionType: "webrtc",
        dynamicVariables: result.dynamicVariables,
      });
      queryClient.invalidateQueries({ queryKey: ["control-room", negotiationId] });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to start call";
      setUi({ kind: "error", message });
      pushEvent("start_error", message);
    }
  }, [
    callMode,
    conversation,
    leverageQuoteId,
    negotiationId,
    providerId,
    pushEvent,
    queryClient,
    rehearsalStyle,
    startFn,
  ]);

  const stop = useCallback(async () => {
    setUi({ kind: "ending" });
    try {
      await conversation.endSession();
    } catch (err) {
      pushEvent("end_session_error", String((err as { message?: string })?.message ?? err));
    }
    if (callId) {
      try {
        await endFn({ data: { callId, reason: "Ended by user" } });
      } catch (err) {
        pushEvent("end_server_error", String((err as { message?: string })?.message ?? err));
      }
    }
    queryClient.invalidateQueries({ queryKey: ["control-room", negotiationId] });
    setUi({ kind: "idle" });
    startedAtRef.current = null;
  }, [callId, conversation, endFn, negotiationId, pushEvent, queryClient]);

  const toggleMute = useCallback(() => {
    const next = !conversation.isMuted;
    try {
      conversation.setMuted(next);
      pushEvent(next ? "muted" : "unmuted");
    } catch (err) {
      pushEvent("mute_error", String((err as { message?: string })?.message ?? err));
    }
  }, [conversation, pushEvent]);

  const isActive = status === "connected" || ui.kind === "connecting" || ui.kind === "ending";
  const provider = useMemo(
    () => providers.find((p) => p.id === providerId) ?? providers[0],
    [providerId, providers],
  );

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Radio className="size-4 text-emerald-600" />
            Provider call rehearsal
          </CardTitle>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Badge variant="secondary">v{specVersion}</Badge>
            <code className="font-mono">{shortHash(specHash || "", 10)}</code>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <Alert>
          <Info className="size-4" />
          <AlertTitle>Microphone access is required</AlertTitle>
          <AlertDescription>
            We use your microphone to talk with the practice provider agent. Audio stays inside your
            browser and the ElevenLabs session — nothing is recorded locally.
          </AlertDescription>
        </Alert>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Practice against</label>
            <Select value={providerId} onValueChange={setProviderId} disabled={isActive}>
              <SelectTrigger>
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
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">
              Provider style (optional role-play)
            </label>
            <Select
              value={rehearsalStyle}
              onValueChange={(v) => setRehearsalStyle(v as RehearsalStyle | "none")}
              disabled={isActive}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No guidance (let the agent choose)</SelectItem>
                {REHEARSAL_STYLES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {REHEARSAL_STYLE_META[s].label} — {REHEARSAL_STYLE_META[s].description}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[11px] leading-snug text-muted-foreground">
              Guidance only. Outcomes still come from the real transcript, verified quotes and
              reconciliation — no fake calls or forced discounts.
            </p>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Call mode</label>
            <Select
              value={callMode}
              onValueChange={(v) => setCallMode(v as CallMode)}
              disabled={isActive}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="QUOTE_GATHERING">
                  Quote gathering — capture a fresh quote
                </SelectItem>
                <SelectItem value="NEGOTIATION">
                  Negotiation — cite a verified competing quote
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          {callMode === "NEGOTIATION" ? (
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">
                Leverage quote (verified, same spec, different provider)
              </label>
              <Select
                value={leverageQuoteId}
                onValueChange={setLeverageQuoteId}
                disabled={isActive || leverageOptions.isLoading}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select a verified quote to cite" />
                </SelectTrigger>
                <SelectContent>
                  {(leverageOptions.data ?? []).map((q) => (
                    <SelectItem key={q.id} value={q.id}>
                      {q.providers?.name ?? "Provider"} · {q.quote_stage} ·{" "}
                      {q.total_amount != null
                        ? new Intl.NumberFormat("en-US", {
                            style: "currency",
                            currency: q.currency || "USD",
                          }).format(Number(q.total_amount))
                        : "—"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {(leverageOptions.data ?? []).length === 0 &&
              !leverageOptions.isLoading ? (
                <p className="text-[11px] leading-snug text-amber-700">
                  No eligible leverage quotes on this specification hash. Capture a quote from a
                  different provider first.
                </p>
              ) : (
                <p className="text-[11px] leading-snug text-muted-foreground">
                  The agent may cite only this stored quote — no invented competitors.
                </p>
              )}
            </div>
          ) : null}
        </div>
        <div className="flex justify-end">
          <div className="flex gap-2">

            {status === "connected" || ui.kind === "connecting" || ui.kind === "ending" ? (
              <>
                <Button variant="outline" onClick={toggleMute} disabled={status !== "connected"}>
                  {conversation.isMuted ? (
                    <>
                      <MicOff className="mr-2 size-4" /> Muted
                    </>
                  ) : (
                    <>
                      <Mic className="mr-2 size-4" /> Mute
                    </>
                  )}
                </Button>
                <Button variant="destructive" onClick={stop} disabled={ui.kind === "ending"}>
                  <PhoneOff className="mr-2 size-4" /> End call
                </Button>
              </>
            ) : (
              <Button onClick={start} disabled={ui.kind === "requesting_mic"}>
                {ui.kind === "requesting_mic" ? (
                  <Loader2 className="mr-2 size-4 animate-spin" />
                ) : (
                  <PhoneCall className="mr-2 size-4" />
                )}
                Start rehearsal
              </Button>
            )}
          </div>
        </div>

        <StatusStrip
          ui={ui}
          status={status}
          isSpeaking={isSpeaking}
          elapsed={elapsed}
          conversationId={conversationId}
          providerName={provider?.name ?? ""}
        />

        <div className="flex flex-wrap gap-2 text-xs">
          <StatusChip label="Dynamic context" state={dynamicContextReady ? "success" : "pending"} />
          <StatusChip
            label={`Spec v${specVersion} · ${shortHash(specHash || "", 8)}`}
            state="info"
          />
          <StatusChip
            label={
              conversationId
                ? `Conversation ${conversationId.slice(0, 10)}…`
                : "Conversation pending"
            }
            state={conversationId ? "success" : "pending"}
          />
          <StatusChip
            label={`Context tool: ${callStatus.data?.contextTool ?? "pending"}`}
            state={
              callStatus.data?.contextTool === "success"
                ? "success"
                : callStatus.data?.contextTool === "failure"
                  ? "failure"
                  : "pending"
            }
          />
          <StatusChip
            label={callStatus.data?.webhookReceivedAt ? "Webhook received" : "Webhook pending"}
            state={callStatus.data?.webhookReceivedAt ? "success" : "pending"}
          />
        </div>

        <FinalizationPanel data={callStatus.data} />

        {ui.kind === "error" ? (
          <Alert variant="destructive">
            <AlertTriangle className="size-4" />
            <AlertTitle>Rehearsal failed</AlertTitle>
            <AlertDescription>{ui.message}</AlertDescription>
          </Alert>
        ) : null}

        <div>
          <div className="mb-1 text-xs font-medium text-muted-foreground">
            Live operational events
          </div>
          <div className="max-h-48 overflow-auto rounded-md border bg-muted/30 p-2 font-mono text-xs">
            {events.length === 0 ? (
              <div className="text-muted-foreground">No events yet.</div>
            ) : (
              events
                .slice()
                .reverse()
                .map((e, i) => (
                  <div key={i} className="flex justify-between gap-4">
                    <span>
                      <span className="text-muted-foreground">
                        {new Date(e.at).toLocaleTimeString()}
                      </span>{" "}
                      <span className="text-foreground">{e.kind}</span>
                    </span>
                    {e.detail ? (
                      <span className="truncate text-muted-foreground">{e.detail}</span>
                    ) : null}
                  </div>
                ))
            )}
          </div>
        </div>

        <p className="text-xs text-muted-foreground">
          Transcripts appear on the negotiation timeline once ElevenLabs delivers the verified
          post-call webhook — we don&apos;t show partial transcripts.
        </p>
      </CardContent>
    </Card>
  );
}

function FinalizationPanel({
  data,
}: {
  data:
    | {
        callStatus: string | null;
        finalOutcome: string | null;
        verifiedSavings: number | null;
        verifiedPriceChanged: boolean | null;
        verifiedTermsChanged: boolean | null;
        needsReview: boolean;
        reconciledAt: string | null;
        redFlags: number;
        commitments: number;
        unresolved: number;
        contradictions: number;
        transcriptCount: number;
        webhookReceivedAt: string | null;
      }
    | null
    | undefined;
}) {
  if (!data || (!data.finalOutcome && !data.reconciledAt && !data.webhookReceivedAt)) return null;
  const fmt = (n: number | null) =>
    n == null ? "—" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
  return (
    <div className="rounded-md border p-3">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Finalization
        </div>
        <div className="flex flex-wrap gap-1.5">
          {data.callStatus ? (
            <StatusChip
              label={data.callStatus}
              state={
                data.callStatus === "completed"
                  ? "success"
                  : data.callStatus === "needs_review" || data.callStatus === "failed"
                    ? "failure"
                    : "info"
              }
            />
          ) : null}
          {data.needsReview ? <StatusChip label="Needs review" state="failure" /> : null}
          <StatusChip
            label={`Transcript: ${data.transcriptCount}`}
            state={data.transcriptCount > 0 ? "success" : "pending"}
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        <Metric label="Outcome" value={data.finalOutcome ?? "—"} />
        <Metric label="Verified savings" value={fmt(data.verifiedSavings)} />
        <Metric label="Price changed" value={data.verifiedPriceChanged == null ? "—" : data.verifiedPriceChanged ? "yes" : "no"} />
        <Metric label="Terms changed" value={data.verifiedTermsChanged == null ? "—" : data.verifiedTermsChanged ? "yes" : "no"} />
        <Metric label="Red flags" value={String(data.redFlags)} />
        <Metric label="Commitments" value={String(data.commitments)} />
        <Metric label="Unresolved" value={String(data.unresolved)} />
        <Metric label="Contradictions" value={String(data.contradictions)} />
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-0.5 font-semibold">{value}</div>
    </div>
  );
}

function StatusStrip({
  ui,
  status,
  isSpeaking,
  elapsed,
  conversationId,
  providerName,
}: {
  ui: UiState;
  status: string;
  isSpeaking: boolean;
  elapsed: number;
  conversationId: string | null;
  providerName: string;
}) {
  const label = (() => {
    if (ui.kind === "error") return "Error";
    if (ui.kind === "ending") return "Ending…";
    if (ui.kind === "requesting_mic") return "Requesting microphone…";
    if (ui.kind === "connecting" || status === "connecting") return "Connecting…";
    if (status === "connected") return isSpeaking ? "Agent speaking" : "Listening";
    return "Disconnected";
  })();
  const tone =
    ui.kind === "error"
      ? "bg-red-100 text-red-700"
      : status === "connected"
        ? "bg-emerald-100 text-emerald-700"
        : "bg-muted text-muted-foreground";
  const mm = String(Math.floor(elapsed / 60)).padStart(2, "0");
  const ss = String(elapsed % 60).padStart(2, "0");
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 ${tone}`}>
        <span
          className={`size-2 rounded-full ${status === "connected" ? "bg-emerald-500" : "bg-muted-foreground/50"}`}
        />
        {label}
      </span>
      <span className="text-muted-foreground">
        Provider: <span className="text-foreground">{providerName || "—"}</span>
      </span>
      <span className="text-muted-foreground">
        Timer:{" "}
        <span className="font-mono text-foreground">
          {mm}:{ss}
        </span>
      </span>
      <span className="text-muted-foreground">
        Conversation:{" "}
        <code className="font-mono text-foreground">
          {conversationId ? conversationId.slice(0, 12) + "…" : "—"}
        </code>
      </span>
    </div>
  );
}

function StatusChip({
  label,
  state,
}: {
  label: string;
  state: "success" | "failure" | "pending" | "info";
}) {
  const tone =
    state === "success"
      ? "bg-emerald-100 text-emerald-700"
      : state === "failure"
        ? "bg-red-100 text-red-700"
        : state === "info"
          ? "bg-slate-100 text-slate-700"
          : "bg-amber-50 text-amber-700";
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 ${tone}`}>
      <span
        className={`size-2 rounded-full ${
          state === "success"
            ? "bg-emerald-500"
            : state === "failure"
              ? "bg-red-500"
              : state === "info"
                ? "bg-slate-400"
                : "bg-amber-400"
        }`}
      />
      {label}
    </span>
  );
}
