import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { FileCheck2, RefreshCw, ShieldAlert, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { PageBody, EmptyState, LoadingState, ErrorState } from "@/components/app/page";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { syncNegotiationReport } from "@/lib/report.functions";

export const Route = createFileRoute("/app/negotiations/$id/evidence")({
  head: () => ({ meta: [{ title: "Evidence — BidPilot AI" }] }),
  component: EvidencePage,
});

type EvidenceRow = {
  id: string;
  quote_id: string;
  quote_line_item_id: string | null;
  evidence_type: string;
  support_status: string;
  extracted_text: string | null;
  timestamp_ms: number | null;
  created_at: string;
  quotes: { provider_id: string | null; providers: { name: string | null } | null } | null;
};

function formatTime(ms: number | null) {
  if (ms == null) return null;
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function EvidencePage() {
  const { id } = Route.useParams();
  const queryClient = useQueryClient();
  const syncFn = useServerFn(syncNegotiationReport);

  const query = useQuery({
    queryKey: ["evidence", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("quote_evidence")
        .select(
          "id, quote_id, quote_line_item_id, evidence_type, support_status, extracted_text, timestamp_ms, created_at, quotes:quote_id(provider_id, providers:provider_id(name))",
        )
        .eq("negotiation_id", id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as EvidenceRow[];
    },
  });

  if (query.isLoading) return <LoadingState />;
  if (query.isError) return <ErrorState onRetry={() => query.refetch()} />;

  const rows = query.data ?? [];
  const sync = useMutation({
    mutationFn: () => syncFn({ data: { negotiationId: id } }),
    onSuccess: (result) => {
      toast.success(
        `Synced ${result.reconciledCalls} call${result.reconciledCalls === 1 ? "" : "s"}`,
      );
      queryClient.invalidateQueries({ queryKey: ["evidence", id] });
      queryClient.invalidateQueries({ queryKey: ["quotes", id] });
      queryClient.invalidateQueries({ queryKey: ["final-report", id] });
      queryClient.invalidateQueries({ queryKey: ["negotiation-overview", id] });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Sync failed"),
  });

  return (
    <PageBody>
      <div className="mb-5 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-xl tracking-tight">Evidence</h2>
          <p className="text-sm text-muted-foreground">
            Verified transcript excerpts tied to quote claims.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="gap-1">
            <Sparkles className="size-3" />
            {rows.length} item{rows.length === 1 ? "" : "s"}
          </Badge>
          <Button variant="outline" size="sm" onClick={() => sync.mutate()} disabled={sync.isPending}>
            <RefreshCw className={sync.isPending ? "animate-spin" : ""} /> Sync
          </Button>
        </div>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={FileCheck2}
          title="No evidence yet"
          description="Evidence is captured automatically after each provider call is finalized and reconciled with the transcript."
        />
      ) : (
        <div className="space-y-3">
          {rows.map((row) => {
            const providerName = row.quotes?.providers?.name ?? "Unknown provider";
            const ts = formatTime(row.timestamp_ms);
            const status = row.support_status;
            const tone =
              status === "supported"
                ? "bg-verified/10 text-verified border-verified/30"
                : status === "contradictory" || status === "unsupported"
                  ? "bg-risk/10 text-risk border-risk/30"
                  : "bg-muted text-muted-foreground border-border";
            return (
              <Card key={row.id} className="border-border/70">
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="text-sm font-medium capitalize">
                      {row.evidence_type.replace(/_/g, " ")}
                    </CardTitle>
                    <div className="flex items-center gap-2">
                      {ts && (
                        <span className="font-mono text-[10px] text-muted-foreground">
                          @ {ts}
                        </span>
                      )}
                      <span className={`rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${tone}`}>
                        {status.replace(/_/g, " ")}
                      </span>
                    </div>
                  </div>
                  <p className="text-[11px] text-muted-foreground">{providerName}</p>
                </CardHeader>
                <CardContent>
                  {row.extracted_text ? (
                    <blockquote className="border-l-2 border-navy/30 bg-muted/40 py-2 pl-3 text-sm italic text-foreground/85">
                      "{row.extracted_text}"
                    </blockquote>
                  ) : (
                    <p className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                      <ShieldAlert className="size-3" />
                      No transcript excerpt captured.
                    </p>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </PageBody>
  );
}
