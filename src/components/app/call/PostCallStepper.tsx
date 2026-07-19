import { Check, Circle, Loader2, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

export type PostCallStepKey = "ended" | "transcript" | "reconciled" | "evidence" | "outcome";

export interface PostCallProgress {
  ended: boolean;
  transcript: boolean;
  reconciled: boolean;
  evidence: boolean;
  outcome: boolean;
}

const STEPS: { key: PostCallStepKey; label: string; sub: string }[] = [
  { key: "ended", label: "Call ended", sub: "Session closed" },
  { key: "transcript", label: "Transcript received", sub: "Audio → text" },
  { key: "reconciled", label: "Quote reconciled", sub: "Snapshots merged" },
  { key: "evidence", label: "Evidence checked", sub: "Claims verified" },
  { key: "outcome", label: "Outcome finalized", sub: "Structured summary" },
];

interface Props {
  progress: PostCallProgress;
  onRetry?: () => void;
  waiting?: PostCallStepKey | null;
}

/**
 * Post-call processing stepper. Each step advances only when the
 * corresponding persisted signal arrives (transcript row, reconciliation
 * timestamp, evidence rows, outcome finalized event).
 */
export function PostCallStepper({ progress, onRetry, waiting }: Props) {
  return (
    <div className="rounded-2xl border border-border/70 bg-card p-5">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="font-display text-base font-semibold">Processing this call</h3>
        {onRetry && (
          <Button type="button" size="sm" variant="ghost" onClick={onRetry}>
            <RefreshCw className="mr-1.5 size-3.5" /> Retry
          </Button>
        )}
      </div>

      <ol className="space-y-3">
        {STEPS.map((step, i) => {
          const done = progress[step.key];
          const active = !done && waiting === step.key;
          const prevDone = i === 0 || progress[STEPS[i - 1].key];
          const state: "done" | "active" | "pending" = done
            ? "done"
            : active || (prevDone && !done)
              ? "active"
              : "pending";

          return (
            <li key={step.key} className="flex items-start gap-3">
              <div className="mt-0.5 grid size-6 shrink-0 place-items-center">
                {state === "done" ? (
                  <div className="grid size-6 place-items-center rounded-full bg-verified text-verified-foreground">
                    <Check className="size-3.5" strokeWidth={3} />
                  </div>
                ) : state === "active" ? (
                  <Loader2 className="size-4 animate-spin text-primary" />
                ) : (
                  <Circle className="size-4 text-muted-foreground/40" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div
                  className={cn(
                    "text-sm font-medium",
                    state === "pending" && "text-muted-foreground",
                  )}
                >
                  {step.label}
                </div>
                <div className="text-[11px] text-muted-foreground">{step.sub}</div>
              </div>
              <span
                className={cn(
                  "font-mono text-[10px] uppercase tracking-[0.12em]",
                  state === "done"
                    ? "text-verified"
                    : state === "active"
                      ? "text-primary"
                      : "text-muted-foreground/60",
                )}
              >
                {state === "done" ? "Done" : state === "active" ? "Working…" : "Waiting"}
              </span>
            </li>
          );
        })}
      </ol>

      <p className="mt-4 text-[11px] text-muted-foreground">
        Steps advance only when persisted data confirms them. Nothing is marked complete
        speculatively.
      </p>
    </div>
  );
}
