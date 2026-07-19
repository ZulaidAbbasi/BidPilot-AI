import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CheckCircle2, ShieldAlert, XCircle } from "lucide-react";

import { PageBody, LoadingState, ErrorState } from "@/components/app/page";
import { Button } from "@/components/ui/button";
import { getChallengeReadiness } from "@/lib/report.functions";

export const Route = createFileRoute("/app/negotiations/$id/readiness")({
  head: () => ({ meta: [{ title: "Challenge readiness — BidPilot AI" }] }),
  component: ReadinessPage,
});

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

  return (
    <PageBody>
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Challenge readiness</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Every check below reads real persisted data — no synthesised state.
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
              Open report
            </Link>
          </Button>
        </div>
      </div>

      <div className="mb-4 h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={`h-full ${pct === 100 ? "bg-verified" : pct >= 70 ? "bg-amber-500" : "bg-risk"}`}
          style={{ width: `${pct}%` }}
        />
      </div>

      <ul className="space-y-2">
        {checks.map((c) => (
          <li
            key={c.id}
            className={`flex items-start gap-3 rounded-lg border px-4 py-3 ${
              c.passed
                ? "border-verified/40 bg-verified-soft/30"
                : "border-warn/40 bg-warn-soft/30"
            }`}
          >
            {c.passed ? (
              <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-verified" />
            ) : (
              <XCircle className="mt-0.5 size-5 shrink-0 text-risk" />
            )}
            <div className="min-w-0 flex-1">
              <p className="font-medium">{c.label}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{c.detail}</p>
            </div>
          </li>
        ))}
      </ul>

      {passed < total && (
        <div className="mt-6 flex items-start gap-3 rounded-lg border border-warn/40 bg-warn-soft/30 px-4 py-3 text-sm">
          <ShieldAlert className="mt-0.5 size-4 text-warn-foreground" />
          <p>
            One or more criteria are not yet met. Failing checks list the concrete data missing — run
            additional calls, sync transcripts from the Final report page, or confirm the spec.
          </p>
        </div>
      )}
    </PageBody>
  );
}
