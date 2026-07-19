import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowUpRight,
  Calendar,
  Filter,
  Inbox,
  MapPin,
  PlusCircle,
  Search,
  ShieldCheck,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PageBody, PageHeader, EmptyState, LoadingState, ErrorState } from "@/components/app/page";
import { StatusBadge } from "@/components/app/status-badge";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { statusTone, workflowLabel, WORKFLOW_STATUSES, type WorkflowStatus } from "@/lib/workflow";

export const Route = createFileRoute("/app/negotiations/")({
  head: () => ({ meta: [{ title: "Negotiations — BidPilot AI" }] }),
  component: NegotiationsListPage,
});

type Row = {
  id: string;
  title: string;
  workflow_status: string;
  origin_address: string | null;
  destination_address: string | null;
  moving_date: string | null;
  updated_at: string;
  created_at: string;
  providers: { count: number }[];
  calls: { count: number }[];
  job_specs: { version: number; confirmed: boolean }[];
};

type SortKey = "updated_at" | "moving_date" | "created_at" | "title";

function formatDate(d: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
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

function daysUntil(d: string | null) {
  if (!d) return null;
  const ms = new Date(d).getTime() - Date.now();
  return Math.ceil(ms / (1000 * 60 * 60 * 24));
}

function NegotiationsListPage() {
  const { user } = useAuth();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<"all" | WorkflowStatus>("all");
  const [sort, setSort] = useState<SortKey>("updated_at");

  const query = useQuery({
    queryKey: ["negotiations-list", user?.id],
    enabled: !!user,
    queryFn: async (): Promise<Row[]> => {
      const { data, error } = await supabase
        .from("negotiations")
        .select(
          "id, title, workflow_status, origin_address, destination_address, moving_date, updated_at, created_at, providers(count), calls(count), job_specs(version, confirmed)",
        )
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return (data as unknown as Row[]) ?? [];
    },
  });

  const rows = useMemo(() => {
    const list = (query.data ?? []).filter((r) => {
      if (status !== "all" && r.workflow_status !== status) return false;
      if (q.trim()) {
        const s = q.toLowerCase();
        return (
          r.title.toLowerCase().includes(s) ||
          (r.origin_address ?? "").toLowerCase().includes(s) ||
          (r.destination_address ?? "").toLowerCase().includes(s) ||
          r.id.toLowerCase().startsWith(s)
        );
      }
      return true;
    });
    const sorted = [...list].sort((a, b) => {
      if (sort === "title") return a.title.localeCompare(b.title);
      if (sort === "moving_date") {
        const av = a.moving_date ? new Date(a.moving_date).getTime() : Infinity;
        const bv = b.moving_date ? new Date(b.moving_date).getTime() : Infinity;
        return av - bv;
      }
      const av = new Date(a[sort]).getTime();
      const bv = new Date(b[sort]).getTime();
      return bv - av;
    });
    return sorted;
  }, [query.data, q, status, sort]);

  return (
    <>
      <PageHeader
        eyebrow="Workspace"
        title="Negotiations"
        description="Every negotiation you own, with live provider, call, and specification state."
        actions={
          <Button asChild>
            <Link to="/app/negotiations/new" search={{ id: undefined, step: 1 }}>
              <PlusCircle className="mr-1.5 size-4" /> New negotiation
            </Link>
          </Button>
        }
      />
      <PageBody>
        <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          <div className="relative w-full sm:min-w-[16rem] sm:flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search title, addresses, or ID…"
              className="h-9 pl-8"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Filter className="hidden size-3.5 text-muted-foreground sm:inline-block" />
            <Select value={status} onValueChange={(v) => setStatus(v as typeof status)}>
              <SelectTrigger className="h-9 flex-1 min-w-[10rem] sm:w-[13rem] sm:flex-none">
                <SelectValue placeholder="All statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                {WORKFLOW_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {workflowLabel(s)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={sort} onValueChange={(v) => setSort(v as SortKey)}>
              <SelectTrigger className="h-9 flex-1 min-w-[9rem] sm:w-[11rem] sm:flex-none">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="updated_at">Recently updated</SelectItem>
                <SelectItem value="created_at">Newest</SelectItem>
                <SelectItem value="moving_date">Soonest move</SelectItem>
                <SelectItem value="title">Title A–Z</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="text-xs text-muted-foreground tabular-nums sm:ml-auto">
            {rows.length} {rows.length === 1 ? "negotiation" : "negotiations"}
          </div>
        </div>

        {query.isLoading ? (
          <LoadingState label="Loading negotiations" />
        ) : query.isError ? (
          <ErrorState
            title="Couldn't load negotiations"
            description={(query.error as Error).message}
            onRetry={() => query.refetch()}
          />
        ) : rows.length === 0 ? (
          (query.data ?? []).length === 0 ? (
            <EmptyState
              icon={Inbox}
              title="No negotiations yet"
              description="Create your first negotiation to build a confirmed moving specification and start collecting itemized quotes."
              action={
                <Button asChild>
                  <Link to="/app/negotiations/new" search={{ id: undefined, step: 1 }}>
                    Start a negotiation
                  </Link>
                </Button>
              }
            />
          ) : (
            <EmptyState
              icon={Search}
              title="No matches"
              description="Try clearing the search or status filter."
            />
          )
        ) : (
          <>
            {/* Mobile card list */}
            <div className="grid gap-2 md:hidden">
              {rows.map((n) => {
                const providerCount = n.providers?.[0]?.count ?? 0;
                const callCount = n.calls?.[0]?.count ?? 0;
                const confirmed = (n.job_specs ?? [])
                  .filter((s) => s.confirmed)
                  .sort((a, b) => b.version - a.version)[0];
                const days = daysUntil(n.moving_date);
                return (
                  <Link
                    key={n.id}
                    to="/app/negotiations/$id/overview"
                    params={{ id: n.id }}
                    className="block rounded-lg border border-border/70 bg-card p-3 shadow-[0_1px_0_0_color-mix(in_oklab,var(--navy)_4%,transparent)] active:bg-muted/40"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium text-navy">{n.title}</div>
                        <div className="mt-0.5 font-mono text-[10px] text-muted-foreground">
                          #{n.id.slice(0, 8)}
                        </div>
                      </div>
                      <StatusBadge tone={statusTone(n.workflow_status)}>
                        {workflowLabel(n.workflow_status)}
                      </StatusBadge>
                    </div>
                    <div className="mt-2 flex items-center gap-1 text-xs text-muted-foreground">
                      <MapPin className="size-3 shrink-0" />
                      <span className="truncate">
                        {n.origin_address ?? "—"} → {n.destination_address ?? "—"}
                      </span>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                      <span className="inline-flex items-center gap-1">
                        <Calendar className="size-3" />
                        {formatDate(n.moving_date)}
                      </span>
                      {typeof days === "number" && n.moving_date && (
                        <span
                          className={`rounded px-1 py-0.5 tabular-nums ${days < 0 ? "bg-muted" : days <= 7 ? "bg-risk/10 text-risk" : days <= 21 ? "bg-warn/15 text-warn-foreground" : "bg-muted"}`}
                        >
                          {days < 0
                            ? `${Math.abs(days)}d ago`
                            : days === 0
                              ? "today"
                              : `in ${days}d`}
                        </span>
                      )}
                      <span className="inline-flex items-center gap-1">
                        {confirmed ? (
                          <>
                            <ShieldCheck className="size-3 text-verified" />v{confirmed.version}
                          </>
                        ) : (
                          "Draft"
                        )}
                      </span>
                      <span className="tabular-nums">{providerCount} providers</span>
                      <span className="tabular-nums">{callCount} calls</span>
                      <span className="ml-auto">{formatRelative(n.updated_at)}</span>
                    </div>
                  </Link>
                );
              })}
            </div>
            <div className="hidden overflow-hidden rounded-lg border border-border/70 bg-card shadow-[0_1px_0_0_color-mix(in_oklab,var(--navy)_4%,transparent)] md:block">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-muted/40 text-left text-[11px] uppercase tracking-[0.1em] text-muted-foreground">
                      <th className="px-4 py-2.5 font-medium">Negotiation</th>
                      <th className="px-4 py-2.5 font-medium">Route</th>
                      <th className="px-4 py-2.5 font-medium">Move</th>
                      <th className="px-4 py-2.5 font-medium">Spec</th>
                      <th className="px-4 py-2.5 text-right font-medium">Providers</th>
                      <th className="px-4 py-2.5 text-right font-medium">Calls</th>
                      <th className="px-4 py-2.5 font-medium">Status</th>
                      <th className="px-4 py-2.5 text-right font-medium">Updated</th>
                      <th className="px-4 py-2.5" />
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((n) => {
                      const providerCount = n.providers?.[0]?.count ?? 0;
                      const callCount = n.calls?.[0]?.count ?? 0;
                      const confirmed = (n.job_specs ?? [])
                        .filter((s) => s.confirmed)
                        .sort((a, b) => b.version - a.version)[0];
                      const days = daysUntil(n.moving_date);
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
                              <span className="max-w-[10rem] truncate">
                                {n.origin_address ?? "—"}
                              </span>
                              <span className="opacity-40">→</span>
                              <span className="max-w-[10rem] truncate">
                                {n.destination_address ?? "—"}
                              </span>
                            </span>
                          </td>
                          <td className="px-4 py-3 text-xs text-muted-foreground">
                            <div className="inline-flex items-center gap-1">
                              <Calendar className="size-3" />
                              {formatDate(n.moving_date)}
                            </div>
                            {typeof days === "number" && n.moving_date && (
                              <div
                                className={`mt-0.5 inline-block rounded px-1 py-0.5 text-[10px] font-medium tabular-nums ${
                                  days < 0
                                    ? "bg-muted text-muted-foreground"
                                    : days <= 7
                                      ? "bg-risk/10 text-risk"
                                      : days <= 21
                                        ? "bg-warn/15 text-warn-foreground"
                                        : "bg-muted text-muted-foreground"
                                }`}
                              >
                                {days < 0 ? `${Math.abs(days)}d ago` : `in ${days}d`}
                              </div>
                            )}
                          </td>
                          <td className="px-4 py-3 text-xs">
                            {confirmed ? (
                              <span className="inline-flex items-center gap-1 text-verified">
                                <ShieldCheck className="size-3" />v{confirmed.version}
                              </span>
                            ) : (
                              <span className="text-muted-foreground">Draft</span>
                            )}
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
            </div>
          </>
        )}
      </PageBody>
    </>
  );
}
