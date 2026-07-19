import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { PageBody, PageHeader, EmptyState, LoadingState, ErrorState } from "@/components/app/page";
import { StatusBadge } from "@/components/app/status-badge";
import { MetricCard } from "@/components/app/ui/metric-card";
import { SectionHeader } from "@/components/app/ui/section-header";
import {
  Activity,
  ArrowUpRight,
  Calendar,
  DollarSign,
  Gauge,
  Inbox,
  MapPin,
  PhoneCall,
  PlusCircle,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { statusTone, workflowLabel } from "@/lib/workflow";

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
  verifiedSavings: number;
};

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

function WorkspacePage() {
  const { user } = useAuth();

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
      const [negC, activeC, callsC, savings] = await Promise.all([
        supabase.from("negotiations").select("id", { count: "exact", head: true }),
        supabase
          .from("negotiations")
          .select("id", { count: "exact", head: true })
          .not("workflow_status", "in", "(REPORT_READY,NEGOTIATION_COMPLETE,FAILED,DRAFT)"),
        supabase.from("calls").select("id", { count: "exact", head: true }),
        supabase
          .from("calls")
          .select("verified_savings_amount")
          .not("verified_savings_amount", "is", null),
      ]);
      if (negC.error) throw negC.error;
      if (activeC.error) throw activeC.error;
      if (callsC.error) throw callsC.error;
      if (savings.error) throw savings.error;
      const verifiedSavings = (savings.data ?? []).reduce(
        (acc, r) => acc + Number(r.verified_savings_amount ?? 0),
        0,
      );
      return {
        totalNegotiations: negC.count ?? 0,
        activeNegotiations: activeC.count ?? 0,
        totalCalls: callsC.count ?? 0,
        verifiedSavings,
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

  return (
    <>
      <PageHeader
        eyebrow="Command center"
        title={`Welcome back${user?.email ? `, ${user.email.split("@")[0]}` : ""}`}
        description="Every number below is pulled from your real negotiations, calls, and verified savings. Nothing is fabricated."
        actions={
          <Button asChild>
            <Link to="/app/negotiations/new" search={{ id: undefined, step: 1 }}>
              <PlusCircle className="mr-1.5 size-4" /> New negotiation
            </Link>
          </Button>
        }
      />
      <PageBody>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard
            label="Negotiations"
            icon={Gauge}
            value={metrics.data?.totalNegotiations ?? "—"}
            hint={
              metrics.data
                ? `${metrics.data.activeNegotiations} active`
                : "Loading…"
            }
          />
          <MetricCard
            label="Provider calls"
            icon={PhoneCall}
            value={metrics.data?.totalCalls ?? "—"}
            hint="Across all negotiations"
          />
          <MetricCard
            label="Verified savings"
            icon={DollarSign}
            tone="verified"
            value={metrics.data ? formatMoney(metrics.data.verifiedSavings) : "—"}
            hint="Only quote-vs-quote deltas backed by transcripts"
          />
          <MetricCard
            label="Recent activity"
            icon={Activity}
            value={recentEvents.data?.length ?? "—"}
            hint={recentEvents.data && recentEvents.data.length > 0
              ? `Last: ${formatRelative(recentEvents.data[0].created_at)}`
              : "No agent activity yet"}
          />
        </div>

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
                  <Link to="/app/negotiations/new" search={{ id: undefined, step: 1 }}>Start a negotiation</Link>
                </Button>
              }
            />
          ) : (
            <div className="overflow-hidden rounded-lg border border-border/70 bg-card shadow-[0_1px_0_0_color-mix(in_oklab,var(--navy)_4%,transparent)]">
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
                            className="font-medium text-navy hover:underline"
                          >
                            {n.title}
                          </Link>
                          <div className="mt-0.5 font-mono text-[10px] text-muted-foreground">
                            #{n.id.slice(0, 8)}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">
                          <span className="inline-flex items-center gap-1">
                            <MapPin className="size-3" />
                            <span className="max-w-[9rem] truncate">
                              {n.origin_address ?? "—"}
                            </span>
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
                            className="inline-flex items-center gap-1 text-xs text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
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

        {recentEvents.data && recentEvents.data.length > 0 && (
          <div className="mt-10">
            <SectionHeader
              title="Latest agent activity"
              description="Everything BidPilot's agents have logged, most recent first."
            />
            <div className="rounded-lg border border-border/70 bg-card">
              <ul className="divide-y divide-border/60">
                {recentEvents.data.map((e) => (
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
                      <div className="mt-1">{formatRelative(e.created_at)}</div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </PageBody>
    </>
  );
}
