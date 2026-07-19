import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useConversation, ConversationProvider } from "@elevenlabs/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Mic,
  MicOff,
  PhoneOff,
  PlayCircle,
  Loader2,
  ShieldAlert,
  CheckCircle2,
  ClipboardList,
  FileText,
  AlertTriangle,
} from "lucide-react";

import { PageBody } from "@/components/app/page";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  startVoiceIntake,
  getIntakeSession,
  bindIntakeConversation,
  recordIntakeClientDisconnect,
} from "@/lib/intake.functions";

export const Route = createFileRoute("/app/negotiations/$id/voice-intake")({
  head: () => ({
    meta: [
      { title: "Voice Intake — BidPilot AI" },
      {
        name: "description",
        content:
          "Talk to the BidPilot Estimator to capture your move details by voice. Every field is confirmed before it enters your canonical specification.",
      },
    ],
  }),
  component: VoiceIntakeRoute,
});

type Turn = { role: "agent" | "user" | "system"; text: string; at: string };

function VoiceIntakeRoute() {
  return (
    <ConversationProvider>
      <VoiceIntakePage />
    </ConversationProvider>
  );
}

function VoiceIntakePage() {
  const { id } = Route.useParams();
  const queryClient = useQueryClient();
  const startFn = useServerFn(startVoiceIntake);
  const getSessionFn = useServerFn(getIntakeSession);
  const bindConversationFn = useServerFn(bindIntakeConversation);
  const recordDisconnectFn = useServerFn(recordIntakeClientDisconnect);

  const [starting, setStarting] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [micReady, setMicReady] = useState<"unknown" | "ok" | "denied">("unknown");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [ended, setEnded] = useState(false);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const sessionIdRef = useRef<string | null>(null);
  const conversationIdRef = useRef<string | null>(null);
  const turnsRef = useRef<Turn[]>([]);

  const { data: state, refetch } = useQuery({
    queryKey: ["intake-state", id],
    queryFn: () => getSessionFn({ data: { negotiationId: id } }),
    refetchInterval: 4_000,
  });

  const persistClientDisconnect = useCallback(async () => {
    const activeSessionId = sessionIdRef.current;
    if (!activeSessionId) return;
    try {
      await recordDisconnectFn({
        data: {
          negotiationId: id,
          sessionId: activeSessionId,
          conversationId: conversationIdRef.current ?? undefined,
          transcript: turnsRef.current,
        },
      });
      await queryClient.invalidateQueries({ queryKey: ["intake-state", id] });
    } catch (error) {
      console.error("[intake] disconnect persistence failed", error);
    }
  }, [id, queryClient, recordDisconnectFn]);

  const bindConnectedConversation = useCallback(
    async (connectedConversationId: string) => {
      const activeSessionId = sessionIdRef.current;
      if (!activeSessionId) return;
      setConversationId(connectedConversationId);
      conversationIdRef.current = connectedConversationId;
      try {
        await bindConversationFn({
          data: {
            negotiationId: id,
            sessionId: activeSessionId,
            conversationId: connectedConversationId,
          },
        });
      } catch (error) {
        console.error("[intake] conversation binding failed", error);
        toast.error("Voice connected, but server binding failed. End the session and retry.");
      }
    },
    [bindConversationFn, id],
  );

  const conversation = useConversation({
    onConnect: ({ conversationId: connectedConversationId }) => {
      void bindConnectedConversation(connectedConversationId);
    },
    onMessage: (msg: { source?: string; message?: string; type?: string }) => {
      const role =
        msg.source === "user" || msg.source === "human"
          ? "user"
          : msg.source === "ai" || msg.source === "agent"
            ? "agent"
            : null;
      const text = msg.message ?? "";
      if (!role || !text) return;
      const turn: Turn = { role, text, at: new Date().toISOString() };
      setTurns((current) => {
        const next = [...current, turn];
        turnsRef.current = next;
        return next;
      });
    },
    onError: (error: unknown) => {
      console.error("[intake] conversation error", error);
      toast.error("Voice session error. Captured progress is being preserved.");
    },
    onDisconnect: () => {
      setEnded(true);
      void persistClientDisconnect();
    },
  });

  useEffect(() => {
    if (transcriptRef.current) {
      transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
    }
  }, [turns.length]);

  useEffect(() => {
    const persisted = state?.session?.transcript;
    if (
      conversation.status === "connected" ||
      turnsRef.current.length > 0 ||
      !Array.isArray(persisted)
    ) {
      return;
    }
    const hydrated = persisted
      .filter((turn): turn is { role: "agent" | "user" | "system"; text: string; at?: string } => {
        if (!turn || typeof turn !== "object") return false;
        const row = turn as Record<string, unknown>;
        return (
          (row.role === "agent" || row.role === "user" || row.role === "system") &&
          typeof row.text === "string"
        );
      })
      .map((turn) => ({
        role: turn.role,
        text: turn.text,
        at: turn.at ?? new Date().toISOString(),
      }));
    if (hydrated.length) {
      turnsRef.current = hydrated;
      setTurns(hydrated);
    }
  }, [conversation.status, state?.session?.transcript]);

  const preflight = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
      setMicReady("ok");
      return true;
    } catch {
      setMicReady("denied");
      toast.error("Microphone access is required for voice intake.");
      return false;
    }
  }, []);

  const beginSession = useCallback(
    async (resume = false) => {
      if (starting) return;
      setStarting(true);
      setTurns([]);
      setEnded(false);
      try {
        const okMic = await preflight();
        if (!okMic) return;
        const result = await startFn({ data: { negotiationId: id, resume } });
        setSessionId(result.sessionId);
        sessionIdRef.current = result.sessionId;
        await conversation.startSession({
          conversationToken: result.conversationToken,
          connectionType: "webrtc",
          dynamicVariables: result.dynamicVariables,
        });
        toast.success("Voice intake started.");
      } catch (e) {
        console.error("[intake] start failed", e);
        toast.error(e instanceof Error ? e.message : "Failed to start voice intake");
      } finally {
        setStarting(false);
      }
    },
    [id, starting, preflight, startFn, conversation],
  );

  const endSession = useCallback(async () => {
    try {
      await conversation.endSession();
    } catch {
      /* ignore */
    }
    setEnded(true);
    await persistClientDisconnect();
    await queryClient.invalidateQueries({ queryKey: ["intake-state", id] });
    await refetch();
    toast.message("Session ended. Post-call transcript processing may take a moment.");
  }, [conversation, id, persistClientDisconnect, queryClient, refetch]);

  const status = conversation.status;
  const speaking = conversation.isSpeaking;

  const captured = useMemo<string[]>(
    () =>
      Array.isArray(state?.session?.captured_fields)
        ? (state.session.captured_fields as string[])
        : [],
    [state],
  );
  const unresolved = useMemo<string[]>(
    () =>
      Array.isArray(state?.session?.unresolved_fields)
        ? (state.session.unresolved_fields as string[])
        : [],
    [state],
  );
  const conflicts = useMemo(
    () => (state?.draft?.conflicts ?? []) as { path: string; resolved?: boolean }[],
    [state?.draft?.conflicts],
  );
  const completionPercent = state?.draft?.completion_percent ?? 0;

  return (
    <PageBody>
      <div className="space-y-5">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Mic className="h-4 w-4" /> BidPilot Estimator — voice intake
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <p className="text-muted-foreground">
              Talk to the BidPilot Estimator. It will ask one question at a time and only save
              values you confirm out loud. The Estimator writes to the same draft as manual entry
              and document upload — nothing is confirmed until you review and hit{" "}
              <span className="font-medium">Confirm &amp; Lock</span> on the specification page.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              {status !== "connected" ? (
                <>
                  <Button onClick={() => beginSession(false)} disabled={starting} size="sm">
                    {starting ? (
                      <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <PlayCircle className="mr-1.5 h-3.5 w-3.5" />
                    )}
                    Start voice intake
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => beginSession(true)}
                    disabled={starting}
                  >
                    Resume last session
                  </Button>
                </>
              ) : (
                <Button variant="destructive" size="sm" onClick={endSession}>
                  <PhoneOff className="mr-1.5 h-3.5 w-3.5" /> End session
                </Button>
              )}
              <Button asChild variant="ghost" size="sm">
                <Link to="/app/negotiations/$id/specification" params={{ id }}>
                  <FileText className="mr-1.5 h-3.5 w-3.5" /> Review specification
                </Link>
              </Button>
              <MicPreflight state={micReady} />
              {status === "connected" && (
                <Badge variant="secondary" className="ml-1">
                  {speaking ? "Estimator speaking…" : "Listening"}
                </Badge>
              )}
              {conversationId && (
                <Badge variant="outline" className="font-mono text-[10px]">
                  {conversationId.slice(0, 12)}…
                </Badge>
              )}
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
          <Card className="flex min-h-[420px] flex-col">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Live transcript</CardTitle>
            </CardHeader>
            <CardContent className="flex-1 overflow-hidden pb-4">
              <div
                ref={transcriptRef}
                className="h-[380px] space-y-2 overflow-y-auto rounded-md border border-border bg-muted/30 p-3 text-[13px]"
              >
                {turns.length === 0 ? (
                  <p className="text-muted-foreground">
                    {status === "connected"
                      ? "Waiting for the Estimator to begin…"
                      : "Start a session to begin the intake conversation."}
                  </p>
                ) : (
                  turns.map((t, i) => (
                    <div
                      key={i}
                      className={`flex gap-2 ${
                        t.role === "agent" ? "text-navy" : "text-foreground"
                      }`}
                    >
                      <span className="w-14 shrink-0 text-[11px] uppercase tracking-wide text-muted-foreground">
                        {t.role === "agent" ? "Agent" : t.role === "user" ? "You" : "Sys"}
                      </span>
                      <span className="min-w-0 flex-1">{t.text}</span>
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>

          <div className="space-y-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-1.5">
                    <ClipboardList className="h-3.5 w-3.5" /> Progress
                  </span>
                  <span className="tabular-nums text-muted-foreground">{completionPercent}%</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-[13px]">
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full bg-navy transition-all"
                    style={{ width: `${completionPercent}%` }}
                  />
                </div>
                <StatLine
                  label="Captured this session"
                  value={captured.length}
                  icon={CheckCircle2}
                />
                <StatLine
                  label="Unresolved"
                  value={unresolved.length}
                  icon={AlertTriangle}
                  tone={unresolved.length ? "warn" : "muted"}
                />
                <StatLine
                  label="Conflicts pending"
                  value={conflicts.filter((c) => !c.resolved).length}
                  icon={ShieldAlert}
                  tone={conflicts.filter((c) => !c.resolved).length ? "warn" : "muted"}
                />
              </CardContent>
            </Card>

            {conflicts.filter((c) => !c.resolved).length > 0 && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-1.5 text-sm">
                    <ShieldAlert className="h-3.5 w-3.5 text-warn-foreground" /> Conflicts
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-[12px]">
                  {conflicts
                    .filter((c) => !c.resolved)
                    .slice(0, 5)
                    .map((c, i) => (
                      <div key={i} className="rounded border border-border bg-muted/40 p-2">
                        <div className="font-mono text-[11px] text-muted-foreground">{c.path}</div>
                        <div className="mt-1 text-[12px]">
                          Multiple sources disagree — resolve in the specification review.
                        </div>
                      </div>
                    ))}
                  <Button asChild size="sm" variant="outline" className="w-full">
                    <Link to="/app/negotiations/$id/specification" params={{ id }}>
                      Resolve in specification
                    </Link>
                  </Button>
                </CardContent>
              </Card>
            )}

            {ended && sessionId && (
              <Card>
                <CardContent className="space-y-2 pt-4 text-[13px]">
                  <p className="font-medium">Session ended.</p>
                  <p className="text-muted-foreground">
                    {captured.length > 0
                      ? `${captured.length} confirmed field${captured.length === 1 ? " was" : "s were"} saved. `
                      : "No confirmed fields were saved during this session. "}
                    {state?.session?.post_processing_status === "completed"
                      ? "The final transcript is available. "
                      : "The final transcript is still processing. "}
                    The specification is <b>not</b> confirmed until you review and lock it.
                  </p>
                  {state?.session?.summary && (
                    <p className="rounded border bg-muted/40 p-2 text-muted-foreground">
                      {state.session.summary}
                    </p>
                  )}
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>
    </PageBody>
  );
}

function MicPreflight({ state }: { state: "unknown" | "ok" | "denied" }) {
  if (state === "ok")
    return (
      <Badge variant="outline" className="border-verified/40 text-verified">
        <Mic className="mr-1 h-3 w-3" /> Mic ready
      </Badge>
    );
  if (state === "denied")
    return (
      <Badge variant="destructive">
        <MicOff className="mr-1 h-3 w-3" /> Mic blocked
      </Badge>
    );
  return null;
}

function StatLine({
  label,
  value,
  icon: Icon,
  tone = "default",
}: {
  label: string;
  value: number;
  icon: typeof CheckCircle2;
  tone?: "default" | "warn" | "muted";
}) {
  const color =
    tone === "warn"
      ? "text-warn-foreground"
      : tone === "muted"
        ? "text-muted-foreground"
        : "text-foreground";
  return (
    <div className="flex items-center justify-between">
      <span className={`inline-flex items-center gap-1.5 ${color}`}>
        <Icon className="h-3.5 w-3.5" /> {label}
      </span>
      <span className={`tabular-nums ${color}`}>{value}</span>
    </div>
  );
}

// silence unused-import warning for supabase (kept for future direct reads)
void supabase;
