import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { GitCompareArrows, ShieldCheck, ShieldAlert } from "lucide-react";

import { PageBody, EmptyState } from "@/components/app/page";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/app/negotiations/$id/quotes")({
  head: () => ({ meta: [{ title: "Quotes — BidPilot AI" }] }),
  component: QuotesPage,
});

type QuoteRow = {
  id: string;
  quote_stage: "INITIAL" | "REVISED" | "FINAL";
  currency: string;
  total_amount: number | null;
  low_amount: number | null;
  high_amount: number | null;
  estimate_type: string | null;
  valid_until: string | null;
  deposit_amount: number | null;
  deposit_refundable: boolean | null;
  terms: string | null;
  included_services: string[] | null;
  excluded_services: string[] | null;
  price_change_conditions: string | null;
  spec_version: number;
  spec_hash: string | null;
  verification_status: string;
  captured_at: string;
  provider_id: string;
  providers: { name: string | null } | null;
  quote_line_items: Array<{
    id: string;
    category: string;
    label: string;
    amount: number | null;
    currency: string;
    quantity: number | null;
    unit: string | null;
    included: boolean;
    conditional: boolean;
    condition_text: string | null;
    provider_words: string | null;
  }>;
};

function fmt(amount: number | null, currency: string): string {
  if (amount == null) return "Not stated";
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

function shortHash(hash: string | null): string {
  if (!hash) return "—";
  return hash.length > 12 ? `${hash.slice(0, 8)}…${hash.slice(-4)}` : hash;
}

function QuotesPage() {
  const { id } = Route.useParams();
  const quotesQ = useQuery({
    queryKey: ["quotes", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("quotes")
        .select(
          "id, quote_stage, currency, total_amount, low_amount, high_amount, estimate_type, valid_until, deposit_amount, deposit_refundable, terms, included_services, excluded_services, price_change_conditions, spec_version, spec_hash, verification_status, captured_at, provider_id, providers(name), quote_line_items(id, category, label, amount, currency, quantity, unit, included, conditional, condition_text, provider_words)",
        )
        .eq("negotiation_id", id)
        .order("captured_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as QuoteRow[];
    },
  });

  const specQ = useQuery({
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

  if (quotesQ.isLoading || specQ.isLoading) {
    return (
      <PageBody>
        <p className="text-sm text-muted-foreground">Loading quotes…</p>
      </PageBody>
    );
  }

  if (quotesQ.error) {
    return (
      <PageBody>
        <p className="text-sm text-destructive">
          Failed to load quotes: {(quotesQ.error as Error).message}
        </p>
      </PageBody>
    );
  }

  const data = quotesQ.data ?? [];
  const latest = specQ.data;

  if (data.length === 0) {
    return (
      <PageBody>
        <EmptyState
          icon={GitCompareArrows}
          title="No quotes captured yet"
          description="Itemized quotes will appear here as provider calls complete. Nothing is shown until real numbers are saved."
        />
      </PageBody>
    );
  }

  const isComparable = (q: QuoteRow) =>
    Boolean(
      latest &&
        q.spec_hash &&
        q.spec_hash === latest.specification_hash &&
        q.spec_version === latest.version,
    );

  const comparable = data.filter(isComparable);
  const nonComparable = data.filter((q) => !isComparable(q));

  return (
    <PageBody>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Quotes</h2>
          {latest ? (
            <p className="mt-0.5 text-xs text-muted-foreground">
              Comparable against confirmed spec v{latest.version} ·{" "}
              <span className="font-mono">{shortHash(latest.specification_hash)}</span>
            </p>
          ) : (
            <p className="mt-0.5 text-xs text-amber-700">
              No confirmed specification — every quote below is non-comparable.
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <ShieldCheck className="size-3.5 text-emerald-700" /> {comparable.length} comparable
          </span>
          <span className="inline-flex items-center gap-1">
            <ShieldAlert className="size-3.5 text-amber-700" /> {nonComparable.length} excluded
          </span>
        </div>
      </div>

      <div className="space-y-6">
        {comparable.length > 0 ? (
          <QuoteGroup title="Comparable quotes" quotes={comparable} comparable />
        ) : null}
        {nonComparable.length > 0 ? (
          <QuoteGroup
            title="Non-comparable (excluded from leverage & ranking)"
            quotes={nonComparable}
            comparable={false}
          />
        ) : null}
      </div>
    </PageBody>
  );
}

function QuoteGroup({
  title,
  quotes,
  comparable,
}: {
  title: string;
  quotes: QuoteRow[];
  comparable: boolean;
}) {
  return (
    <section className="space-y-3">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h3>
      <div className="space-y-4">
        {quotes.map((q) => (
          <Card key={q.id} className={comparable ? "" : "border-amber-300/70 bg-amber-50/40"}>
            <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
              <div>
                <CardTitle className="text-base">
                  {q.providers?.name ?? "Unknown provider"}
                </CardTitle>
                <p className="mt-1 text-xs text-muted-foreground">
                  Captured {new Date(q.captured_at).toLocaleString()} · spec v{q.spec_version} ·{" "}
                  <span className="font-mono">{shortHash(q.spec_hash)}</span>
                </p>
              </div>
              <div className="flex flex-wrap items-center justify-end gap-2">
                {comparable ? (
                  <Badge className="gap-1 bg-emerald-600 hover:bg-emerald-600">
                    <ShieldCheck className="size-3" /> comparable
                  </Badge>
                ) : (
                  <Badge variant="outline" className="gap-1 border-amber-500 text-amber-700">
                    <ShieldAlert className="size-3" /> non-comparable
                  </Badge>
                )}
                <Badge variant="outline">{q.quote_stage}</Badge>
                {q.estimate_type ? (
                  <Badge variant="secondary">{q.estimate_type.replace("_", " ")}</Badge>
                ) : null}
                <Badge variant={q.verification_status === "verified" ? "default" : "outline"}>
                  {q.verification_status}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {!comparable ? (
                <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  This quote was captured against a different specification version or hash than
                  the latest confirmed spec. It's excluded from leverage calculations and provider
                  ranking. Re-run the call against the current spec to make it comparable.
                </p>
              ) : null}
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <Metric label="Total" value={fmt(q.total_amount, q.currency)} />
                <Metric label="Low" value={fmt(q.low_amount, q.currency)} />
                <Metric label="High" value={fmt(q.high_amount, q.currency)} />
                <Metric
                  label="Deposit"
                  value={
                    q.deposit_amount == null
                      ? q.quote_line_items.find((li) => li.category === "deposit" && li.amount != null)
                        ? `${fmt(q.quote_line_items.find((li) => li.category === "deposit" && li.amount != null)?.amount ?? null, q.currency)} · line item`
                        : "Not stated"
                      : `${fmt(q.deposit_amount, q.currency)}${q.deposit_refundable ? " · refundable" : ""}`
                  }
                />
              </div>

              {q.total_amount != null &&
              q.quote_line_items.some((li) => li.amount != null) &&
              Math.abs(
                q.quote_line_items.reduce((sum, li) => sum + Number(li.amount ?? 0), 0) -
                  q.total_amount,
              ) > 0.5 ? (
                <p className="rounded-md border border-border bg-muted/35 px-3 py-2 text-xs text-muted-foreground">
                  Itemized lines total{" "}
                  {fmt(
                    q.quote_line_items.reduce((sum, li) => sum + Number(li.amount ?? 0), 0),
                    q.currency,
                  )}
                  ; provider stated the quote total as {fmt(q.total_amount, q.currency)}.
                </p>
              ) : null}

              {q.quote_line_items.length > 0 ? (
                <div className="rounded-md border">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2">Category</th>
                        <th className="px-3 py-2">Item</th>
                        <th className="px-3 py-2 text-right">Qty</th>
                        <th className="px-3 py-2 text-right">Amount</th>
                        <th className="px-3 py-2">Flags</th>
                      </tr>
                    </thead>
                    <tbody>
                      {q.quote_line_items.map((li) => (
                        <tr key={li.id} className="border-t">
                          <td className="px-3 py-2 text-xs">{li.category}</td>
                          <td className="px-3 py-2">
                            <div className="font-medium">{li.label}</div>
                            {li.provider_words ? (
                              <div className="mt-0.5 text-xs italic text-muted-foreground">
                                "{li.provider_words}"
                              </div>
                            ) : null}
                            {li.conditional && li.condition_text ? (
                              <div className="mt-0.5 text-xs text-amber-700">
                                Conditional: {li.condition_text}
                              </div>
                            ) : null}
                          </td>
                          <td className="px-3 py-2 text-right text-xs">
                            {li.quantity != null
                              ? `${li.quantity}${li.unit ? ` ${li.unit}` : ""}`
                              : "—"}
                          </td>
                          <td className="px-3 py-2 text-right">{fmt(li.amount, li.currency)}</td>
                          <td className="px-3 py-2 text-xs">
                            {li.included ? "included" : "excluded"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="rounded-md border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
                  Flat quote captured; no itemized breakdown was stated or saved for this offer.
                </p>
              )}

              {q.included_services?.length ||
              q.excluded_services?.length ||
              q.terms ||
              q.price_change_conditions ? (
                <div className="grid gap-3 text-sm sm:grid-cols-2">
                  {q.included_services?.length ? (
                    <TextBlock title="Included">{q.included_services.join(", ")}</TextBlock>
                  ) : null}
                  {q.excluded_services?.length ? (
                    <TextBlock title="Excluded">{q.excluded_services.join(", ")}</TextBlock>
                  ) : null}
                  {q.terms ? <TextBlock title="Terms">{q.terms}</TextBlock> : null}
                  {q.price_change_conditions ? (
                    <TextBlock title="Price change conditions">
                      {q.price_change_conditions}
                    </TextBlock>
                  ) : null}
                </div>
              ) : null}
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-0.5 font-semibold">{value}</div>
    </div>
  );
}

function TextBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {title}
      </div>
      <div className="mt-0.5 text-sm">{children}</div>
    </div>
  );
}
