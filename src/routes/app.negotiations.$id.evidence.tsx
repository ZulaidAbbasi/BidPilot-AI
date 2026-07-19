import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  ArrowRight,
  Check,
  FileCheck2,
  Hash,
  HelpCircle,
  MessageSquareQuote,
  Mic,
  RefreshCw,
  ShieldAlert,
  TriangleAlert,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { useMemo, useState } from "react";

import { PageBody, EmptyState, LoadingState, ErrorState } from "@/components/app/page";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { supabase } from "@/integrations/supabase/client";
import { syncNegotiationReport } from "@/lib/report.functions";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/app/negotiations/$id/evidence")({
  head: () => ({ meta: [{ title: "Evidence — BidPilot AI" }] }),
  component: EvidencePage,
});

type SupportStatus = "supported" | "contradictory" | "missing_evidence" | "unsupported" | string;

type EvidenceRow = {
  id: string;
  quote_id: string;
  quote_line_item_id: string | null;
  evidence_type: string;
  support_status: SupportStatus;
  extracted_text: string | null;
  timestamp_ms: number | null;
  transcript_id: string | null;
  created_at: string;
  quotes: {
    id: string;
    quote_stage: string;
    total_amount: number | null;
    currency: string;
    spec_hash: string | null;
    spec_version: number;
    call_id: string | null;
    provider_id: string | null;
    providers: { name: string | null } | null;
  } | null;
};

type TranscriptRow = {
  id: string;
  call_id: string;
  sequence_number: number;
  speaker: string;
  text: string;
  started_at_ms: number | null;
};
function qaHelperText(data: { center: TranscriptRow | null; context: TranscriptRow[] }) {
  if (!data.center) return null;
  const idx = data.context.findIndex((t) => t.id === data.center?.id);
  const centerIsProvider =
    idx >= 0 && /provider|user/i.test(data.context[idx]!.speaker);
  const hasPrecedingAgent =
    centerIsProvider &&
    idx > 0 &&
    data.context.slice(0, idx).some((t) => /agent|assistant|ai/i.test(t.speaker));
  if (centerIsProvider && !hasPrecedingAgent) {
    return (
      <p className="mt-1 rounded-md border border-warn/40 bg-warn-soft/30 px-2 py-1.5 text-[11px] text-warn-foreground">
        No preceding agent question captured — an isolated affirmation does not support a specific
        monetary claim.
      </p>
    );
  }
  return null;
}


function fmtTime(ms: number | null) {
  if (ms == null) return null;
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function money(v: number | null | undefined, currency = "USD") {
  if (v == null) return "—";
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

function shortHash(hash: string | null | undefined) {
  if (!hash) return "—";
  return hash.length > 12 ? `${hash.slice(0, 8)}…${hash.slice(-4)}` : hash;
}

const STATUS_META: Record<
  string,
  {
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    dot: string;
    chip: string;
    outline: string;
    detail: string;
  }
> = {
  supported: {
    label: "Supported",
    icon: Check,
    dot: "bg-verified",
    chip: "bg-verified-soft/50 text-verified border-verified/40",
    outline: "border-verified/40",
    detail: "The transcript excerpt confirms this claim.",
  },
  contradictory: {
    label: "Contradictory",
    icon: TriangleAlert,
    dot: "bg-risk",
    chip: "bg-risk-soft/40 text-risk border-risk/40",
    outline: "border-risk/50",
    detail: "The transcript states a different value than the saved quote.",
  },
  missing_evidence: {
    label: "Missing evidence",
    icon: HelpCircle,
    dot: "bg-warn",
    chip: "bg-warn-soft/40 text-warn-foreground border-warn/40",
    outline: "border-warn/40",
    detail: "No transcript excerpt was captured for this claim. Re-run the call or Sync.",
  },
  unsupported: {
    label: "Unsupported",
    icon: X,
    dot: "bg-risk",
    chip: "bg-risk-soft/30 text-risk border-risk/40",
    outline: "border-risk/40",
    detail: "The transcript does not corroborate this claim — excluded from ranking.",
  },
};

function metaFor(status: string) {
  return STATUS_META[status] ?? STATUS_META.missing_evidence!;
}

function EvidencePage() {
  const { id } = Route.useParams();
  const queryClient = useQueryClient();
  const syncFn = useServerFn(syncNegotiationReport);

  const [filter, setFilter] = useState<
    "all" | "supported" | "contradictory" | "missing" | "unsupported"
  >("all");
  const [openId, setOpenId] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ["evidence", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("quote_evidence")
        .select(
          "id, quote_id, quote_line_item_id, evidence_type, support_status, extracted_text, timestamp_ms, transcript_id, created_at, quotes:quote_id(id, quote_stage, total_amount, currency, spec_hash, spec_version, call_id, provider_id, providers:provider_id(name))",
        )
        .eq("negotiation_id", id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as EvidenceRow[];
    },
  });

  const sync = useMutation({
    mutationFn: () => syncFn({ data: { negotiationId: id } }),
    onSuccess: (result) => {
      toast.success(
        `Synced ${result.reconciledCalls} call${result.reconciledCalls === 1 ? "" : "s"}`,
      );
      queryClient.invalidateQueries({ queryKey: ["evidence", id] });
      queryClient.invalidateQueries({ queryKey: ["quotes", id] });
      queryClient.invalidateQueries({ queryKey: ["final-report", id] });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Sync failed"),
  });

  const rows = useMemo(() => query.data ?? [], [query.data]);
  const counts = useMemo(() => {
    const c = { supported: 0, contradictory: 0, missing: 0, unsupported: 0 };
    for (const r of rows) {
      if (r.support_status === "supported") c.supported++;
      else if (r.support_status === "contradictory") c.contradictory++;
      else if (r.support_status === "missing_evidence") c.missing++;
      else if (r.support_status === "unsupported") c.unsupported++;
    }
    return c;
  }, [rows]);

  const filtered = rows.filter((r) => {
    if (filter === "all") return true;
    if (filter === "missing") return r.support_status === "missing_evidence";
    return r.support_status === filter;
  });

  const openRow = rows.find((r) => r.id === openId) ?? null;

  if (query.isLoading) return <LoadingState />;
  if (query.isError) return <ErrorState onRetry={() => query.refetch()} />;

  return (
    <PageBody>
      <header className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Evidence ledger</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Every quote claim reconciled against its call transcript. Click a row to open the full
            evidence chain.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => sync.mutate()}
          disabled={sync.isPending}
          className="self-start"
        >
          <RefreshCw className={cn("size-3.5", sync.isPending && "animate-spin")} /> Re-reconcile
        </Button>
      </header>

      {/* Status filters */}
      <div className="mb-4 flex flex-wrap gap-2">
        <FilterPill
          active={filter === "all"}
          onClick={() => setFilter("all")}
          label={`All · ${rows.length}`}
        />
        <FilterPill
          active={filter === "supported"}
          onClick={() => setFilter("supported")}
          label={`Supported · ${counts.supported}`}
          tone="verified"
        />
        <FilterPill
          active={filter === "contradictory"}
          onClick={() => setFilter("contradictory")}
          label={`Contradictory · ${counts.contradictory}`}
          tone="risk"
        />
        <FilterPill
          active={filter === "missing"}
          onClick={() => setFilter("missing")}
          label={`Missing · ${counts.missing}`}
          tone="warn"
        />
        <FilterPill
          active={filter === "unsupported"}
          onClick={() => setFilter("unsupported")}
          label={`Unsupported · ${counts.unsupported}`}
          tone="risk"
        />
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={FileCheck2}
          title="No evidence yet"
          description="Evidence is captured automatically after each provider call is finalized and reconciled with the transcript."
        />
      ) : filtered.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
          No records match this filter.
        </p>
      ) : (
        <div className="space-y-2">
          {filtered.map((row) => (
            <EvidenceCard key={row.id} row={row} onOpen={() => setOpenId(row.id)} />
          ))}
        </div>
      )}

      {/* Evidence drawer */}
      <EvidenceDrawer row={openRow} onClose={() => setOpenId(null)} negotiationId={id} />
    </PageBody>
  );
}

function FilterPill({
  active,
  onClick,
  label,
  tone,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  tone?: "verified" | "risk" | "warn";
}) {
  const toneClass =
    tone === "verified"
      ? "border-verified/40 text-verified"
      : tone === "risk"
        ? "border-risk/40 text-risk"
        : tone === "warn"
          ? "border-warn/40 text-warn-foreground"
          : "border-border text-foreground";
  return (
    <button
      onClick={onClick}
      className={cn(
        "rounded-full border px-3 py-1 text-xs transition-colors",
        active
          ? `${toneClass} bg-secondary/70`
          : "border-border text-muted-foreground hover:bg-secondary/40",
      )}
    >
      {label}
    </button>
  );
}

function EvidenceCard({ row, onOpen }: { row: EvidenceRow; onOpen: () => void }) {
  const meta = metaFor(row.support_status);
  const Icon = meta.icon;
  const providerName = row.quotes?.providers?.name ?? "Unknown provider";
  const ts = fmtTime(row.timestamp_ms);
  return (
    <button
      onClick={onOpen}
      className={cn(
        "group flex w-full flex-col gap-2 rounded-xl border bg-card p-4 text-left transition-all hover:shadow-sm sm:flex-row sm:items-start",
        meta.outline,
      )}
    >
      <div
        className={cn(
          "mt-0.5 grid size-8 shrink-0 place-items-center rounded-full",
          meta.dot,
          "text-white",
        )}
      >
        <Icon className="size-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium capitalize">
            {row.evidence_type.replace(/_/g, " ")}
          </span>
          <span
            className={cn(
              "rounded-full border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider",
              meta.chip,
            )}
          >
            {meta.label}
          </span>
          {row.quotes ? (
            <Badge variant="outline" className="text-[10px]">
              {row.quotes.quote_stage}
            </Badge>
          ) : null}
        </div>
        <p className="mt-0.5 text-[12px] text-muted-foreground">
          {providerName}
          {row.quotes?.total_amount != null
            ? ` · ${money(row.quotes.total_amount, row.quotes.currency)}`
            : ""}
          {ts ? ` · @${ts}` : ""}
        </p>
        {row.extracted_text ? (
          <blockquote className="mt-2 line-clamp-2 border-l-2 border-border pl-3 text-[13px] italic text-foreground/85">
            "{row.extracted_text}"
          </blockquote>
        ) : (
          <p className="mt-2 inline-flex items-center gap-1 text-xs text-muted-foreground">
            <ShieldAlert className="size-3" /> {meta.detail}
          </p>
        )}
      </div>
      <ArrowRight className="mt-1 size-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
    </button>
  );
}

/* ─────────────────── Drawer ─────────────────── */

function EvidenceDrawer({
  row,
  onClose,
  negotiationId,
}: {
  row: EvidenceRow | null;
  onClose: () => void;
  negotiationId: string;
}) {
  const transcriptQ = useQuery({
    queryKey: ["evidence-transcript-context", row?.transcript_id, row?.quotes?.call_id],
    enabled: !!row && !!row.quotes?.call_id,
    queryFn: async () => {
      if (!row?.quotes?.call_id) return { center: null, context: [] as TranscriptRow[] };
      const { data: all, error } = await supabase
        .from("call_transcripts")
        .select("id, call_id, sequence_number, speaker, text, started_at_ms")
        .eq("call_id", row.quotes.call_id)
        .order("sequence_number", { ascending: true });
      if (error) throw error;
      const list = (all ?? []) as TranscriptRow[];
      let centerIdx = -1;
      if (row.transcript_id) centerIdx = list.findIndex((t) => t.id === row.transcript_id);
      if (centerIdx < 0 && row.timestamp_ms != null) {
        centerIdx = list.findIndex((t) => (t.started_at_ms ?? -1) >= row.timestamp_ms!);
      }
      const center = centerIdx >= 0 ? (list[centerIdx] ?? null) : null;
      const from = Math.max(0, centerIdx - 2);
      const to = centerIdx >= 0 ? Math.min(list.length, centerIdx + 3) : 0;
      const context = centerIdx >= 0 ? list.slice(from, to) : [];
      return { center, context };
    },
  });

  const open = !!row;
  const meta = row ? metaFor(row.support_status) : null;

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent side="right" className="w-full overflow-y-auto p-0 sm:max-w-xl md:max-w-2xl">
        {row && meta ? (
          <>
            <SheetHeader className="border-b border-border px-5 py-4">
              <div className="flex items-center gap-2">
                <div
                  className={cn("grid size-8 place-items-center rounded-full text-white", meta.dot)}
                >
                  <meta.icon className="size-4" />
                </div>
                <div className="min-w-0">
                  <SheetTitle className="truncate text-base">
                    {row.evidence_type.replace(/_/g, " ")}
                  </SheetTitle>
                  <SheetDescription className="text-xs">
                    {meta.label} · {row.quotes?.providers?.name ?? "Unknown provider"}
                  </SheetDescription>
                </div>
              </div>
            </SheetHeader>

            <div className="space-y-6 p-5">
              {/* Chain */}
              <ChainStep
                index={1}
                icon={MessageSquareQuote}
                title="Provider statement"
                subtitle={
                  row.timestamp_ms != null ? `@ ${fmtTime(row.timestamp_ms)}` : "Unknown time"
                }
              >
                {row.extracted_text ? (
                  <blockquote className="border-l-2 border-border bg-secondary/40 py-2 pl-3 italic text-foreground/90">
                    "{row.extracted_text}"
                  </blockquote>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    No excerpt captured for this claim.
                  </p>
                )}
              </ChainStep>

              <ChainStep
                index={2}
                icon={Mic}
                title="Transcript location"
                subtitle={
                  transcriptQ.data?.center
                    ? `Turn ${transcriptQ.data.center.sequence_number} · ${transcriptQ.data.center.speaker}`
                    : row.transcript_id
                      ? "Loading…"
                      : "No transcript reference"
                }
              >
                {transcriptQ.data?.context.length ? (
                  <div className="space-y-1.5">
                    {(() => {
                      const centerId = transcriptQ.data.center?.id ?? null;
                      const list = transcriptQ.data.context;
                      const centerIdx = list.findIndex((t) => t.id === centerId);
                      // Q→A span: the Agent turn immediately preceding the
                      // Provider affirmation is the "Question"; the Provider
                      // turn is the "Answer". Both belong to the evidence
                      // span, so both get highlighted — an isolated "yes"
                      // without its preceding question does not count as
                      // support (server-side reconciliation enforces this;
                      // this is the UI proof).
                      const centerRow = centerIdx >= 0 ? list[centerIdx] : null;
                      const centerIsProvider =
                        !!centerRow && /provider|user/i.test(centerRow.speaker);
                      const qaAskerIdx =
                        centerIsProvider && centerIdx > 0
                          ? list
                              .slice(0, centerIdx)
                              .map((t, i) => ({ t, i }))
                              .reverse()
                              .find(({ t }) => /agent|assistant|ai/i.test(t.speaker))?.i ?? -1
                          : -1;
                      return list.map((t, i) => {
                        const isCenter = i === centerIdx;
                        const isQuestion = qaAskerIdx >= 0 && i === qaAskerIdx;
                        const inSpan = isCenter || isQuestion;
                        const spanRole = isQuestion ? "Question" : isCenter ? "Answer" : null;
                        return (
                          <div
                            key={t.id}
                            className={cn(
                              "rounded-md border px-3 py-2 text-sm transition-all",
                              isCenter
                                ? "animate-in fade-in border-primary/50 bg-primary/10 shadow-sm ring-1 ring-primary/20"
                                : isQuestion
                                  ? "animate-in fade-in border-warn/50 bg-warn-soft/40 shadow-sm ring-1 ring-warn/20"
                                  : "border-border bg-card opacity-70",
                            )}
                          >
                            <div className="mb-0.5 flex items-center justify-between text-[10px] uppercase tracking-wider text-muted-foreground">
                              <span className="inline-flex items-center gap-1.5">
                                #{t.sequence_number} · {t.speaker}
                                {spanRole ? (
                                  <span
                                    className={cn(
                                      "rounded-full px-1.5 py-[1px] text-[9px] font-semibold",
                                      isQuestion
                                        ? "bg-warn/20 text-warn-foreground"
                                        : "bg-primary/20 text-primary",
                                    )}
                                  >
                                    {spanRole}
                                  </span>
                                ) : null}
                              </span>
                              <span className="font-mono">{fmtTime(t.started_at_ms)}</span>
                            </div>
                            <p className={cn("text-[13px]", inSpan && "font-medium")}>{t.text}</p>
                          </div>
                        );
                      });
                    })()}
                    {qaHelperText(transcriptQ.data)}
                  </div>
                ) : transcriptQ.isLoading ? (
                  <p className="text-xs text-muted-foreground">Loading transcript context…</p>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    No stored transcript for this call yet.
                  </p>
                )}

              </ChainStep>

              <ChainStep
                index={3}
                icon={FileCheck2}
                title="Structured claim"
                subtitle="Extracted by the agent tool"
              >
                <ClaimTable row={row} />
              </ChainStep>

              <ChainStep
                index={4}
                icon={Hash}
                title="Specification"
                subtitle={`v${row.quotes?.spec_version ?? "—"} · ${shortHash(row.quotes?.spec_hash)}`}
              >
                <p className="text-xs text-muted-foreground">
                  This claim was captured against the specification above. It is only counted in
                  ranking when the hash matches the confirmed spec.
                </p>
              </ChainStep>

              <ChainStep
                index={5}
                icon={meta.icon}
                title="Verification result"
                subtitle={meta.label}
              >
                <p className="text-xs text-muted-foreground">{meta.detail}</p>
              </ChainStep>
            </div>
          </>
        ) : null}
        {/* Suppress unused warning */}
        {open ? <span className="hidden">{negotiationId}</span> : null}
      </SheetContent>
    </Sheet>
  );
}

function ChainStep({
  index,
  icon: Icon,
  title,
  subtitle,
  children,
}: {
  index: number;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <div className="relative">
      <div className="mb-2 flex items-center gap-2">
        <span className="grid size-6 place-items-center rounded-full border border-border bg-secondary text-[11px] font-semibold">
          {index}
        </span>
        <Icon className="size-3.5 text-muted-foreground" />
        <span className="text-sm font-semibold">{title}</span>
        <span className="text-[11px] text-muted-foreground">{subtitle}</span>
      </div>
      <div className="ml-2 border-l border-dashed border-border pl-4">{children}</div>
    </div>
  );
}

function ClaimTable({ row }: { row: EvidenceRow }) {
  const q = row.quotes;
  const entries: Array<[string, string]> = [
    ["Evidence type", row.evidence_type.replace(/_/g, " ")],
    ["Quote stage", q?.quote_stage ?? "—"],
    ["Quote total", q?.total_amount != null ? money(q.total_amount, q.currency) : "—"],
    ["Captured", new Date(row.created_at).toLocaleString()],
    ["Timestamp", fmtTime(row.timestamp_ms) ?? "—"],
  ];
  return (
    <Card className="border-border/70">
      <CardContent className="grid grid-cols-2 gap-x-4 gap-y-1.5 p-3 text-xs">
        {entries.map(([k, v]) => (
          <div key={k} className="flex flex-col">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              {k}
            </span>
            <span className="tabular-nums">{v}</span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
