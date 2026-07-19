/**
 * Confirmation panel for the specification page.
 *
 * - Reads confirmed versions from `job_specs` (RLS-scoped: owners only).
 * - Reads the current draft and validates it against the strict `JobSpecSchema`.
 * - Shows a live-canonical short hash preview so the user knows what they're
 *   about to lock in (the SERVER re-derives + stores the authoritative hash).
 * - Confirmation goes through the `confirmJobSpec` server function, which
 *   authenticates, verifies ownership, validates, hashes, allocates the next
 *   version, inserts an immutable row, advances workflow status, and writes
 *   an agent event.
 * - "Create revised draft" replaces the current draft (drafts stay editable
 *   — but a new confirmation always yields a new version, never a mutation).
 */

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, CheckCircle2, History, Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { confirmJobSpec } from "@/lib/job-spec.functions";
import {
  JobSpecSchema,
  emptyDraft,
  type JobSpec,
  type JobSpecDraft,
} from "@/lib/job-spec";
import { canonicalizeAndHash, shortHash } from "@/lib/job-spec-canonical";
import { friendlyIssues } from "@/lib/spec-errors";

const CONFIRM_TIMEOUT_MS = 25_000;

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timer);
        reject(error);
      },
    );
  });
}

type ConfirmedVersion = {
  id: string;
  version: number;
  specification_hash: string | null;
  confirmed_at: string | null;
  specification: unknown;
};

async function loadConfirmedVersions(
  negotiationId: string,
): Promise<ConfirmedVersion[]> {
  const { data, error } = await supabase
    .from("job_specs")
    .select("id, version, specification_hash, confirmed_at, specification")
    .eq("negotiation_id", negotiationId)
    .eq("confirmed", true)
    .order("version", { ascending: false });
  if (error) throw error;
  return (data ?? []) as ConfirmedVersion[];
}

export function SpecConfirmationPanel({
  negotiationId,
  draft,
}: {
  negotiationId: string;
  draft: JobSpecDraft;
}) {
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [slowConfirm, setSlowConfirm] = useState(false);

  const versions = useQuery({
    queryKey: ["job-spec-versions", negotiationId],
    queryFn: () => loadConfirmedVersions(negotiationId),
  });

  const strict = useMemo(() => JobSpecSchema.safeParse(draft), [draft]);

  // Preview hash — informational only. Server rederives the canonical bytes
  // and hash from the validated spec; never trust this value for equality
  // checks against a stored hash.
  const preview = useQuery({
    queryKey: ["job-spec-preview-hash", strict.success ? strict.data : null],
    enabled: strict.success,
    queryFn: () => canonicalizeAndHash(strict.data as JobSpec),
    staleTime: Infinity,
  });

  const confirmFn = useServerFn(confirmJobSpec);
  const confirm = useMutation({
    mutationFn: async () => {
      setSlowConfirm(false);
      const slowTimer = window.setTimeout(() => setSlowConfirm(true), 8_000);
      try {
        return await withTimeout(
          confirmFn({ data: { negotiationId } }),
          CONFIRM_TIMEOUT_MS,
          "Confirmation is taking too long. Please refresh the versions list and try again.",
        );
      } finally {
        window.clearTimeout(slowTimer);
      }
    },
    onSuccess: (result) => {
      setSlowConfirm(false);
      toast.success(
        `Specification v${result.version} confirmed · ${shortHash(result.hash)}`,
      );
      setDialogOpen(false);
      queryClient.invalidateQueries({ queryKey: ["job-spec-versions", negotiationId] });
      queryClient.invalidateQueries({ queryKey: ["negotiation-header", negotiationId] });
      queryClient.invalidateQueries({ queryKey: ["negotiation-overview", negotiationId] });
    },
    onError: (err: unknown) => {
      setSlowConfirm(false);
      toast.error(err instanceof Error ? err.message : "Confirmation failed");
    },
  });

  const revise = useMutation({
    mutationFn: async (source: JobSpec | null) => {
      // Replace the draft row with a copy of a confirmed version (or an empty
      // draft when creating a fresh revision from scratch). Confirmed rows
      // are never touched.
      const { error } = await supabase.from("job_spec_drafts").upsert(
        {
          negotiation_id: negotiationId,
          specification: (source ?? emptyDraft()) as unknown as never,
          completion_percent: source ? 100 : 0,
        },
        { onConflict: "negotiation_id" },
      );
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Draft is now editable again");
      queryClient.invalidateQueries({ queryKey: ["job-spec-draft", negotiationId] });
    },
    onError: (err: unknown) => {
      toast.error(err instanceof Error ? err.message : "Could not create revised draft");
    },
  });

  const latest = versions.data?.[0] ?? null;
  const canConfirm = strict.success && !confirm.isPending;

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldCheck className="size-4 text-navy" />
              Confirm specification
            </CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              Confirmation locks the specification with a SHA-256 hash. Every
              provider quotes against this exact document. Drafts stay editable
              — confirming again creates a new version.
            </p>
          </div>
          {latest && (
            <Badge variant="secondary" className="gap-1.5 whitespace-nowrap">
              <CheckCircle2 className="size-3.5 text-emerald-600" />
              v{latest.version} · {shortHash(latest.specification_hash ?? "")}
            </Badge>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          {!strict.success ? (
            <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <div>
                <p className="font-medium">Draft isn't ready to confirm yet.</p>
                <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs">
                  {friendlyIssues(strict.error.issues)
                    .slice(0, 5)
                    .map((i, idx) => (
                      <li key={idx}>{i.message}</li>
                    ))}
                  {strict.error.issues.length > 5 && (
                    <li>…and {strict.error.issues.length - 5} more</li>
                  )}
                </ul>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <span className="text-muted-foreground">Preview hash:</span>
              <code className="rounded bg-muted px-2 py-0.5 font-mono text-xs">
                {preview.data ? shortHash(preview.data.hash, 16) : "…"}
              </code>
              <span className="text-xs text-muted-foreground">
                Server rederives the authoritative hash on confirmation.
              </span>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              onClick={() => setDialogOpen(true)}
              disabled={!canConfirm}
            >
              {latest ? "Confirm as new version" : "Confirm specification"}
            </Button>
            {latest && (
              <Button
                type="button"
                variant="outline"
                onClick={() => revise.mutate(latest.specification as JobSpec)}
                disabled={revise.isPending}
              >
                {revise.isPending ? "Copying…" : `Create revised draft from v${latest.version}`}
              </Button>
            )}
          </div>

          {versions.data && versions.data.length > 0 && (
            <>
              <Separator />
              <div>
                <p className="mb-2 flex items-center gap-2 text-sm font-semibold">
                  <History className="size-3.5" /> Version history
                </p>
                <ul className="divide-y divide-border rounded-md border border-border/70">
                  {versions.data.map((v) => (
                    <li key={v.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                      <div>
                        <div className="font-medium">v{v.version}</div>
                        <div className="text-xs text-muted-foreground">
                          {v.confirmed_at
                            ? new Date(v.confirmed_at).toLocaleString()
                            : "—"}{" "}
                          ·{" "}
                          <code className="font-mono">
                            {shortHash(v.specification_hash ?? "", 12)}
                          </code>
                        </div>
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => revise.mutate(v.specification as JobSpec)}
                        disabled={revise.isPending}
                      >
                        Use as new draft
                      </Button>
                    </li>
                  ))}
                </ul>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm this specification?</DialogTitle>
            <DialogDescription>
              Once confirmed, this version cannot be edited or deleted. Providers
              will quote against this exact document.
            </DialogDescription>
          </DialogHeader>
          {strict.success && <ReviewSummary spec={strict.data} />}
          {slowConfirm && (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              Still confirming. This should finish shortly; if it does not, the request will stop automatically so you can retry.
            </div>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setDialogOpen(false)}
              disabled={confirm.isPending}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => confirm.mutate()}
              disabled={!canConfirm}
            >
              {confirm.isPending ? (
                <>
                  <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                  Confirming…
                </>
              ) : (
                "Confirm & lock"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function ReviewSummary({ spec }: { spec: JobSpec }) {
  const rows: [string, string][] = [
    ["Origin", `${spec.origin.line1}, ${spec.origin.city} ${spec.origin.postal_code}`],
    [
      "Destination",
      `${spec.destination.line1}, ${spec.destination.city} ${spec.destination.postal_code}`,
    ],
    ["Move date", `${spec.move_date} · ${spec.preferred_time_window}`],
    ["Bedrooms", String(spec.bedroom_count)],
    [
      "Inventory",
      `${spec.inventory.length} standard · ${spec.fragile_items.length} fragile · ${spec.specialty_items.length} specialty`,
    ],
    [
      "Packing",
      `${spec.packing_level}${spec.unpacking_requested ? " · unpacking" : ""}${
        spec.disassembly_required ? " · disassembly" : ""
      }`,
    ],
    ["Insurance", spec.insurance_level],
    [
      "Storage",
      spec.storage.needed
        ? `yes${spec.storage.duration_days ? ` · ${spec.storage.duration_days}d` : ""}`
        : "no",
    ],
  ];
  return (
    <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5 rounded-md border border-border/70 bg-muted/30 p-3 text-sm">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {k}
          </dt>
          <dd className="text-foreground">{v}</dd>
        </div>
      ))}
    </dl>
  );
}
