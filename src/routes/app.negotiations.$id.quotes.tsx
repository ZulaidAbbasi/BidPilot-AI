import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import {
  ArrowRight,
  ChevronDown,
  GitCompareArrows,
  Hash,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  TrendingDown,
} from "lucide-react";

import { PageBody, EmptyState } from "@/components/app/page";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/app/negotiations/$id/quotes")({
  head: () => ({ meta: [{ title: "Quotes — BidPilot AI" }] }),
  component: QuotesPage,
});

type QuoteStage = "INITIAL" | "REVISED" | "FINAL";

type LineItem = {
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
};

type QuoteRow = {
  id: string;
  quote_stage: QuoteStage;
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
  call_id: string | null;
  previous_quote_id: string | null;
  final_confirmed_at: string | null;
  providers: { name: string | null } | null;
  quote_line_items: LineItem[];

};

type ProviderBundle = {
  providerId: string;
  providerName: string;
  callId: string | null;
  comparable: boolean;
  stages: QuoteRow[]; // sorted INITIAL -> REVISED -> FINAL (by captured_at)
  final: QuoteRow;
  currency: string;
  priceProgression: Array<{ stage: QuoteStage; amount: number | null }>;
  hasHiddenFeeRisk: boolean;
  hasConditionalItems: boolean;
  itemCount: number;
  latestPrice: number | null;
  initialPrice: number | null;
  savings: number | null;
};

function fmt(amount: number | null | undefined, currency = "USD"): string {
  if (amount == null) return "—";
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(0)}`;
  }
}

function shortHash(hash: string | null): string {
  if (!hash) return "—";
  return hash.length > 12 ? `${hash.slice(0, 8)}…${hash.slice(-4)}` : hash;
}

const STAGE_ORDER: Record<QuoteStage, number> = { INITIAL: 0, REVISED: 1, FINAL: 2 };

function buildBundles(quotes: QuoteRow[], specHash: string | null, specVersion: number | null) {
  const key = (q: QuoteRow) => `${q.provider_id}::${q.call_id ?? "solo"}`;
  const groups = new Map<string, QuoteRow[]>();
  for (const q of quotes) {
    const k = key(q);
    const arr = groups.get(k) ?? [];
    arr.push(q);
    groups.set(k, arr);
  }
  const bundles: ProviderBundle[] = [];
  for (const [, arr] of groups) {
    const sorted = [...arr].sort((a, b) => {
      const s = STAGE_ORDER[a.quote_stage] - STAGE_ORDER[b.quote_stage];
      if (s !== 0) return s;
      return new Date(a.captured_at).getTime() - new Date(b.captured_at).getTime();
    });
    const finalQ = [...sorted].reverse()[0]!;
    const comparable =
      !!specHash && finalQ.spec_hash === specHash && finalQ.spec_version === specVersion;

    const priceProgression = (["INITIAL", "REVISED", "FINAL"] as QuoteStage[]).map((s) => {
      const match = sorted.find((q) => q.quote_stage === s);
      return { stage: s, amount: match?.total_amount ?? null };
    });
    const knownPrices = priceProgression.map((p) => p.amount).filter((n): n is number => n != null);
    const initialPrice = knownPrices[0] ?? null;
    const latestPrice = knownPrices[knownPrices.length - 1] ?? null;
    const savings =
      initialPrice != null && latestPrice != null && initialPrice > latestPrice
        ? initialPrice - latestPrice
        : null;

    const allItems = sorted.flatMap((q) => q.quote_line_items);
    const hasHiddenFeeRisk = allItems.some(
      (li) => li.conditional || /fee|surcharge|extra/i.test(li.category ?? ""),
    );
    const hasConditionalItems = allItems.some((li) => li.conditional);

    bundles.push({
      providerId: finalQ.provider_id,
      providerName: finalQ.providers?.name ?? "Unknown provider",
      callId: finalQ.call_id,
      comparable,
      stages: sorted,
      final: finalQ,
      currency: finalQ.currency,
      priceProgression,
      hasHiddenFeeRisk,
      hasConditionalItems,
      itemCount: finalQ.quote_line_items.length,
      latestPrice,
      initialPrice,
      savings,
    });
  }
  // sort: comparable first, then by latest price ascending, missing last
  bundles.sort((a, b) => {
    if (a.comparable !== b.comparable) return a.comparable ? -1 : 1;
    const av = a.latestPrice ?? Number.POSITIVE_INFINITY;
    const bv = b.latestPrice ?? Number.POSITIVE_INFINITY;
    return av - bv;
  });
  return bundles;
}

function QuotesPage() {
  const { id } = Route.useParams();

  const quotesQ = useQuery({
    queryKey: ["quotes", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("quotes")
        .select(
          "id, quote_stage, currency, total_amount, low_amount, high_amount, estimate_type, valid_until, deposit_amount, deposit_refundable, terms, included_services, excluded_services, price_change_conditions, spec_version, spec_hash, verification_status, captured_at, provider_id, call_id, previous_quote_id, final_confirmed_at, providers(name), quote_line_items(id, category, label, amount, currency, quantity, unit, included, conditional, condition_text, provider_words)",
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

  const bundles = useMemo(
    () =>
      buildBundles(
        quotesQ.data ?? [],
        specQ.data?.specification_hash ?? null,
        specQ.data?.version ?? null,
      ),
    [quotesQ.data, specQ.data],
  );

  const comparable = bundles.filter((b) => b.comparable);
  const excluded = bundles.filter((b) => !b.comparable);
  const cheapest = comparable.reduce<ProviderBundle | null>((min, b) => {
    if (b.latestPrice == null) return min;
    if (!min || (min.latestPrice ?? Infinity) > b.latestPrice) return b;
    return min;
  }, null);

  const [selected, setSelected] = useState<string | null>(null);
  const activeId = selected ?? bundles[0]?.providerId ?? null;
  const activeBundle = bundles.find((b) => b.providerId === activeId) ?? null;

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

  if (bundles.length === 0) {
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

  const specHash = specQ.data?.specification_hash ?? null;

  return (
    <PageBody>
      {/* Header with spec integrity chain */}
      <header className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-xl font-semibold tracking-tight">Quotes</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {comparable.length} comparable · {excluded.length} excluded ·{" "}
            {bundles.reduce((sum, b) => sum + b.stages.length, 0)} snapshots
          </p>
        </div>
        {specHash ? (
          <div className="inline-flex items-center gap-2 self-start rounded-full border border-verified/30 bg-verified-soft/40 px-3 py-1.5 text-[11px]">
            <Hash className="size-3 text-verified" />
            <span className="text-muted-foreground">Confirmed spec v{specQ.data?.version}</span>
            <span className="font-mono text-foreground">{shortHash(specHash)}</span>
          </div>
        ) : (
          <div className="inline-flex items-center gap-2 self-start rounded-full border border-warn/40 bg-warn-soft/40 px-3 py-1.5 text-[11px] text-warn-foreground">
            <ShieldAlert className="size-3" />
            No confirmed specification — quotes cannot be compared
          </div>
        )}
      </header>

      {/* Same-spec-hash chain signature moment */}
      {comparable.length >= 2 && specHash ? (
        <SpecChainStrip bundles={comparable} specHash={specHash} />
      ) : null}

      {/* Provider comparison matrix */}
      <section className="mt-6">
        <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          Provider comparison
        </h3>

        {/* Desktop matrix */}
        <div className="hidden overflow-x-auto rounded-xl border border-border bg-card md:block">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-secondary/40 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-2.5 font-medium">Provider</th>
                <th className="px-4 py-2.5 font-medium">Stages</th>
                <th className="px-4 py-2.5 font-medium">Progression</th>
                <th className="px-4 py-2.5 text-right font-medium">Current total</th>
                <th className="px-4 py-2.5 font-medium">Type</th>
                <th className="px-4 py-2.5 font-medium">Deposit</th>
                <th className="px-4 py-2.5 font-medium">Valid until</th>
                <th className="px-4 py-2.5 font-medium">Signals</th>
              </tr>
            </thead>
            <tbody>
              {bundles.map((b) => (
                <tr
                  key={b.providerId + (b.callId ?? "")}
                  onClick={() => setSelected(b.providerId)}
                  className={cn(
                    "cursor-pointer border-b border-border/50 transition-colors last:border-b-0 hover:bg-secondary/50",
                    activeId === b.providerId && "bg-secondary/70",
                    !b.comparable && "opacity-70",
                  )}
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      {cheapest?.providerId === b.providerId && b.comparable ? (
                        <span
                          title="Lowest comparable total"
                          className="grid size-5 place-items-center rounded-full bg-verified/15 text-verified"
                        >
                          <Sparkles className="size-3" />
                        </span>
                      ) : null}
                      <span className="font-medium">{b.providerName}</span>
                    </div>
                    <div className="mt-0.5 text-[11px] text-muted-foreground">
                      {b.comparable ? (
                        <span className="inline-flex items-center gap-1 text-verified">
                          <ShieldCheck className="size-3" /> same spec
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-warn-foreground">
                          <ShieldAlert className="size-3" /> different spec
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <StageBadges stages={b.stages.map((s) => s.quote_stage)} />
                  </td>
                  <td className="px-4 py-3">
                    <PriceProgressionInline
                      progression={b.priceProgression}
                      currency={b.currency}
                    />
                  </td>
                  <td className="px-4 py-3 text-right font-semibold tabular-nums">
                    {b.latestPrice != null
                      ? fmt(b.latestPrice, b.currency)
                      : b.final.low_amount != null && b.final.high_amount != null
                        ? `${fmt(b.final.low_amount, b.currency)}–${fmt(b.final.high_amount, b.currency)}`
                        : "Not stated"}
                  </td>
                  <td className="px-4 py-3 text-xs capitalize text-muted-foreground">
                    {b.final.estimate_type?.replace(/_/g, " ") ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {b.final.deposit_amount != null
                      ? `${fmt(b.final.deposit_amount, b.currency)}${b.final.deposit_refundable ? " · refundable" : ""}`
                      : "—"}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {b.final.valid_until ? new Date(b.final.valid_until).toLocaleDateString() : "—"}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {b.hasHiddenFeeRisk ? (
                        <Badge variant="outline" className="border-warn/60 text-warn-foreground">
                          hidden-fee risk
                        </Badge>
                      ) : null}
                      {b.savings != null ? (
                        <Badge className="gap-1 bg-verified hover:bg-verified">
                          <TrendingDown className="size-3" />
                          {fmt(b.savings, b.currency)} down
                        </Badge>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Mobile cards */}
        <div className="grid gap-3 md:hidden">
          {bundles.map((b) => (
            <button
              key={b.providerId + (b.callId ?? "")}
              onClick={() => setSelected(b.providerId)}
              className={cn(
                "rounded-xl border bg-card p-3 text-left transition-all",
                activeId === b.providerId
                  ? "border-primary/40 ring-2 ring-primary/15"
                  : "border-border",
                !b.comparable && "opacity-70",
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-medium">{b.providerName}</p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    {b.comparable ? "same spec" : "different spec"} · {b.stages.length} stage
                    {b.stages.length === 1 ? "" : "s"}
                  </p>
                </div>
                <div className="text-right">
                  <div className="font-semibold tabular-nums">{fmt(b.latestPrice, b.currency)}</div>
                  {b.savings != null ? (
                    <div className="mt-0.5 inline-flex items-center gap-1 text-[11px] text-verified">
                      <TrendingDown className="size-3" /> {fmt(b.savings, b.currency)}
                    </div>
                  ) : null}
                </div>
              </div>
              <div className="mt-2">
                <PriceProgressionInline progression={b.priceProgression} currency={b.currency} />
              </div>
            </button>
          ))}
        </div>
      </section>

      {/* Selected provider detail */}
      {activeBundle ? (
        <section
          key={activeBundle.providerId + (activeBundle.callId ?? "")}
          className="mt-6 animate-in fade-in slide-in-from-right-2 duration-300"
        >
          <ProviderDetail bundle={activeBundle} />
        </section>
      ) : null}
    </PageBody>
  );
}

/* ─────────────────── Sub-components ─────────────────── */

function SpecChainStrip({ bundles, specHash }: { bundles: ProviderBundle[]; specHash: string }) {
  return (
    <div className="mt-1 rounded-xl border border-verified/30 bg-verified-soft/25 p-3">
      <div className="mb-2 flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.16em] text-verified">
        <ShieldCheck className="size-3.5" />
        Same specification chain
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        {bundles.slice(0, 6).map((b, i) => (
          <span key={b.providerId} className="inline-flex items-center gap-2">
            <span className="rounded-md border border-verified/30 bg-white px-2 py-1 font-medium">
              {b.providerName}
            </span>
            {i < Math.min(bundles.length, 6) - 1 ? (
              <span className="font-mono text-[10px] text-verified/70">{shortHash(specHash)}</span>
            ) : null}
          </span>
        ))}
        {bundles.length > 6 ? (
          <span className="text-muted-foreground">+{bundles.length - 6} more</span>
        ) : null}
      </div>
    </div>
  );
}

function StageBadges({ stages }: { stages: QuoteStage[] }) {
  const has = (s: QuoteStage) => stages.includes(s);
  const pill = (label: string, on: boolean, tone: string) =>
    on ? (
      <span
        key={label}
        className={cn(
          "rounded-full px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider",
          tone,
        )}
      >
        {label}
      </span>
    ) : (
      <span
        key={label}
        className="rounded-full border border-dashed border-border px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground/60"
      >
        {label}
      </span>
    );
  return (
    <div className="flex flex-wrap items-center gap-1">
      {pill("I", has("INITIAL"), "bg-muted text-foreground")}
      {pill("R", has("REVISED"), "bg-primary/15 text-primary")}
      {pill("F", has("FINAL"), "bg-verified/15 text-verified")}
    </div>
  );
}

function PriceProgressionInline({
  progression,
  currency,
}: {
  progression: ProviderBundle["priceProgression"];
  currency: string;
}) {
  const known = progression.filter((p) => p.amount != null);
  if (known.length === 0) {
    return <span className="text-xs text-muted-foreground">Not stated</span>;
  }
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs tabular-nums">
      {known.map((p, i) => (
        <span key={p.stage} className="inline-flex items-center gap-1.5">
          <span
            className={cn(
              "font-medium",
              i === known.length - 1 ? "text-foreground" : "text-muted-foreground line-through",
            )}
          >
            {fmt(p.amount, currency)}
          </span>
          {i < known.length - 1 ? <ArrowRight className="size-3 text-muted-foreground/70" /> : null}
        </span>
      ))}
    </div>
  );
}

function ProviderDetail({ bundle }: { bundle: ProviderBundle }) {
  const q = bundle.final;
  const stageTabs = bundle.stages;
  const [tab, setTab] = useState<string>(stageTabs[stageTabs.length - 1]!.id);
  const active = stageTabs.find((s) => s.id === tab) ?? stageTabs[stageTabs.length - 1]!;

  return (
    <Card className="border-border">
      <CardContent className="space-y-5 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h4 className="text-lg font-semibold tracking-tight">{bundle.providerName}</h4>
              {bundle.comparable ? (
                <Badge className="gap-1 bg-verified hover:bg-verified">
                  <ShieldCheck className="size-3" /> comparable
                </Badge>
              ) : (
                <Badge variant="outline" className="gap-1 border-warn text-warn-foreground">
                  <ShieldAlert className="size-3" /> excluded
                </Badge>
              )}
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              spec v{q.spec_version} · <span className="font-mono">{shortHash(q.spec_hash)}</span> ·
              captured {new Date(q.captured_at).toLocaleString()}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {q.estimate_type ? (
              <Badge variant="secondary" className="capitalize">
                {q.estimate_type.replace(/_/g, " ")}
              </Badge>
            ) : null}
            <Badge variant="outline">verification: {q.verification_status}</Badge>
            {q.quote_stage === "FINAL" ? (
              q.final_confirmed_at ? (
                <Badge className="gap-1 bg-verified hover:bg-verified">
                  <ShieldCheck className="size-3" /> confirmed FINAL
                </Badge>
              ) : (
                <Badge
                  variant="outline"
                  className="gap-1 border-warn text-warn-foreground"
                  title="Provider never explicitly confirmed the closing offer (final_confirmed=true). Not counted for verified savings or recommendation ranking."
                >
                  <ShieldAlert className="size-3" /> unconfirmed final candidate
                </Badge>
              )
            ) : null}
          </div>
        </div>

        {!bundle.comparable ? (
          <div className="rounded-md border border-warn/40 bg-warn-soft/30 px-3 py-2 text-xs text-warn-foreground">
            Captured against a different specification than the latest confirmed spec. Excluded from
            leverage and ranking. Re-run the call against the current spec to include it.
          </div>
        ) : null}

        {q.quote_stage === "FINAL" && !q.final_confirmed_at ? (
          <div className="rounded-md border border-warn/40 bg-warn-soft/30 px-3 py-2 text-xs text-warn-foreground">
            <div className="font-semibold">Unconfirmed final candidate.</div>
            <p className="mt-0.5">
              The provider named a closing amount but never explicitly confirmed it. This quote is
              excluded from verified savings and cannot be selected as the winning recommendation.{" "}
              <span className="font-medium">Next action:</span> re-open the call and get an explicit
              "yes, that's the final price" from the provider, or run a follow-up negotiation call.
            </p>
          </div>
        ) : null}


        {/* Price progression — signature moment */}
        <PriceProgressionTimeline bundle={bundle} />

        {/* Term grid — deposit moved to its own structured card below */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <TermCell
            label="Current total"
            value={fmt(bundle.latestPrice, bundle.currency)}
            emphasis
          />
          <TermCell
            label="Range"
            value={
              q.low_amount != null && q.high_amount != null
                ? `${fmt(q.low_amount, bundle.currency)}–${fmt(q.high_amount, bundle.currency)}`
                : "Not stated"
            }
          />
          <TermCell
            label="Valid until"
            value={q.valid_until ? new Date(q.valid_until).toLocaleDateString() : "Not stated"}
          />
        </div>

        {/* Structured deposit card — never rendered as an included/excluded line item */}
        <DepositCard quote={q} currency={bundle.currency} />

        {/* Coverage matrix — captured / refused / unknown / not applicable */}
        {bundle.callId ? <CoverageMatrix callId={bundle.callId} /> : null}


        {/* Stage tabs with line items */}
        {stageTabs.length > 1 ? (
          <Tabs value={tab} onValueChange={setTab} className="mt-2">
            <TabsList>
              {stageTabs.map((s) => (
                <TabsTrigger key={s.id} value={s.id}>
                  <span className="mr-1.5 text-[10px] font-semibold uppercase tracking-wider">
                    {s.quote_stage}
                  </span>
                  <span className="tabular-nums">{fmt(s.total_amount, s.currency)}</span>
                </TabsTrigger>
              ))}
            </TabsList>
            {stageTabs.map((s) => (
              <TabsContent key={s.id} value={s.id} className="mt-3">
                <StageDetail quote={s} />
              </TabsContent>
            ))}
          </Tabs>
        ) : (
          <StageDetail quote={active} />
        )}
      </CardContent>
    </Card>
  );
}

function PriceProgressionTimeline({ bundle }: { bundle: ProviderBundle }) {
  const known = bundle.priceProgression.filter((p) => p.amount != null);
  if (known.length < 2) return null;
  const first = known[0]!.amount!;
  const last = known[known.length - 1]!.amount!;
  const dropped = last < first;
  return (
    <div className="rounded-xl border border-border bg-gradient-to-br from-secondary/40 to-transparent p-4">
      <div className="flex items-center justify-between text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
        <span>Price progression</span>
        {dropped ? (
          <span className="inline-flex items-center gap-1 text-verified">
            <TrendingDown className="size-3" /> {fmt(first - last, bundle.currency)} reduction
          </span>
        ) : null}
      </div>
      <div className="mt-3 flex items-center gap-2 overflow-x-auto">
        {known.map((p, i) => (
          <div key={p.stage} className="flex items-center gap-2">
            <div
              className={cn(
                "rounded-lg border px-3 py-2 transition-all",
                i === known.length - 1
                  ? "border-verified/40 bg-verified-soft/40 shadow-sm"
                  : "border-border bg-card",
              )}
              style={{ animationDelay: `${i * 120}ms` }}
            >
              <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {p.stage}
              </div>
              <div
                className={cn(
                  "font-semibold tabular-nums",
                  i === known.length - 1 ? "text-verified" : "text-foreground",
                )}
              >
                {fmt(p.amount, bundle.currency)}
              </div>
            </div>
            {i < known.length - 1 ? (
              <ArrowRight className="size-4 shrink-0 text-muted-foreground/70" />
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

function TermCell({
  label,
  value,
  emphasis,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
}) {
  return (
    <div className="rounded-lg border border-border bg-secondary/25 px-3 py-2">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div
        className={cn(
          "mt-1 tabular-nums",
          emphasis ? "text-lg font-semibold" : "text-sm font-medium",
        )}
      >
        {value}
      </div>
    </div>
  );
}

function DepositCard({ quote, currency }: { quote: QuoteRow; currency: string }) {
  const has = quote.deposit_amount != null;
  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border/60 px-3 py-2">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Deposit terms
        </div>
        {has ? (
          <Badge variant="outline" className="gap-1 text-[10px]">
            <ShieldCheck className="size-3" />
            Captured
          </Badge>
        ) : (
          <Badge variant="secondary" className="text-[10px] text-muted-foreground">
            Not stated
          </Badge>
        )}
      </div>
      {has ? (
        <div className="grid grid-cols-2 gap-x-4 gap-y-2 px-3 py-2.5 text-[13px] sm:grid-cols-3">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Amount
            </div>
            <div className="mt-0.5 font-semibold tabular-nums">
              {fmt(quote.deposit_amount, currency)}
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Refundable
            </div>
            <div className="mt-0.5 font-medium">
              {quote.deposit_refundable === true
                ? "Yes"
                : quote.deposit_refundable === false
                  ? "No"
                  : "Unknown"}
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
              % of total
            </div>
            <div className="mt-0.5 font-medium tabular-nums">
              {quote.total_amount && quote.deposit_amount != null && quote.total_amount > 0
                ? `${Math.round((quote.deposit_amount / quote.total_amount) * 100)}%`
                : "—"}
            </div>
          </div>
        </div>
      ) : (
        <p className="px-3 py-2.5 text-[12px] text-muted-foreground">
          Deposit was not captured on this quote. It is intentionally shown as a separate term —
          never as an included or excluded line item.
        </p>
      )}
    </div>
  );
}

type CoverageValue = "captured" | "refused" | "unknown" | "not_applicable" | string;

function CoverageMatrix({ callId }: { callId: string }) {
  const q = useQuery({
    queryKey: ["call-coverage", callId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("calls")
        .select("coverage")
        .eq("id", callId)
        .maybeSingle();
      if (error) throw error;
      return (data?.coverage ?? null) as Record<string, CoverageValue> | null;
    },
    staleTime: 30_000,
  });
  const coverage = q.data;
  if (!coverage || Object.keys(coverage).length === 0) return null;

  const buckets: Record<string, string[]> = {
    captured: [],
    refused: [],
    unknown: [],
    not_applicable: [],
  };
  for (const [field, state] of Object.entries(coverage)) {
    const k = String(state);
    if (buckets[k]) buckets[k]!.push(field);
    else buckets.unknown!.push(field);
  }
  const tone: Record<string, string> = {
    captured: "border-verified/40 bg-verified-soft/40 text-verified-foreground",
    refused: "border-risk/40 bg-risk-soft/40 text-risk-foreground",
    unknown: "border-warn/40 bg-warn-soft/40 text-warn-foreground",
    not_applicable: "border-border bg-secondary/40 text-muted-foreground",
  };
  const total = Object.values(buckets).reduce((n, arr) => n + arr.length, 0);

  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border/60 px-3 py-2">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Call coverage
        </div>
        <div className="text-[11px] text-muted-foreground tabular-nums">
          {buckets.captured!.length}/{total} captured
        </div>
      </div>
      <div className="grid grid-cols-1 gap-2 p-3 sm:grid-cols-2 lg:grid-cols-4">
        {(["captured", "refused", "unknown", "not_applicable"] as const).map((k) => (
          <div key={k} className={cn("rounded-md border px-2.5 py-2 text-[12px]", tone[k])}>
            <div className="flex items-center justify-between text-[10px] font-semibold uppercase tracking-wider">
              <span>{k.replace("_", " ")}</span>
              <span className="tabular-nums opacity-70">{buckets[k]!.length}</span>
            </div>
            {buckets[k]!.length > 0 ? (
              <ul className="mt-1 space-y-0.5">
                {buckets[k]!.slice(0, 6).map((f) => (
                  <li key={f} className="truncate opacity-90">
                    {f.replace(/_/g, " ")}
                  </li>
                ))}
                {buckets[k]!.length > 6 ? (
                  <li className="opacity-60">+{buckets[k]!.length - 6} more</li>
                ) : null}
              </ul>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}


function StageDetail({ quote }: { quote: QuoteRow }) {
  const items = quote.quote_line_items;
  const itemsSum = items.reduce((s, li) => s + Number(li.amount ?? 0), 0);
  const totalMismatch =
    quote.total_amount != null &&
    items.some((li) => li.amount != null) &&
    Math.abs(itemsSum - quote.total_amount) > 0.5;

  return (
    <div className="space-y-3">
      {totalMismatch ? (
        <p className="rounded-md border border-warn/40 bg-warn-soft/25 px-3 py-2 text-xs text-warn-foreground">
          Items total {fmt(itemsSum, quote.currency)}, provider stated{" "}
          {fmt(quote.total_amount, quote.currency)}. Line items may be missing.
        </p>
      ) : null}

      {items.length > 0 ? (
        <Accordion type="single" collapsible defaultValue="items" className="w-full">
          <AccordionItem value="items" className="rounded-lg border border-border">
            <AccordionTrigger className="px-3 py-2 text-sm">
              <span className="flex items-center gap-2">
                <ChevronDown className="size-3.5 text-muted-foreground" />
                Itemized breakdown · {items.length} {items.length === 1 ? "line" : "lines"}
              </span>
            </AccordionTrigger>
            <AccordionContent className="px-0 pb-0">
              <div className="overflow-x-auto border-t border-border">
                <table className="w-full text-sm">
                  <thead className="bg-secondary/40 text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 font-medium">Category</th>
                      <th className="px-3 py-2 font-medium">Item</th>
                      <th className="px-3 py-2 text-right font-medium">Qty</th>
                      <th className="px-3 py-2 text-right font-medium">Amount</th>
                      <th className="px-3 py-2 font-medium">Flags</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((li) => (
                      <tr key={li.id} className="border-t border-border/60">
                        <td className="px-3 py-2 text-xs capitalize text-muted-foreground">
                          {li.category}
                        </td>
                        <td className="px-3 py-2">
                          <div className="font-medium">{li.label}</div>
                          {li.provider_words ? (
                            <div className="mt-0.5 text-xs italic text-muted-foreground">
                              "{li.provider_words}"
                            </div>
                          ) : null}
                          {li.conditional && li.condition_text ? (
                            <div className="mt-0.5 text-xs text-warn-foreground">
                              Conditional: {li.condition_text}
                            </div>
                          ) : null}
                        </td>
                        <td className="px-3 py-2 text-right text-xs tabular-nums">
                          {li.quantity != null
                            ? `${li.quantity}${li.unit ? ` ${li.unit}` : ""}`
                            : "—"}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {fmt(li.amount, li.currency)}
                        </td>
                        <td className="px-3 py-2 text-xs">
                          <div className="flex flex-wrap gap-1">
                            {li.included ? (
                              <span className="text-verified">included</span>
                            ) : (
                              <span className="text-warn-foreground">excluded</span>
                            )}
                            {li.conditional ? (
                              <Badge
                                variant="outline"
                                className="border-warn/50 text-warn-foreground"
                              >
                                conditional
                              </Badge>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      ) : (
        <p className="rounded-md border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
          Flat quote — no itemized lines saved for this stage.
        </p>
      )}

      {quote.included_services?.length ||
      quote.excluded_services?.length ||
      quote.terms ||
      quote.price_change_conditions ? (
        <div className="grid gap-3 text-sm sm:grid-cols-2">
          {quote.included_services?.length ? (
            <TextBlock title="Included">{quote.included_services.join(", ")}</TextBlock>
          ) : null}
          {quote.excluded_services?.length ? (
            <TextBlock title="Excluded">{quote.excluded_services.join(", ")}</TextBlock>
          ) : null}
          {quote.terms ? <TextBlock title="Terms">{quote.terms}</TextBlock> : null}
          {quote.price_change_conditions ? (
            <TextBlock title="Price change conditions">{quote.price_change_conditions}</TextBlock>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function TextBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-secondary/25 px-3 py-2">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </div>
      <div className="mt-1 text-sm">{children}</div>
    </div>
  );
}

// Suppress unused-import warning while keeping Link importable for future CTAs.
void Link;
