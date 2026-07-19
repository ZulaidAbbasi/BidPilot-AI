import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useIsMutating, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm, useFieldArray, useWatch, type UseFormReturn } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { AlertTriangle, Check, ChevronDown, ChevronUp, Loader2, Plus, RefreshCw, Trash2 } from "lucide-react";

import { PageBody, LoadingState, ErrorState } from "@/components/app/page";
import { SpecConfirmationPanel } from "@/components/app/spec-confirmation";
import { SpecImportPanel } from "@/components/app/spec-import";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { supabase } from "@/integrations/supabase/client";
import {
  ADDITIONAL_STOP_PURPOSE_LABELS,
  ADDITIONAL_STOP_PURPOSES,
  CARRY_UNITS,
  computeCompletion,
  CUSTOMER_PRIORITIES,
  CUSTOMER_PRIORITY_LABELS,
  defaultAgentPermissions,
  ELEVATOR_KINDS,
  emptyDraft,
  FRAGILE_CATEGORIES,
  INSURANCE_LEVELS,
  INVENTORY_CATEGORIES,
  JobSpecDraftSchema,
  newItemId,
  PACKING_LEVELS,
  PARKING_KINDS,
  PROPERTY_TYPES,
  sanitizeDraft,
  SPECIALTY_CATEGORIES,
  TIME_WINDOWS,
  type CustomerPriority,
  type JobSpecDraft,
} from "@/lib/job-spec";

import { friendlyIssues } from "@/lib/spec-errors";

export const Route = createFileRoute("/app/negotiations/$id/specification")({
  head: () => ({ meta: [{ title: "Specification — BidPilot AI" }] }),
  component: SpecPage,
});

type DraftRow = {
  id: string;
  negotiation_id: string;
  specification: unknown;
  completion_percent: number;
  updated_at: string;
};

async function loadDraft(negotiationId: string): Promise<{
  draft: JobSpecDraft;
  updated_at: string | null;
  revision: number;
}> {
  const { data, error } = await supabase
    .from("job_spec_drafts")
    .select("id, negotiation_id, specification, completion_percent, updated_at, revision")
    .eq("negotiation_id", negotiationId)
    .maybeSingle<DraftRow & { revision: number }>();
  if (error) throw error;
  if (!data) return { draft: emptyDraft(), updated_at: null, revision: 0 };

  // Coerce stored JSON through the schema. If the stored blob is malformed or
  // missing keys, fall back to empty defaults for that subset so the editor
  // still opens.
  const parsed = JobSpecDraftSchema.safeParse(data.specification ?? {});
  return {
    draft: parsed.success ? parsed.data : emptyDraft(),
    updated_at: data.updated_at,
    revision: data.revision ?? 0,
  };
}

async function saveDraft(
  negotiationId: string,
  draft: JobSpecDraft,
): Promise<{ updated_at: string }> {
  // Validate before write — throws on type violations, never on missing fields.
  const clean = sanitizeDraft(JobSpecDraftSchema.parse(draft));
  const completion = computeCompletion(clean);
  const { data, error } = await supabase
    .from("job_spec_drafts")
    .upsert(
      {
        negotiation_id: negotiationId,
        specification: clean as unknown as never,
        completion_percent: completion,
      },
      { onConflict: "negotiation_id" },
    )
    .select("updated_at")
    .single();
  if (error) throw error;
  return { updated_at: data.updated_at as string };
}

type SaveStatus =
  | { kind: "idle"; lastSavedAt: string | null }
  | { kind: "saving" }
  | { kind: "saved"; lastSavedAt: string }
  | { kind: "error"; message: string };

function SpecPage() {
  const { id } = Route.useParams();

  const query = useQuery({
    queryKey: ["job-spec-draft", id],
    queryFn: () => loadDraft(id),
  });

  if (query.isLoading) {
    return (
      <PageBody>
        <LoadingState label="Loading specification draft" />
      </PageBody>
    );
  }
  if (query.isError || !query.data) {
    return (
      <PageBody>
        <ErrorState
          title="Couldn't load the draft"
          description={(query.error as Error | undefined)?.message ?? "Try again in a moment."}
          onRetry={() => query.refetch()}
        />
      </PageBody>
    );
  }

  return (
    <PageBody>
      <div className="space-y-6">
        <SpecConfirmationPanel negotiationId={id} draft={query.data.draft} />
        <SpecImportPanel negotiationId={id} />
        <SpecEditor
          key={`${query.data.updated_at ?? "new"}::${query.data.revision}`}
          negotiationId={id}
          initial={query.data.draft}
          initialUpdatedAt={query.data.updated_at}
        />
      </div>
    </PageBody>
  );
}

function SpecEditor({
  negotiationId,
  initial,
  initialUpdatedAt,
}: {
  negotiationId: string;
  initial: JobSpecDraft;
  initialUpdatedAt: string | null;
}) {
  const queryClient = useQueryClient();
  const form = useForm<JobSpecDraft>({
    resolver: zodResolver(JobSpecDraftSchema),
    // Sanitize initial values so required booleans hydrate as explicit `false`.
    defaultValues: sanitizeDraft({ ...emptyDraft(), ...initial }),
    mode: "onBlur",
  });

  const [status, setStatus] = useState<SaveStatus>({
    kind: "idle",
    lastSavedAt: initialUpdatedAt,
  });

  const mutation = useMutation({
    mutationFn: (draft: JobSpecDraft) => saveDraft(negotiationId, draft),
    onMutate: () => setStatus({ kind: "saving" }),
    onSuccess: ({ updated_at }) => {
      setStatus({ kind: "saved", lastSavedAt: updated_at });
      form.reset(form.getValues(), { keepValues: true, keepDirty: false });
      queryClient.invalidateQueries({ queryKey: ["job-spec-draft", negotiationId] });
      queryClient.invalidateQueries({ queryKey: ["negotiation-overview", negotiationId] });
    },
    onError: (err: unknown) => {
      setStatus({
        kind: "error",
        message: err instanceof Error ? err.message : "Save failed",
      });
    },
  });

  // Debounced autosave. Only fires after a real change (dirty) and only when
  // the form parses cleanly. Never autosaves while a save is already in
  // flight — the pending call carries the newest values. Also paused while a
  // document merge is running so a stale autosave cannot overwrite it.
  const values = form.watch();
  const isDirty = form.formState.isDirty;
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestRef = useRef(values);
  latestRef.current = values;

  const mergingCount = useIsMutating({ mutationKey: ["merge-doc", negotiationId] });
  const isMerging = mergingCount > 0;

  useEffect(() => {
    if (!isDirty) return;
    if (isMerging) {
      // Cancel any pending autosave — the merge writes the source of truth.
      if (debounceRef.current) clearTimeout(debounceRef.current);
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      if (mutation.isPending) return;
      const parsed = JobSpecDraftSchema.safeParse(latestRef.current);
      if (!parsed.success) return; // wait for user to fix type-invalid fields
      mutation.mutate(parsed.data);
    }, 1500);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // Depend on the JSON snapshot so real edits re-arm the timer; ignore the
    // mutation object identity to avoid retriggering on status transitions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(values), isDirty, isMerging]);

  const completion = useMemo(() => computeCompletion(values), [values]);

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit((v) => mutation.mutate(v))} className="space-y-6">
        <StatusBar
          status={status}
          completion={completion}
          onRetry={() => mutation.mutate(form.getValues())}
          onSave={form.handleSubmit((v) => mutation.mutate(v))}
          saving={mutation.isPending}
          dirty={isDirty}
        />

        <MoveDetailsSection form={form} />
        <AdditionalStopsSection form={form} />
        <InventorySection form={form} />
        <AccessSection form={form} />
        <ServicesSection form={form} />
        <ProtectionSchedulingSection form={form} />
        <PrioritiesAuthoritySection form={form} />
      </form>
    </Form>
  );
}

function StatusBar({
  status,
  completion,
  onRetry,
  onSave,
  saving,
  dirty,
}: {
  status: SaveStatus;
  completion: number;
  onRetry: () => void;
  onSave: () => void;
  saving: boolean;
  dirty: boolean;
}) {
  return (
    <div className="sticky top-0 z-10 -mx-4 border-b border-border/70 bg-background/95 px-4 py-3 backdrop-blur sm:-mx-8 sm:px-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-1 items-center gap-3">
          <div className="flex-1 max-w-md">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Completion</span>
              <span className="font-medium text-foreground">{completion}%</span>
            </div>
            <Progress value={completion} className="mt-1 h-2" />
          </div>
          <StatusPill status={status} saving={saving} dirty={dirty} />
        </div>
        <div className="flex items-center gap-2">
          {status.kind === "error" && (
            <Button type="button" variant="outline" size="sm" onClick={onRetry}>
              <RefreshCw className="mr-1.5 size-3.5" /> Retry save
            </Button>
          )}
          <Button type="button" size="sm" onClick={onSave} disabled={saving}>
            {saving ? (
              <>
                <Loader2 className="mr-1.5 size-3.5 animate-spin" /> Saving
              </>
            ) : (
              "Save draft"
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}

function StatusPill({
  status,
  saving,
  dirty,
}: {
  status: SaveStatus;
  saving: boolean;
  dirty: boolean;
}) {
  if (saving) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
        <Loader2 className="size-3 animate-spin" /> Saving…
      </span>
    );
  }
  if (status.kind === "error") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-risk-soft px-2.5 py-1 text-xs font-medium text-navy">
        <AlertTriangle className="size-3" /> {status.message}
      </span>
    );
  }
  const lastSaved =
    status.kind === "saved"
      ? status.lastSavedAt
      : status.kind === "idle"
        ? status.lastSavedAt
        : null;
  if (!lastSaved) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
        Not saved yet
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-verified-soft px-2.5 py-1 text-xs font-medium text-navy">
      <Check className="size-3" />
      {dirty ? "Unsaved changes" : `Saved · ${new Date(lastSaved).toLocaleTimeString()}`}
    </span>
  );
}

// ---- Sections -------------------------------------------------------------

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </CardHeader>
      <CardContent className="space-y-4">{children}</CardContent>
    </Card>
  );
}

type F = UseFormReturn<JobSpecDraft>;

function AddressGroup({ form, prefix }: { form: F; prefix: "origin" | "destination" }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <FormField
        control={form.control}
        name={`${prefix}.line1` as const}
        render={({ field }) => (
          <FormItem className="sm:col-span-2">
            <FormLabel>Street address</FormLabel>
            <FormControl>
              <Input {...field} value={field.value ?? ""} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      <FormField
        control={form.control}
        name={`${prefix}.line2` as const}
        render={({ field }) => (
          <FormItem>
            <FormLabel>Apt / suite (optional)</FormLabel>
            <FormControl>
              <Input {...field} value={field.value ?? ""} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      <FormField
        control={form.control}
        name={`${prefix}.city` as const}
        render={({ field }) => (
          <FormItem>
            <FormLabel>City</FormLabel>
            <FormControl>
              <Input {...field} value={field.value ?? ""} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      <FormField
        control={form.control}
        name={`${prefix}.region` as const}
        render={({ field }) => (
          <FormItem>
            <FormLabel>State / region</FormLabel>
            <FormControl>
              <Input {...field} value={field.value ?? ""} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      <FormField
        control={form.control}
        name={`${prefix}.postal_code` as const}
        render={({ field }) => (
          <FormItem>
            <FormLabel>Postal code</FormLabel>
            <FormControl>
              <Input {...field} value={field.value ?? ""} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      <FormField
        control={form.control}
        name={`${prefix}.country` as const}
        render={({ field }) => (
          <FormItem>
            <FormLabel>Country</FormLabel>
            <FormControl>
              <Input {...field} value={field.value ?? "US"} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
    </div>
  );
}

function MoveDetailsSection({ form }: { form: F }) {
  return (
    <Section title="1. Move details" description="Where the move starts and ends, and when.">
      <div className="grid gap-6 lg:grid-cols-2">
        <div>
          <p className="mb-2 text-sm font-semibold">Origin</p>
          <AddressGroup form={form} prefix="origin" />
        </div>
        <div>
          <p className="mb-2 text-sm font-semibold">Destination</p>
          <AddressGroup form={form} prefix="destination" />
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField
          control={form.control}
          name="move_date"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Move date</FormLabel>
              <FormControl>
                <Input type="date" {...field} value={field.value ?? ""} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="preferred_time_window"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Preferred time window</FormLabel>
              <Select onValueChange={field.onChange} value={field.value ?? ""}>
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder="Choose a window" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {TIME_WINDOWS.map((w) => (
                    <SelectItem key={w} value={w}>
                      {w.charAt(0).toUpperCase() + w.slice(1)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>
    </Section>
  );
}

function AdditionalStopsSection({ form }: { form: F }) {
  const stops = useFieldArray({ control: form.control, name: "additional_stops" });
  // Renumber `stop_order` on the current array so the route always
  // reflects visual order after add/remove/move. The canonical hash
  // depends on this ordering, so keep it authoritative here.
  const renumber = () => {
    stops.fields.forEach((_f, idx) => {
      form.setValue(`additional_stops.${idx}.stop_order`, idx, {
        shouldDirty: true,
        shouldTouch: false,
      });
    });
  };
  return (
    <Section
      title="1b. Additional stops"
      description="Extra pickups, drop-offs, or storage stops between origin and destination. Order matters — movers price by route. Zero stops is valid."
    >
      <ArrayEditor
        title="Stops"
        emptyLabel="No extra stops. Add one only if the route deviates from origin → destination."
        addLabel="Add stop"
        items={stops.fields}
        onAdd={() => {
          stops.append({
            id: newItemId(),
            label: `Stop ${stops.fields.length + 1}`,
            address: "",
            stop_order: stops.fields.length,
            purpose: "pickup",
            notes: "",
            services: [],
            time_restriction: "",
          });
          // append is synchronous in RHF; ordering already correct.
        }}
        onRemove={(i) => {
          stops.remove(i);
          // Compact stop_order after removal.
          setTimeout(renumber, 0);
        }}
        onMoveUp={(i) => {
          if (i > 0) {
            stops.swap(i, i - 1);
            setTimeout(renumber, 0);
          }
        }}
        onMoveDown={(i) => {
          if (i < stops.fields.length - 1) {
            stops.swap(i, i + 1);
            setTimeout(renumber, 0);
          }
        }}
        renderRow={(i) => (
          <div className="grid flex-1 gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_minmax(0,1fr)]">
            <FormField
              control={form.control}
              name={`additional_stops.${i}.label`}
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-xs">Label</FormLabel>
                  <FormControl>
                    <Input placeholder="Storage unit" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name={`additional_stops.${i}.address`}
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-xs">Address</FormLabel>
                  <FormControl>
                    <Input placeholder="Street, city, state" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name={`additional_stops.${i}.purpose`}
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-xs">Service / purpose</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value ?? "pickup"}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {ADDITIONAL_STOP_PURPOSES.map((p) => (
                        <SelectItem key={p} value={p}>
                          {ADDITIONAL_STOP_PURPOSE_LABELS[p]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="sm:col-span-3 grid gap-2 sm:grid-cols-2">
              <FormField
                control={form.control}
                name={`additional_stops.${i}.services`}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs">Inventory / services at this stop</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="e.g. sofa, boxes, piano"
                        value={
                          Array.isArray(field.value) ? (field.value as string[]).join(", ") : ""
                        }
                        onChange={(e) => {
                          const raw = e.target.value;
                          const parts = raw
                            .split(",")
                            .map((s) => s.trim())
                            .filter((s) => s.length > 0);
                          field.onChange(parts);
                        }}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name={`additional_stops.${i}.time_restriction`}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs">Time restriction (optional)</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="After 2pm, Sat only, etc."
                        {...field}
                        value={field.value ?? ""}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <div className="sm:col-span-3">
              <FormField
                control={form.control}
                name={`additional_stops.${i}.notes`}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs">Access notes (optional)</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="Gate code, contact, dock hours…"
                        {...field}
                        value={field.value ?? ""}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          </div>
        )}
      />
    </Section>
  );
}


function InventorySection({ form }: { form: F }) {
  const inv = useFieldArray({ control: form.control, name: "inventory" });
  const frag = useFieldArray({ control: form.control, name: "fragile_items" });
  const spec = useFieldArray({ control: form.control, name: "specialty_items" });

  return (
    <Section
      title="2. Inventory"
      description="Bedrooms, standard items, fragile items, and specialty items that need special handling."
    >
      <FormField
        control={form.control}
        name="bedroom_count"
        render={({ field }) => (
          <FormItem className="max-w-xs">
            <FormLabel>Bedrooms</FormLabel>
            <FormControl>
              <Input
                type="number"
                min={0}
                max={20}
                {...field}
                value={field.value ?? ""}
                onChange={(e) =>
                  field.onChange(e.target.value === "" ? undefined : Number(e.target.value))
                }
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      <ArrayEditor
        title="Standard inventory"
        emptyLabel="No inventory items yet."
        addLabel="Add item"
        onAdd={() => inv.append({ id: newItemId(), label: "", quantity: 1, notes: "" })}
        items={inv.fields}
        onRemove={inv.remove}
        renderRow={(index) => (
          <div className="grid flex-1 gap-2 sm:grid-cols-[1fr_140px_100px_1fr]">
            <FormField
              control={form.control}
              name={`inventory.${index}.label` as const}
              render={({ field }) => (
                <FormItem>
                  <FormControl>
                    <Input placeholder="e.g. Sofa" {...field} value={field.value ?? ""} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name={`inventory.${index}.category` as const}
              render={({ field }) => (
                <FormItem>
                  <Select
                    onValueChange={(v) => field.onChange(v === "__unset__" ? undefined : v)}
                    value={field.value ?? "__unset__"}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Category" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="__unset__">Uncategorized</SelectItem>
                      {INVENTORY_CATEGORIES.map((c) => (
                        <SelectItem key={c} value={c}>
                          {c.replace(/_/g, " ")}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name={`inventory.${index}.quantity` as const}
              render={({ field }) => (
                <FormItem>
                  <FormControl>
                    <Input
                      type="number"
                      min={1}
                      {...field}
                      value={field.value ?? 1}
                      onChange={(e) =>
                        field.onChange(
                          e.target.value === "" ? 1 : Math.max(1, Number(e.target.value) || 1),
                        )
                      }
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name={`inventory.${index}.notes` as const}
              render={({ field }) => (
                <FormItem>
                  <FormControl>
                    <Input placeholder="Notes (optional)" {...field} value={field.value ?? ""} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        )}
      />


      <ArrayEditor
        title="Fragile items"
        emptyLabel="No fragile items."
        addLabel="Add fragile item"
        onAdd={() =>
          frag.append({
            id: newItemId(),
            label: "",
            category: "other",
            quantity: 1,
            notes: "",
          })
        }
        items={frag.fields}
        onRemove={frag.remove}
        renderRow={(index) => (
          <div className="grid flex-1 gap-2 sm:grid-cols-[1fr_140px_100px]">
            <FormField
              control={form.control}
              name={`fragile_items.${index}.label` as const}
              render={({ field }) => (
                <FormItem>
                  <FormControl>
                    <Input placeholder="e.g. Framed print" {...field} value={field.value ?? ""} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name={`fragile_items.${index}.category` as const}
              render={({ field }) => (
                <FormItem>
                  <Select onValueChange={field.onChange} value={field.value ?? "other"}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {FRAGILE_CATEGORIES.map((c) => (
                        <SelectItem key={c} value={c}>
                          {c.replace(/_/g, " ")}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name={`fragile_items.${index}.quantity` as const}
              render={({ field }) => (
                <FormItem>
                  <FormControl>
                    <Input
                      type="number"
                      min={1}
                      {...field}
                      value={field.value ?? 1}
                      onChange={(e) =>
                        field.onChange(
                          e.target.value === "" ? 1 : Math.max(1, Number(e.target.value) || 1),
                        )
                      }
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        )}
      />

      <ArrayEditor
        title="Specialty items"
        emptyLabel="No specialty items (piano, safe, hot tub, etc.)."
        addLabel="Add specialty item"
        onAdd={() =>
          spec.append({
            id: newItemId(),
            label: "",
            category: "other",
            requires_disassembly: false,
            dimensions: "",
            notes: "",
          })
        }
        items={spec.fields}
        onRemove={spec.remove}
        renderRow={(index) => (
          <div className="grid flex-1 gap-2 sm:grid-cols-[1fr_160px_auto]">
            <FormField
              control={form.control}
              name={`specialty_items.${index}.label` as const}
              render={({ field }) => (
                <FormItem>
                  <FormControl>
                    <Input placeholder="e.g. Upright piano" {...field} value={field.value ?? ""} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name={`specialty_items.${index}.category` as const}
              render={({ field }) => (
                <FormItem>
                  <Select onValueChange={field.onChange} value={field.value ?? "other"}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {SPECIALTY_CATEGORIES.map((c) => (
                        <SelectItem key={c} value={c}>
                          {c.replace(/_/g, " ")}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name={`specialty_items.${index}.requires_disassembly` as const}
              render={({ field }) => (
                <FormItem className="flex items-center gap-2 pt-6 sm:pt-8">
                  <FormControl>
                    <Checkbox
                      checked={field.value === true}
                      onCheckedChange={(v) => field.onChange(v === true)}
                    />
                  </FormControl>
                  <FormLabel className="!m-0 text-xs font-normal">Needs disassembly</FormLabel>
                </FormItem>
              )}
            />
          </div>
        )}
      />
    </Section>
  );
}

function AccessBlock({
  form,
  prefix,
}: {
  form: F;
  prefix: "origin_access" | "destination_access";
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <FormField
        control={form.control}
        name={`${prefix}.property_type` as const}
        render={({ field }) => (
          <FormItem>
            <FormLabel>
              Property type <span className="text-xs text-muted-foreground">(optional)</span>
            </FormLabel>
            <Select
              onValueChange={(v) => field.onChange(v === "__unset__" ? undefined : v)}
              value={field.value ?? "__unset__"}
            >
              <FormControl>
                <SelectTrigger>
                  <SelectValue placeholder="Not specified" />
                </SelectTrigger>
              </FormControl>
              <SelectContent>
                <SelectItem value="__unset__">Not specified</SelectItem>
                {PROPERTY_TYPES.map((v) => (
                  <SelectItem key={v} value={v}>
                    {v.replace(/_/g, " ")}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FormMessage />
          </FormItem>
        )}
      />
      <FormField
        control={form.control}

        name={`${prefix}.floor` as const}
        render={({ field }) => (
          <FormItem>
            <FormLabel>Floor</FormLabel>
            <FormControl>
              <Input
                type="number"
                {...field}
                value={field.value ?? ""}
                onChange={(e) =>
                  field.onChange(e.target.value === "" ? undefined : Number(e.target.value))
                }
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      <FormField
        control={form.control}
        name={`${prefix}.stairs_flights` as const}
        render={({ field }) => (
          <FormItem>
            <FormLabel>Flights of stairs</FormLabel>
            <FormControl>
              <Input
                type="number"
                min={0}
                {...field}
                value={field.value ?? ""}
                onChange={(e) =>
                  field.onChange(e.target.value === "" ? undefined : Number(e.target.value))
                }
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      <FormField
        control={form.control}
        name={`${prefix}.elevator` as const}
        render={({ field }) => (
          <FormItem>
            <FormLabel>Elevator</FormLabel>
            <Select onValueChange={field.onChange} value={field.value ?? ""}>
              <FormControl>
                <SelectTrigger>
                  <SelectValue placeholder="Select" />
                </SelectTrigger>
              </FormControl>
              <SelectContent>
                {ELEVATOR_KINDS.map((v) => (
                  <SelectItem key={v} value={v}>
                    {v.replace(/_/g, " ")}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FormMessage />
          </FormItem>
        )}
      />
      <div className="grid grid-cols-[1fr_100px] gap-2">
        <FormField
          control={form.control}
          name={`${prefix}.long_carry_meters` as const}
          render={({ field }) => (
            <FormItem>
              <FormLabel>Carry distance</FormLabel>
              <FormControl>
                <Input
                  type="number"
                  min={0}
                  {...field}
                  value={field.value ?? ""}
                  onChange={(e) =>
                    field.onChange(e.target.value === "" ? undefined : Number(e.target.value))
                  }
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name={`${prefix}.long_carry_unit` as const}
          render={({ field }) => (
            <FormItem>
              <FormLabel>Unit</FormLabel>
              <Select onValueChange={field.onChange} value={field.value ?? "meters"}>
                <FormControl>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {CARRY_UNITS.map((u) => (
                    <SelectItem key={u} value={u}>
                      {u}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>

      <FormField
        control={form.control}
        name={`${prefix}.parking` as const}
        render={({ field }) => (
          <FormItem>
            <FormLabel>Parking</FormLabel>
            <Select onValueChange={field.onChange} value={field.value ?? ""}>
              <FormControl>
                <SelectTrigger>
                  <SelectValue placeholder="Select" />
                </SelectTrigger>
              </FormControl>
              <SelectContent>
                {PARKING_KINDS.map((v) => (
                  <SelectItem key={v} value={v}>
                    {v.replace(/_/g, " ")}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FormMessage />
          </FormItem>
        )}
      />
      <div className="space-y-2">
        <FormField
          control={form.control}
          name={`${prefix}.elevator_reservation_required` as const}
          render={({ field }) => (
            <FormItem className="flex items-center gap-2">
              <FormControl>
                <Checkbox
                  checked={field.value === true}
                  onCheckedChange={(v) => field.onChange(v === true)}
                />
              </FormControl>
              <FormLabel className="!m-0 text-sm font-normal">
                Elevator reservation required
              </FormLabel>
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name={`${prefix}.parking_permit_required` as const}
          render={({ field }) => (
            <FormItem className="flex items-center gap-2">
              <FormControl>
                <Checkbox
                  checked={field.value === true}
                  onCheckedChange={(v) => field.onChange(v === true)}
                />
              </FormControl>
              <FormLabel className="!m-0 text-sm font-normal">Parking permit required</FormLabel>
            </FormItem>
          )}
        />
      </div>
      <FormField
        control={form.control}
        name={`${prefix}.loading_dock_available` as const}
        render={({ field }) => (
          <FormItem className="flex items-center gap-2 sm:col-span-2">
            <FormControl>
              <Checkbox
                checked={field.value === true}
                onCheckedChange={(v) => field.onChange(v === true)}
              />
            </FormControl>
            <FormLabel className="!m-0 text-sm font-normal">
              Loading dock available at this address
            </FormLabel>
          </FormItem>
        )}
      />
      <FormField
        control={form.control}
        name={`${prefix}.access_restrictions` as const}
        render={({ field }) => (
          <FormItem className="sm:col-span-2">
            <FormLabel>Access restrictions</FormLabel>
            <FormControl>
              <Textarea
                rows={2}
                placeholder="e.g. Loading dock hours 9am–5pm, gated community, narrow driveway"
                {...field}
                value={field.value ?? ""}
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      <FormField
        control={form.control}
        name={`${prefix}.site_notes` as const}
        render={({ field }) => (
          <FormItem className="sm:col-span-2">
            <FormLabel>
              Site notes <span className="text-xs text-muted-foreground">(optional)</span>
            </FormLabel>
            <FormControl>
              <Textarea
                rows={2}
                placeholder="Narrow doorframe at unit; elevator padding stored with concierge…"
                {...field}
                value={field.value ?? ""}
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
    </div>
  );
}


function AccessSection({ form }: { form: F }) {
  return (
    <Section
      title="3. Access conditions"
      description="Floors, stairs, elevators, carry distance, parking, and site restrictions."
    >
      <div className="grid gap-6 lg:grid-cols-2">
        <div>
          <p className="mb-2 text-sm font-semibold">Origin access</p>
          <AccessBlock form={form} prefix="origin_access" />
        </div>
        <div>
          <p className="mb-2 text-sm font-semibold">Destination access</p>
          <AccessBlock form={form} prefix="destination_access" />
        </div>
      </div>
    </Section>
  );
}

function ServicesSection({ form }: { form: F }) {
  // Observe conditional fields so the UI hides irrelevant inputs
  // and the strict schema's refine only sees required duration when
  // storage.needed is true. False values still persist because the
  // form retains the field even when its input is not shown.
  const packingLevel = useWatch({ control: form.control, name: "packing_level" });
  const storageNeeded = useWatch({ control: form.control, name: "storage.needed" });
  return (
    <Section
      title="4. Services"
      description="Packing, unpacking, disassembly, reassembly, and storage."
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField
          control={form.control}
          name="packing_level"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Packing level</FormLabel>
              <Select onValueChange={field.onChange} value={field.value ?? ""}>
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder="Select" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {PACKING_LEVELS.map((v) => (
                    <SelectItem key={v} value={v}>
                      {v.replace(/_/g, " ")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />
        <div className="space-y-2 pt-6">
          {(
            [
              ["unpacking_requested", "Unpacking requested"],
              ["disassembly_required", "Disassembly required"],
              ["reassembly_required", "Reassembly required"],
            ] as const
          ).map(([name, label]) => (
            <FormField
              key={name}
              control={form.control}
              name={name}
              render={({ field }) => (
                <FormItem className="flex items-center gap-2">
                  <FormControl>
                    <Checkbox
                      checked={field.value === true}
                      onCheckedChange={(v) => field.onChange(v === true)}
                    />
                  </FormControl>
                  <FormLabel className="!m-0 text-sm font-normal">{label}</FormLabel>
                </FormItem>
              )}
            />
          ))}
        </div>
      </div>

      {packingLevel === "partial" && (
        <FormField
          control={form.control}
          name="partial_packing_notes"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Which items should the crew pack? (partial packing)</FormLabel>
              <FormControl>
                <Textarea
                  rows={3}
                  placeholder="e.g. kitchen, artwork, and closets only — we'll pack our own boxes."
                  {...field}
                  value={field.value ?? ""}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      )}

      <div className="rounded-md border border-border/70 p-3">
        <p className="text-sm font-semibold">Storage</p>
        <div className="mt-2 grid gap-3 sm:grid-cols-3">
          <FormField
            control={form.control}
            name="storage.needed"
            render={({ field }) => (
              <FormItem className="flex items-center gap-2 sm:pt-6">
                <FormControl>
                  <Checkbox
                    checked={field.value === true}
                    onCheckedChange={(v) => field.onChange(v === true)}
                  />
                </FormControl>
                <FormLabel className="!m-0 text-sm font-normal">Storage needed</FormLabel>
              </FormItem>
            )}
          />
          {storageNeeded === true ? (
            <>
              <FormField
                control={form.control}
                name="storage.duration_days"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Duration (days)</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min={1}
                        {...field}
                        value={field.value ?? ""}
                        onChange={(e) =>
                          field.onChange(
                            e.target.value === "" ? undefined : Number(e.target.value),
                          )
                        }
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="storage.climate_controlled"
                render={({ field }) => (
                  <FormItem className="flex items-center gap-2 sm:pt-6">
                    <FormControl>
                      <Checkbox
                        checked={field.value === true}
                        onCheckedChange={(v) => field.onChange(v === true)}
                      />
                    </FormControl>
                    <FormLabel className="!m-0 text-sm font-normal">Climate controlled</FormLabel>
                  </FormItem>
                )}
              />
            </>
          ) : (
            <p className="text-xs text-muted-foreground sm:col-span-2 sm:pt-7">
              Duration and climate control apply only when storage is needed.
            </p>
          )}
        </div>
      </div>
    </Section>
  );
}


function ProtectionSchedulingSection({ form }: { form: F }) {
  return (
    <Section
      title="5. Protection & scheduling"
      description="Insurance coverage and any special instructions for the crew."
    >
      <FormField
        control={form.control}
        name="insurance_level"
        render={({ field }) => (
          <FormItem className="max-w-sm">
            <FormLabel>Insurance preference</FormLabel>
            <Select onValueChange={field.onChange} value={field.value ?? ""}>
              <FormControl>
                <SelectTrigger>
                  <SelectValue placeholder="Select" />
                </SelectTrigger>
              </FormControl>
              <SelectContent>
                {INSURANCE_LEVELS.map((v) => (
                  <SelectItem key={v} value={v}>
                    {v.replace(/_/g, " ")}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FormMessage />
          </FormItem>
        )}
      />
      <FormField
        control={form.control}
        name="special_instructions"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Special instructions</FormLabel>
            <FormControl>
              <Textarea
                rows={4}
                placeholder="Anything providers should know: pets, kids, keys, timing constraints, etc."
                {...field}
                value={field.value ?? ""}
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
    </Section>
  );
}

// ---- Generic array editor -------------------------------------------------

function ArrayEditor({
  title,
  emptyLabel,
  addLabel,
  items,
  onAdd,
  onRemove,
  renderRow,
  onMoveUp,
  onMoveDown,
}: {
  title: string;
  emptyLabel: string;
  addLabel: string;
  items: { id: string }[];
  onAdd: () => void;
  onRemove: (index: number) => void;
  renderRow: (index: number) => React.ReactNode;
  // Optional reorder controls: when supplied, up/down buttons appear
  // next to each row. Stops use these to change route order without
  // asking the user to type into the numeric stop_order field.
  onMoveUp?: (index: number) => void;
  onMoveDown?: (index: number) => void;
}) {
  const reorderable = Boolean(onMoveUp && onMoveDown);
  return (
    <div className="rounded-md border border-border/70">
      <div className="flex items-center justify-between border-b border-border/70 px-3 py-2">
        <p className="text-sm font-semibold">{title}</p>
        <Button type="button" size="sm" variant="outline" onClick={onAdd}>
          <Plus className="mr-1 size-3.5" />
          {addLabel}
        </Button>
      </div>
      {items.length === 0 ? (
        <p className="px-3 py-4 text-sm text-muted-foreground">{emptyLabel}</p>
      ) : (
        <ul className="divide-y divide-border">
          {items.map((it, i) => (
            <li key={it.id} className="flex items-start gap-2 p-3">
              {renderRow(i)}
              <div className="flex shrink-0 flex-col items-center gap-1">
                {reorderable && (
                  <div className="flex gap-0.5">
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      onClick={() => onMoveUp?.(i)}
                      aria-label="Move up"
                      disabled={i === 0}
                      className="size-7"
                    >
                      <ChevronUp className="size-4" />
                    </Button>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      onClick={() => onMoveDown?.(i)}
                      aria-label="Move down"
                      disabled={i === items.length - 1}
                      className="size-7"
                    >
                      <ChevronDown className="size-4" />
                    </Button>
                  </div>
                )}
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  onClick={() => onRemove(i)}
                  aria-label="Remove"
                  className="mt-1"
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}


// -- Priorities & Authority section ----------------------------------------

const PERMISSION_LABELS: Record<string, string> = {
  may_request_quote: "Request a full itemized quote",
  may_request_itemization: "Request breakdown of line items",
  may_negotiate_price: "Negotiate on price",
  may_request_fee_waivers: "Ask to waive fees",
  may_request_improved_terms: "Ask for better terms (cancellation, deposit)",
  may_use_verified_leverage: "Use verified competitor benchmarks as leverage",
  may_request_written_estimates: "Request written / emailed estimate",
  may_accept_offer: "Accept an offer on the customer's behalf",
  may_pay_deposit: "Authorize a deposit or hold",
  may_change_inventory: "Change the confirmed inventory",
  may_add_paid_services: "Add paid services not on the spec",
  may_reveal_max_budget: "Reveal customer's maximum budget",
  may_sign_or_authorize: "Sign or verbally authorize a contract",
};

const ALLOWED_KEYS = [
  "may_request_quote",
  "may_request_itemization",
  "may_negotiate_price",
  "may_request_fee_waivers",
  "may_request_improved_terms",
  "may_use_verified_leverage",
  "may_request_written_estimates",
] as const;

const FORBIDDEN_KEYS = [
  "may_accept_offer",
  "may_pay_deposit",
  "may_change_inventory",
  "may_add_paid_services",
  "may_reveal_max_budget",
  "may_sign_or_authorize",
] as const;

function PrioritiesAuthoritySection({ form }: { form: UseFormReturn<JobSpecDraft> }) {
  const priorities = form.watch("customer_priorities") ?? [];
  const perms = form.watch("agent_permissions") ?? defaultAgentPermissions();

  const togglePriority = (p: CustomerPriority) => {
    const next = new Set(priorities);
    if (next.has(p)) next.delete(p);
    else next.add(p);
    form.setValue("customer_priorities", Array.from(next), { shouldDirty: true });
  };

  const togglePerm = (key: string, value: boolean) => {
    form.setValue(
      "agent_permissions",
      { ...defaultAgentPermissions(), ...perms, [key]: value },
      { shouldDirty: true },
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Priorities &amp; Authority</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <div>
          <div className="mb-2 text-sm font-medium">Customer priorities</div>
          <p className="mb-3 text-xs text-muted-foreground">
            What matters most to the customer. The agent uses these to trade off during the call.
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            {CUSTOMER_PRIORITIES.map((p) => {
              const checked = priorities.includes(p);
              return (
                <label
                  key={p}
                  className="flex items-start gap-2 rounded-md border p-2 text-sm cursor-pointer hover:bg-muted/40"
                >
                  <Checkbox
                    checked={checked}
                    onCheckedChange={() => togglePriority(p)}
                    className="mt-0.5"
                  />
                  <span>{CUSTOMER_PRIORITY_LABELS[p]}</span>
                </label>
              );
            })}
          </div>
        </div>

        <div>
          <div className="mb-2 text-sm font-medium">Allowed agent actions</div>
          <div className="space-y-2">
            {ALLOWED_KEYS.map((k) => (
              <label key={k} className="flex items-start gap-2 text-sm">
                <Checkbox
                  checked={Boolean((perms as Record<string, boolean>)[k])}
                  onCheckedChange={(v) => togglePerm(k, Boolean(v))}
                  className="mt-0.5"
                />
                <span>{PERMISSION_LABELS[k]}</span>
              </label>
            ))}
          </div>
        </div>

        <div>
          <div className="mb-2 text-sm font-medium text-destructive">Never allowed</div>
          <p className="mb-2 text-xs text-muted-foreground">
            Every item below is off by default. Turn one on only if you truly want the agent to have
            that authority.
          </p>
          <div className="space-y-2">
            {FORBIDDEN_KEYS.map((k) => (
              <label key={k} className="flex items-start gap-2 text-sm">
                <Checkbox
                  checked={Boolean((perms as Record<string, boolean>)[k])}
                  onCheckedChange={(v) => togglePerm(k, Boolean(v))}
                  className="mt-0.5"
                />
                <span>{PERMISSION_LABELS[k]}</span>
              </label>
            ))}
          </div>
        </div>

        <FormField
          control={form.control}
          name="agent_guidance"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Additional guidance for the agent (optional)</FormLabel>
              <FormControl>
                <Textarea
                  rows={3}
                  placeholder="Anything the agent should know beyond the specification (tone, deal-breakers, must-hits)."
                  {...field}
                  value={field.value ?? ""}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </CardContent>
    </Card>
  );
}
