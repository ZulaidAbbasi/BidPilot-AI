import { useEffect, useState } from "react";
import {
  Circle,
  FlaskConical,
  Mic,
  MicOff,
  PhoneOff,
  Radio,
  ShieldCheck,
  Signal,
  SignalHigh,
  SignalLow,
  SignalMedium,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import type {
  AgentActivity,
  CallMode,
  CallStage,
  ConnectionQuality,
  ProviderIdentity,
  SpecIntegrity,
} from "./types";
import { CALL_TYPE_LABEL, isRehearsal, type CallType } from "./types";

interface Props {
  provider: ProviderIdentity;
  mode: CallMode;
  callType: CallType;
  stage: CallStage;
  spec: SpecIntegrity;
  agentActivity?: AgentActivity;
  quality?: ConnectionQuality;
  aiDisclosed?: boolean;
  recording?: boolean;
  muted?: boolean;
  onToggleMute?: () => void;
  onEndCall?: () => void;
  startedAt?: number | null;
}

/**
 * Sticky top bar shown during connecting/live/ending stages.
 * Everything here derives from real session state — no synthetic values.
 */
export function LiveCallBar({
  provider,
  mode,
  callType,
  stage,
  spec,
  agentActivity = "idle",
  quality = "unknown",
  aiDisclosed,
  recording,
  muted,
  onToggleMute,
  onEndCall,
  startedAt,
}: Props) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const rehearsal = isRehearsal(mode, callType);
  const live = stage === "live";

  useEffect(() => {
    if (!startedAt || (stage !== "live" && stage !== "ending")) return;
    const tick = () => setElapsed(Math.floor((Date.now() - startedAt) / 1000));
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [startedAt, stage]);

  const mm = String(Math.floor(elapsed / 60)).padStart(2, "0");
  const ss = String(elapsed % 60).padStart(2, "0");

  return (
    <>
      <div
        className={cn(
          "sticky top-0 z-30 flex flex-wrap items-center gap-3 border-b bg-background/95 px-4 py-2.5 backdrop-blur",
          rehearsal ? "border-warn/30" : "border-border",
        )}
        role="region"
        aria-label="Live call controls"
      >
        {/* State pill */}
        <div className="flex items-center gap-2">
          <StatePill stage={stage} rehearsal={rehearsal} />
          <div className="hidden font-mono text-xs tabular-nums sm:block">
            {mm}:{ss}
          </div>
        </div>

        <div className="mx-1 h-6 w-px bg-border" />

        {/* Provider identity */}
        <div className="flex min-w-0 items-center gap-2">
          {rehearsal ? (
            <FlaskConical className="size-4 shrink-0 text-warn-foreground" />
          ) : (
            <Radio className="size-4 shrink-0 text-primary" />
          )}
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold leading-tight">{provider.name}</div>
            <div className="truncate font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
              {CALL_TYPE_LABEL[callType]}
              {rehearsal && " · role-play"}
            </div>
          </div>
        </div>

        <div className="mx-1 h-6 w-px bg-border" />

        {/* Agent activity */}
        <div className="hidden items-center gap-1.5 text-xs md:flex">
          <ActivityDot activity={agentActivity} live={live} />
          <span className="font-mono uppercase tracking-[0.1em] text-muted-foreground">
            {live ? agentActivity : stage}
          </span>
        </div>

        {/* Spec integrity chip */}
        <Badge
          variant="outline"
          className={cn(
            "hidden font-mono text-[10px] uppercase tracking-[0.12em] md:inline-flex",
            spec.confirmed ? "border-verified/40 text-verified" : "border-risk/40 text-risk",
          )}
        >
          <ShieldCheck className="mr-1 size-3" />v{spec.version}·{spec.shortHash}
        </Badge>

        {/* Signal */}
        <div
          className="hidden items-center gap-1 text-muted-foreground lg:flex"
          title={`Connection: ${quality}`}
        >
          <QualityIcon quality={quality} />
        </div>

        {/* AI disclosure & recording */}
        <div className="hidden items-center gap-2 lg:flex">
          {aiDisclosed && (
            <Badge variant="secondary" className="font-mono text-[10px] uppercase tracking-[0.1em]">
              AI disclosed
            </Badge>
          )}
          {recording && (
            <Badge
              variant="destructive"
              className="gap-1 font-mono text-[10px] uppercase tracking-[0.1em]"
            >
              <Circle className="size-2 animate-pulse fill-current" /> REC
            </Badge>
          )}
        </div>

        {/* Right controls */}
        <div className="ml-auto flex items-center gap-2">
          {onToggleMute && (
            <Button
              type="button"
              variant={muted ? "destructive" : "outline"}
              size="sm"
              onClick={onToggleMute}
              aria-pressed={muted}
              aria-label={muted ? "Unmute microphone" : "Mute microphone"}
              disabled={!live && stage !== "ending"}
            >
              {muted ? <MicOff className="size-4" /> : <Mic className="size-4" />}
              <span className="ml-1.5 hidden sm:inline">{muted ? "Muted" : "Mute"}</span>
            </Button>
          )}
          {onEndCall && (
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={() => setConfirmOpen(true)}
              disabled={stage !== "live" && stage !== "connecting"}
            >
              <PhoneOff className="size-4" />
              <span className="ml-1.5 hidden sm:inline">End call</span>
            </Button>
          )}
        </div>
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>End this {rehearsal ? "rehearsal" : "call"}?</AlertDialogTitle>
            <AlertDialogDescription>
              {rehearsal
                ? "The rehearsal session will end. Captured quote data stays in the database."
                : "This will disconnect the call. Captured data, transcript, and outcome will be processed after ending."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep talking</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmOpen(false);
                onEndCall?.();
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              End {rehearsal ? "rehearsal" : "call"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function StatePill({ stage, rehearsal }: { stage: CallStage; rehearsal: boolean }) {
  const map: Record<CallStage, { label: string; tone: string; dot: string }> = {
    preflight: {
      label: "Preflight",
      tone: "text-muted-foreground border-border",
      dot: "bg-muted-foreground",
    },
    connecting: {
      label: "Connecting",
      tone: "text-warn border-warn/40 bg-warn-soft/40",
      dot: "bg-warn animate-pulse",
    },
    live: {
      label: rehearsal ? "Rehearsing" : "Live",
      tone: rehearsal
        ? "text-warn-foreground border-warn/40 bg-warn-soft/40"
        : "text-risk border-risk/40 bg-risk-soft/30",
      dot: rehearsal ? "bg-warn animate-pulse" : "bg-risk animate-pulse",
    },
    ending: {
      label: "Ending",
      tone: "text-muted-foreground border-border",
      dot: "bg-muted-foreground",
    },
    processing: {
      label: "Processing",
      tone: "text-primary border-primary/30 bg-primary/10",
      dot: "bg-primary animate-pulse",
    },
    done: {
      label: "Ended",
      tone: "text-muted-foreground border-border",
      dot: "bg-muted-foreground",
    },
  };
  const s = map[stage];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em]",
        s.tone,
      )}
    >
      <span className={cn("size-1.5 rounded-full", s.dot)} />
      {s.label}
    </span>
  );
}

function ActivityDot({ activity, live }: { activity: AgentActivity; live: boolean }) {
  if (!live) return <span className="size-2 rounded-full bg-muted-foreground/40" />;
  const color =
    activity === "speaking"
      ? "bg-primary"
      : activity === "thinking"
        ? "bg-warn"
        : activity === "listening"
          ? "bg-verified"
          : "bg-muted-foreground/50";
  return (
    <span className={cn("size-2 rounded-full", color, activity !== "idle" && "animate-pulse")} />
  );
}

function QualityIcon({ quality }: { quality: ConnectionQuality }) {
  const cls = "size-4";
  if (quality === "good") return <SignalHigh className={cn(cls, "text-verified")} />;
  if (quality === "fair") return <SignalMedium className={cn(cls, "text-warn")} />;
  if (quality === "poor") return <SignalLow className={cn(cls, "text-risk")} />;
  return <Signal className={cn(cls, "opacity-40")} />;
}
