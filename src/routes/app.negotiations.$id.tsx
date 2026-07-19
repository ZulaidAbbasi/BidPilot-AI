import { createFileRoute, Outlet, Link, useRouterState, redirect } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  Calendar,
  MapPin,
  ShieldCheck,
  Users,
  PhoneCall,
  FileText,
  ClipboardCheck,
} from "lucide-react";
import { StatusBadge } from "@/components/app/status-badge";
import { supabase } from "@/integrations/supabase/client";
import { statusTone, workflowLabel } from "@/lib/workflow";

const tabs = [
  { label: "Overview", to: "/app/negotiations/$id/overview" },
  { label: "Intake", to: "/app/negotiations/$id/intake" },
  { label: "Voice intake", to: "/app/negotiations/$id/voice-intake" },
  { label: "Specification", to: "/app/negotiations/$id/specification" },
  { label: "Providers", to: "/app/negotiations/$id/providers" },
  { label: "Calls", to: "/app/negotiations/$id/calls" },
  { label: "Control Room", to: "/app/negotiations/$id/control-room" },
  { label: "Quotes", to: "/app/negotiations/$id/quotes" },
  { label: "Evidence", to: "/app/negotiations/$id/evidence" },
  { label: "Integrity", to: "/app/negotiations/$id/integrity" },
  { label: "Final report", to: "/app/negotiations/$id/report" },
  { label: "Readiness", to: "/app/negotiations/$id/readiness" },
] as const;

export const Route = createFileRoute("/app/negotiations/$id")({
  beforeLoad: ({ location, params }) => {
    if (location.pathname === `/app/negotiations/${params.id}`) {
      throw redirect({
        to: "/app/negotiations/$id/overview",
        params: { id: params.id },
      });
    }
  },
  component: NegotiationLayout,
});

import { formatDateOnly, daysUntil } from "@/lib/date";

function formatDate(d: string | null) {
  return formatDateOnly(d);
}

function formatMoney(n: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
}

function NegotiationLayout() {
  const { id } = Route.useParams();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  const { data } = useQuery({
    queryKey: ["negotiation-shell", id],
    queryFn: async () => {
      const [neg, spec, prov, calls, savings] = await Promise.all([
        supabase
          .from("negotiations")
          .select(
            "title, workflow_status, origin_address, destination_address, moving_date, bedroom_count",
          )
          .eq("id", id)
          .maybeSingle(),
        supabase
          .from("job_specs")
          .select("version")
          .eq("negotiation_id", id)
          .eq("confirmed", true)
          .order("version", { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from("providers")
          .select("id", { count: "exact", head: true })
          .eq("negotiation_id", id),
        supabase
          .from("calls")
          .select("id", { count: "exact", head: true })
          .eq("negotiation_id", id),
        supabase
          .from("quotes")
          .select("total_amount")
          .eq("negotiation_id", id)
          .eq("verification_status", "verified"),
      ]);
      const verifiedSavings = (savings.data ?? []).reduce((a, r) => a + (r.total_amount ?? 0), 0);
      return {
        negotiation: neg.data,
        confirmedSpecVersion: spec.data?.version ?? null,
        providerCount: prov.count ?? 0,
        callCount: calls.count ?? 0,
        verifiedSavings,
      };
    },
  });

  const n = data?.negotiation;
  const title = n?.title ?? `#${id.slice(0, 8)}`;
  const status = n?.workflow_status ?? "DRAFT";
  const days = daysUntil(n?.moving_date ?? null);

  return (
    <div className="flex flex-col">
      <div className="sticky top-0 z-20 border-b border-border bg-background/95 backdrop-blur-md">
        <div className="px-5 pt-6 sm:px-10 sm:pt-8">
          <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(0,1fr)_auto]">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                  Negotiation
                </p>
                <StatusBadge tone={statusTone(status)}>{workflowLabel(status)}</StatusBadge>
              </div>
              <h1
                className="mt-1.5 truncate text-[26px] font-semibold tracking-tight sm:text-[30px]"
                title={`${title} · #${id.slice(0, 8)}`}
              >
                {title}
              </h1>
              {n && (
                <div className="mt-2.5 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-[13px] text-muted-foreground">
                  {(n.origin_address || n.destination_address) && (
                    <span className="inline-flex items-center gap-1.5">
                      <MapPin className="size-3.5 shrink-0" />
                      <span className="max-w-[22rem] truncate">
                        {n.origin_address ?? "—"} <span className="mx-1 opacity-50">→</span>{" "}
                        {n.destination_address ?? "—"}
                      </span>
                    </span>
                  )}
                  <span className="inline-flex items-center gap-1.5">
                    <Calendar className="size-3.5" />
                    <span className="tabular-nums">{formatDate(n.moving_date)}</span>
                    {typeof days === "number" && n.moving_date && (
                      <span
                        className={`ml-0.5 rounded-md px-1.5 py-0.5 text-[11px] font-medium tabular-nums ${
                          days < 0
                            ? "bg-muted text-muted-foreground"
                            : days <= 7
                              ? "bg-risk/10 text-risk"
                              : days <= 21
                                ? "bg-warn/15 text-warn-foreground"
                                : "bg-muted text-muted-foreground"
                        }`}
                      >
                        {days < 0 ? `${Math.abs(days)}d ago` : days === 0 ? "today" : `in ${days}d`}
                      </span>
                    )}
                  </span>
                  {typeof n.bedroom_count === "number" && (
                    <span className="tabular-nums">
                      {n.bedroom_count} bedroom{n.bedroom_count === 1 ? "" : "s"}
                    </span>
                  )}
                </div>
              )}
            </div>
            {data && (
              <div className="hidden shrink-0 items-stretch gap-0 divide-x divide-border rounded-xl border border-border bg-card shadow-[var(--shadow-card)] xl:flex">
                <MetricChip
                  icon={ShieldCheck}
                  label="Spec"
                  value={data.confirmedSpecVersion ? `v${data.confirmedSpecVersion}` : "Draft"}
                  tone={data.confirmedSpecVersion ? "verified" : "muted"}
                />
                <MetricChip icon={Users} label="Providers" value={String(data.providerCount)} />
                <MetricChip icon={PhoneCall} label="Calls" value={String(data.callCount)} />
                <MetricChip
                  icon={FileText}
                  label="Verified savings"
                  value={data.verifiedSavings > 0 ? formatMoney(data.verifiedSavings) : "—"}
                  tone={data.verifiedSavings > 0 ? "verified" : "muted"}
                />
              </div>
            )}
          </div>
          <nav className="mt-6 -mb-px flex gap-0.5 overflow-x-auto">
            {tabs.map((t) => {
              const resolved = t.to.replace("$id", id);
              const active = pathname === resolved;
              return (
                <Link
                  key={t.to}
                  to={t.to}
                  params={{ id }}
                  className={`relative whitespace-nowrap px-3.5 py-2.5 text-[13px] font-medium transition-colors ${
                    active ? "text-navy" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {t.label}
                  <span
                    className={`absolute inset-x-2 -bottom-px h-0.5 rounded-t-full transition-colors ${
                      active ? "bg-navy" : "bg-transparent"
                    }`}
                    aria-hidden
                  />
                </Link>
              );
            })}
          </nav>
        </div>
      </div>
      <div className="min-h-[calc(100dvh-3.5rem-9rem)]">
        <Outlet />
      </div>
    </div>
  );
}

function MetricChip({
  icon: Icon,
  label,
  value,
  tone = "default",
}: {
  icon: typeof ClipboardCheck;
  label: string;
  value: string;
  tone?: "default" | "verified" | "muted";
}) {
  const valueColor =
    tone === "verified"
      ? "text-verified"
      : tone === "muted"
        ? "text-muted-foreground"
        : "text-navy";
  return (
    <div className="flex min-w-[112px] flex-col justify-center px-4 py-2.5">
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        <Icon className="size-3" />
        {label}
      </div>
      <div className={`mt-1 text-[15px] font-semibold tabular-nums ${valueColor}`}>{value}</div>
    </div>
  );
}
