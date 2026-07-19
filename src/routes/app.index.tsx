import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { PageBody, PageHeader, EmptyState, LoadingState, ErrorState } from "@/components/app/page";
import { StatusBadge } from "@/components/app/status-badge";
import { MetricCard } from "@/components/app/ui/metric-card";
import { SectionHeader } from "@/components/app/ui/section-header";
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  Calendar,
  CheckCircle2,
  DollarSign,
  FileCheck2,
  Gauge,
  Inbox,
  MapPin,
  PhoneCall,
  PlusCircle,
  Sparkles,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { statusTone, workflowLabel, WORKFLOW_STATUSES, type WorkflowStatus } from "@/lib/workflow";

export const Route = createFileRoute("/app/")({
  head: () => ({ meta: [{ title: "Command Center — BidPilot AI" }] }),
  component: WorkspacePage,
});

type NegotiationRow = {
  id: string;
  title: string;
  workflow_status: string;
  origin_address: string | null;
  destination_address: string | null;
  moving_date: string | null;
  updated_at: string;
  providers: { count: number }[];
  calls: { count: number }[];
};

type Metrics = {
  totalNegotiations: number;
  activeNegotiations: number;
  totalCalls: number;
  usableQuotes: number;
  verifiedSavings: number;
  hasVerifiedSavings: boolean;
};

// Statuses that flag "needs attention"
const NEEDS_ATTENTION: readonly WorkflowStatus[] = [
  "CLARIFICATION_REQUIRED",
  "AWAITING_HUMAN_APPROVAL",
  "READY_TO_NEGOTIATE",
  "NEGOTIATING",
];

const ACTIVE_STATUSES: readonly WorkflowStatus[] = WORKFLOW_STATUSES.filter(
  (s) => s !== "DRAFT" && s !== "REPORT_READY" && s !== "NEGOTIATION_COMPLETE" && s !== "FAILED",
);

function formatDate(d: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatMoney(n: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
}

function formatRelative(d: string) {
  const diff = Date.now() - new Date(d).getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return `${days}d ago`;
}

function daysUntil(d: string | null): number | null {
  if (!d) return null;
  const ms = new Date(d).getTime() - Date.now();
  return Math.ceil(ms / (1000 * 60 * 60 * 24));
}

/**
 * Deterministic "Attention now" rule.
 * Priority (first match wins):
 *   1. workflow_status in NEEDS_ATTENTION set
 *   2. active status AND moving_date within 14 days (and not past)
 *   3. active status AND updated in last 7 days (most recent first)
 * Returns null when nothing qualifies (positive empty state).
 */
function pickAttention(rows: NegotiationRow[] | undefined): {
  row: NegotiationRow;
  reason: string;
} | null {
  if (!rows || rows.length === 0) return null;

  const byStatus = rows.find((r) => NEEDS_ATTENTION.includes(r.workflow_status as WorkflowStatus));
  if (byStatus) return { row: byStatus, reason: workflowLabel(byStatus.workflow_status) };

  const byDate = rows
    .filter((r) => ACTIVE_STATUSES.includes(r.workflow_status as WorkflowStatus))
    .map((r) => ({ r, d: daysUntil(r.moving_date) }))
    .filter((x) => x.d !== null && x.d >= 0 && x.d <= 14)
    .sort((a, b) => a.d! - b.d!)[0];
  if (byDate)
    return { row: byDate.r, reason: `Move in ${byDate.d} day${byDate.d === 1 ? "" : "s"}` };

  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const recent = rows
    .filter(
      (r) =>
        ACTIVE_STATUSES.includes(r.workflow_status as WorkflowStatus) &&
        new Date(r.updated_at).getTime() > weekAgo,
    )
    .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())[0];
  if (recent) return { row: recent, reason: `Updated ${formatRelative(recent.updated_at)}` };

  return null;
}

function useDisplayName() {
  const { user } = useAuth();
  const profile = useQuery({
    queryKey: ["profile", user?.id],
    enabled: !!user,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("full_name")
        .eq("id", user!.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const full = profile.data?.full_name?.trim();
  if (full) return full.split(" ")[0] ?? full;
  const local = user?.email?.split("@")[0]?.trim();
  // Reject awkward numeric-only or single-char locals
  if (local && local.length >= 2 && !/^\d+$/.test(local)) return local;
  return null;
}

function WorkspacePage() {
  const { user } = useAuth();
  const displayName = useDisplayName();

  const negotiations = useQuery({
    queryKey: ["negotiations", user?.id],
    enabled: !!user,
    queryFn: async (): Promise<NegotiationRow[]> => {
      const { data, error } = await supabase
        .from("negotiations")
        .select(
          "id, title, workflow_status, origin_address, destination_address, moving_date, updated_at, providers(count), calls(count)",
        )
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return (data as unknown as NegotiationRow[]) ?? [];
    },
  });

  const metrics = useQuery({
    queryKey: ["command-center-metrics", user?.id],
    enabled: !!user,
    queryFn: async (): Promise<Metrics> => {
      const [negC, activeC, callsC, usableQuotesC, savings] = await Promise.all([
        supabase.from("negotiations").select("id", { count: "exact", head: true }),
        supabase
          .from("negotiations")
          .select("id", { count: "exact", head: true })
          .not("workflow_status", "in", "(REPORT_READY,NEGOTIATION_COMPLETE,FAILED,DRAFT)"),
        supabase.from("calls").select("id", { count: "exact", head: true }),
        supabase
          .from("quotes")
          .select("id", { count: "exact", head: true })
          .eq("verification_status", "verified"),
        supabase
          .from("calls")
          .select("verified_savings_amount")
          .not("verified_savings_amount", "is", null),
      ]);
      if (negC.error) throw negC.error;
      if (activeC.error) throw activeC.error;
      if (callsC.error) throw callsC.error;
      if (usableQuotesC.error) throw usableQuotesC.error;
      if (savings.error) throw savings.error;
      const savingsRows = savings.data ?? [];
      const verifiedSavings = savingsRows.reduce(
        (acc, r) => acc + Number(r.verified_savings_amount ?? 0),
        0,
      );
      return {
        totalNegotiations: negC.count ?? 0,
        activeNegotiations: activeC.count ?? 0,
        totalCalls: callsC.count ?? 0,
        usableQuotes: usableQuotesC.count ?? 0,
        verifiedSavings,
        // "Not available" if no negotiation has ever produced a savings-eligible call
        hasVerifiedSavings: savingsRows.length > 0,
      };
    },
  });

  const recentEvents = useQuery({
    queryKey: ["command-center-events", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("agent_events")
        .select("id, agent_name, event_type, event_status, summary, created_at, negotiation_id")
        .order("created_at", { ascending: false })
        .limit(6);
      if (error) throw error;
      return data ?? [];
    },
  });

  const attention = pickAttention(negotiations.data);

  return (
    <>
      <PageHeader
        eyebrow="Command center"
        title={displayName ? `Welcome back, ${displayName}` : "Welcome back"}
        description="Every number is derived from your real negotiations, calls, and verified savings. Metrics without persisted data show as “Not available.”"
        actions={
          <Button asChild size="lg">
            <Link to="/app/negotiations/new" search={{ id: undefined, step: 1 }}>
              <PlusCircle className="mr-1.5 size-4" /> New negotiation
            </Link>
          </Button>
        }
      />
      <PageBody>
        {/* Attention now */}
        {negotiations.isLoading ? null : attention ? (
          <div className="mb-6 flex flex-col gap-4 rounded-2xl border border-warn/40 bg-warn-soft/60 p-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-start gap-3">
              <div className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-full bg-warn/20 text-warn-foreground">
                <AlertTriangle className="size-4" />
              </div>
              <div className="min-w-0">
                <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-warn-foreground/80">
                  Attention now · {attention.reason}
                </div>
                <h3 className="mt-0.5 truncate font-display text-lg font-semibold">
                  {attention.row.title}
                </h3>
                <div className="mt-0.5 text-sm text-muted-foreground">
                  <StatusBadge tone={statusTone(attention.row.workflow_status)}>
                    {workflowLabel(attention.row.workflow_status)}
                  </StatusBadge>
                  {attention.row.moving_date && (
                    <span className="ml-2 inline-flex items-center gap-1 text-xs">
                      <Calendar className="size-3" />
                      {formatDate(attention.row.moving_date)}
                    </span>
                  )}
                </div>
              </div>
            </div>
            <Button asChild variant="default" className="shrink-0">
              <Link to="/app/negotiations/$id/overview" params={{ id: attention.row.id }}>
                Open <ArrowUpRight className="ml-1 size-4" />
              </Link>
            </Button>
          </div>
        ) : negotiations.data && negotiations.data.length > 0 ? (
          <div className="mb-6 flex items-center gap-3 rounded-2xl border border-verified/30 bg-verified-soft/60 p-4 text-sm">
            <CheckCircle2 className="size-4 text-verified" />
            <span className="font-medium">Nothing needs your attention right now.</span>
            <span className="text-muted-foreground">
              All active negotiations are on track. Create a new one when you're ready.
            </span>
          </div>
        ) : null}

        {/* Metrics */}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard
            label="Negotiations"
            icon={Gauge}
            value={metrics.data ? metrics.data.totalNegotiations : "—"}
            hint={metrics.data ? `${metrics.data.activeNegotiations} active` : "Loading…"}
          />
          <MetricCard
            label="Provider calls"
            icon={PhoneCall}
            value={metrics.data ? metrics.data.totalCalls : "—"}
            hint="Completed across all negotiations"
          />
          <MetricCard
            label="Usable quotes"
            icon={FileCheck2}
            value={metrics.data ? metrics.data.usableQuotes : "—"}
            hint="Verification status: verified"
          />
          <MetricCard
            label="Verified savings"
            icon={DollarSign}
            tone={metrics.data?.hasVerifiedSavings ? "verified" : "default"}
            value={
              !metrics.data
                ? "—"
                : metrics.data.hasVerifiedSavings
                  ? formatMoney(metrics.data.verifiedSavings)
                  : "Not available"
            }
            hint={
              metrics.data?.hasVerifiedSavings
                ? "Server-verified quote-vs-quote deltas"
                : "No savings-eligible calls yet"
            }
          />
        </div>

        {/* Recent negotiations */}
        <div className="mt-8">
          <SectionHeader
            title="Recent negotiations"
            description="Your five most recently updated negotiations."
            actions={
              <Button asChild size="sm" variant="outline">
                <Link to="/app/negotiations">
                  View all <ArrowUpRight className="ml-1 size-3.5" />
                </Link>
              </Button>
            }
          />

          {negotiations.isLoading ? (
            <LoadingState label="Loading negotiations" />
          ) : negotiations.isError ? (
            <ErrorState
              title="Couldn't load negotiations"
              description={(negotiations.error as Error).message}
              onRetry={() => negotiations.refetch()}
            />
          ) : !negotiations.data || negotiations.data.length === 0 ? (
            <EmptyState
              icon={Inbox}
              title="No negotiations yet"
              description="Create your first negotiation to build a confirmed moving specification and start collecting itemized quotes."
              action={
                <Button asChild>
                  <Link to="/app/negotiations/new" search={{ id: undefined, step: 1 }}>
                    <Sparkles className="mr-1.5 size-4" /> Start a negotiation
                  </Link>
                </Button>
              }
            />
          ) : (
            <div className="overflow-hidden rounded-lg border border-border/70 bg-card">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/40 text-left text-[11px] uppercase tracking-[0.1em] text-muted-foreground">
                    <th className="px-4 py-2.5 font-medium">Negotiation</th>
                    <th className="px-4 py-2.5 font-medium">Route</th>
                    <th className="px-4 py-2.5 font-medium">Move date</th>
                    <th className="px-4 py-2.5 text-right font-medium">Providers</th>
                    <th className="px-4 py-2.5 text-right font-medium">Calls</th>
                    <th className="px-4 py-2.5 font-medium">Status</th>
                    <th className="px-4 py-2.5 text-right font-medium">Updated</th>
                    <th className="px-4 py-2.5" />
                  </tr>
                </thead>
                <tbody>
                  {negotiations.data.slice(0, 5).map((n) => {
                    const providerCount = n.providers?.[0]?.count ?? 0;
                    const callCount = n.calls?.[0]?.count ?? 0;
                    return (
                      <tr
                        key={n.id}
                        className="group border-t border-border/60 transition-colors hover:bg-muted/30"
                      >
                        <td className="px-4 py-3">
                          <Link
                            to="/app/negotiations/$id/overview"
                            params={{ id: n.id }}
                            className="font-display font-semibold tracking-tight text-foreground hover:text-primary"
                          >
                            {n.title}
                          </Link>
                          <div className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                            #{n.id.slice(0, 8)}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">
                          <span className="inline-flex items-center gap-1">
                            <MapPin className="size-3" />
                            <span className="max-w-[9rem] truncate">{n.origin_address ?? "—"}</span>
                            <span className="opacity-40">→</span>
                            <span className="max-w-[9rem] truncate">
                              {n.destination_address ?? "—"}
                            </span>
                          </span>
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">
                          <span className="inline-flex items-center gap-1">
                            <Calendar className="size-3" />
                            {formatDate(n.moving_date)}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-xs tabular-nums">
                          {providerCount}
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-xs tabular-nums">
                          {callCount}
                        </td>
                        <td className="px-4 py-3">
                          <StatusBadge tone={statusTone(n.workflow_status)}>
                            {workflowLabel(n.workflow_status)}
                          </StatusBadge>
                        </td>
                        <td className="px-4 py-3 text-right text-xs text-muted-foreground">
                          {formatRelative(n.updated_at)}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <Link
                            to="/app/negotiations/$id/overview"
                            params={{ id: n.id }}
                            className="inline-flex items-center gap-1 text-xs text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                          >
                            Open <ArrowUpRight className="size-3" />
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Compact event timeline */}
        {recentEvents.data && recentEvents.data.length > 0 && (
          <div className="mt-10">
            <SectionHeader
              title="Latest agent activity"
              description="Live agent events, most recent first."
            />
            <ol className="relative rounded-lg border border-border/70 bg-card">
              {recentEvents.data.map((e, i) => (
                <li
                  key={e.id}
                  className="relative flex items-start gap-3 border-b border-border/50 px-4 py-3 last:border-b-0"
                >
                  <div className="mt-1.5 grid size-6 shrink-0 place-items-center">
                    <span
                      className={`size-2 rounded-full ${
                        e.event_status === "success" || e.event_status === "verified"
                          ? "bg-verified"
                          : e.event_status === "failure" || e.event_status === "error"
                            ? "bg-risk"
                            : e.event_status === "warning"
                              ? "bg-warn"
                              : "bg-muted-foreground/50"
                      }`}
                    />
                    {i < recentEvents.data.length - 1 && (
                      <span className="absolute left-[calc(1rem+0.375rem)] top-6 bottom-0 w-px bg-border" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <span className="text-sm font-medium">{e.agent_name ?? "Agent"}</span>
                      {e.event_type && (
                        <span className="font-mono text-[11px] uppercase tracking-[0.1em] text-muted-foreground">
                          {e.event_type}
                        </span>
                      )}
                    </div>
                    {e.summary && (
                      <p className="mt-0.5 text-xs text-muted-foreground">{e.summary}</p>
                    )}
                  </div>
                  <div className="shrink-0 text-right">
                    {e.event_status && <StatusBadge tone="neutral">{e.event_status}</StatusBadge>}
                    <div className="mt-1 font-mono text-[10px] text-muted-foreground">
                      {formatRelative(e.created_at)}
                    </div>
                  </div>
                </li>
              ))}
              <li className="border-t border-border/60 px-4 py-2 text-center">
                <span className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                  <Activity className="size-3" /> live · updates on refresh
                </span>
              </li>
            </ol>
          </div>
        )}
      </PageBody>
    </>
  );
}
