import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Award,
  FileText,
  Mic,
  PhoneCall,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
} from "lucide-react";
import { toast } from "sonner";
import { useState } from "react";

import { MetricCard } from "@/components/app/ui/metric-card";
import { PageBody, ErrorState, LoadingState, EmptyState } from "@/components/app/page";
import { StatusBadge } from "@/components/app/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  getCallRecording,
  getNegotiationReport,
  syncNegotiationReport,
} from "@/lib/report.functions";

export const Route = createFileRoute("/app/negotiations/$id/report")({
  head: () => ({ meta: [{ title: "Report — BidPilot AI" }] }),
  component: ReportPage,
});

function money(v: number | null, currency = "USD") {
  if (v == null) return "Not stated";
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(v);
  } catch {
    return `${currency} ${v.toFixed(0)}`;
  }
}

function ReportPage() {
  const { id } = Route.useParams();
  const queryClient = useQueryClient();
  const reportFn = useServerFn(getNegotiationReport);
  const syncFn = useServerFn(syncNegotiationReport);

  const query = useQuery({
    queryKey: ["final-report", id],
    queryFn: () => reportFn({ data: { negotiationId: id } }),
  });

  const sync = useMutation({
    mutationFn: () => syncFn({ data: { negotiationId: id } }),
    onSuccess: (result) => {
      toast.success(
        `Synced ${result.reconciledCalls} call${result.reconciledCalls === 1 ? "" : "s"}`,
      );
      queryClient.invalidateQueries({ queryKey: ["final-report", id] });
      queryClient.invalidateQueries({ queryKey: ["evidence", id] });
      queryClient.invalidateQueries({ queryKey: ["quotes", id] });
      queryClient.invalidateQueries({ queryKey: ["challenge-readiness", id] });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Sync failed"),
  });

  if (query.isLoading) {
    return (
      <PageBody>
        <LoadingState label="Building report" />
      </PageBody>
    );
  }

  if (query.isError || !query.data) {
    return (
      <PageBody>
        <ErrorState onRetry={() => query.refetch()} />
      </PageBody>
    );
  }

  const report = query.data;
  const {
    ranked,
    winner,
    verifiedSavings,
    changedTermLinks,
    lowOutliers,
    nonWinnerOutcomes,
    totals,
    confirmedSpec,
  } = report;

  if (!confirmedSpec) {
    return (
      <PageBody>
        <EmptyState
          icon={FileText}
          title="Confirm the specification first"
          description="The final report only ranks provider outcomes captured against a confirmed specification."
          action={
            <Button asChild>
              <Link to="/app/negotiations/$id/specification" params={{ id }}>
                Open specification
              </Link>
            </Button>
          }
        />
      </PageBody>
    );
  }

  if (ranked.length === 0) {
    return (
      <PageBody>
        <EmptyState
          icon={FileText}
          title="No matched provider outcomes yet"
          description="Run at least one live call against the confirmed spec — outcomes will appear here."
          action={
            <Button asChild>
              <Link to="/app/negotiations/$id/control-room" params={{ id }}>
                Open Control Room
              </Link>
            </Button>
          }
        />
      </PageBody>
    );
  }

  const eligibleRanked = ranked.filter((r) => r.eligibleForWinner);

  return (
    <PageBody>
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Final report</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Ranked usable provider outcomes for confirmed spec v{confirmedSpec.version} ·{" "}
            <span className="font-mono">{confirmedSpec.hash?.slice(0, 12)}…</span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge tone={winner ? "verified" : "warn"}>
            {winner ? "Recommendation ready" : "Insufficient evidence"}
          </StatusBadge>
          <Button
            variant="outline"
            size="sm"
            onClick={() => sync.mutate()}
            disabled={sync.isPending}
          >
            <RefreshCw className={sync.isPending ? "animate-spin" : ""} /> Sync
          </Button>
        </div>
      </div>

      {/* Signature: recommended provider hero card */}
      {winner ? (
        <Card className="mb-4 overflow-hidden border-verified/40 bg-gradient-to-br from-verified-soft/40 via-card to-card shadow-sm animate-in fade-in slide-in-from-bottom-2 duration-500">
          <CardContent className="p-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="inline-flex items-center gap-2 rounded-full border border-verified/40 bg-white/70 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-verified">
                  <Award className="size-3" /> Recommended
                </div>
                <h3 className="mt-2 text-2xl font-semibold tracking-tight">
                  {winner.providerName}
                </h3>
                <ul className="mt-2 space-y-0.5 text-sm text-muted-foreground">
                  {winner.rationale.slice(0, 3).map((r, i) => (
                    <li key={i} className="flex items-start gap-1.5">
                      <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-verified" />
                      {r}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="text-right">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Final amount
                </div>
                <div className="text-3xl font-semibold tabular-nums">
                  {money(winner.totalPrice, winner.currency)}
                </div>
                {verifiedSavings > 0 ? (
                  <div className="mt-1 inline-flex items-center gap-1 rounded-full bg-verified/10 px-2 py-0.5 text-xs font-medium text-verified">
                    <ShieldCheck className="size-3" /> {money(verifiedSavings)} verified savings
                  </div>
                ) : null}
              </div>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          label="Recommended provider"
          value={winner ? winner.providerName : "None yet"}
          icon={Award}
          tone={winner ? "verified" : "warn"}
          hint={winner ? money(winner.totalPrice) : "Evidence too weak"}
        />
        <MetricCard
          label="Verified savings"
          value={
            winner && eligibleRanked.length > 0
              ? verifiedSavings > 0
                ? money(verifiedSavings)
                : "$0"
              : "Not available"
          }
          icon={ShieldCheck}
          tone={
            winner && eligibleRanked.length > 0
              ? verifiedSavings > 0
                ? "verified"
                : "default"
              : "warn"
          }
          hint={
            winner && eligibleRanked.length > 0
              ? verifiedSavings > 0
                ? "Computed server-side from supported quotes"
                : "Server-verified: no reduction between initial and final"
              : "Requires supported INITIAL and FINAL on the same call"
          }
        />

        <MetricCard
          label="Matched calls"
          value={`${totals.matchedCalls}/${totals.calls}`}
          icon={PhoneCall}
          hint="Same confirmed spec hash"
        />
        <MetricCard
          label="Ranked offers"
          value={eligibleRanked.length}
          icon={Sparkles}
          hint="Eligible for winner selection"
        />
      </div>

      {!winner ? (
        <Card className="mt-6 border-warn/40 bg-warn-soft/40">
          <CardContent className="flex items-start gap-3 py-4 text-sm">
            <ShieldAlert className="mt-0.5 size-4 text-warn-foreground" />
            <div>
              <p className="font-medium text-warn-foreground">Recommendation unavailable</p>
              <p className="mt-1 text-muted-foreground">
                No captured outcome meets the evidence bar. Reasons per candidate appear below. Run
                additional calls or Sync to recover transcripts, then reconcile.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <section className="mt-7 space-y-3">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Ranked outcomes
        </h3>
        <div className="space-y-3">
          {ranked.map((row, idx) => (
            <RankedRow key={`${row.providerId}-${row.callId}`} row={row} rank={idx + 1} />
          ))}
        </div>
      </section>

      {changedTermLinks.length > 0 && (
        <section className="mt-8 space-y-3">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Changed price / terms — linked to leverage & evidence
          </h3>
          <div className="space-y-2">
            {changedTermLinks.map((link, i) => (
              <div
                key={`${link.callId}-${i}`}
                className="rounded-lg border border-border bg-card px-4 py-3 text-sm"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium">{link.providerName}</p>
                  <div className="flex items-center gap-2 text-xs">
                    <Badge variant="outline">
                      {money(link.priceBefore)} → {money(link.priceAfter)}
                    </Badge>
                    {link.leverageQuoteId && (
                      <Badge variant="secondary" className="font-mono text-[10px]">
                        leverage {link.leverageQuoteId.slice(0, 8)}
                      </Badge>
                    )}
                  </div>
                </div>
                {link.transcriptExcerpt && (
                  <blockquote className="mt-2 border-l-2 border-navy/30 bg-muted/40 py-1.5 pl-3 text-xs italic text-foreground/80">
                    "{link.transcriptExcerpt}"
                  </blockquote>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {lowOutliers.length > 0 && (
        <section className="mt-8 space-y-3">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Low-outlier warnings — 30%+ below comparable verified offers
          </h3>
          <Card className="border-risk/40 bg-risk/5">
            <CardContent className="space-y-3 py-4 text-sm">
              <p className="text-muted-foreground">
                The lowest number is not automatically the best deal. BidPilot checks whether a
                supported final quote is 30% or more below other verified offers for the same
                confirmed specification and requires human review before recommending it. Unusually
                low pricing may indicate missing scope, unresolved conditional fees, or estimate
                uncertainty — not fraud.
              </p>
              {lowOutliers.map((lo, i) => (
                <div
                  key={`${lo.callId}-${i}`}
                  className="rounded-md border border-risk/30 bg-card px-3 py-2"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-medium">{lo.providerName}</p>
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <Badge variant="outline" className="border-risk text-risk">
                        {lo.percentBelowComparables != null
                          ? `${Math.round(lo.percentBelowComparables * 1000) / 10}% below`
                          : "flagged"}
                      </Badge>
                      <Badge variant="outline">
                        Screened {lo.comparisonValueBasis === "range_high" ? "range high" : "exact total"}:{" "}
                        {money(lo.comparisonValue, lo.currency)}
                      </Badge>
                      <Badge variant="outline">
                        Median of others: {money(lo.referenceMedian, lo.currency)}
                      </Badge>
                    </div>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{lo.reason}</p>
                </div>
              ))}
            </CardContent>
          </Card>
        </section>
      )}


      {nonWinnerOutcomes.length > 0 && (
        <section className="mt-8 space-y-3">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Callback & decline outcomes
          </h3>
          <div className="grid gap-2 sm:grid-cols-2">
            {nonWinnerOutcomes.map((o, i) => (
              <div key={i} className="rounded-lg border border-border bg-card px-4 py-3 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-medium">{o.providerName}</p>
                  <Badge variant="outline" className="capitalize">
                    {o.outcome}
                  </Badge>
                </div>
                <ul className="mt-1.5 list-disc pl-4 text-xs text-muted-foreground">
                  {o.rationale.slice(0, 3).map((r, j) => (
                    <li key={j}>{r}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      )}
    </PageBody>
  );
}

function RankedRow({
  row,
  rank,
}: {
  row: Awaited<ReturnType<typeof getNegotiationReport>>["ranked"][number];
  rank: number;
}) {
  const winnerTone = row.eligibleForWinner
    ? "border-verified/40 bg-verified-soft/30"
    : "border-border bg-card";
  return (
    <div className={`rounded-lg border ${winnerTone} px-4 py-3`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="inline-flex size-7 items-center justify-center rounded-md bg-muted text-sm font-semibold">
            #{rank}
          </span>
          <div className="min-w-0">
            <p className="font-medium">{row.providerName}</p>
            <p className="text-xs text-muted-foreground">
              {row.outcomeKind === "quote"
                ? `Final stage: ${row.finalStage ?? "—"}`
                : `Outcome: ${row.outcomeKind}`}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-base font-semibold tabular-nums">
            {money(row.totalPrice, row.currency)}
          </span>
          {row.eligibleForWinner ? (
            <Badge className="gap-1 bg-verified hover:bg-verified">
              <ShieldCheck className="size-3" /> usable
            </Badge>
          ) : (
            <Badge variant="outline" className="gap-1 border-warn text-warn-foreground">
              <TriangleAlert className="size-3" /> excluded
            </Badge>
          )}
          {row.lowOutlier ? (
            <Badge variant="outline" className="gap-1 border-risk text-risk">
              <ShieldAlert className="size-3" />
              Low-outlier warning
              {row.percentBelowComparables != null
                ? ` — ${Math.round(row.percentBelowComparables * 1000) / 10}% below comparable verified offers`
                : ""}
            </Badge>
          ) : null}
          {row.callId ? <RecordingButton callId={row.callId} /> : null}
        </div>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-5">
        <ScorePill label="Certainty" value={row.certaintyScore} />
        <ScorePill label="Itemisation" value={row.itemizationScore} />
        <ScorePill label="Hidden-fee risk" value={row.hiddenFeeRisk} inverse />
        <ScorePill label="Deposit risk" value={row.depositRisk} inverse />
        <ScorePill label="Evidence" value={row.evidenceQuality} />
      </div>
      <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
        {row.rationale.map((r, i) => (
          <li key={i}>• {r}</li>
        ))}
        {!row.eligibleForWinner &&
          row.eligibilityReasons.map((r, i) => (
            <li key={`x-${i}`} className="text-warn-foreground">
              ⚠ {r}
            </li>
          ))}
      </ul>
    </div>
  );
}

function ScorePill({ label, value, inverse }: { label: string; value: number; inverse?: boolean }) {
  const good = inverse ? value < 0.35 : value > 0.65;
  const bad = inverse ? value > 0.65 : value < 0.35;
  const tone = good
    ? "bg-verified/10 text-verified border-verified/30"
    : bad
      ? "bg-risk/10 text-risk border-risk/30"
      : "bg-muted text-muted-foreground border-border";
  return (
    <div className={`rounded-md border px-2 py-1 text-[11px] ${tone}`}>
      <div className="uppercase tracking-wider opacity-70">{label}</div>
      <div className="font-semibold tabular-nums">{Math.round(value * 100)}%</div>
    </div>
  );
}

function RecordingButton({ callId }: { callId: string }) {
  const [state, setState] = useState<"idle" | "loading" | "ready" | "unavailable">("idle");
  const [url, setUrl] = useState<string | null>(null);
  const fn = useServerFn(getCallRecording);
  const load = async () => {
    setState("loading");
    try {
      const res = await fn({ data: { callId } });
      if (res.dataUrl) {
        setUrl(res.dataUrl);
        setState("ready");
      } else {
        setState("unavailable");
      }
    } catch {
      setState("unavailable");
    }
  };
  if (state === "ready" && url) {
    return <audio controls src={url} className="h-8 max-w-[220px]" />;
  }
  return (
    <Button
      size="sm"
      variant="outline"
      onClick={load}
      disabled={state === "loading" || state === "unavailable"}
      className="gap-1"
    >
      <Mic className="size-3" />
      {state === "loading" ? "Loading" : state === "unavailable" ? "No audio" : "Recording"}
    </Button>
  );
}
