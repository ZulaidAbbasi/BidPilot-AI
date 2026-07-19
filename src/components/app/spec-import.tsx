/**
 * Document intake UI: upload → real extraction → conflict resolution → merge.
 *
 * Rules from the intake spec:
 *  - Real upload, real extraction (LLM via Lovable AI Gateway).
 *  - Show extracted fields BEFORE any write.
 *  - Never silently overwrite existing draft (voice or previous) values —
 *    every conflict must be resolved by the user.
 *  - Never auto-confirm. Merging into the draft leaves the spec UNconfirmed;
 *    confirmation still requires the explicit action on the confirmation
 *    panel.
 */

import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  AlertTriangle,
  Check,
  FileText,
  Loader2,
  Upload,
  X,
} from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { extractSpecFromDocument } from "@/lib/spec-extraction.functions";
import {
  JobSpecDraftSchema,
  computeCompletion,
  type JobSpecDraft,
} from "@/lib/job-spec";

const ACCEPT =
  ".pdf,application/pdf,image/png,image/jpeg,image/webp,image/gif,.csv,text/csv,.txt,text/plain";

const MAX_UPLOAD = 12 * 1024 * 1024;

type ExtractionResult = {
  extracted: Partial<JobSpecDraft>;
  notes: string[];
  model: string;
  document: { fileName: string; mimeType: string; bytes: number };
};

async function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error ?? new Error("File read failed"));
    r.readAsDataURL(file);
  });
}

/**
 * A field-level diff describing exactly what would happen on merge.
 *  - "add": field is missing on the draft, extraction supplies a value.
 *  - "conflict": both sides have differing values — user must choose.
 *  - "match": both sides agree — nothing to do.
 * Only "add" and "conflict" rows are user-actionable.
 */
type Row = {
  key: keyof JobSpecDraft;
  label: string;
  currentDisplay: string;
  extractedDisplay: string;
  kind: "add" | "conflict" | "match";
  currentValue: unknown;
  extractedValue: unknown;
};

function fmt(value: unknown): string {
  if (value === undefined || value === null || value === "") return "—";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return "—";
    return `${value.length} item${value.length === 1 ? "" : "s"}`;
  }
  if (typeof value === "object") {
    const rec = value as Record<string, unknown>;
    // Address-ish
    if ("line1" in rec || "city" in rec) {
      return [rec.line1, rec.city, rec.postal_code].filter(Boolean).join(", ") || "—";
    }
    const parts = Object.entries(rec)
      .filter(([, v]) => v !== undefined && v !== null && v !== "")
      .map(([k, v]) => `${k}: ${fmt(v)}`);
    return parts.length ? parts.slice(0, 3).join(" · ") : "—";
  }
  return String(value);
}

const FIELD_LABELS: Partial<Record<keyof JobSpecDraft, string>> = {
  origin: "Origin address",
  destination: "Destination address",
  move_date: "Move date",
  preferred_time_window: "Time window",
  bedroom_count: "Bedrooms",
  inventory: "General inventory",
  fragile_items: "Fragile items",
  specialty_items: "Specialty items",
  origin_access: "Origin access",
  destination_access: "Destination access",
  packing_level: "Packing level",
  unpacking_requested: "Unpacking requested",
  disassembly_required: "Disassembly required",
  reassembly_required: "Reassembly required",
  storage: "Storage",
  insurance_level: "Insurance",
  special_instructions: "Special instructions",
};

function isEmpty(v: unknown): boolean {
  if (v === undefined || v === null || v === "") return true;
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === "object") {
    const rec = v as Record<string, unknown>;
    return Object.values(rec).every((x) => x === undefined || x === "" || x === null);
  }
  return false;
}

function deepEq(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function buildRows(
  current: JobSpecDraft,
  extracted: Partial<JobSpecDraft>,
): Row[] {
  const keys = Object.keys(FIELD_LABELS) as (keyof JobSpecDraft)[];
  const rows: Row[] = [];
  for (const key of keys) {
    if (!(key in extracted)) continue;
    const cur = current[key];
    const ext = extracted[key];
    if (isEmpty(ext)) continue;
    const kind: Row["kind"] = isEmpty(cur)
      ? "add"
      : deepEq(cur, ext)
        ? "match"
        : "conflict";
    rows.push({
      key,
      label: FIELD_LABELS[key] ?? String(key),
      currentDisplay: fmt(cur),
      extractedDisplay: fmt(ext),
      kind,
      currentValue: cur,
      extractedValue: ext,
    });
  }
  return rows;
}

async function loadDraft(negotiationId: string): Promise<JobSpecDraft> {
  const { data, error } = await supabase
    .from("job_spec_drafts")
    .select("specification")
    .eq("negotiation_id", negotiationId)
    .maybeSingle<{ specification: unknown }>();
  if (error) throw error;
  const parsed = JobSpecDraftSchema.safeParse(data?.specification ?? {});
  return parsed.success ? parsed.data : {};
}

async function saveMerged(
  negotiationId: string,
  merged: JobSpecDraft,
): Promise<void> {
  const clean = JobSpecDraftSchema.parse(merged);
  const completion = computeCompletion(clean);
  const { error } = await supabase.from("job_spec_drafts").upsert(
    {
      negotiation_id: negotiationId,
      specification: clean as unknown as never,
      completion_percent: completion,
    },
    { onConflict: "negotiation_id" },
  );
  if (error) throw error;
}

export function SpecImportPanel({ negotiationId }: { negotiationId: string }) {
  const queryClient = useQueryClient();
  const extractFn = useServerFn(extractSpecFromDocument);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<ExtractionResult | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  // Read current draft on-demand for conflict rendering.
  const draftQuery = useQuery({
    queryKey: ["job-spec-draft-raw", negotiationId],
    queryFn: () => loadDraft(negotiationId),
    enabled: !!result,
  });

  const rows = useMemo(() => {
    if (!result || !draftQuery.data) return [];
    return buildRows(draftQuery.data, result.extracted);
  }, [result, draftQuery.data]);

  const actionable = rows.filter((r) => r.kind !== "match");
  const conflicts = rows.filter((r) => r.kind === "conflict");
  const additions = rows.filter((r) => r.kind === "add");

  const extractMutation = useMutation({
    mutationFn: async (f: File) => {
      const dataUrl = await fileToDataUrl(f);
      return (await extractFn({
        data: {
          negotiationId,
          fileName: f.name,
          mimeType: f.type || "application/octet-stream",
          dataUrl,
        },
      })) as ExtractionResult;
    },
    onSuccess: (r) => {
      setResult(r);
      // Default selection: additions checked, conflicts UNchecked (must opt-in).
      const next = new Set<string>();
      const built = buildRows(draftQuery.data ?? {}, r.extracted);
      for (const row of built) {
        if (row.kind === "add") next.add(String(row.key));
      }
      setSelected(next);
      setError(null);
    },
    onError: (e: unknown) => {
      setError(e instanceof Error ? e.message : "Extraction failed");
    },
  });

  const mergeMutation = useMutation({
    mutationFn: async () => {
      const current = draftQuery.data ?? {};
      const merged: JobSpecDraft = { ...current };
      for (const row of rows) {
        if (row.kind === "match") continue;
        if (!selected.has(String(row.key))) continue;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (merged as any)[row.key] = row.extractedValue;
      }
      await saveMerged(negotiationId, merged);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["job-spec-draft", negotiationId] });
      queryClient.invalidateQueries({ queryKey: ["job-spec-draft-raw", negotiationId] });
      // Reset the panel — the editor below will remount with the merged draft.
      setResult(null);
      setFile(null);
      setSelected(new Set());
      if (fileInputRef.current) fileInputRef.current.value = "";
    },
    onError: (e: unknown) => {
      setError(e instanceof Error ? e.message : "Merge failed");
    },
  });

  const onFile = (f: File | null) => {
    setError(null);
    setResult(null);
    if (!f) {
      setFile(null);
      return;
    }
    if (f.size > MAX_UPLOAD) {
      setError(`File is too large (${(f.size / 1024 / 1024).toFixed(1)} MB, max 12 MB).`);
      setFile(null);
      return;
    }
    setFile(f);
  };

  const toggle = (key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const extracting = extractMutation.isPending;
  const merging = mergeMutation.isPending;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <FileText className="h-4 w-4" /> Import from a document
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Upload a PDF, image, CSV, or text file (inventory sheet, quote request, moving list).
          BidPilot extracts fields with AI, shows you every conflict against your current draft,
          and only writes what you explicitly accept. Voice-captured values are never overwritten
          silently.
        </p>

        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPT}
            className="hidden"
            onChange={(e) => onFile(e.target.files?.[0] ?? null)}
          />
          <Button
            type="button"
            variant="outline"
            onClick={() => fileInputRef.current?.click()}
            disabled={extracting || merging}
          >
            <Upload className="mr-2 h-4 w-4" />
            {file ? "Change file" : "Choose file"}
          </Button>
          {file && (
            <span className="text-sm">
              <span className="font-medium">{file.name}</span>{" "}
              <span className="text-muted-foreground">
                · {(file.size / 1024).toFixed(0)} KB · {file.type || "unknown"}
              </span>
            </span>
          )}
          <Button
            type="button"
            onClick={() => file && extractMutation.mutate(file)}
            disabled={!file || extracting || merging}
          >
            {extracting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Extracting
              </>
            ) : (
              "Extract fields"
            )}
          </Button>
        </div>

        {error && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {result && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <Badge variant="outline">Model: {result.model}</Badge>
              <Badge variant="outline">
                {result.document.fileName} · {(result.document.bytes / 1024).toFixed(0)} KB
              </Badge>
              {conflicts.length > 0 && (
                <Badge variant="destructive">
                  {conflicts.length} conflict{conflicts.length === 1 ? "" : "s"} — resolve to merge
                </Badge>
              )}
              {additions.length > 0 && (
                <Badge>
                  {additions.length} new field{additions.length === 1 ? "" : "s"}
                </Badge>
              )}
            </div>

            {result.notes.length > 0 && (
              <div className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
                <div className="mb-1 font-medium text-foreground">Model notes</div>
                <ul className="list-disc space-y-0.5 pl-4">
                  {result.notes.slice(0, 8).map((n, i) => (
                    <li key={i}>{n}</li>
                  ))}
                </ul>
              </div>
            )}

            {actionable.length === 0 ? (
              <div className="rounded-md border p-3 text-sm text-muted-foreground">
                Nothing new to import from this document.
              </div>
            ) : (
              <div className="overflow-hidden rounded-md border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="w-10 px-2 py-2"></th>
                      <th className="px-2 py-2 text-left">Field</th>
                      <th className="px-2 py-2 text-left">Current draft</th>
                      <th className="px-2 py-2 text-left">From document</th>
                      <th className="w-24 px-2 py-2 text-left">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => {
                      const isSel = selected.has(String(row.key));
                      const isMatch = row.kind === "match";
                      return (
                        <tr key={String(row.key)} className="border-t align-top">
                          <td className="px-2 py-2">
                            <input
                              type="checkbox"
                              checked={isSel}
                              disabled={isMatch}
                              onChange={() => toggle(String(row.key))}
                              aria-label={`Accept ${row.label}`}
                            />
                          </td>
                          <td className="px-2 py-2 font-medium">{row.label}</td>
                          <td className="px-2 py-2 text-muted-foreground">
                            {row.currentDisplay}
                          </td>
                          <td className="px-2 py-2">{row.extractedDisplay}</td>
                          <td className="px-2 py-2">
                            {row.kind === "conflict" ? (
                              <Badge variant="destructive" className="whitespace-nowrap">
                                Conflict
                              </Badge>
                            ) : row.kind === "add" ? (
                              <Badge className="whitespace-nowrap">New</Badge>
                            ) : (
                              <Badge variant="outline" className="whitespace-nowrap">
                                Match
                              </Badge>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                onClick={() => mergeMutation.mutate()}
                disabled={selected.size === 0 || merging}
              >
                {merging ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Merging
                  </>
                ) : (
                  <>
                    <Check className="mr-2 h-4 w-4" /> Merge {selected.size} field
                    {selected.size === 1 ? "" : "s"} into draft
                  </>
                )}
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setResult(null);
                  setSelected(new Set());
                  setFile(null);
                  if (fileInputRef.current) fileInputRef.current.value = "";
                }}
                disabled={merging}
              >
                <X className="mr-2 h-4 w-4" /> Discard extraction
              </Button>
              <span className="text-xs text-muted-foreground">
                Merging updates the draft only. The specification is not confirmed until you
                explicitly confirm it above.
              </span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
