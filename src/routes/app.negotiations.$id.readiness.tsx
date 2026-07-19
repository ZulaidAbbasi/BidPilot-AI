import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CheckCircle2, XCircle, ArrowRight, ShieldAlert } from "lucide-react";

import { PageBody, LoadingState, ErrorState } from "@/components/app/page";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getChallengeReadiness } from "@/lib/report.functions";

export const Route = createFileRoute("/app/negotiations/$id/readiness")({
  head: () => ({ meta: [{ title: "Challenge readiness — BidPilot AI" }] }),
  component: ReadinessPage,
});

const GROUP_LABEL: Record<string, string> = {
  intake: "Intake",
  specification: "Specification",
  calls: "Calls",
  quotes: "Quotes",
  evidence: "Evidence",
  outcome: "Outcome",
};

const GROUP_ORDER = ["intake", "specification", "calls", "quotes", "evidence", "outcome"];

function ReadinessPage() {
  const { id } = Route.useParams();
  const fn = useServerFn(getChallengeReadiness);
  const query = useQuery({
    queryKey: ["challenge-readiness", id],
    queryFn: () => fn({ data: { negotiationId: id } }),
  });

  if (query.isLoading) {
    return (
      <PageBody>
        <LoadingState label="Evaluating challenge criteria" />
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

  const { checks } = query.data;
  const passed = checks.filter((c) => c.passed).length;
  const total = checks.length;
  const pct = Math.round((passed / total) * 100);
  const grouped = GROUP_ORDER.map((g) => ({
    id: g,
    label: GROUP_LABEL[g] ?? g,
    items: checks.filter((c) => c.group === g),
  })).filter((g) => g.items.length > 0);
  const fails = checks.filter((c) => !c.passed);

  return (
    <PageBody>
      <div className="mb-6 grid grid-cols-[minmax(0,1fr)_auto] items-end gap-4 sm:flex sm:justify-between">
        <div className="min-w-0">
          <h2 className="truncate text-xl font-semibold tracking-tight">Challenge readiness</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Real persisted data only — every FAIL surfaces its exact next action.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right">
            <div className="text-2xl font-semibold tabular-nums">{pct}%</div>
            <div className="text-xs text-muted-foreground">
              {passed} of {total} passed
            </div>
          </div>
          <Button asChild size="sm" variant="outline">
            <Link to="/app/negotiations/$id/report" params={{ id }}>
              Open report <ArrowRight className="ml-1 h-3.5 w-3.5" />
            </Link>
          </Button>
        </div>
      </div>

      <div className="mb-6 h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={`h-full transition-all ${
            pct === 100 ? "bg-verified" : pct >= 70 ? "bg-amber-500" : "bg-risk"
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>

      {fails.length > 0 && (
        <Card className="mb-6 border-warn/40 bg-warn-soft/30">
          <CardContent className="p-4">
            <div className="mb-2 flex items-center gap-2 text-sm font-medium">
              <ShieldAlert className="size-4 text-warn-foreground" />
              {fails.length} item{fails.length === 1 ? "" : "s"} require action
            </div>
            <ul className="space-y-1.5 text-sm">
              {fails.map((c) => (
                <li key={c.id} className="flex items-start gap-2">
                  <span className="mt-1 size-1.5 shrink-0 rounded-full bg-risk" />
                  <div className="min-w-0">
                    <span className="font-medium">{c.label}</span>
                    {c.nextAction && (
                      <span className="ml-1 text-muted-foreground">— {c.nextAction}</span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <div className="space-y-6">
        {grouped.map((group) => (
          <section key={group.id}>
            <div className="mb-2 flex items-center gap-2">
              <h3 className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                {group.label}
              </h3>
              <Badge variant="outline" className="h-5 font-mono text-[10px]">
                {group.items.filter((i) => i.passed).length}/{group.items.length}
              </Badge>
            </div>
            <ul className="grid gap-2 md:grid-cols-2">
              {group.items.map((c) => (
                <li
                  key={c.id}
                  className={`flex items-start gap-3 rounded-lg border px-4 py-3 ${
                    c.passed
                      ? "border-verified/40 bg-verified-soft/20"
                      : "border-warn/40 bg-warn-soft/20"
                  }`}
                >
                  {c.passed ? (
                    <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-verified" />
                  ) : (
                    <XCircle className="mt-0.5 size-5 shrink-0 text-risk" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm font-medium">{c.label}</p>
                      <Badge
                        variant="outline"
                        className={`h-4 shrink-0 font-mono text-[9px] uppercase ${
                          c.passed ? "border-verified/60 text-verified" : "border-risk/60 text-risk"
                        }`}
                      >
                        {c.passed ? "PASS" : "FAIL"}
                      </Badge>
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground">{c.detail}</p>
                    {!c.passed && c.nextAction && (
                      <p className="mt-1.5 text-xs text-warn-foreground">
                        <span className="font-medium">Next: </span>
                        {c.nextAction}
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </PageBody>
  );
}
