import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { PhoneCall, ArrowRight, ShieldCheck, ShieldAlert } from "lucide-react";
import { useMemo, useState } from "react";

import { PageBody, LoadingState, ErrorState, EmptyState } from "@/components/app/page";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/app/status-badge";
import { supabase } from "@/integrations/supabase/client";

type Filter = "relevant" | "all" | "failed";

export const Route = createFileRoute("/app/negotiations/$id/calls")({
  head: () => ({ meta: [{ title: "Calls — BidPilot AI" }] }),
  component: CallsPage,
});

const CALL_TONE: Record<string, "neutral" | "verified" | "risk" | "warn"> = {
  scheduled: "neutral",
  context_loading: "neutral",
  in_progress: "warn",
  quote_captured: "warn",
  negotiating: "warn",
  completed: "verified",
  failed: "risk",
  needs_review: "risk",
};

const STYLE_TONE: Record<string, "neutral" | "verified" | "risk" | "warn"> = {
  flexible: "verified",
  firm: "neutral",
  difficult: "warn",
};

function fmt(d: string | null): string {
  if (!d) return "—";
  return new Date(d).toLocaleString();
}

function shortHash(hash: string | null): string {
  if (!hash) return "—";
  return hash.length > 12 ? `${hash.slice(0, 8)}…${hash.slice(-4)}` : hash;
}

type CallRow = {
  id: string;
  status: string;
  agent_type: string | null;
  started_at: string | null;
  ended_at: string | null;
  final_outcome: string | null;
  provider_id: string | null;
  job_spec_version: number | null;
  job_spec_hash: string | null;
  metadata: Record<string, unknown> | null;
  providers: { name: string | null } | null;
};

function CallsPage() {
  const { id } = Route.useParams();
  const [filter, setFilter] = useState<Filter>("relevant");

  const callsQuery = useQuery({
    queryKey: ["calls-list", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("calls")
        .select(
          "id, status, agent_type, started_at, ended_at, final_outcome, provider_id, job_spec_version, job_spec_hash, metadata, providers(name)",
        )
        .eq("negotiation_id", id)
        .order("started_at", { ascending: false, nullsFirst: false });
      if (error) throw error;
      return (data ?? []) as unknown as CallRow[];
    },
  });

  const latestSpecQuery = useQuery({
    queryKey: ["latest-confirmed-spec", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("job_specs")
        .select("version, specification_hash")
        .eq("negotiation_id", id)
        .eq("confirmed", true)
        .order("version", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const allRows = callsQuery.data ?? [];
  const latest = latestSpecQuery.data ?? null;

  const counts = useMemo(() => {
    let relevant = 0;
    let failed = 0;
    for (const r of allRows) {
      const isFailed =
        r.status === "failed" ||
        r.final_outcome === "negotiation_failed" ||
        r.final_outcome === "disconnected" ||
        r.final_outcome === "wrong_number";
      const isDraft = r.status === "scheduled" && !r.final_outcome;
      if (isFailed) failed++;
      // "Relevant" = completed, in-progress with real data, or needs_review.
      // Filters out abandoned drafts + old failed test calls.
      if (!isDraft && !isFailed) relevant++;
    }
    return { relevant, failed, all: allRows.length };
  }, [allRows]);

  const rows = useMemo(() => {
    if (filter === "all") return allRows;
    if (filter === "failed") {
      return allRows.filter(
        (r) =>
          r.status === "failed" ||
          r.final_outcome === "negotiation_failed" ||
          r.final_outcome === "disconnected" ||
          r.final_outcome === "wrong_number",
      );
    }
    return allRows.filter((r) => {
      const isFailed =
        r.status === "failed" ||
        r.final_outcome === "negotiation_failed" ||
        r.final_outcome === "disconnected" ||
        r.final_outcome === "wrong_number";
      const isDraft = r.status === "scheduled" && !r.final_outcome;
      return !isFailed && !isDraft;
    });
  }, [allRows, filter]);

  if (callsQuery.isLoading || latestSpecQuery.isLoading) {
    return (
      <PageBody>
        <LoadingState label="Loading calls" />
      </PageBody>
    );
  }
  if (callsQuery.isError) {
    return (
      <PageBody>
        <ErrorState
          title="Couldn't load calls"
          description={(callsQuery.error as Error).message}
          onRetry={() => callsQuery.refetch()}
        />
      </PageBody>
    );
  }

  return (
    <PageBody>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Calls</h2>
          {latest ? (
            <p className="mt-0.5 text-xs text-muted-foreground">
              Latest confirmed spec: v{latest.version} · {shortHash(latest.specification_hash)}
            </p>
          ) : (
            <p className="mt-0.5 text-xs text-muted-foreground">
              No confirmed specification yet — calls can't be marked comparable.
            </p>
          )}
        </div>
        <Button asChild size="sm">
          <Link to="/app/negotiations/$id/control-room" params={{ id }}>
            Open Control Room <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
          </Link>
        </Button>
      </div>
      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        {(
          [
            { key: "relevant" as const, label: `Relevant (${counts.relevant})` },
            { key: "all" as const, label: `All (${counts.all})` },
            { key: "failed" as const, label: `Failed (${counts.failed})` },
          ]
        ).map((f) => (
          <Button
            key={f.key}
            size="sm"
            variant={filter === f.key ? "default" : "outline"}
            className="h-7 rounded-full px-3 text-xs"
            onClick={() => setFilter(f.key)}
          >
            {f.label}
          </Button>
        ))}
      </div>
      {rows.length === 0 ? (
        <EmptyState
          icon={PhoneCall}
          title="No calls yet"
          description="Kick off a rehearsal from the Control Room to record the first agent conversation."
          action={
            <Button asChild size="sm">
              <Link to="/app/negotiations/$id/control-room" params={{ id }}>
                Open Control Room
              </Link>
            </Button>
          }
        />
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/40 text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left">Provider</th>
                    <th className="px-3 py-2 text-left">Style</th>
                    <th className="px-3 py-2 text-left">Status</th>
                    <th className="px-3 py-2 text-left">Spec</th>
                    <th className="px-3 py-2 text-left">Integrity</th>
                    <th className="px-3 py-2 text-left">Outcome</th>
                    <th className="px-3 py-2 text-left">Started</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const name = r.providers?.name ?? "—";
                    const tone = CALL_TONE[r.status ?? ""] ?? "neutral";
                    const style =
                      (r.metadata &&
                        typeof r.metadata === "object" &&
                        typeof (r.metadata as { rehearsal_style?: unknown }).rehearsal_style ===
                          "string"
                        ? ((r.metadata as { rehearsal_style: string }).rehearsal_style as string)
                        : null) ?? null;
                    const hasSpec = r.job_spec_hash && r.job_spec_version;
                    const match =
                      latest &&
                      r.job_spec_hash &&
                      r.job_spec_hash === latest.specification_hash &&
                      r.job_spec_version === latest.version;
                    const comparable = Boolean(match);
                    return (
                      <tr key={r.id} className="border-t">
                        <td className="px-3 py-2 font-medium">{name}</td>
                        <td className="px-3 py-2">
                          {style ? (
                            <StatusBadge tone={STYLE_TONE[style] ?? "neutral"}>{style}</StatusBadge>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <StatusBadge tone={tone}>{r.status}</StatusBadge>
                        </td>
                        <td className="px-3 py-2 font-mono text-[11px] text-muted-foreground">
                          {hasSpec ? (
                            <>
                              v{r.job_spec_version} · {shortHash(r.job_spec_hash)}
                            </>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="px-3 py-2">
                          {!hasSpec ? (
                            <Badge variant="outline">no spec</Badge>
                          ) : !latest ? (
                            <Badge variant="outline">no confirmed spec</Badge>
                          ) : comparable ? (
                            <span className="inline-flex items-center gap-1 text-xs text-emerald-700">
                              <ShieldCheck className="size-3.5" /> match · comparable
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-xs text-amber-700">
                              <ShieldAlert className="size-3.5" /> mismatch · non-comparable
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">
                          {r.final_outcome ?? "—"}
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">{fmt(r.started_at)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </PageBody>
  );
}
