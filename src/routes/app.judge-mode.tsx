import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseQuery, queryOptions } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  BadgeCheck,
  FileCheck,
  Gavel,
  Info,
  PhoneCall,
  Receipt,
  ScrollText,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  TrendingDown,
  Users,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { getJudgeModeSnapshot } from "@/lib/judge-mode.functions";

const judgeQueryOptions = (fn: () => Promise<Awaited<ReturnType<typeof getJudgeModeSnapshot>>>) =>
  queryOptions({
    queryKey: ["judge-mode-snapshot"],
    queryFn: fn,
    staleTime: 30_000,
  });

export const Route = createFileRoute("/app/judge-mode")({
  head: () => ({
    meta: [
      { title: "Judge Mode — BidPilot AI" },
      {
        name: "description",
        content:
          "Reviewer entry point. Full challenge coverage from a single completed BidPilot negotiation with authenticated records only.",
      },
    ],
  }),
  component: JudgeModePage,
  errorComponent: ({ error }) => (
    <div className="mx-auto max-w-2xl p-8 text-sm text-muted-foreground">
      Failed to load Judge Mode: {error.message}
    </div>
  ),
  notFoundComponent: () => (
    <div className="mx-auto max-w-2xl p-8 text-sm text-muted-foreground">Not found.</div>
  ),
});

function GateRow({ label, ok }: { label: string; ok: boolean }) {
  return (
    <li className="flex items-center justify-between gap-3 border-b border-border/60 py-2 last:border-b-0">
      <span className="text-[13px] text-foreground">{label}</span>
      <span
        className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium ${
          ok
            ? "bg-emerald-500/12 text-emerald-700 dark:text-emerald-400"
            : "bg-muted text-muted-foreground"
        }`}
      >
        <span
          className={`size-1.5 rounded-full ${ok ? "bg-emerald-500" : "bg-muted-foreground/50"}`}
          aria-hidden
        />
        {ok ? "Verified" : "Not on record"}
      </span>
    </li>
  );
}

function Metric({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2.5">
      <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </p>
      <p className="mt-0.5 text-[19px] font-semibold tabular-nums text-foreground">{value}</p>
      {hint ? <p className="text-[11px] text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function JudgeModePage() {
  const fn = useServerFn(getJudgeModeSnapshot);
  const { data } = useSuspenseQuery(judgeQueryOptions(fn));

  if (!data.available) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-12">
        <div className="rounded-xl border border-dashed border-border bg-card p-8 text-center">
          <Info className="mx-auto mb-3 size-8 text-muted-foreground" aria-hidden />
          <h1 className="text-lg font-semibold">No demonstration record yet</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Judge Mode requires at least one negotiation on this account. Create one to begin.
          </p>
          <Button asChild className="mt-4">
            <Link to="/app/negotiations/new" search={{ id: undefined, step: 1 }}>
              Start a negotiation
            </Link>
          </Button>
        </div>
      </main>
    );
  }

  const n = data.negotiation;
  const c = data.counts;
  const currency = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-6 sm:py-8">
      {/* Hero */}
      <section aria-labelledby="judge-heading" className="mb-6">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-4 sm:flex sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Badge className="bg-primary/10 text-primary hover:bg-primary/10">
                <Sparkles className="mr-1 size-3" aria-hidden /> Judge Mode
              </Badge>
              {data.isAuthenticDemo ? (
                <Badge className="bg-emerald-500/12 text-emerald-700 hover:bg-emerald-500/12 dark:text-emerald-400">
                  <BadgeCheck className="mr-1 size-3" aria-hidden />
                  Authentic completed demonstration
                </Badge>
              ) : (
                <Badge
                  variant="outline"
                  className="border-amber-500/40 text-amber-700 dark:text-amber-400"
                >
                  <ShieldAlert className="mr-1 size-3" aria-hidden />
                  Partial demonstration · {data.gatesPassed}/{data.gatesTotal} gates
                </Badge>
              )}
            </div>
            <h1
              id="judge-heading"
              className="mt-2 truncate text-2xl font-semibold tracking-tight text-foreground sm:text-3xl"
            >
              {n.title}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Reviewer entry point · every field below is loaded from real persisted records.
              Nothing on this screen is fabricated.
            </p>
          </div>
          <div className="shrink-0">
            <Button asChild variant="outline">
              <Link to="/app/negotiations/$id/overview" params={{ id: n.id }}>
                Open workspace
              </Link>
            </Button>
          </div>
        </div>
      </section>

      {/* Challenge summary metrics */}
      <section aria-label="Challenge summary" className="mb-6">
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
          <Metric label="Verified savings" value={currency.format(data.verifiedSavings)} />
          <Metric
            label="Provider styles"
            value={data.styles.length}
            hint={data.styles.slice(0, 3).join(" · ") || "—"}
          />
          <Metric
            label="Matched calls"
            value={`${c.matchedCalls}/${c.calls}`}
            hint="same-spec integrity"
          />
          <Metric
            label="Itemized quotes"
            value={`${c.matchedQuotes}/${c.quotes}`}
            hint="on confirmed spec"
          />
          <Metric label="Transcript turns" value={c.transcriptTurns} />
          <Metric label="Recordings" value={c.recordings} hint="via signed URL" />
        </div>
      </section>

      {/* Two-column: gates + provenance */}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        {/* Coverage gates */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldCheck className="size-4 text-primary" aria-hidden />
              Coverage against challenge criteria
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="text-sm">
              <GateRow
                label="Confirmed specification (immutable, hashed)"
                ok={data.gates.confirmedSpec}
              />
              <GateRow
                label="Three provider styles rehearsed or called"
                ok={data.gates.threeStyles}
              />
              <GateRow
                label="At least one call on the same-spec hash"
                ok={data.gates.matchedCalls}
              />
              <GateRow label="Itemized quote captured" ok={data.gates.itemizedQuotes} />
              <GateRow label="Real leverage move recorded" ok={data.gates.leverage} />
              <GateRow label="Verified price or term improvement" ok={data.gates.improvement} />
              <GateRow label="Transcript persisted for reconciliation" ok={data.gates.transcript} />
              <GateRow label="Recording reference stored (URL gated)" ok={data.gates.recording} />
              <GateRow label="Server-verified savings > 0" ok={data.gates.verifiedSavings} />
            </ul>
          </CardContent>
        </Card>

        {/* Provenance */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <FileCheck className="size-4 text-primary" aria-hidden />
              Specification provenance
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {data.confirmedSpec ? (
              <>
                <div className="rounded-md border border-border bg-muted/40 px-3 py-2">
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                    Confirmed spec
                  </p>
                  <p className="mt-1 font-mono text-[12px] text-foreground">
                    v{data.confirmedSpec.version} ·{" "}
                    <span className="text-muted-foreground">
                      {data.confirmedSpec.hash?.slice(0, 16)}…
                    </span>
                  </p>
                  {data.confirmedSpec.confirmedAt ? (
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      Confirmed {new Date(data.confirmedSpec.confirmedAt).toLocaleString()}
                    </p>
                  ) : null}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Badge
                    variant="outline"
                    className={
                      data.intake.voice
                        ? "border-emerald-500/40 text-emerald-700 dark:text-emerald-400"
                        : ""
                    }
                  >
                    Voice intake {data.intake.voice ? "✓" : "—"}
                  </Badge>
                  <Badge
                    variant="outline"
                    className={
                      data.intake.document
                        ? "border-emerald-500/40 text-emerald-700 dark:text-emerald-400"
                        : ""
                    }
                  >
                    Document intake {data.intake.document ? "✓" : "—"}
                  </Badge>
                </div>
                <p className="text-[12px] text-muted-foreground">
                  All matched calls and quotes below reference this hash. Rows without the matching
                  hash are auditable but excluded from ranking.
                </p>
              </>
            ) : (
              <p className="text-muted-foreground">
                No confirmed specification on this negotiation yet.
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Details grid */}
      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Users className="size-4 text-primary" aria-hidden /> Providers & styles
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            <p className="text-[13px] text-foreground">
              {c.providers} provider{c.providers === 1 ? "" : "s"} · {c.calls} call attempts
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {data.styles.length > 0 ? (
                data.styles.map((s) => (
                  <Badge key={s} variant="secondary" className="capitalize">
                    {s}
                  </Badge>
                ))
              ) : (
                <span className="text-[12px] text-muted-foreground">
                  No rehearsal style tagged yet.
                </span>
              )}
            </div>
            <p className="mt-3 text-[12px] text-muted-foreground">
              {c.auditableFailedCalls} failed / review-flagged call
              {c.auditableFailedCalls === 1 ? " remains" : "s remain"} auditable but is excluded
              from the default judge view.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Gavel className="size-4 text-primary" aria-hidden /> Leverage moves
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            {data.leverageMoves.length === 0 ? (
              <p className="text-muted-foreground">
                No leverage moves recorded. Leverage requires a prior competing quote linked in
                <span className="font-mono text-[12px]"> quotes.metadata.leverage_quote_id</span>.
              </p>
            ) : (
              <ul className="space-y-2">
                {data.leverageMoves.slice(0, 4).map((m) => (
                  <li
                    key={m.quoteId}
                    className="rounded-md border border-border bg-muted/30 px-3 py-2"
                  >
                    <p className="font-mono text-[11px] text-muted-foreground">
                      Quote {m.quoteId.slice(0, 8)}
                    </p>
                    <p className="mt-0.5 text-[13px] text-foreground">
                      {m.before != null ? currency.format(m.before) : "—"}
                      <span className="mx-1.5 text-muted-foreground">→</span>
                      <span className="font-semibold text-emerald-700 dark:text-emerald-400">
                        {m.after != null ? currency.format(m.after) : "—"}
                      </span>
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <TrendingDown className="size-4 text-primary" aria-hidden /> Verified improvements
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            {data.improvements.length === 0 ? (
              <p className="text-muted-foreground">
                No server-verified price or term changes yet. Verification happens after transcript
                reconciliation on finalize-call-outcome.
              </p>
            ) : (
              <ul className="space-y-2">
                {data.improvements.slice(0, 4).map((imp) => (
                  <li key={imp.callId} className="flex items-center justify-between gap-2">
                    <span className="text-[12px] text-muted-foreground">
                      Call {imp.callId.slice(0, 8)}
                    </span>
                    <span className="flex items-center gap-1.5">
                      {imp.priceChanged ? (
                        <Badge className="bg-emerald-500/12 text-emerald-700 hover:bg-emerald-500/12 dark:text-emerald-400">
                          price
                        </Badge>
                      ) : null}
                      {imp.termsChanged ? (
                        <Badge className="bg-emerald-500/12 text-emerald-700 hover:bg-emerald-500/12 dark:text-emerald-400">
                          terms
                        </Badge>
                      ) : null}
                      {imp.savings ? (
                        <span className="text-[13px] font-semibold tabular-nums">
                          {currency.format(imp.savings)}
                        </span>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Low-outlier warnings — server-derived, no client math */}
      {data.lowOutliers && data.lowOutliers.length > 0 ? (
        <section aria-labelledby="low-outlier-heading" className="mt-8">
          <h2
            id="low-outlier-heading"
            className="mb-2 font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground"
          >
            Low-outlier warnings
          </h2>
          <p className="mb-3 max-w-3xl text-sm text-muted-foreground">
            The lowest number is not automatically the best deal. BidPilot flags a supported final
            quote when it is 30% or more below other verified comparable offers for the same
            confirmed specification and requires human review.
          </p>
          <div className="space-y-2">
            {data.lowOutliers.map((o) => {
              const pct =
                o.percentBelowComparables != null
                  ? Math.round(o.percentBelowComparables * 1000) / 10
                  : null;
              return (
                <div
                  key={`${o.providerId}-${o.callId ?? ""}`}
                  className="rounded-lg border border-red-300/70 bg-red-50/60 p-3 dark:border-red-500/40 dark:bg-red-500/10"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-foreground">
                      {o.providerName}
                    </span>
                    <Badge
                      variant="destructive"
                      className="text-[11px] font-medium"
                    >
                      Low-outlier warning
                      {pct != null ? ` — ${pct}% below comparable verified offers` : ""}
                    </Badge>
                  </div>
                  <dl className="mt-2 grid grid-cols-1 gap-x-6 gap-y-1 text-[13px] sm:grid-cols-3">
                    <div>
                      <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">
                        Screening value
                      </dt>
                      <dd className="tabular-nums text-foreground">
                        {o.comparisonValue != null
                          ? currency.format(o.comparisonValue)
                          : "—"}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">
                        Basis
                      </dt>
                      <dd className="text-foreground">
                        {o.comparisonValueBasis === "range_high"
                          ? "Confirmed range high"
                          : o.comparisonValueBasis === "exact_total"
                            ? "Exact total"
                            : "—"}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">
                        Reference median
                      </dt>
                      <dd className="tabular-nums text-foreground">
                        {o.referenceMedian != null
                          ? currency.format(o.referenceMedian)
                          : "—"}
                      </dd>
                    </div>
                  </dl>
                  <p className="mt-2 text-[12px] text-muted-foreground">{o.reason}</p>
                </div>
              );
            })}
          </div>
        </section>
      ) : null}

      {/* Deep-links */}
      <section aria-labelledby="deep-links" className="mt-8">
        <h2
          id="deep-links"
          className="mb-3 font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground"
        >
          Verify every claim
        </h2>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            { to: "quotes", label: "Itemized quotes", icon: Receipt },
            { to: "calls", label: "Calls & transcripts", icon: PhoneCall },
            { to: "evidence", label: "Evidence ledger", icon: ScrollText },
            { to: "report", label: "Ranked report", icon: BadgeCheck },
          ].map((l) => (
            <Button
              key={l.to}
              asChild
              variant="outline"
              className="h-auto justify-start gap-2 py-2.5"
            >
              <Link
                to={
                  `/app/negotiations/$id/${l.to}` as
                    | "/app/negotiations/$id/quotes"
                    | "/app/negotiations/$id/calls"
                    | "/app/negotiations/$id/evidence"
                    | "/app/negotiations/$id/report"
                }
                params={{ id: n.id }}
              >
                <l.icon className="size-4 text-primary" aria-hidden />
                <span className="truncate">{l.label}</span>
              </Link>
            </Button>
          ))}
        </div>
      </section>

      {/* Alternatives */}
      {data.alternatives.length > 0 && (
        <section aria-labelledby="alt-heading" className="mt-8">
          <h2
            id="alt-heading"
            className="mb-2 font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground"
          >
            Other negotiations on this account
          </h2>
          <div className="rounded-lg border border-border bg-card">
            <ul>
              {data.alternatives.map((a, i) => (
                <li
                  key={a.id}
                  className={`flex items-center justify-between gap-3 px-3 py-2 text-sm ${
                    i > 0 ? "border-t border-border/60" : ""
                  }`}
                >
                  <span className="min-w-0 truncate">
                    <span className="text-foreground">{a.title}</span>
                    <span className="ml-2 font-mono text-[11px] text-muted-foreground">
                      {a.status}
                    </span>
                  </span>
                  <Button asChild variant="ghost" size="sm">
                    <Link to="/app/negotiations/$id/overview" params={{ id: a.id }}>
                      Open
                    </Link>
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}
    </main>
  );
}
