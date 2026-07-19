import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { PageBody, LoadingState, ErrorState } from "@/components/app/page";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/app/status-badge";
import {
  ArrowRight,
  BadgeCheck,
  Check,
  ChevronRight,
  CircleDashed,
  DollarSign,
  FileCheck2,
  Hash,
  PhoneCall,
  Radio,
  ReceiptText,
  ShieldAlert,
  TriangleAlert,
  Users,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { nextAction, statusTone, workflowLabel } from "@/lib/workflow";

export const Route = createFileRoute("/app/negotiations/$id/overview")({
  head: () => ({ meta: [{ title: "Overview — BidPilot AI" }] }),
  component: OverviewPage,
});

/* ------------------------------------------------------------------ */
/* 7-phase user-facing pipeline (mapped from 14 workflow_status values) */
/* ------------------------------------------------------------------ */

type Phase = "intake" | "confirm" | "providers" | "calls" | "negotiate" | "evidence" | "report";

const PHASES: { key: Phase; label: string; short: string }[] = [
  { key: "intake", label: "Intake", short: "Intake" },
  { key: "confirm", label: "Confirm spec", short: "Confirm" },
  { key: "providers", label: "Providers", short: "Providers" },
  { key: "calls", label: "Provider calls", short: "Calls" },
  { key: "negotiate", label: "Negotiate", short: "Negotiate" },
  { key: "evidence", label: "Evidence", short: "Evidence" },
  { key: "report", label: "Report", short: "Report" },
];

function currentPhase(
  status: string,
  hasSpec: boolean,
  providerCount: number,
  callCount: number,
): Phase {
  if (status === "REPORT_READY") return "report";
  if (status === "NEGOTIATION_COMPLETE") return "evidence";
  if (
    status === "NEGOTIATING" ||
    status === "READY_TO_NEGOTIATE" ||
    status === "AWAITING_HUMAN_APPROVAL" ||
    status === "CLARIFICATION_REQUIRED"
  )
    return "negotiate";
  if (
    status === "CALLING_PROVIDERS" ||
    status === "QUOTES_RECEIVED" ||
    status === "AUDITING_QUOTES"
  )
    return "calls";
  if (status === "SPEC_CONFIRMED") {
    if (providerCount === 0) return "providers";
    if (callCount === 0) return "providers";
    return "calls";
  }
  if (status === "AWAITING_CONFIRMATION") return "confirm";
  if (status === "INTAKE_IN_PROGRESS") return "intake";
  if (status === "DRAFT") return hasSpec ? "confirm" : "intake";
  return "intake";
}

function phaseIndex(p: Phase): number {
  return PHASES.findIndex((x) => x.key === p);
}

/* ------------------------------------------------------------------ */

type Overview = {
  negotiation: {
    id: string;
    title: string;
    workflow_status: string;
  };
  confirmedSpecVersion: number | null;
  confirmedSpecHash: string | null;
  providerCount: number;
  callCount: number;
  usableQuotes: number;
  verifiedSavings: number;
  risks: {
    id: string;
    created_at: string;
    event_type: string | null;
    event_status: string | null;
    summary: string | null;
  }[];
  events: {
    id: string;
    agent_name: string | null;
    event_type: string | null;
    event_status: string | null;
    summary: string | null;
    created_at: string;
  }[];
};

function formatMoney(n: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
}

function OverviewPage() {
  const { id } = Route.useParams();

  const query = useQuery({
    queryKey: ["negotiation-overview-v2", id],
    queryFn: async (): Promise<Overview> => {
      const [neg, spec, prov, calls, savings, quotes, events, risks] = await Promise.all([
        supabase
          .from("negotiations")
          .select("id, title, workflow_status")
          .eq("id", id)
          .maybeSingle(),
        supabase
          .from("job_specs")
          .select("version, specification_hash")
          .eq("negotiation_id", id)
          .eq("confirmed", true)
          .order("version", { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from("providers")
          .select("id", { count: "exact", head: true })
          .eq("negotiation_id", id),
        supabase
          .from("calls")
          .select("id", { count: "exact", head: true })
          .eq("negotiation_id", id),
        supabase
          .from("calls")
          .select("verified_savings_amount")
          .eq("negotiation_id", id)
          .not("verified_savings_amount", "is", null),
        supabase
          .from("quotes")
          .select("id, quote_stage")
          .eq("negotiation_id", id)
          .in("quote_stage", ["INITIAL", "REVISED", "FINAL"]),
        supabase
          .from("agent_events")
          .select("id, agent_name, event_type, event_status, summary, created_at")
          .eq("negotiation_id", id)
          .order("created_at", { ascending: false })
          .limit(8),
        supabase
          .from("agent_events")
          .select("id, event_type, event_status, summary, created_at")
          .eq("negotiation_id", id)
          .in("event_status", ["warning", "failure", "error"])
          .order("created_at", { ascending: false })
          .limit(5),
      ]);
      if (neg.error) throw neg.error;
      if (!neg.data) throw new Error("Negotiation not found");
      if (spec.error) throw spec.error;
      if (prov.error) throw prov.error;
      if (calls.error) throw calls.error;
      if (savings.error) throw savings.error;
      if (quotes.error) throw quotes.error;
      if (events.error) throw events.error;
      if (risks.error) throw risks.error;

      const verifiedSavings = (savings.data ?? []).reduce(
        (acc, r) => acc + Number(r.verified_savings_amount ?? 0),
        0,
      );
      // "Usable quotes" = distinct call+provider groups that reached at least FINAL or REVISED
      const usableStages = (quotes.data ?? []).filter(
        (q) => q.quote_stage === "FINAL" || q.quote_stage === "REVISED",
      ).length;

      return {
        negotiation: neg.data,
        confirmedSpecVersion: spec.data?.version ?? null,
        confirmedSpecHash: spec.data?.specification_hash ?? null,
        providerCount: prov.count ?? 0,
        callCount: calls.count ?? 0,
        usableQuotes: usableStages,
        verifiedSavings,
        risks: risks.data ?? [],
        events: events.data ?? [],
      };
    },
  });

  if (query.isLoading) {
    return (
      <PageBody>
        <LoadingState label="Loading overview" />
      </PageBody>
    );
  }
  if (query.isError || !query.data) {
    return (
      <PageBody>
        <ErrorState
          title="Couldn't load this negotiation"
          description={
            (query.error as Error | undefined)?.message ??
            "It may not exist or you don't have access."
          }
          onRetry={() => query.refetch()}
        />
      </PageBody>
    );
  }

  const {
    negotiation,
    confirmedSpecVersion,
    confirmedSpecHash,
    providerCount,
    callCount,
    usableQuotes,
    verifiedSavings,
    risks,
    events,
  } = query.data;

  const hasSpec = confirmedSpecVersion !== null;
  const isFailed = negotiation.workflow_status === "FAILED";
  const isReportReady = negotiation.workflow_status === "REPORT_READY";
  const phase = currentPhase(negotiation.workflow_status, hasSpec, providerCount, callCount);
  const phaseIdx = phaseIndex(phase);
  const next = nextAction(negotiation.workflow_status, hasSpec, providerCount);

  return (
    <PageBody>
      {/* ─── Command bar ─────────────────────────────────────────── */}
      <section
        className="rounded-2xl border border-border/70 bg-gradient-to-br from-card via-card to-secondary/40 p-5 shadow-sm sm:p-6"
        aria-label="Negotiation status"
      >
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-4 sm:flex sm:flex-wrap sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-[11px] font-mono uppercase tracking-[0.16em] text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <span
                  className={`inline-block size-1.5 rounded-full ${
                    isFailed
                      ? "bg-risk"
                      : isReportReady
                        ? "bg-verified"
                        : "bg-primary animate-pulse"
                  }`}
                />
                {isFailed ? "Halted" : isReportReady ? "Complete" : "In progress"}
              </span>
              <span className="text-border">·</span>
              <span>
                Phase {phaseIdx + 1} of {PHASES.length}
              </span>
            </div>
            <h2 className="mt-1 truncate font-display text-lg font-semibold tracking-tight text-foreground sm:text-xl">
              {PHASES[phaseIdx]?.label ?? "Overview"}
            </h2>
            <p className="mt-1 max-w-xl text-[13.5px] leading-[1.55] text-muted-foreground">
              {phaseCopy(phase, { hasSpec, providerCount, callCount, isFailed })}
            </p>
          </div>
          <StatusBadge tone={statusTone(negotiation.workflow_status)}>
            {workflowLabel(negotiation.workflow_status)}
          </StatusBadge>
        </div>

        {/* Horizontal 7-phase pipeline */}
        <ol
          className="mt-5 grid grid-cols-4 gap-x-2 gap-y-4 sm:grid-cols-7"
          role="list"
          aria-label="Workflow phases"
        >
          {PHASES.map((p, i) => {
            const done = !isFailed && i < phaseIdx;
            const active = i === phaseIdx && !isFailed;
            const halted = isFailed && i === phaseIdx;
            return (
              <li key={p.key} className="relative flex flex-col items-start gap-1.5">
                {/* connector */}
                {i < PHASES.length - 1 ? (
                  <span
                    aria-hidden
                    className={`absolute top-3 hidden h-px sm:block ${
                      done ? "bg-verified/60" : "bg-border"
                    }`}
                    style={{ left: "1.75rem", right: "-0.5rem" }}
                  />
                ) : null}
                <span
                  className={`relative z-10 grid size-6 shrink-0 place-items-center rounded-full border transition-colors ${
                    done
                      ? "border-verified/40 bg-verified-soft text-verified"
                      : active
                        ? "border-primary/50 bg-primary/10 text-primary ring-4 ring-primary/10"
                        : halted
                          ? "border-risk/40 bg-risk-soft text-risk"
                          : "border-border bg-card text-muted-foreground"
                  }`}
                >
                  {done ? (
                    <Check className="size-3" />
                  ) : halted ? (
                    <TriangleAlert className="size-3" />
                  ) : active ? (
                    <span className="size-1.5 rounded-full bg-primary" />
                  ) : (
                    <CircleDashed className="size-3" />
                  )}
                </span>
                <span
                  className={`text-[11.5px] font-medium sm:text-xs ${
                    active ? "text-foreground" : "text-muted-foreground"
                  }`}
                >
                  <span className="sm:hidden">{p.short}</span>
                  <span className="hidden sm:inline">{p.label}</span>
                </span>
              </li>

            );
          })}
        </ol>

        {/* Next action */}
        <div className="mt-5 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-xl border border-primary/20 bg-primary/5 px-4 py-3">
          <div className="min-w-0">
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-primary/80">
              Next action
            </div>
            <div className="mt-0.5 truncate text-sm font-semibold text-foreground">
              {isFailed
                ? "Review halted state before continuing"
                : nextActionCopy(phase, { hasSpec, providerCount, callCount })}
            </div>
          </div>
          <Button asChild size="sm" disabled={isFailed} className="shrink-0">
            <Link
              to={`/app/negotiations/$id/${next.to}` as "/app/negotiations/$id/intake"}
              params={{ id }}
            >
              {next.label}
              <ArrowRight className="ml-1 size-3.5" />
            </Link>
          </Button>
        </div>
      </section>

      {/* ─── Metric strip ────────────────────────────────────────── */}
      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <TightMetric
          label="Confirmed spec"
          icon={FileCheck2}
          tone={hasSpec ? "verified" : "warn"}
          value={hasSpec ? `v${confirmedSpecVersion}` : "None"}
          mono={hasSpec && confirmedSpecHash ? confirmedSpecHash.slice(0, 10) : undefined}
        />
        <TightMetric label="Providers" icon={Users} value={String(providerCount)} />
        <TightMetric
          label="Calls"
          icon={PhoneCall}
          value={String(callCount)}
          hint={callCount === 0 ? "No calls yet" : undefined}
        />
        <TightMetric
          label="Usable quotes"
          icon={ReceiptText}
          value={String(usableQuotes)}
          tone={usableQuotes > 0 ? "verified" : "neutral"}
          hint={usableQuotes === 0 ? "REVISED/FINAL only" : undefined}
        />
        <TightMetric
          label="Verified savings"
          icon={DollarSign}
          tone="verified"
          value={formatMoney(verifiedSavings)}
          hint="Server-computed"
        />
      </div>

      {/* ─── Two-column: risks + activity ────────────────────────── */}
      <div className="mt-6 grid gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        {/* Unresolved risks */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
            <div className="flex items-center gap-2">
              <span className="grid size-7 place-items-center rounded-lg bg-warn-soft text-warn-foreground">
                <ShieldAlert className="size-3.5" />
              </span>
              <CardTitle className="text-sm font-semibold">Unresolved risks</CardTitle>
            </div>
            <span className="rounded-full border border-border bg-secondary px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
              {risks.length} open
            </span>
          </CardHeader>
          <CardContent>
            {risks.length === 0 ? (
              <div className="flex items-center gap-3 rounded-lg border border-dashed border-border/70 bg-secondary/40 px-4 py-6 text-sm text-muted-foreground">
                <BadgeCheck className="size-4 text-verified" />
                No warnings or failures. Every recent agent event succeeded.
              </div>
            ) : (
              <ul className="divide-y divide-border/60 rounded-lg border border-border/60 bg-card">
                {risks.map((r) => (
                  <li key={r.id} className="flex items-start gap-3 px-3.5 py-2.5">
                    <span
                      className={`mt-0.5 grid size-6 shrink-0 place-items-center rounded-md ${
                        r.event_status === "failure" || r.event_status === "error"
                          ? "bg-risk-soft text-risk"
                          : "bg-warn-soft text-warn-foreground"
                      }`}
                    >
                      <TriangleAlert className="size-3" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-[13px] font-medium">
                          {r.event_type ?? "Agent event"}
                        </span>
                        <span className="rounded bg-secondary px-1.5 py-0.5 font-mono text-[9.5px] uppercase tracking-[0.14em] text-muted-foreground">
                          {r.event_status ?? "warning"}
                        </span>
                      </div>
                      {r.summary ? (
                        <p className="mt-0.5 line-clamp-2 text-[12.5px] leading-[1.5] text-muted-foreground">
                          {r.summary}
                        </p>
                      ) : null}
                    </div>
                    <span className="shrink-0 self-center font-mono text-[10.5px] text-muted-foreground">
                      {new Date(r.created_at).toLocaleTimeString(undefined, {
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Recent activity */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
            <div className="flex items-center gap-2">
              <span className="grid size-7 place-items-center rounded-lg bg-primary/10 text-primary">
                <Radio className="size-3.5" />
              </span>
              <CardTitle className="text-sm font-semibold">Recent activity</CardTitle>
            </div>
            <Link
              to="/app/negotiations/$id/control-room"
              params={{ id }}
              className="inline-flex items-center gap-1 rounded-full border border-border bg-secondary px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground transition hover:border-primary/30 hover:text-foreground"
            >
              Control Room <ChevronRight className="size-3" />
            </Link>
          </CardHeader>
          <CardContent>
            {events.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border/70 bg-secondary/40 px-4 py-8 text-center text-sm text-muted-foreground">
                No agent activity yet. Events will appear here as the workflow advances.
              </div>
            ) : (
              <ol className="relative ml-2 space-y-2.5 border-l border-border/70 pl-4">
                {events.map((e) => {
                  const tone = eventTone(e.event_status);
                  return (
                    <li key={e.id} className="relative">
                      <span
                        aria-hidden
                        className={`absolute -left-[1.34rem] top-2 grid size-3 place-items-center rounded-full ring-4 ring-card ${toneDot(tone)}`}
                      />
                      <div className="rounded-lg border border-border/60 bg-card px-3 py-2">
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-[13px] font-medium">
                            {e.event_type ?? "event"}
                          </span>
                          <span className="shrink-0 font-mono text-[10.5px] text-muted-foreground">
                            {new Date(e.created_at).toLocaleTimeString(undefined, {
                              hour: "numeric",
                              minute: "2-digit",
                            })}
                          </span>
                        </div>
                        {e.summary ? (
                          <p className="mt-0.5 line-clamp-2 text-[12.5px] leading-[1.5] text-muted-foreground">
                            {e.summary}
                          </p>
                        ) : null}
                        <div className="mt-1.5 flex items-center gap-2 text-[10.5px] text-muted-foreground">
                          <span className="font-mono uppercase tracking-[0.14em]">
                            {e.agent_name ?? "agent"}
                          </span>
                          {e.event_status ? (
                            <>
                              <span>·</span>
                              <span
                                className={`rounded px-1.5 py-[1px] font-mono uppercase tracking-[0.14em] ${toneChip(tone)}`}
                              >
                                {e.event_status}
                              </span>
                            </>
                          ) : null}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
          </CardContent>
        </Card>
      </div>
    </PageBody>
  );
}

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

function phaseCopy(
  phase: Phase,
  ctx: { hasSpec: boolean; providerCount: number; callCount: number; isFailed: boolean },
): string {
  if (ctx.isFailed) return "The workflow is halted. Review the risks below.";
  switch (phase) {
    case "intake":
      return "Capture the customer's authority, addresses, inventory, and access details.";
    case "confirm":
      return "Lock the specification. Hash-verify it so every provider sees the same scope.";
    case "providers":
      return ctx.providerCount === 0
        ? "Add the providers you want to negotiate against."
        : "Providers are ready. Start a live call from the Control Room.";
    case "calls":
      return "Run structured calls. Every quote and line item is captured against the confirmed spec.";
    case "negotiate":
      return "Apply verified leverage from other providers to close the strongest evidence-backed offer.";
    case "evidence":
      return "Reconciling transcripts, line items, and price changes against the confirmed spec.";
    case "report":
      return "The final ranked report is ready with server-verified savings.";
  }
}

function nextActionCopy(
  phase: Phase,
  ctx: { hasSpec: boolean; providerCount: number; callCount: number },
): string {
  switch (phase) {
    case "intake":
      return "Complete intake — customer, route, and access conditions.";
    case "confirm":
      return "Confirm the specification to lock the scope.";
    case "providers":
      return ctx.providerCount === 0
        ? "Add at least one provider."
        : "Open the Control Room and start a call.";
    case "calls":
      return ctx.callCount === 0
        ? "Run your first provider call."
        : "Capture the remaining quotes.";
    case "negotiate":
      return "Use verified leverage from your best provider to close the deal.";
    case "evidence":
      return "Review the reconciled evidence before generating the report.";
    case "report":
      return "Open the ranked recommendation.";
  }
}

type EventTone = "verified" | "warn" | "risk" | "neutral";
function eventTone(status: string | null | undefined): EventTone {
  if (!status) return "neutral";
  const s = status.toLowerCase();
  if (s === "success" || s === "completed") return "verified";
  if (s === "warning") return "warn";
  if (s === "failure" || s === "error") return "risk";
  return "neutral";
}
function toneDot(tone: EventTone): string {
  if (tone === "verified") return "bg-verified";
  if (tone === "warn") return "bg-warn";
  if (tone === "risk") return "bg-risk";
  return "bg-muted-foreground/60";
}
function toneChip(tone: EventTone): string {
  if (tone === "verified") return "bg-verified-soft text-verified";
  if (tone === "warn") return "bg-warn-soft text-warn-foreground";
  if (tone === "risk") return "bg-risk-soft text-risk";
  return "bg-secondary text-muted-foreground";
}

/* ------------------------------------------------------------------ */
/* Tight metric card                                                   */
/* ------------------------------------------------------------------ */

function TightMetric({
  label,
  icon: Icon,
  value,
  hint,
  mono,
  tone,
}: {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  value: string;
  hint?: string;
  mono?: string;
  tone?: "verified" | "warn" | "neutral";
}) {
  const iconClass =
    tone === "verified"
      ? "bg-verified-soft text-verified"
      : tone === "warn"
        ? "bg-warn-soft text-warn-foreground"
        : "bg-secondary text-muted-foreground";
  return (
    <div className="rounded-xl border border-border/70 bg-card px-4 py-3.5 shadow-sm">
      <div className="flex items-center gap-2">
        <span className={`grid size-6 shrink-0 place-items-center rounded-md ${iconClass}`}>
          <Icon className="size-3.5" />
        </span>
        <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
          {label}
        </span>
      </div>
      <div className="mt-2 flex items-baseline gap-2">
        <span
          className={`font-display text-[22px] font-semibold tabular-nums ${
            tone === "verified" ? "text-verified" : "text-foreground"
          }`}
        >
          {value}
        </span>
        {mono ? (
          <span className="flex items-center gap-0.5 font-mono text-[10.5px] text-muted-foreground">
            <Hash className="size-2.5" />
            {mono}
          </span>
        ) : null}
      </div>
      {hint ? <p className="mt-1 truncate text-[11.5px] text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
