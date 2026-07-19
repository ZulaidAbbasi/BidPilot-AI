import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  PhoneCall,
  ArrowRight,
  ShieldCheck,
  ShieldAlert,
  FileText,
  Mic,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";
import { useMemo, useState } from "react";

import { PageBody, LoadingState, ErrorState, EmptyState } from "@/components/app/page";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/app/status-badge";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { supabase } from "@/integrations/supabase/client";

type Filter =
  | "relevant"
  | "all"
  | "successful"
  | "needs_review"
  | "failed"
  | "historical"
  | "quote_gathering"
  | "negotiation"
  | "rehearsal";


export const Route = createFileRoute("/app/negotiations/$id/calls")({
  head: () => ({ meta: [{ title: "Calls — BidPilot AI" }] }),
  component: CallsPage,
});

const CALL_TONE: Record<string, "neutral" | "verified" | "risk" | "warn"> = {
  scheduled: "neutral",
  context_loading: "neutral",
  in_progress: "warn",
  quote_captured: "warn",
  negotiating: "warn",
  completed: "verified",
  failed: "risk",
  needs_review: "risk",
};

const STYLE_TONE: Record<string, "neutral" | "verified" | "risk" | "warn"> = {
  flexible: "verified",
  firm: "neutral",
  difficult: "warn",
  stonewaller: "warn",
  upseller: "warn",
};

const MODE_LABEL: Record<string, string> = {
  rehearsal: "Rehearsal",
  quote_gathering: "Quote gathering",
  negotiation: "Negotiation",
  voice_intake: "Voice intake",
};

function fmt(d: string | null): string {
  if (!d) return "—";
  return new Date(d).toLocaleString();
}

function durationLabel(start: string | null, end: string | null): string {
  if (!start || !end) return "—";
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (!Number.isFinite(ms) || ms <= 0) return "—";
  const s = Math.round(ms / 1000);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return m > 0 ? `${m}m ${r.toString().padStart(2, "0")}s` : `${r}s`;
}

function shortHash(hash: string | null): string {
  if (!hash) return "—";
  return hash.length > 12 ? `${hash.slice(0, 8)}…${hash.slice(-4)}` : hash;
}

type CallRow = {
  id: string;
  status: string;
  agent_type: string | null;
  call_mode: string | null;
  started_at: string | null;
  ended_at: string | null;
  final_outcome: string | null;
  provider_id: string | null;
  job_spec_version: number | null;
  job_spec_hash: string | null;
  recording_url: string | null;
  needs_review: boolean | null;
  verified_savings_amount: number | null;
  verified_price_changed: boolean | null;
  verified_terms_changed: boolean | null;
  metadata: Record<string, unknown> | null;
  providers: { name: string | null } | null;
};

type TranscriptRow = { call_id: string; count: number };
type EvidenceRow = { call_id: string | null; total: number; supported: number };

function getRehearsalStyle(r: CallRow): string | null {
  const md = r.metadata;
  if (md && typeof md === "object") {
    const s = (md as { rehearsal_style?: unknown }).rehearsal_style;
    if (typeof s === "string" && s.length > 0) return s;
  }
  return null;
}

function CallsPage() {
  const { id } = Route.useParams();
  const [filter, setFilter] = useState<Filter>("relevant");
  const [openCallId, setOpenCallId] = useState<string | null>(null);

  const callsQuery = useQuery({
    queryKey: ["calls-list-v2", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("calls")
        .select(
          "id, status, agent_type, call_mode, started_at, ended_at, final_outcome, provider_id, job_spec_version, job_spec_hash, recording_url, needs_review, verified_savings_amount, verified_price_changed, verified_terms_changed, metadata, providers(name)",
        )
        .eq("negotiation_id", id)
        .order("started_at", { ascending: false, nullsFirst: false });
      if (error) throw error;
      return (data ?? []) as unknown as CallRow[];
    },
  });

  const latestSpecQuery = useQuery({
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

  const transcriptsQuery = useQuery({
    queryKey: ["call-transcripts-count", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("call_transcripts")
        .select("call_id")
        .eq("negotiation_id", id);
      if (error) throw error;
      const counts = new Map<string, number>();
      for (const row of data ?? []) {
        if (row.call_id) counts.set(row.call_id, (counts.get(row.call_id) ?? 0) + 1);
      }
      return counts;
    },
  });

  const evidenceQuery = useQuery({
    queryKey: ["call-evidence-count", id],
    queryFn: async () => {
      // quote_evidence links via quote_id -> quotes.call_id. Do a joined read.
      const { data, error } = await supabase
        .from("quote_evidence")
        .select("support_status, quotes!inner(call_id, negotiation_id)")
        .eq("quotes.negotiation_id", id);
      if (error) throw error;
      const counts = new Map<string, { total: number; supported: number }>();
      for (const row of (data ?? []) as unknown as Array<{
        support_status: string | null;
        quotes: { call_id: string | null } | null;
      }>) {
        const cid = row.quotes?.call_id ?? null;
        if (!cid) continue;
        const cur = counts.get(cid) ?? { total: 0, supported: 0 };
        cur.total += 1;
        if (row.support_status === "supported") cur.supported += 1;
        counts.set(cid, cur);
      }
      return counts;
    },
  });

  const allRows = useMemo(() => callsQuery.data ?? [], [callsQuery.data]);
  const latest = latestSpecQuery.data ?? null;
  const transcripts = transcriptsQuery.data ?? new Map<string, number>();
  const evidenceMap = evidenceQuery.data ?? new Map<string, { total: number; supported: number }>();

  const counts = useMemo(() => {
    const bucket = {
      relevant: 0,
      all: allRows.length,
      successful: 0,
      needs_review: 0,
      failed: 0,
      historical: 0,
      quote_gathering: 0,
      negotiation: 0,
      rehearsal: 0,
    };
    const latestHash = latest?.specification_hash ?? null;
    for (const r of allRows) {
      const isFailed =
        r.status === "failed" ||
        r.final_outcome === "negotiation_failed" ||
        r.final_outcome === "disconnected" ||
        r.final_outcome === "wrong_number";
      const isDraft = r.status === "scheduled" && !r.final_outcome;
      const isSuccessful =
        r.final_outcome === "quote_received" || r.final_outcome === "negotiation_completed";
      const isNeedsReview = r.status === "needs_review" || r.needs_review === true;
      const isHistorical =
        !!latestHash && !!r.job_spec_hash && r.job_spec_hash !== latestHash;
      if (isFailed) bucket.failed++;
      if (isSuccessful) bucket.successful++;
      if (isNeedsReview) bucket.needs_review++;
      if (isHistorical) bucket.historical++;
      if (!isDraft && !isFailed && !isHistorical) bucket.relevant++;
      const mode = r.call_mode ?? r.agent_type;
      if (mode === "quote_gathering") bucket.quote_gathering++;
      if (mode === "negotiation") bucket.negotiation++;
      if (mode === "rehearsal") bucket.rehearsal++;
    }
    return bucket;
  }, [allRows, latest?.specification_hash]);


  const rows = useMemo(() => {
    const latestHash = latest?.specification_hash ?? null;
    return allRows.filter((r) => {
      const isFailed =
        r.status === "failed" ||
        r.final_outcome === "negotiation_failed" ||
        r.final_outcome === "disconnected" ||
        r.final_outcome === "wrong_number";
      const isDraft = r.status === "scheduled" && !r.final_outcome;
      const isHistorical =
        !!latestHash && !!r.job_spec_hash && r.job_spec_hash !== latestHash;
      const mode = r.call_mode ?? r.agent_type;
      switch (filter) {
        case "all":
          return true;
        case "successful":
          return (
            r.final_outcome === "quote_received" || r.final_outcome === "negotiation_completed"
          );
        case "needs_review":
          return r.status === "needs_review" || r.needs_review === true;
        case "failed":
          return isFailed;
        case "historical":
          return isHistorical;
        case "quote_gathering":
          return mode === "quote_gathering";
        case "negotiation":
          return mode === "negotiation";
        case "rehearsal":
          return mode === "rehearsal";
        case "relevant":
        default:
          return !isFailed && !isDraft && !isHistorical;
      }
    });
  }, [allRows, filter, latest?.specification_hash]);


  const openCall = openCallId ? (allRows.find((c) => c.id === openCallId) ?? null) : null;

  if (callsQuery.isLoading || latestSpecQuery.isLoading) {
    return (
      <PageBody>
        <LoadingState label="Loading calls" />
      </PageBody>
    );
  }
  if (callsQuery.isError) {
    return (
      <PageBody>
        <ErrorState
          title="Couldn't load calls"
          description={(callsQuery.error as Error).message}
          onRetry={() => callsQuery.refetch()}
        />
      </PageBody>
    );
  }

  const FILTERS: Array<{ key: Filter; label: string; count: number }> = [
    { key: "relevant", label: "Relevant", count: counts.relevant },
    { key: "all", label: "All", count: counts.all },
    { key: "successful", label: "Successful", count: counts.successful },
    { key: "needs_review", label: "Needs review", count: counts.needs_review },
    { key: "failed", label: "Failed", count: counts.failed },
    { key: "historical", label: "Historical", count: counts.historical },

    { key: "quote_gathering", label: "Quote gathering", count: counts.quote_gathering },
    { key: "negotiation", label: "Negotiation", count: counts.negotiation },
    { key: "rehearsal", label: "Rehearsal", count: counts.rehearsal },
  ];

  return (
    <PageBody>
      <div className="mb-4 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 sm:flex sm:justify-between">
        <div className="min-w-0">
          <h2 className="truncate text-xl font-semibold tracking-tight">Calls</h2>
          {latest ? (
            <p className="mt-0.5 text-xs text-muted-foreground">
              Latest confirmed spec: v{latest.version} · {shortHash(latest.specification_hash)}
            </p>
          ) : (
            <p className="mt-0.5 text-xs text-muted-foreground">
              No confirmed specification yet — calls can't be marked comparable.
            </p>
          )}
        </div>
        <Button asChild size="sm">
          <Link to="/app/negotiations/$id/control-room" params={{ id }}>
            Open Control Room <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
          </Link>
        </Button>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        {FILTERS.map((f) => (
          <Button
            key={f.key}
            size="sm"
            variant={filter === f.key ? "default" : "outline"}
            className="h-7 rounded-full px-3 text-xs"
            onClick={() => setFilter(f.key)}
          >
            {f.label} <span className="ml-1 tabular-nums text-[10px] opacity-70">{f.count}</span>
          </Button>
        ))}
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={PhoneCall}
          title="No calls yet"
          description="Kick off a rehearsal from the Control Room to record the first agent conversation."
          action={
            <Button asChild size="sm">
              <Link to="/app/negotiations/$id/control-room" params={{ id }}>
                Open Control Room
              </Link>
            </Button>
          }
        />
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/40 text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left">Provider</th>
                    <th className="px-3 py-2 text-left">Style</th>
                    <th className="px-3 py-2 text-left">Mode</th>
                    <th className="px-3 py-2 text-left">Status</th>
                    <th className="px-3 py-2 text-left">Duration</th>
                    <th className="px-3 py-2 text-left">Spec</th>
                    <th className="px-3 py-2 text-left">Integrity</th>
                    <th className="px-3 py-2 text-left">Outcome</th>
                    <th className="px-3 py-2 text-left">Transcript</th>
                    <th className="px-3 py-2 text-left">Recording</th>
                    <th className="px-3 py-2 text-left">Evidence</th>
                    <th className="px-3 py-2 text-left">Started</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const name = r.providers?.name ?? "—";
                    const tone = CALL_TONE[r.status ?? ""] ?? "neutral";
                    const style = getRehearsalStyle(r);
                    const hasSpec = r.job_spec_hash && r.job_spec_version;
                    const match =
                      latest &&
                      r.job_spec_hash &&
                      r.job_spec_hash === latest.specification_hash &&
                      r.job_spec_version === latest.version;
                    const comparable = Boolean(match);
                    const mode = r.call_mode ?? r.agent_type;
                    const trCount = transcripts.get(r.id) ?? 0;
                    const ev = evidenceMap.get(r.id);
                    return (
                      <tr
                        key={r.id}
                        className="cursor-pointer border-t hover:bg-muted/30"
                        onClick={() => setOpenCallId(r.id)}
                      >
                        <td className="px-3 py-2 font-medium">{name}</td>
                        <td className="px-3 py-2">
                          {style ? (
                            <StatusBadge tone={STYLE_TONE[style] ?? "neutral"}>{style}</StatusBadge>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-xs">
                          {mode ? (MODE_LABEL[mode] ?? mode) : "—"}
                        </td>
                        <td className="px-3 py-2">
                          <StatusBadge tone={tone}>{r.status}</StatusBadge>
                        </td>
                        <td className="px-3 py-2 tabular-nums text-xs text-muted-foreground">
                          {durationLabel(r.started_at, r.ended_at)}
                        </td>
                        <td className="px-3 py-2 font-mono text-[11px] text-muted-foreground">
                          {hasSpec ? (
                            <>
                              v{r.job_spec_version} · {shortHash(r.job_spec_hash)}
                            </>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="px-3 py-2">
                          {!hasSpec ? (
                            <Badge variant="outline">no spec</Badge>
                          ) : !latest ? (
                            <Badge variant="outline">no confirmed spec</Badge>
                          ) : comparable ? (
                            <span className="inline-flex items-center gap-1 text-xs text-emerald-700">
                              <ShieldCheck className="size-3.5" /> match
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-xs text-amber-700">
                              <ShieldAlert className="size-3.5" /> mismatch
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-xs text-muted-foreground">
                          {r.final_outcome ?? "—"}
                        </td>
                        <td className="px-3 py-2 text-xs">
                          {trCount > 0 ? (
                            <span className="inline-flex items-center gap-1 text-emerald-700">
                              <FileText className="size-3.5" /> {trCount}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-xs">
                          {r.recording_url ? (
                            <span className="inline-flex items-center gap-1 text-emerald-700">
                              <Mic className="size-3.5" /> stored
                            </span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-xs">
                          {ev && ev.total > 0 ? (
                            <span
                              className={
                                ev.supported === ev.total
                                  ? "text-emerald-700"
                                  : ev.supported > 0
                                    ? "text-amber-700"
                                    : "text-muted-foreground"
                              }
                            >
                              {ev.supported}/{ev.total}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-xs text-muted-foreground">
                          {fmt(r.started_at)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      <CallDetailSheet
        call={openCall}
        latestSpec={latest}
        transcriptCount={openCall ? (transcripts.get(openCall.id) ?? 0) : 0}
        evidence={openCall ? (evidenceMap.get(openCall.id) ?? null) : null}
        onClose={() => setOpenCallId(null)}
      />
    </PageBody>
  );
}

function CallDetailSheet({
  call,
  latestSpec,
  transcriptCount,
  evidence,
  onClose,
}: {
  call: CallRow | null;
  latestSpec: { version: number | null; specification_hash: string | null } | null;
  transcriptCount: number;
  evidence: { total: number; supported: number } | null;
  onClose: () => void;
}) {
  const style = call ? getRehearsalStyle(call) : null;
  const md = (call?.metadata ?? {}) as Record<string, unknown>;
  const commitments = Array.isArray(md.provider_commitments)
    ? (md.provider_commitments as string[])
    : [];
  const questions = Array.isArray(md.unresolved_questions)
    ? (md.unresolved_questions as string[])
    : [];
  const redFlags = Array.isArray(md.red_flags) ? (md.red_flags as string[]) : [];
  const changedTerms = Array.isArray(md.changed_terms) ? (md.changed_terms as string[]) : [];
  const comparable =
    call &&
    latestSpec &&
    call.job_spec_hash === latestSpec.specification_hash &&
    call.job_spec_version === latestSpec.version;

  return (
    <Sheet open={Boolean(call)} onOpenChange={(open) => (!open ? onClose() : null)}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle className="truncate">{call?.providers?.name ?? "Call"}</SheetTitle>
          <SheetDescription className="text-xs">
            {call ? (MODE_LABEL[call.call_mode ?? call.agent_type ?? ""] ?? "Call") : ""}
            {style && <> · Style {style}</>}
          </SheetDescription>
        </SheetHeader>

        {call && (
          <div className="mt-4 space-y-5 text-sm">
            <section className="grid grid-cols-2 gap-3">
              <Stat label="Status" value={call.status} />
              <Stat label="Outcome" value={call.final_outcome ?? "—"} />
              <Stat label="Duration" value={durationLabel(call.started_at, call.ended_at)} />
              <Stat label="Started" value={fmt(call.started_at)} />
              <Stat
                label="Spec"
                value={
                  call.job_spec_hash
                    ? `v${call.job_spec_version} · ${shortHash(call.job_spec_hash)}`
                    : "—"
                }
              />
              <Stat
                label="Integrity"
                value={comparable ? "Comparable" : call.job_spec_hash ? "Mismatch" : "No spec"}
                tone={comparable ? "verified" : call.job_spec_hash ? "warn" : "neutral"}
              />
            </section>

            <Section title="Same-spec integrity">
              {comparable ? (
                <p className="inline-flex items-center gap-2 text-xs text-emerald-700">
                  <ShieldCheck className="size-3.5" /> Ran against confirmed spec v
                  {latestSpec?.version} — comparable with sibling providers.
                </p>
              ) : call.job_spec_hash ? (
                <p className="inline-flex items-center gap-2 text-xs text-amber-700">
                  <ShieldAlert className="size-3.5" /> Ran against a different spec — results are
                  non-comparable until re-run against the current hash.
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">No spec hash captured on this call.</p>
              )}
            </Section>

            <Section title="Verified outcome">
              <div className="grid grid-cols-2 gap-3">
                <Stat
                  label="Verified savings"
                  value={
                    typeof call.verified_savings_amount === "number" &&
                    call.verified_savings_amount > 0
                      ? `$${call.verified_savings_amount.toFixed(2)}`
                      : "Not available"
                  }
                  tone={
                    typeof call.verified_savings_amount === "number" &&
                    call.verified_savings_amount > 0
                      ? "verified"
                      : "neutral"
                  }
                />
                <Stat
                  label="Price changed"
                  value={call.verified_price_changed ? "Yes" : "No"}
                  tone={call.verified_price_changed ? "verified" : "neutral"}
                />
                <Stat
                  label="Terms changed"
                  value={call.verified_terms_changed ? "Yes" : "No"}
                  tone={call.verified_terms_changed ? "verified" : "neutral"}
                />
                <Stat
                  label="Needs review"
                  value={call.needs_review ? "Yes" : "No"}
                  tone={call.needs_review ? "warn" : "neutral"}
                />
              </div>
            </Section>

            <Section title="Transcript">
              <p className="inline-flex items-center gap-2 text-xs">
                {transcriptCount > 0 ? (
                  <>
                    <CheckCircle2 className="size-3.5 text-emerald-600" />
                    {transcriptCount} transcript segment{transcriptCount === 1 ? "" : "s"} stored
                  </>
                ) : (
                  <>
                    <AlertCircle className="size-3.5 text-amber-600" />
                    No transcript yet — run Sync on Final report to fetch from ElevenLabs.
                  </>
                )}
              </p>
            </Section>

            <Section title="Recording">
              <p className="text-xs text-muted-foreground">
                {call.recording_url
                  ? "Recording reference stored (delivered via signed URL — never public)."
                  : "No recording stored for this call."}
              </p>
            </Section>

            {commitments.length > 0 && (
              <Section title="Provider commitments">
                <List items={commitments} />
              </Section>
            )}
            {changedTerms.length > 0 && (
              <Section title="Changed terms">
                <List items={changedTerms} />
              </Section>
            )}
            {questions.length > 0 && (
              <Section title="Unresolved questions">
                <List items={questions} tone="warn" />
              </Section>
            )}
            {redFlags.length > 0 && (
              <Section title="Red flags">
                <List items={redFlags} tone="risk" />
              </Section>
            )}

            <Section title="Evidence coverage">
              <p className="text-xs text-muted-foreground">
                {evidence && evidence.total > 0
                  ? `${evidence.supported} of ${evidence.total} claims transcript-supported.`
                  : "No structured evidence captured for this call yet."}
              </p>
            </Section>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Stat({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "neutral" | "verified" | "warn" | "risk";
}) {
  return (
    <div className="rounded-md border bg-muted/20 p-2">
      <div className="text-[10px] font-mono uppercase tracking-[0.1em] text-muted-foreground">
        {label}
      </div>
      <div
        className={`mt-0.5 truncate text-sm font-medium ${
          tone === "verified"
            ? "text-emerald-700"
            : tone === "warn"
              ? "text-amber-700"
              : tone === "risk"
                ? "text-risk"
                : ""
        }`}
      >
        {value}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        {title}
      </h4>
      {children}
    </div>
  );
}

function List({
  items,
  tone = "neutral",
}: {
  items: string[];
  tone?: "neutral" | "warn" | "risk";
}) {
  const color =
    tone === "warn" ? "text-amber-700" : tone === "risk" ? "text-risk" : "text-foreground";
  return (
    <ul className="space-y-1 text-xs">
      {items.map((it, i) => (
        <li key={i} className="flex items-start gap-2">
          <span className={`mt-1 size-1 shrink-0 rounded-full bg-current ${color}`} />
          <span className="min-w-0">{it}</span>
        </li>
      ))}
    </ul>
  );
}
