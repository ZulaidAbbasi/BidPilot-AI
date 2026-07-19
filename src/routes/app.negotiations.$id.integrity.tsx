import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, XCircle, AlertTriangle } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { shortHash } from "@/lib/job-spec-canonical";

export const Route = createFileRoute("/app/negotiations/$id/integrity")({
  component: IntegrityPage,
});

function IntegrityPage() {
  const { id } = Route.useParams();
  const q = useQuery({
    queryKey: ["integrity", id],
    queryFn: async () => {
      const [{ data: spec }, { data: calls }, { data: quotes }] = await Promise.all([
        supabase
          .from("job_specs")
          .select("version, specification_hash")
          .eq("negotiation_id", id)
          .eq("confirmed", true)
          .order("version", { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from("calls")
          .select(
            "id, provider_id, status, call_mode, job_spec_version, job_spec_hash, started_at, final_outcome, providers(name)",
          )
          .eq("negotiation_id", id)
          .order("started_at", { ascending: false }),
        supabase
          .from("quotes")
          .select(
            "id, provider_id, quote_stage, total_amount, currency, spec_version, spec_hash, verification_status, captured_at, providers(name)",
          )
          .eq("negotiation_id", id)
          .order("captured_at", { ascending: false }),
      ]);
      return { spec, calls: calls ?? [], quotes: quotes ?? [] };
    },
  });

  if (q.isLoading) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  const spec = q.data?.spec;
  if (!spec) {
    return (
      <div className="p-6 text-sm text-muted-foreground">
        No confirmed specification yet — integrity view unlocks after you confirm the spec.
      </div>
    );
  }
  const currentHash = spec.specification_hash ?? "";
  const currentVersion = spec.version;

  const calls = q.data!.calls;
  const quotes = q.data!.quotes;
  const matchesSpec = (h: string | null, v: number | null) =>
    (!h || h === currentHash) && (v == null || v === currentVersion);

  const matchedCalls = calls.filter((c) => matchesSpec(c.job_spec_hash, c.job_spec_version));
  const excludedCalls = calls.filter((c) => !matchesSpec(c.job_spec_hash, c.job_spec_version));
  const matchedQuotes = quotes.filter((qq) => matchesSpec(qq.spec_hash, qq.spec_version));
  const excludedQuotes = quotes.filter((qq) => !matchesSpec(qq.spec_hash, qq.spec_version));

  return (
    <div className="space-y-4 p-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Same-spec integrity</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">Confirmed v{currentVersion}</Badge>
            <code className="font-mono text-xs">{shortHash(currentHash, 16)}</code>
          </div>
          <p className="text-muted-foreground">
            Every call and quote below is compared against this hash. Rows with a different hash are
            excluded from the final report.
          </p>
        </CardContent>
      </Card>

      <Section title="Calls on this spec" count={matchedCalls.length}>
        {matchedCalls.map((c) => (
          <Row
            key={c.id}
            ok
            title={c.providers?.name ?? "Provider"}
            meta={`${c.call_mode ?? "—"} · ${c.status} · ${c.final_outcome ?? "—"}`}
            hash={c.job_spec_hash}
            version={c.job_spec_version}
          />
        ))}
      </Section>

      {excludedCalls.length > 0 ? (
        <Section title="Excluded calls (different spec)" count={excludedCalls.length} warn>
          {excludedCalls.map((c) => (
            <Row
              key={c.id}
              title={c.providers?.name ?? "Provider"}
              meta={`${c.call_mode ?? "—"} · ${c.status}`}
              hash={c.job_spec_hash}
              version={c.job_spec_version}
            />
          ))}
        </Section>
      ) : null}

      <Section title="Quotes on this spec" count={matchedQuotes.length}>
        {matchedQuotes.map((qq) => (
          <Row
            key={qq.id}
            ok
            title={`${qq.providers?.name ?? "Provider"} · ${qq.quote_stage}`}
            meta={
              qq.total_amount != null
                ? new Intl.NumberFormat("en-US", {
                    style: "currency",
                    currency: qq.currency || "USD",
                  }).format(Number(qq.total_amount))
                : "—"
            }
            hash={qq.spec_hash}
            version={qq.spec_version}
          />
        ))}
      </Section>

      {excludedQuotes.length > 0 ? (
        <Section title="Excluded quotes (different spec)" count={excludedQuotes.length} warn>
          {excludedQuotes.map((qq) => (
            <Row
              key={qq.id}
              title={`${qq.providers?.name ?? "Provider"} · ${qq.quote_stage}`}
              meta={qq.verification_status}
              hash={qq.spec_hash}
              version={qq.spec_version}
            />
          ))}
        </Section>
      ) : null}
    </div>
  );
}

function Section({
  title,
  count,
  warn,
  children,
}: {
  title: string;
  count: number;
  warn?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          {warn ? (
            <AlertTriangle className="size-4 text-amber-600" />
          ) : (
            <CheckCircle2 className="size-4 text-emerald-600" />
          )}
          {title}
        </CardTitle>
        <Badge variant="outline">{count}</Badge>
      </CardHeader>
      <CardContent className="space-y-1">
        {count === 0 ? <p className="text-xs text-muted-foreground">None.</p> : children}
      </CardContent>
    </Card>
  );
}

function Row({
  title,
  meta,
  hash,
  version,
  ok,
}: {
  title: string;
  meta: string;
  hash: string | null;
  version: number | null;
  ok?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-xs">
      <div>
        <div className="font-medium text-foreground">{title}</div>
        <div className="text-muted-foreground">{meta}</div>
      </div>
      <div className="flex items-center gap-2">
        {ok ? (
          <CheckCircle2 className="size-3.5 text-emerald-600" />
        ) : (
          <XCircle className="size-3.5 text-red-600" />
        )}
        <span className="font-mono">
          v{version ?? "—"} · {shortHash(hash ?? "", 10)}
        </span>
      </div>
    </div>
  );
}
