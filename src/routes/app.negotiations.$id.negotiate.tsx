import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import {
  ArrowRight,
  Ban,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Hash,
  Handshake,
  Info,
  PhoneCall,
  Radio,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  TrendingDown,
  Users,
} from "lucide-react";

import { PageBody, EmptyState } from "@/components/app/page";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/app/negotiations/$id/negotiate")({
  head: () => ({ meta: [{ title: "Negotiate — BidPilot AI" }] }),
  component: NegotiatePage,
});

type QuoteRow = {
  id: string;
  quote_stage: "INITIAL" | "REVISED" | "FINAL";
  currency: string;
  total_amount: number | null;
  valid_until: string | null;
  spec_hash: string | null;
  spec_version: number;
  verification_status: string;
  captured_at: string;
  provider_id: string;
  call_id: string | null;
  previous_quote_id: string | null;
  providers: { name: string | null } | null;
};

type EvidenceRow = {
  id: string;
  quote_id: string;
  support_status: string;
  evidence_type: string;
};

type LeverageEligibility =
  | { kind: "eligible" }
  | { kind: "expired"; validUntil: string }
  | { kind: "different_spec" }
  | { kind: "missing_evidence" }
  | { kind: "unverified" }
  | { kind: "not_lower" }
  | { kind: "same_provider" };

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

function NegotiatePage() {
  const { id } = Route.useParams();

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

  const quotesQ = useQuery({
    queryKey: ["quotes-negotiate", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("quotes")
        .select(
          "id, quote_stage, currency, total_amount, valid_until, spec_hash, spec_version, verification_status, captured_at, provider_id, call_id, previous_quote_id, providers(name)",
        )
        .eq("negotiation_id", id)
        .order("captured_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as QuoteRow[];
    },
  });

  const evidenceQ = useQuery({
    queryKey: ["evidence-support", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("quote_evidence")
        .select("id, quote_id, support_status, evidence_type")
        .eq("negotiation_id", id);
      if (error) throw error;
      return (data ?? []) as unknown as EvidenceRow[];
    },
  });

  const [targetId, setTargetId] = useState<string | null>(null);

  const data = useMemo(() => {
    const spec = specQ.data ?? null;
    const quotes = quotesQ.data ?? [];
    const evidence = evidenceQ.data ?? [];

    const specHash = spec?.specification_hash ?? null;
    const specVersion = spec?.version ?? null;

    // Latest quote per provider (call).
    const latestByProvider = new Map<string, QuoteRow>();
    for (const q of quotes) {
      const existing = latestByProvider.get(q.provider_id);
      if (!existing || new Date(q.captured_at) > new Date(existing.captured_at)) {
        latestByProvider.set(q.provider_id, q);
      }
    }
    const targets = Array.from(latestByProvider.values());

    const evidenceByQuote = new Map<string, EvidenceRow[]>();
    for (const e of evidence) {
      const arr = evidenceByQuote.get(e.quote_id) ?? [];
      arr.push(e);
      evidenceByQuote.set(e.quote_id, arr);
    }
    const hasSupportedPriceEvidence = (quoteId: string) =>
      (evidenceByQuote.get(quoteId) ?? []).some(
        (e) => e.support_status === "supported" && /price|total|line/i.test(e.evidence_type),
      );

    return {
      spec,
      specHash,
      specVersion,
      targets,
      quotes,
      hasSupportedPriceEvidence,
    };
  }, [specQ.data, quotesQ.data, evidenceQ.data]);

  const activeId = targetId ?? data.targets[0]?.provider_id ?? null;
  const activeTarget = data.targets.find((t) => t.provider_id === activeId) ?? null;

  const leverageCandidates = useMemo(() => {
    if (!activeTarget) return [];
    const targetPrice = activeTarget.total_amount;
    return data.quotes
      .filter((q) => q.provider_id !== activeTarget.provider_id)
      .map<{
        quote: QuoteRow;
        eligibility: LeverageEligibility;
      }>((q) => {
        const now = new Date();
        const validUntil = q.valid_until ? new Date(q.valid_until) : null;
        const expired = validUntil ? validUntil.getTime() < now.getTime() : false;
        const specMatches =
          data.specHash != null &&
          q.spec_hash === data.specHash &&
          q.spec_version === data.specVersion;
        const supported = data.hasSupportedPriceEvidence(q.id);
        const verified = q.verification_status === "verified" || supported;
        const isLower =
          targetPrice != null && q.total_amount != null && q.total_amount < targetPrice;

        let eligibility: LeverageEligibility;
        if (!specMatches) eligibility = { kind: "different_spec" };
        else if (expired && validUntil)
          eligibility = { kind: "expired", validUntil: validUntil.toISOString() };
        else if (!supported) eligibility = { kind: "missing_evidence" };
        else if (!verified) eligibility = { kind: "unverified" };
        else if (!isLower) eligibility = { kind: "not_lower" };
        else eligibility = { kind: "eligible" };

        return { quote: q, eligibility };
      })
      .sort((a, b) => {
        const rank = (e: LeverageEligibility) => (e.kind === "eligible" ? 0 : 1);
        if (rank(a.eligibility) !== rank(b.eligibility))
          return rank(a.eligibility) - rank(b.eligibility);
        return (a.quote.total_amount ?? Infinity) - (b.quote.total_amount ?? Infinity);
      });
  }, [activeTarget, data]);

  const eligibleLeverage = leverageCandidates.find((c) => c.eligibility.kind === "eligible");

  if (specQ.isLoading || quotesQ.isLoading || evidenceQ.isLoading) {
    return (
      <PageBody>
        <p className="text-sm text-muted-foreground">Loading negotiation state…</p>
      </PageBody>
    );
  }

  if (!data.specHash) {
    return (
      <PageBody>
        <EmptyState
          icon={Handshake}
          title="Confirm the specification first"
          description="Negotiation requires a confirmed job spec so leverage quotes can be verified against it."
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

  if (data.targets.length < 2) {
    return (
      <PageBody>
        <EmptyState
          icon={Handshake}
          title="Not enough comparable providers"
          description="Negotiation needs at least two providers with captured quotes before real leverage can be applied."
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

  return (
    <PageBody>
      <header className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Negotiate</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Choose a target provider and cite an eligible competing quote. Nothing invented — every
            leverage claim is a real saved quote with supported evidence.
          </p>
        </div>
        <div className="inline-flex items-center gap-2 self-start rounded-full border border-verified/30 bg-verified-soft/40 px-3 py-1.5 text-[11px]">
          <Hash className="size-3 text-verified" />
          <span className="text-muted-foreground">spec v{data.specVersion}</span>
          <span className="font-mono text-foreground">
            {data.specHash?.slice(0, 8)}…{data.specHash?.slice(-4)}
          </span>
        </div>
      </header>

      <div className="grid gap-5 lg:grid-cols-[280px_minmax(0,1fr)]">
        {/* Target provider selector */}
        <aside className="space-y-3">
          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            <Users className="mr-1 inline size-3" /> Target provider
          </div>
          <div className="space-y-1.5">
            {data.targets.map((t) => (
              <button
                key={t.provider_id}
                onClick={() => setTargetId(t.provider_id)}
                className={cn(
                  "flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left transition-all",
                  activeId === t.provider_id
                    ? "border-primary/40 bg-primary/5 ring-2 ring-primary/15"
                    : "border-border bg-card hover:bg-secondary/60",
                )}
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {t.providers?.name ?? "Unknown provider"}
                  </p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    {t.quote_stage} · {fmt(t.total_amount, t.currency)}
                  </p>
                </div>
                <ChevronRight className="size-3.5 text-muted-foreground" />
              </button>
            ))}
          </div>
        </aside>

        {/* Command panel */}
        {activeTarget ? (
          <section
            key={activeTarget.provider_id}
            className="animate-in fade-in slide-in-from-right-2 space-y-5 duration-300"
          >
            <TargetSummary target={activeTarget} data={data} />
            <LeveragePanel candidates={leverageCandidates} target={activeTarget} />
            <ActionsPanel
              negotiationId={id}
              eligible={!!eligibleLeverage}
              targetName={activeTarget.providers?.name ?? "Unknown provider"}
              leverageName={eligibleLeverage?.quote.providers?.name ?? null}
              targetPrice={activeTarget.total_amount}
              leveragePrice={eligibleLeverage?.quote.total_amount ?? null}
              currency={activeTarget.currency}
            />
          </section>
        ) : null}
      </div>
    </PageBody>
  );
}

function TargetSummary({
  target,
  data,
}: {
  target: QuoteRow;
  data: {
    specHash: string | null;
    specVersion: number | null;
    hasSupportedPriceEvidence: (id: string) => boolean;
  };
}) {
  const specMatches =
    !!data.specHash &&
    target.spec_hash === data.specHash &&
    target.spec_version === data.specVersion;
  const validUntil = target.valid_until ? new Date(target.valid_until) : null;
  const expired = validUntil ? validUntil.getTime() < Date.now() : false;
  const supported = data.hasSupportedPriceEvidence(target.id);

  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-lg font-semibold tracking-tight">
                {target.providers?.name ?? "Unknown provider"}
              </h3>
              <Badge variant="outline">{target.quote_stage}</Badge>
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Current offer captured {new Date(target.captured_at).toLocaleString()}
            </p>
          </div>
          <div className="text-right">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Current offer
            </div>
            <div className="text-2xl font-semibold tabular-nums">
              {fmt(target.total_amount, target.currency)}
            </div>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <StatusChip
            ok={specMatches}
            okLabel="Same spec"
            failLabel="Different spec"
            icon={ShieldCheck}
          />
          <StatusChip
            ok={!expired}
            okLabel={validUntil ? `Valid ${validUntil.toLocaleDateString()}` : "Undated"}
            failLabel={validUntil ? `Expired ${validUntil.toLocaleDateString()}` : "Expired"}
            icon={Clock3}
          />
          <StatusChip
            ok={supported}
            okLabel="Evidence supported"
            failLabel="Missing evidence"
            icon={Radio}
          />
          <StatusChip
            ok={target.verification_status === "verified"}
            okLabel="Verified"
            failLabel={`Verification: ${target.verification_status}`}
            icon={CheckCircle2}
          />
        </div>
      </CardContent>
    </Card>
  );
}

function StatusChip({
  ok,
  okLabel,
  failLabel,
  icon: Icon,
}: {
  ok: boolean;
  okLabel: string;
  failLabel: string;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-lg border px-2.5 py-2 text-xs",
        ok
          ? "border-verified/30 bg-verified-soft/30 text-verified"
          : "border-warn/40 bg-warn-soft/25 text-warn-foreground",
      )}
    >
      <Icon className="size-3.5 shrink-0" />
      <span className="truncate">{ok ? okLabel : failLabel}</span>
    </div>
  );
}

function LeveragePanel({
  candidates,
  target,
}: {
  candidates: Array<{ quote: QuoteRow; eligibility: LeverageEligibility }>;
  target: QuoteRow;
}) {
  const eligible = candidates.filter((c) => c.eligibility.kind === "eligible");
  const ineligible = candidates.filter((c) => c.eligibility.kind !== "eligible");
  return (
    <Card>
      <CardContent className="p-5">
        <div className="mb-3 flex items-center justify-between">
          <h4 className="text-sm font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            Eligible leverage
          </h4>
          <Badge variant="outline" className="gap-1">
            <Sparkles className="size-3" /> {eligible.length} usable
          </Badge>
        </div>
        {eligible.length === 0 ? (
          <div className="rounded-lg border border-warn/40 bg-warn-soft/25 px-3 py-2 text-xs text-warn-foreground">
            No eligible leverage against {target.providers?.name ?? "this provider"}. See excluded
            rows below for reasons.
          </div>
        ) : (
          <ul className="space-y-2">
            {eligible.map((c) => (
              <LeverageRow key={c.quote.id} candidate={c} target={target} />
            ))}
          </ul>
        )}

        {ineligible.length > 0 ? (
          <>
            <div className="mt-5 mb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              Excluded
            </div>
            <ul className="space-y-2">
              {ineligible.map((c) => (
                <LeverageRow key={c.quote.id} candidate={c} target={target} />
              ))}
            </ul>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}

function eligibilityCopy(e: LeverageEligibility): { label: string; detail: string } {
  switch (e.kind) {
    case "eligible":
      return { label: "Eligible", detail: "Same spec · verified · supported · lower total" };
    case "expired":
      return {
        label: "Expired",
        detail: `Quote validity ended ${new Date(e.validUntil).toLocaleDateString()}`,
      };
    case "different_spec":
      return {
        label: "Different specification",
        detail: "Captured against a spec hash that differs from the current confirmed spec",
      };
    case "missing_evidence":
      return {
        label: "Missing evidence",
        detail: "No supported transcript excerpt backs the price for this quote",
      };
    case "unverified":
      return {
        label: "Unverified",
        detail: "Reconciliation has not marked this quote as verified against the transcript",
      };
    case "not_lower":
      return {
        label: "Not lower",
        detail: "Total is not below the target provider's current offer",
      };
    case "same_provider":
      return { label: "Same provider", detail: "Can't use a provider's own quote as leverage" };
  }
}

function LeverageRow({
  candidate,
  target,
}: {
  candidate: { quote: QuoteRow; eligibility: LeverageEligibility };
  target: QuoteRow;
}) {
  const { quote, eligibility } = candidate;
  const eligible = eligibility.kind === "eligible";
  const copy = eligibilityCopy(eligibility);
  const diff =
    target.total_amount != null && quote.total_amount != null
      ? target.total_amount - quote.total_amount
      : null;
  return (
    <li
      className={cn(
        "flex flex-col gap-2 rounded-lg border px-3 py-2 text-sm sm:flex-row sm:items-center sm:justify-between",
        eligible
          ? "border-verified/30 bg-verified-soft/25"
          : "border-border bg-secondary/25 opacity-90",
      )}
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{quote.providers?.name ?? "Unknown provider"}</span>
          <Badge variant="outline" className="text-[10px]">
            {quote.quote_stage}
          </Badge>
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider",
              eligible ? "bg-verified text-white" : "bg-warn text-warn-foreground",
            )}
          >
            {eligible ? <CheckCircle2 className="size-3" /> : <Ban className="size-3" />}
            {copy.label}
          </span>
        </div>
        <p className="mt-0.5 flex items-start gap-1 text-[11px] text-muted-foreground">
          <Info className="mt-0.5 size-3 shrink-0" />
          <span>{copy.detail}</span>
        </p>
      </div>
      <div className="text-right sm:pl-4">
        <div className="tabular-nums font-semibold">{fmt(quote.total_amount, quote.currency)}</div>
        {diff && diff > 0 ? (
          <div className="mt-0.5 inline-flex items-center gap-1 text-[11px] text-verified">
            <TrendingDown className="size-3" />
            {fmt(diff, quote.currency)} lower
          </div>
        ) : null}
      </div>
    </li>
  );
}

function ActionsPanel({
  negotiationId,
  eligible,
  targetName,
  leverageName,
  targetPrice,
  leveragePrice,
  currency,
}: {
  negotiationId: string;
  eligible: boolean;
  targetName: string;
  leverageName: string | null;
  targetPrice: number | null;
  leveragePrice: number | null;
  currency: string;
}) {
  return (
    <Card
      className={cn("overflow-hidden", eligible ? "border-primary/30 shadow-sm" : "border-border")}
    >
      <CardContent className="space-y-4 p-5">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg border border-border bg-secondary/30 p-3">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Allowed
            </div>
            <ul className="mt-1.5 space-y-1 text-sm">
              <Bullet ok>Cite eligible leverage quote by name and total</Bullet>
              <Bullet ok>Confirm identical specification hash</Bullet>
              <Bullet ok>Request revised total and refundable deposit terms</Bullet>
              <Bullet ok>Accept revised offer when it beats current total</Bullet>
            </ul>
          </div>
          <div className="rounded-lg border border-border bg-secondary/30 p-3">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Prohibited
            </div>
            <ul className="mt-1.5 space-y-1 text-sm">
              <Bullet>Invent competing prices or providers</Bullet>
              <Bullet>Reveal customer's maximum authority</Bullet>
              <Bullet>Cite ineligible or expired leverage</Bullet>
              <Bullet>Change specification during the call</Bullet>
            </ul>
          </div>
        </div>

        {eligible && leverageName && leveragePrice != null ? (
          <div className="rounded-xl border border-primary/25 bg-primary/5 p-4">
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-primary">
              Ready to negotiate
            </div>
            <p className="mt-1 text-sm">
              Call <span className="font-semibold">{targetName}</span>. Cite{" "}
              <span className="font-semibold">{leverageName}</span> at{" "}
              <span className="font-mono tabular-nums">{fmt(leveragePrice, currency)}</span> against
              their current{" "}
              <span className="font-mono tabular-nums">{fmt(targetPrice, currency)}</span>.
            </p>
          </div>
        ) : (
          <div className="rounded-lg border border-warn/40 bg-warn-soft/25 px-3 py-2 text-xs text-warn-foreground">
            <ShieldAlert className="mr-1 inline size-3" /> Negotiation call cannot launch: no
            leverage passes the eligibility check.
          </div>
        )}

        <div className="flex flex-wrap justify-end gap-2 pt-1">
          <Button variant="outline" asChild>
            <Link to="/app/negotiations/$id/quotes" params={{ id: negotiationId }}>
              Review quotes
            </Link>
          </Button>
          <Button asChild disabled={!eligible}>
            <Link to="/app/negotiations/$id/control-room" params={{ id: negotiationId }}>
              <PhoneCall className="mr-1 size-4" />
              Launch negotiation call
              <ArrowRight className="ml-1 size-4" />
            </Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function Bullet({ children, ok }: { children: React.ReactNode; ok?: boolean }) {
  return (
    <li
      className={cn(
        "flex items-start gap-1.5 text-[13px]",
        ok ? "text-foreground" : "text-muted-foreground",
      )}
    >
      <span
        className={cn(
          "mt-0.5 grid size-3.5 shrink-0 place-items-center rounded-full",
          ok ? "bg-verified/15 text-verified" : "bg-warn/15 text-warn-foreground",
        )}
      >
        {ok ? <CheckCircle2 className="size-3" /> : <Ban className="size-3" />}
      </span>
      <span>{children}</span>
    </li>
  );
}
