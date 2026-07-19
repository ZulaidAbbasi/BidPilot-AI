import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { PageBody, LoadingState, ErrorState } from "@/components/app/page";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/app/status-badge";
import { MetricCard } from "@/components/app/ui/metric-card";
import { SectionHeader } from "@/components/app/ui/section-header";
import { Check, CircleDashed, DollarSign, FileCheck2, PhoneCall, TriangleAlert, Users } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  WORKFLOW_STAGES,
  nextAction,
  statusTone,
  workflowLabel,
  workflowStageIndex,
} from "@/lib/workflow";

export const Route = createFileRoute("/app/negotiations/$id/overview")({
  head: () => ({ meta: [{ title: "Overview — BidPilot AI" }] }),
  component: OverviewPage,
});

type Overview = {
  negotiation: {
    id: string;
    title: string;
    workflow_status: string;
  };
  confirmedSpecVersion: number | null;
  providerCount: number;
  callCount: number;
  verifiedSavings: number;
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
    queryKey: ["negotiation-overview", id],
    queryFn: async (): Promise<Overview> => {
      const [neg, spec, prov, calls, savings, events] = await Promise.all([
        supabase
          .from("negotiations")
          .select("id, title, workflow_status")
          .eq("id", id)
          .maybeSingle(),
        supabase
          .from("job_specs")
          .select("version")
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
          .from("agent_events")
          .select("id, agent_name, event_type, event_status, summary, created_at")
          .eq("negotiation_id", id)
          .order("created_at", { ascending: false })
          .limit(6),
      ]);
      if (neg.error) throw neg.error;
      if (!neg.data) throw new Error("Negotiation not found");
      if (spec.error) throw spec.error;
      if (prov.error) throw prov.error;
      if (calls.error) throw calls.error;
      if (savings.error) throw savings.error;
      if (events.error) throw events.error;
      const verifiedSavings = (savings.data ?? []).reduce(
        (acc, r) => acc + Number(r.verified_savings_amount ?? 0),
        0,
      );
      return {
        negotiation: neg.data,
        confirmedSpecVersion: spec.data?.version ?? null,
        providerCount: prov.count ?? 0,
        callCount: calls.count ?? 0,
        verifiedSavings,
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

  const { negotiation, confirmedSpecVersion, providerCount, callCount, verifiedSavings, events } =
    query.data;
  const hasSpec = confirmedSpecVersion !== null;
  const currentStageIndex = workflowStageIndex(negotiation.workflow_status);
  const next = nextAction(negotiation.workflow_status, hasSpec, providerCount);
  const isFailed = negotiation.workflow_status === "FAILED";
  const totalStages = WORKFLOW_STAGES.length;
  const progressPct = Math.round(((currentStageIndex + 1) / totalStages) * 100);

  return (
    <PageBody>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          label="Confirmed spec"
          icon={FileCheck2}
          tone={hasSpec ? "verified" : "warn"}
          value={hasSpec ? `v${confirmedSpecVersion}` : "None"}
          hint={hasSpec ? "Hash-locked for all providers" : "Lock the spec to unlock calls"}
        />
        <MetricCard
          label="Providers"
          icon={Users}
          value={providerCount}
          hint={providerCount === 0 ? "Add vetted providers" : "Sourced for this negotiation"}
        />
        <MetricCard
          label="Calls"
          icon={PhoneCall}
          value={callCount}
          hint={callCount === 0 ? "No calls yet" : "Rehearsals + live"}
        />
        <MetricCard
          label="Verified savings"
          icon={DollarSign}
          tone="verified"
          value={formatMoney(verifiedSavings)}
          hint="Only backed by transcripts"
        />
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
            <div>
              <CardTitle className="text-sm font-semibold">Workflow pipeline</CardTitle>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Stage {currentStageIndex + 1} of {totalStages} · {progressPct}%
              </p>
            </div>
            <StatusBadge tone={statusTone(negotiation.workflow_status)}>
              {workflowLabel(negotiation.workflow_status)}
            </StatusBadge>
          </CardHeader>
          <CardContent>
            {/* Progress rail */}
            <div className="mb-4 h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className={`h-full rounded-full transition-all ${
                  isFailed ? "bg-risk" : "bg-verified"
                }`}
                style={{ width: `${progressPct}%` }}
              />
            </div>
            <ul className="grid gap-1">
              {WORKFLOW_STAGES.map((s, i) => {
                const done = !isFailed && i < currentStageIndex;
                const active = i === currentStageIndex;
                const halted = isFailed && i === currentStageIndex;
                return (
                  <li
                    key={s.key}
                    className={`flex items-center gap-3 rounded-md px-2 py-1.5 text-sm ${
                      active ? "bg-muted/60" : ""
                    }`}
                  >
                    <span
                      className={`inline-flex size-5 shrink-0 items-center justify-center rounded-full border ${
                        done
                          ? "border-verified/40 bg-verified-soft text-verified"
                          : halted
                            ? "border-risk/40 bg-risk-soft text-risk"
                            : active
                              ? "border-warn/50 bg-warn-soft text-warn-foreground"
                              : "border-border bg-card text-muted-foreground"
                      }`}
                    >
                      {done ? (
                        <Check className="size-3" />
                      ) : halted ? (
                        <TriangleAlert className="size-3" />
                      ) : (
                        <CircleDashed className="size-3" />
                      )}
                    </span>
                    <span className={`flex-1 ${active ? "font-medium" : ""}`}>{s.label}</span>
                    <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
                      {done ? "done" : active ? "active" : halted ? "halted" : "pending"}
                    </span>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-semibold">Next action</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="mb-3 text-xs text-muted-foreground">
                {isFailed
                  ? "This negotiation is halted. Review and start a fresh negotiation to continue."
                  : "Move forward with the next step in the pipeline."}
              </p>
              <Button asChild className="w-full" disabled={isFailed}>
                <Link
                  to={`/app/negotiations/$id/${next.to}` as "/app/negotiations/$id/intake"}
                  params={{ id }}
                >
                  {next.label}
                </Link>
              </Button>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-semibold">At a glance</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <Row label="Status" value={workflowLabel(negotiation.workflow_status)} />
              <Row
                label="Confirmed spec"
                value={confirmedSpecVersion !== null ? `v${confirmedSpecVersion}` : "None"}
              />
              <Row label="Providers" value={String(providerCount)} />
              <Row label="Calls" value={String(callCount)} />
            </CardContent>
          </Card>
        </div>
      </div>

      <div className="mt-8">
        <SectionHeader
          title="Recent activity"
          description="Everything BidPilot's agents have logged for this negotiation."
        />
        {events.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border/70 bg-card px-4 py-8 text-center text-sm text-muted-foreground">
            No agent activity yet. Events will appear here as the workflow advances.
          </div>
        ) : (
          <div className="rounded-lg border border-border/70 bg-card">
            <ul className="divide-y divide-border/60">
              {events.map((e) => (
                <li key={e.id} className="flex items-start justify-between gap-4 px-4 py-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">
                      {e.agent_name ?? "Agent"}
                      {e.event_type ? (
                        <span className="text-muted-foreground"> · {e.event_type}</span>
                      ) : null}
                    </p>
                    {e.summary && (
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">
                        {e.summary}
                      </p>
                    )}
                  </div>
                  <div className="shrink-0 text-right text-[11px] text-muted-foreground">
                    {e.event_status && (
                      <StatusBadge tone="neutral">{e.event_status}</StatusBadge>
                    )}
                    <div className="mt-1">
                      {new Date(e.created_at).toLocaleString(undefined, {
                        month: "short",
                        day: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </PageBody>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium tabular-nums">{value}</span>
    </div>
  );
}
