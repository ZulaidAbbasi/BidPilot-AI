import { useState } from "react";
import {
  BadgeCheck,
  Building2,
  CalendarClock,
  Compass,
  FlaskConical,
  KeyRound,
  Loader2,
  Phone,
  PhoneCall,
  ShieldCheck,
  Sparkles,
  Target,
  TriangleAlert,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { AudioPreflight } from "./AudioPreflight";
import { CALL_TYPE_LABEL, isRehearsal, type CallContextSummary } from "./types";

interface Props {
  ctx: CallContextSummary;
  onStart: () => void | Promise<void>;
  starting?: boolean;
  disabled?: boolean;
  disabledReason?: string;
}

/**
 * Full pre-call preflight surface. Shows the professional pre-flight
 * checklist and blocks Start until spec is confirmed and mic is granted.
 * Real provider calls and Rehearsal role-plays are visually distinct.
 */
export function PreflightPanel({ ctx, onStart, starting, disabled, disabledReason }: Props) {
  const [micReady, setMicReady] = useState(false);
  const rehearsal = isRehearsal(ctx.mode, ctx.callType);

  const canStart = !starting && !disabled && micReady && ctx.spec.confirmed;
  const startingLatch = starting === true;

  return (
    <div className="mx-auto max-w-6xl">
      {/* Header — Real vs Rehearsal must never blur */}
      <div
        className={cn(
          "flex flex-col gap-4 rounded-2xl border p-6 sm:flex-row sm:items-start sm:justify-between",
          rehearsal
            ? "border-warn/40 bg-gradient-to-br from-warn-soft/60 via-card to-card"
            : "border-primary/30 bg-gradient-to-br from-primary/5 via-card to-card",
        )}
      >
        <div className="flex min-w-0 items-start gap-4">
          <div
            className={cn(
              "grid size-12 shrink-0 place-items-center rounded-xl",
              rehearsal ? "bg-warn/15 text-warn-foreground" : "bg-primary/10 text-primary",
            )}
          >
            {rehearsal ? <FlaskConical className="size-6" /> : <PhoneCall className="size-6" />}
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Badge
                variant="outline"
                className={cn(
                  "font-mono text-[10px] uppercase tracking-[0.14em]",
                  rehearsal
                    ? "border-warn/50 text-warn-foreground"
                    : "border-primary/40 text-primary",
                )}
              >
                {rehearsal ? "Rehearsal · role-play only" : "Real provider call"}
              </Badge>
              <Badge
                variant="secondary"
                className="font-mono text-[10px] uppercase tracking-[0.12em]"
              >
                {CALL_TYPE_LABEL[ctx.callType]}
              </Badge>
            </div>
            <h2 className="mt-2 truncate font-display text-2xl font-semibold">
              {ctx.provider.name}
            </h2>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              {ctx.provider.phone && !rehearsal && (
                <span className="inline-flex items-center gap-1">
                  <Phone className="size-3" /> {ctx.provider.phone}
                </span>
              )}
              {ctx.provider.carrier && (
                <span className="inline-flex items-center gap-1">
                  <Building2 className="size-3" /> {ctx.provider.carrier}
                </span>
              )}
              {rehearsal && (
                <span className="inline-flex items-center gap-1 text-warn-foreground">
                  <FlaskConical className="size-3" /> No real provider is dialed.
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="shrink-0 rounded-xl border border-border/60 bg-card/60 p-3 text-right backdrop-blur">
          <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            Specification
          </div>
          <div className="mt-1 inline-flex items-center gap-1.5">
            {ctx.spec.confirmed ? (
              <ShieldCheck className="size-4 text-verified" />
            ) : (
              <TriangleAlert className="size-4 text-risk" />
            )}
            <span className="font-mono text-xs">
              v{ctx.spec.version} · {ctx.spec.shortHash}
            </span>
          </div>
          <div
            className={cn(
              "mt-1 font-mono text-[10px]",
              ctx.spec.confirmed ? "text-verified" : "text-risk",
            )}
          >
            {ctx.spec.confirmed ? "Same-spec integrity ✓" : "Not confirmed"}
          </div>
        </div>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_20rem]">
        {/* Checklist */}
        <div className="space-y-4">
          <Section title="Call objective" icon={Target}>
            <p className="text-sm text-foreground">
              {ctx.objective ?? "No objective set for this call."}
            </p>
          </Section>

          <Section title="Route & date" icon={Compass}>
            <div className="grid gap-2 text-sm sm:grid-cols-2">
              <Field label="From" value={ctx.route?.origin ?? "—"} />
              <Field label="To" value={ctx.route?.destination ?? "—"} />
              <Field
                label="Moving date"
                value={
                  ctx.movingDate
                    ? new Date(ctx.movingDate).toLocaleDateString(undefined, {
                        weekday: "short",
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })
                    : "—"
                }
                icon={CalendarClock}
              />
              <Field
                label="Customer authority"
                value={ctx.authority ?? "Not specified"}
                icon={KeyRound}
              />
            </div>
          </Section>

          {ctx.requiredQuestions && ctx.requiredQuestions.length > 0 && (
            <Section title="Required questions" icon={Sparkles}>
              <ol className="list-decimal space-y-1 pl-5 text-sm">
                {ctx.requiredQuestions.map((q, i) => (
                  <li key={i}>{q}</li>
                ))}
              </ol>
            </Section>
          )}

          {ctx.eligibleLeverage && ctx.eligibleLeverage.length > 0 && (
            <Section title="Eligible leverage" icon={Zap} tone="verified">
              <ul className="space-y-1 text-sm">
                {ctx.eligibleLeverage.map((l, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <BadgeCheck className="mt-0.5 size-3.5 shrink-0 text-verified" />
                    <span>{l}</span>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {ctx.unresolvedRisks && ctx.unresolvedRisks.length > 0 && (
            <Section title="Unresolved risks" icon={TriangleAlert} tone="warn">
              <ul className="space-y-1 text-sm">
                {ctx.unresolvedRisks.map((r, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-warn" />
                    <span>{r}</span>
                  </li>
                ))}
              </ul>
            </Section>
          )}
        </div>

        {/* Right rail — audio preflight + start */}
        <aside className="space-y-4">
          <AudioPreflight onReady={() => setMicReady(true)} onNotReady={() => setMicReady(false)} />

          <div className="rounded-xl border border-border/70 bg-card p-4">
            <div className="mb-3 space-y-2">
              <PreflightCheck ok={ctx.spec.confirmed} label="Specification confirmed" />
              <PreflightCheck ok={micReady} label="Microphone ready" />
              <PreflightCheck ok={!!ctx.objective} label="Objective set" optional />
            </div>

            <Button
              type="button"
              size="lg"
              className="w-full"
              onClick={() => {
                if (!canStart) return;
                void onStart();
              }}
              disabled={!canStart || startingLatch}
              aria-disabled={!canStart || startingLatch}
            >
              {startingLatch ? (
                <>
                  <Loader2 className="mr-1.5 size-4 animate-spin" /> Connecting…
                </>
              ) : rehearsal ? (
                <>
                  <FlaskConical className="mr-1.5 size-4" /> Start rehearsal
                </>
              ) : (
                <>
                  <PhoneCall className="mr-1.5 size-4" /> Start call
                </>
              )}
            </Button>

            {disabled && disabledReason && (
              <p className="mt-2 text-center text-xs text-muted-foreground">{disabledReason}</p>
            )}
            {!disabled && !canStart && !startingLatch && (
              <p className="mt-2 text-center text-xs text-muted-foreground">
                {!ctx.spec.confirmed
                  ? "Confirm the specification before starting."
                  : "Grant microphone access to continue."}
              </p>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

function Section({
  title,
  icon: Icon,
  tone,
  children,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  tone?: "verified" | "warn";
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border p-4",
        tone === "verified"
          ? "border-verified/30 bg-verified-soft/40"
          : tone === "warn"
            ? "border-warn/30 bg-warn-soft/40"
            : "border-border/70 bg-card",
      )}
    >
      <div className="mb-2 flex items-center gap-2">
        <Icon
          className={cn(
            "size-4",
            tone === "verified"
              ? "text-verified"
              : tone === "warn"
                ? "text-warn"
                : "text-muted-foreground",
          )}
        />
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
          {title}
        </span>
      </div>
      {children}
    </div>
  );
}

function Field({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string;
  icon?: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div>
      <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </div>
      <div className="mt-0.5 flex items-center gap-1.5 text-sm">
        {Icon && <Icon className="size-3.5 text-muted-foreground" />}
        <span>{value}</span>
      </div>
    </div>
  );
}

function PreflightCheck({
  ok,
  label,
  optional,
}: {
  ok: boolean;
  label: string;
  optional?: boolean;
}) {
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span
        className={cn(
          "font-mono text-[10px] uppercase tracking-[0.12em]",
          ok ? "text-verified" : optional ? "text-muted-foreground" : "text-risk",
        )}
      >
        {ok ? "Ready" : optional ? "Optional" : "Blocked"}
      </span>
    </div>
  );
}
