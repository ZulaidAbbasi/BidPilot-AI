/**
 * New negotiation wizard.
 *
 * Six-step multi-page form. Backend contracts are unchanged:
 * - Step 1 creates the `negotiations` row via a single idempotent client
 *   INSERT (RLS-scoped). Every subsequent step edits the `job_spec_drafts`
 *   row for that negotiation via the existing upsert pattern.
 * - Confirmation is NEVER done from the wizard. Step 6 navigates the user to
 *   `/app/negotiations/$id/specification`, where `confirmJobSpec` (the
 *   existing server function) remains the only path to a confirmed
 *   immutable specification version.
 *
 * Fields presented in each step are constrained to what the canonical
 * `JobSpecSchema` accepts. See prompt-12B audit for the list of requested
 * fields that were omitted because the backend has no storage for them.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useForm, useFieldArray, type UseFormReturn } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Check,
  ClipboardList,
  DoorOpen,
  Info,
  Loader2,
  Package,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Truck,
} from "lucide-react";

import { PageBody, PageHeader, LoadingState, ErrorState } from "@/components/app/page";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import {
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
  JobSpecSchema,
  newItemId,
  PACKING_LEVELS,
  PARKING_KINDS,
  sanitizeDraft,
  SPECIALTY_CATEGORIES,
  TIME_WINDOWS,
  type CustomerPriority,
  type JobSpecDraft,
} from "@/lib/job-spec";
import { validateForConfirm } from "@/lib/job-spec-validation";
import { todayIso } from "@/lib/date";
import { friendlyIssues, type WizardStep } from "@/lib/spec-errors";


// ---------------------------------------------------------------------------
// Route setup
// ---------------------------------------------------------------------------

const STEP_KEYS = [1, 2, 3, 4, 5, 6] as const;
type StepKey = (typeof STEP_KEYS)[number];

function isStep(v: unknown): v is StepKey {
  return typeof v === "number" && STEP_KEYS.includes(v as StepKey);
}

export const Route = createFileRoute("/app/negotiations/new")({
  head: () => ({ meta: [{ title: "New negotiation — BidPilot AI" }] }),
  validateSearch: (search: Record<string, unknown>) => {
    const step = Number(search.step);
    return {
      id: typeof search.id === "string" ? search.id : undefined,
      step: isStep(step) ? step : (1 as StepKey),
    };
  },
  component: NewNegotiationWizard,
});

// ---------------------------------------------------------------------------
// Step definitions
// ---------------------------------------------------------------------------

const STEPS: {
  key: StepKey;
  label: string;
  short: string;
  icon: React.ComponentType<{ className?: string }>;
}[] = [
  { key: 1, label: "Move basics", short: "Basics", icon: Truck },
  { key: 2, label: "Access", short: "Access", icon: DoorOpen },
  { key: 3, label: "Inventory", short: "Inventory", icon: Package },
  { key: 4, label: "Services", short: "Services", icon: Sparkles },
  { key: 5, label: "Priorities & authority", short: "Priorities", icon: ShieldCheck },
  { key: 6, label: "Review", short: "Review", icon: ClipboardList },
];

// ---------------------------------------------------------------------------
// Step 1 — Basics (creates the negotiation row)
// ---------------------------------------------------------------------------

const BasicsAddressSchema = z.object({
  line1: z.string().trim().min(3, "Enter a street address").max(255),
  line2: z.string().trim().max(120).optional().or(z.literal("")),
  city: z.string().trim().min(1, "City is required").max(120),
  region: z.string().trim().max(120).optional().or(z.literal("")),
  postal_code: z.string().trim().min(2, "Postal code is required").max(20),
  country: z.string().trim().min(2, "Country is required").max(80),
});
type BasicsAddress = z.infer<typeof BasicsAddressSchema>;

function composeAddress(a: BasicsAddress): string {
  const region = [a.region, a.postal_code].filter((s) => !!s && s.length > 0).join(" ");
  return [a.line1, a.city, region, a.country].filter((s) => !!s && s.length > 0).join(", ");
}

const BasicsSchema = z.object({
  title: z.string().trim().min(2, "Give this negotiation a short internal title").max(120),
  origin: BasicsAddressSchema,
  destination: BasicsAddressSchema,
  moving_date: z
    .string()
    .min(1, "Choose a target move date")
    .refine((v) => /^\d{4}-\d{2}-\d{2}$/.test(v), "Enter a valid date")
    .refine((v) => v >= todayIso(), "Move date must be today or later"),
  bedroom_count: z.coerce.number().int().min(0, "Must be 0 or more").max(20, "Too many bedrooms"),
  preferred_time_window: z.enum(TIME_WINDOWS),
});
type BasicsValues = z.infer<typeof BasicsSchema>;

// ---------------------------------------------------------------------------
// Wizard shell
// ---------------------------------------------------------------------------

function NewNegotiationWizard() {
  const { id, step } = Route.useSearch();
  return id ? <DraftWizard negotiationId={id} step={step} /> : <BasicsStep />;
}

// ---------------------------------------------------------------------------
// Step 1 component
// ---------------------------------------------------------------------------

function BasicsStep() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const submittingRef = useRef(false);

  const emptyAddr: BasicsAddress = {
    line1: "",
    line2: "",
    city: "",
    region: "",
    postal_code: "",
    country: "US",
  };
  const form = useForm<BasicsValues>({
    resolver: zodResolver(BasicsSchema),
    defaultValues: {
      title: "",
      origin: { ...emptyAddr },
      destination: { ...emptyAddr },
      moving_date: "",
      bedroom_count: 1,
      preferred_time_window: "flexible",
    },
  });

  const create = useMutation({
    mutationFn: async (values: BasicsValues) => {
      if (!user) throw new Error("You must be signed in.");
      const originAddr = {
        ...values.origin,
        line2: values.origin.line2 || undefined,
        region: values.origin.region || undefined,
      };
      const destAddr = {
        ...values.destination,
        line2: values.destination.line2 || undefined,
        region: values.destination.region || undefined,
      };
      const { data, error } = await supabase
        .from("negotiations")
        .insert({
          user_id: user.id,
          title: values.title,
          origin_address: composeAddress(values.origin),
          destination_address: composeAddress(values.destination),
          moving_date: values.moving_date,
          bedroom_count: values.bedroom_count,
          vertical: "moving",
          workflow_status: "INTAKE_IN_PROGRESS",
        })
        .select("id")
        .single();
      if (error) throw error;

      const seedDraft: JobSpecDraft = {
        ...emptyDraft(),
        move_date: values.moving_date,
        preferred_time_window: values.preferred_time_window,
        bedroom_count: values.bedroom_count,
        origin: originAddr,
        destination: destAddr,
      };
      const { error: draftErr } = await supabase.from("job_spec_drafts").upsert(
        {
          negotiation_id: data.id,
          specification: sanitizeDraft(seedDraft) as unknown as never,
          completion_percent: computeCompletion(seedDraft),
        },
        { onConflict: "negotiation_id" },
      );
      if (draftErr) console.warn("Draft seed failed:", draftErr.message);

      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["negotiations"] });
      queryClient.invalidateQueries({
        queryKey: ["job-spec-draft", data.id],
      });
      toast.success("Draft negotiation created");
      navigate({
        to: "/app/negotiations/new",
        search: { id: data.id, step: 2 },
        replace: true,
      });
    },
    onError: (err: Error) => {
      submittingRef.current = false;
      toast.error(err.message || "Could not create the negotiation");
    },
  });

  const onSubmit = form.handleSubmit((values) => {
    if (submittingRef.current || create.isPending) return;
    submittingRef.current = true;
    create.mutate(values);
  });

  return (
    <>
      <PageHeader
        eyebrow="New negotiation"
        title="Start a negotiation"
        description="Six steps to a hash-locked specification. Nothing is sent to providers until you confirm."
      />
      <PageBody>
        <StepRail current={1} completedThrough={0} />
        <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">1 · Move basics</CardTitle>
              <p className="text-sm text-muted-foreground">
                Just enough to open the draft. You can refine every field in the next five steps.
              </p>
            </CardHeader>
            <CardContent>
              <Form {...form}>
                <form onSubmit={onSubmit} className="space-y-5">
                  <FormField
                    control={form.control}
                    name="title"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Internal title</FormLabel>
                        <FormControl>
                          <Input placeholder="Brooklyn → Boston, July" {...field} />
                        </FormControl>
                        <FormDescription>Only visible to you.</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  {(["origin", "destination"] as const).map((side) => (
                    <div key={side} className="rounded-md border border-border/70 p-4">
                      <p className="mb-3 text-sm font-medium">
                        {side === "origin" ? "Origin address" : "Destination address"}
                      </p>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <FormField
                          control={form.control}
                          name={`${side}.line1` as const}
                          render={({ field }) => (
                            <FormItem className="sm:col-span-2">
                              <FormLabel>Street</FormLabel>
                              <FormControl>
                                <Input placeholder="123 Elm St" {...field} />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={form.control}
                          name={`${side}.line2` as const}
                          render={({ field }) => (
                            <FormItem className="sm:col-span-2">
                              <FormLabel>
                                Apt / suite{" "}
                                <span className="text-xs text-muted-foreground">(optional)</span>
                              </FormLabel>
                              <FormControl>
                                <Input placeholder="Apt 4B" {...field} value={field.value ?? ""} />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={form.control}
                          name={`${side}.city` as const}
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>City</FormLabel>
                              <FormControl>
                                <Input placeholder="Brooklyn" {...field} />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={form.control}
                          name={`${side}.region` as const}
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>
                                State / region{" "}
                                <span className="text-xs text-muted-foreground">(optional)</span>
                              </FormLabel>
                              <FormControl>
                                <Input placeholder="NY" {...field} value={field.value ?? ""} />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={form.control}
                          name={`${side}.postal_code` as const}
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Postal code</FormLabel>
                              <FormControl>
                                <Input placeholder="11201" {...field} />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={form.control}
                          name={`${side}.country` as const}
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Country</FormLabel>
                              <FormControl>
                                <Input placeholder="US" {...field} />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </div>
                    </div>
                  ))}
                  <div className="grid gap-4 sm:grid-cols-3">
                    <FormField
                      control={form.control}
                      name="moving_date"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Target move date</FormLabel>
                          <FormControl>
                            <Input type="date" min={todayIso()} {...field} />
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
                          <FormLabel>Preferred window</FormLabel>
                          <Select onValueChange={field.onChange} value={field.value}>
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {TIME_WINDOWS.map((w) => (
                                <SelectItem key={w} value={w}>
                                  {capitalize(w)}
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
                      name="bedroom_count"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Bedrooms</FormLabel>
                          <FormControl>
                            <Input
                              type="number"
                              min={0}
                              max={20}
                              {...field}
                              onChange={(e) =>
                                field.onChange(
                                  e.target.value === ""
                                    ? 0
                                    : Math.max(0, Number(e.target.value) || 0),
                                )
                              }
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  <div className="rounded-md border border-border/70 bg-muted/40 p-3 text-xs text-muted-foreground">
                    <p className="font-medium text-foreground">Explicit action required</p>
                    <p className="mt-1">
                      No draft is created until you click{" "}
                      <span className="font-medium text-foreground">Create draft and continue</span>
                      . Once created, the wizard remembers your progress.
                    </p>
                  </div>

                  <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
                    <Button type="button" variant="ghost" asChild className="sm:w-auto">
                      <Link to="/app">Cancel</Link>
                    </Button>
                    <Button type="submit" disabled={create.isPending} className="w-full sm:w-auto">
                      {create.isPending ? (
                        <>
                          <Loader2 className="mr-2 size-4 animate-spin" />
                          Creating draft…
                        </>
                      ) : (
                        <>
                          Create draft and continue
                          <ArrowRight className="ml-2 size-4" />
                        </>
                      )}
                    </Button>
                  </div>
                </form>
              </Form>
            </CardContent>
          </Card>

          <aside className="hidden space-y-3 lg:block">
            <Card className="border-verified/25 bg-verified-soft/40">
              <CardContent className="pt-5">
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-verified">
                  What happens next
                </p>
                <ol className="mt-3 space-y-2 text-sm">
                  <FlowStep n={1}>Move basics (this step)</FlowStep>
                  <FlowStep n={2}>Access at origin and destination</FlowStep>
                  <FlowStep n={3}>Inventory and specialty items</FlowStep>
                  <FlowStep n={4}>Services and storage</FlowStep>
                  <FlowStep n={5}>Priorities and authority</FlowStep>
                  <FlowStep n={6}>Review and confirm</FlowStep>
                </ol>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-5 text-xs text-muted-foreground">
                <p className="font-medium text-foreground">Nothing is fabricated</p>
                <p className="mt-1">
                  No fake providers, no fake quotes, no fake savings. Every number in BidPilot comes
                  from your real database and call transcripts.
                </p>
              </CardContent>
            </Card>
          </aside>
        </div>
      </PageBody>
    </>
  );
}

// ---------------------------------------------------------------------------
// Steps 2–6 — Draft wizard
// ---------------------------------------------------------------------------

type SaveStatus =
  | { kind: "idle"; at: string | null }
  | { kind: "saving" }
  | { kind: "saved"; at: string }
  | { kind: "error"; message: string };

async function loadDraft(
  negotiationId: string,
): Promise<{ draft: JobSpecDraft; updated_at: string | null }> {
  const { data, error } = await supabase
    .from("job_spec_drafts")
    .select("specification, updated_at")
    .eq("negotiation_id", negotiationId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return { draft: emptyDraft(), updated_at: null };
  const parsed = JobSpecDraftSchema.safeParse(data.specification ?? {});
  return {
    draft: parsed.success ? parsed.data : emptyDraft(),
    updated_at: (data.updated_at as string | null) ?? null,
  };
}

async function saveDraft(
  negotiationId: string,
  draft: JobSpecDraft,
): Promise<{ updated_at: string }> {
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

function DraftWizard({ negotiationId, step }: { negotiationId: string; step: StepKey }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const draftQuery = useQuery({
    queryKey: ["job-spec-draft", negotiationId],
    queryFn: () => loadDraft(negotiationId),
  });

  if (draftQuery.isLoading) {
    return (
      <PageBody>
        <LoadingState label="Loading your draft" />
      </PageBody>
    );
  }
  if (draftQuery.isError || !draftQuery.data) {
    return (
      <PageBody>
        <ErrorState
          title="Couldn't load this draft"
          description={
            (draftQuery.error as Error | undefined)?.message ??
            "It may not exist or you don't have access."
          }
          onRetry={() => draftQuery.refetch()}
        />
      </PageBody>
    );
  }

  return (
    <DraftWizardInner
      negotiationId={negotiationId}
      step={step}
      initial={draftQuery.data.draft}
      initialUpdatedAt={draftQuery.data.updated_at}
      onGo={(nextStep) =>
        navigate({
          to: "/app/negotiations/new",
          search: { id: negotiationId, step: nextStep },
          replace: false,
        })
      }
      onFinish={() => {
        queryClient.invalidateQueries({
          queryKey: ["job-spec-draft", negotiationId],
        });
        navigate({
          to: "/app/negotiations/$id/specification",
          params: { id: negotiationId },
        });
      }}
    />
  );
}

function DraftWizardInner({
  negotiationId,
  step,
  initial,
  initialUpdatedAt,
  onGo,
  onFinish,
}: {
  negotiationId: string;
  step: StepKey;
  initial: JobSpecDraft;
  initialUpdatedAt: string | null;
  onGo: (step: StepKey) => void;
  onFinish: () => void;
}) {
  const form = useForm<JobSpecDraft>({
    resolver: zodResolver(JobSpecDraftSchema),
    // Sanitize initial values so required booleans (access, storage, service
    // toggles) are hydrated as explicit `false` rather than `undefined`.
    // Without this, an unchecked box on an untouched draft would validate as
    // missing on the Review step.
    defaultValues: sanitizeDraft({ ...emptyDraft(), ...initial }),
    mode: "onBlur",
  });

  const [status, setStatus] = useState<SaveStatus>({
    kind: "idle",
    at: initialUpdatedAt,
  });

  const mutation = useMutation({
    mutationFn: (draft: JobSpecDraft) => saveDraft(negotiationId, draft),
    onMutate: () => setStatus({ kind: "saving" }),
    onSuccess: ({ updated_at }) => {
      setStatus({ kind: "saved", at: updated_at });
      form.reset(form.getValues(), { keepValues: true, keepDirty: false });
    },
    onError: (err: unknown) => {
      setStatus({
        kind: "error",
        message: err instanceof Error ? err.message : "Save failed",
      });
    },
  });

  const values = form.watch();
  const isDirty = form.formState.isDirty;
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestRef = useRef(values);
  latestRef.current = values;

  useEffect(() => {
    if (!isDirty) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      if (mutation.isPending) return;
      const parsed = JobSpecDraftSchema.safeParse(latestRef.current);
      if (!parsed.success) return;
      mutation.mutate(parsed.data);
    }, 1500);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(values), isDirty]);

  // beforeunload warning while dirty.
  useEffect(() => {
    if (!isDirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isDirty]);

  const flushBeforeLeave = useCallback(async () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!isDirty) return;
    const parsed = JobSpecDraftSchema.safeParse(latestRef.current);
    if (!parsed.success) return;
    await mutation.mutateAsync(parsed.data).catch(() => {
      /* status is set by onError */
    });
  }, [isDirty, mutation]);

  const goStep = useCallback(
    async (next: StepKey) => {
      await flushBeforeLeave();
      onGo(next);
    },
    [flushBeforeLeave, onGo],
  );

  // Review and the completion bar MUST consult the same validator that
  // Confirm-and-Lock runs. Anything else lets Review lie about readiness.
  const validation = useMemo(() => validateForConfirm(values), [values]);
  const completion = useMemo(() => computeCompletion(values), [values]);
  const missing = useMemo(
    () => (validation.ok ? [] : friendlyIssues(validation.issues).slice(0, 8)),
    [validation],
  );



  return (
    <>
      <PageHeader
        eyebrow={
          <span className="inline-flex items-center gap-2">
            <span>New negotiation</span>
            <span className="font-mono text-[10px] text-muted-foreground">
              #{negotiationId.slice(0, 8)}
            </span>
          </span>
        }
        title={STEPS[step - 1].label}
        description="Autosaves as you go. Confirmation is a separate explicit step."
        actions={<SaveIndicator status={status} onRetry={() => flushBeforeLeave()} />}
      />
      <PageBody>
        <StepRail
          current={step}
          completedThrough={Math.max(0, step - 1) as 0 | 1 | 2 | 3 | 4 | 5}
          onJump={(target) => {
            if (target === step) return;
            void goStep(target);
          }}
        />
        <div className="mt-6">
          <Form {...form}>
            <form
              onSubmit={form.handleSubmit((v) => mutation.mutate(v))}
              className="space-y-6"
              noValidate
            >
              {step === 2 && <AccessStep form={form} />}
              {step === 3 && <InventoryStep form={form} />}
              {step === 4 && <ServicesStep form={form} />}
              {step === 5 && <PrioritiesStep form={form} />}
              {step === 6 && (
                <ReviewStep
                  values={values}
                  completion={completion}
                  missing={missing}
                  ready={validation.ok}
                  onJumpTo={(target) => goStep(target as StepKey)}
                />
              )}

              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/70 pt-4">
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => goStep(Math.max(1, step - 1) as StepKey)}
                    disabled={step === 1}
                  >
                    <ArrowLeft className="mr-2 size-4" />
                    Back
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      const v = form.getValues();
                      const parsed = JobSpecDraftSchema.safeParse(v);
                      if (parsed.success) mutation.mutate(parsed.data);
                      else toast.error("Fix the invalid field values before saving.");
                    }}
                    disabled={mutation.isPending}
                  >
                    {mutation.isPending ? (
                      <>
                        <Loader2 className="mr-2 size-3.5 animate-spin" />
                        Saving
                      </>
                    ) : (
                      "Save draft"
                    )}
                  </Button>
                </div>
                <div className="flex items-center gap-2">
                  {step < 6 && (
                    <Button type="button" onClick={() => goStep(Math.min(6, step + 1) as StepKey)}>
                      Continue
                      <ArrowRight className="ml-2 size-4" />
                    </Button>
                  )}
                  {step === 6 && (
                    <Button
                      type="button"
                      onClick={async () => {
                        await flushBeforeLeave();
                        onFinish();
                      }}
                    >
                      Save and review specification
                      <ArrowRight className="ml-2 size-4" />
                    </Button>
                  )}
                </div>
              </div>
            </form>
          </Form>
        </div>
      </PageBody>
    </>
  );
}

// ---------------------------------------------------------------------------
// Sub-components: rail, indicator
// ---------------------------------------------------------------------------

function StepRail({
  current,
  completedThrough,
  onJump,
}: {
  current: StepKey;
  completedThrough: 0 | 1 | 2 | 3 | 4 | 5;
  onJump?: (step: StepKey) => void;
}) {
  const currentIndex = STEPS.findIndex((s) => s.key === current);
  const currentStep = STEPS[currentIndex] ?? STEPS[0];
  const pct = Math.round(((currentIndex + 1) / STEPS.length) * 100);
  const CurrentIcon = currentStep.icon;

  return (
    <nav aria-label="Wizard progress" className="space-y-3">
      {/* Mobile: bold step marker + progress + tiny scrollable chip row */}
      <div className="md:hidden">
        <div className="flex items-center gap-3">
          <span
            className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-navy text-white"
            aria-hidden
          >
            <CurrentIcon className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Step {currentIndex + 1} of {STEPS.length}
            </p>
            <p className="truncate text-base font-semibold text-navy">{currentStep.label}</p>
          </div>
          <span className="shrink-0 text-xs font-semibold text-muted-foreground">{pct}%</span>
        </div>
        <div
          className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div
            className="h-full rounded-full bg-navy transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
        <ol className="mt-3 -mx-1 flex snap-x snap-mandatory gap-1.5 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {STEPS.map((s, i) => {
            const done = i + 1 <= completedThrough && current !== s.key;
            const active = current === s.key;
            const clickable = !!onJump && (done || active);
            return (
              <li key={s.key} className="snap-start">
                <button
                  type="button"
                  onClick={() => clickable && onJump?.(s.key)}
                  disabled={!clickable}
                  aria-current={active ? "step" : undefined}
                  className={`flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
                    active
                      ? "bg-navy text-white"
                      : done
                        ? "border border-verified/40 bg-verified-soft text-navy"
                        : "border border-border bg-card text-muted-foreground"
                  } ${clickable ? "cursor-pointer" : "cursor-default"}`}
                >
                  <span
                    className={`inline-flex size-4 items-center justify-center rounded-full text-[10px] font-semibold ${
                      active
                        ? "bg-white/20 text-white"
                        : done
                          ? "bg-verified/20 text-verified"
                          : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {done ? <Check className="size-2.5" /> : i + 1}
                  </span>
                  {s.short}
                </button>
              </li>
            );
          })}
        </ol>
      </div>

      {/* Desktop: full pill rail */}
      <ol className="hidden min-w-0 flex-wrap items-center gap-1 md:flex lg:flex-nowrap lg:overflow-x-auto">
        {STEPS.map((s, i) => {
          const done = i + 1 <= completedThrough && current !== s.key;
          const active = current === s.key;
          const clickable = !!onJump && (done || active);
          const Icon = s.icon;
          return (
            <li key={s.key} className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => clickable && onJump?.(s.key)}
                disabled={!clickable}
                aria-current={active ? "step" : undefined}
                className={`flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                  active
                    ? "bg-navy text-white shadow-sm"
                    : done
                      ? "border border-verified/40 bg-verified-soft text-navy hover:bg-verified-soft/80"
                      : "border border-border bg-card text-muted-foreground"
                } ${!clickable ? "cursor-default" : "cursor-pointer"}`}
              >
                <span
                  className={`inline-flex size-5 items-center justify-center rounded-full ${
                    active
                      ? "bg-white/15 text-white"
                      : done
                        ? "bg-verified/15 text-verified"
                        : "bg-muted text-muted-foreground"
                  }`}
                >
                  {done ? <Check className="size-3" /> : <Icon className="size-3" />}
                </span>
                <span>{s.label}</span>
              </button>
              {i < STEPS.length - 1 && (
                <span
                  className={`h-px w-6 shrink-0 ${done ? "bg-verified/40" : "bg-border"}`}
                  aria-hidden
                />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function SaveIndicator({ status, onRetry }: { status: SaveStatus; onRetry: () => void }) {
  if (status.kind === "saving") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
        <Loader2 className="size-3 animate-spin" /> Saving…
      </span>
    );
  }
  if (status.kind === "error") {
    return (
      <span className="inline-flex items-center gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-risk-soft px-2.5 py-1 text-xs font-medium text-navy">
          <AlertTriangle className="size-3" /> Save failed
        </span>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={onRetry}
          className="h-7 gap-1.5 text-xs"
        >
          <RefreshCw className="size-3" /> Retry
        </Button>
      </span>
    );
  }
  const at = status.kind === "saved" ? status.at : status.at;
  if (!at) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
        Not saved yet
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-verified-soft px-2.5 py-1 text-xs font-medium text-navy">
      <Check className="size-3" />
      Saved · {new Date(at).toLocaleTimeString()}
    </span>
  );
}

function FlowStep({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-3">
      <span className="mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full border border-verified/40 bg-card font-mono text-[11px] font-semibold text-verified">
        {n}
      </span>
      <span className="text-foreground">{children}</span>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Step 2 — Access
// ---------------------------------------------------------------------------

type F = UseFormReturn<JobSpecDraft>;

function AccessStep({ form }: { form: F }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">2 · Access conditions</CardTitle>
        <p className="text-sm text-muted-foreground">
          Floors, stairs, elevators, parking, and site restrictions at both ends. Every detail here
          reduces surprise fees during the move.
        </p>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid gap-6 lg:grid-cols-2">
          <div>
            <h3 className="mb-3 text-sm font-semibold">Origin access</h3>
            <AccessGrid form={form} prefix="origin_access" />
          </div>
          <div>
            <h3 className="mb-3 text-sm font-semibold">Destination access</h3>
            <AccessGrid form={form} prefix="destination_access" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function AccessGrid({ form, prefix }: { form: F; prefix: "origin_access" | "destination_access" }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
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
            <FormLabel>Stairs (flights)</FormLabel>
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
            <FormDescription className="text-xs">Not inferred from floor number.</FormDescription>
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
                    {capitalize(v.replace(/_/g, " "))}
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
        name={`${prefix}.long_carry_meters` as const}
        render={({ field }) => (
          <FormItem>
            <FormLabel>Long carry (meters)</FormLabel>
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
                    {capitalize(v.replace(/_/g, " "))}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FormMessage />
          </FormItem>
        )}
      />
      <div className="space-y-2 sm:pt-6">
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
        name={`${prefix}.access_restrictions` as const}
        render={({ field }) => (
          <FormItem className="sm:col-span-2">
            <FormLabel>Site notes and building restrictions</FormLabel>
            <FormControl>
              <Textarea
                rows={2}
                placeholder="Loading dock hours 9am–5pm, narrow driveway, gated community…"
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

// ---------------------------------------------------------------------------
// Step 3 — Inventory
// ---------------------------------------------------------------------------

function InventoryStep({ form }: { form: F }) {
  const inv = useFieldArray({ control: form.control, name: "inventory" });
  const frag = useFieldArray({ control: form.control, name: "fragile_items" });
  const spec = useFieldArray({
    control: form.control,
    name: "specialty_items",
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">3 · Inventory</CardTitle>
        <p className="text-sm text-muted-foreground">
          Bedrooms, standard items, fragile items, and specialty items that need special handling.
          Nothing is assumed.
        </p>
      </CardHeader>
      <CardContent className="space-y-6">
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

        <ArraySection
          title="Standard inventory"
          empty="No inventory items yet. Add sofas, beds, boxes, appliances…"
          addLabel="Add item"
          onAdd={() =>
            inv.append({
              id: newItemId(),
              label: "",
              quantity: 1,
              notes: "",
            })
          }
          rows={inv.fields.map((f, index) => ({
            key: f.id,
            onRemove: () => inv.remove(index),
            content: (
              <div className="grid flex-1 gap-2 sm:grid-cols-[1fr_140px_90px_1fr]">
                <FormField
                  control={form.control}
                  name={`inventory.${index}.label` as const}
                  render={({ field }) => (
                    <FormItem>
                      <FormControl>
                        <Input placeholder="e.g. Queen bed" {...field} value={field.value ?? ""} />
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
                        <Input placeholder="Notes" {...field} value={field.value ?? ""} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            ),

          }))}
        />

        <ArraySection
          title="Fragile items"
          empty="No fragile items."
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
          rows={frag.fields.map((f, index) => ({
            key: f.id,
            onRemove: () => frag.remove(index),
            content: (
              <div className="grid flex-1 gap-2 sm:grid-cols-[1fr_140px_100px]">
                <FormField
                  control={form.control}
                  name={`fragile_items.${index}.label` as const}
                  render={({ field }) => (
                    <FormItem>
                      <FormControl>
                        <Input
                          placeholder="e.g. Framed print"
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
            ),
          }))}
        />

        <ArraySection
          title="Specialty items"
          empty="No specialty items (piano, safe, hot tub, etc.)."
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
          rows={spec.fields.map((f, index) => ({
            key: f.id,
            onRemove: () => spec.remove(index),
            content: (
              <div className="grid flex-1 gap-2 sm:grid-cols-[1fr_160px_auto]">
                <FormField
                  control={form.control}
                  name={`specialty_items.${index}.label` as const}
                  render={({ field }) => (
                    <FormItem>
                      <FormControl>
                        <Input
                          placeholder="e.g. Upright piano"
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
                    <FormItem className="flex items-center gap-2 sm:pt-2">
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
            ),
          }))}
        />

        <div className="rounded-md border border-dashed border-border/70 bg-muted/30 p-3 text-xs text-muted-foreground">
          <Info className="mr-1 inline size-3.5 -translate-y-px" />
          Inventory document upload isn't wired up yet. When it lands, you'll be able to import
          inventory here — until then, add items manually.
        </div>
      </CardContent>
    </Card>
  );
}

function ArraySection({
  title,
  empty,
  addLabel,
  onAdd,
  rows,
}: {
  title: string;
  empty: string;
  addLabel: string;
  onAdd: () => void;
  rows: { key: string; onRemove: () => void; content: React.ReactNode }[];
}) {
  return (
    <div className="rounded-md border border-border/70 p-3">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-sm font-semibold">{title}</p>
        <Button type="button" size="sm" variant="outline" onClick={onAdd}>
          {addLabel}
        </Button>
      </div>
      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">{empty}</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => (
            <li key={r.key} className="flex items-start gap-2">
              {r.content}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={r.onRemove}
                aria-label="Remove item"
                className="mt-1 shrink-0 text-muted-foreground hover:text-risk"
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 4 — Services
// ---------------------------------------------------------------------------

function ServicesStep({ form }: { form: F }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">4 · Services</CardTitle>
        <p className="text-sm text-muted-foreground">
          What providers need to quote against. Every service you enable becomes a line item they
          must price and honor.
        </p>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2">
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
                        {capitalize(v.replace(/_/g, " "))}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormDescription className="text-xs">
                  Packing materials are always included when packing is enabled.
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
          <div className="space-y-2 sm:pt-6">
            {(
              [
                ["unpacking_requested", "Unpacking at destination"],
                ["disassembly_required", "Disassembly at origin"],
                ["reassembly_required", "Reassembly at destination"],
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
            <FormField
              control={form.control}
              name="storage.duration_days"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Duration (days)</FormLabel>
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
          </div>
        </div>

        <div className="rounded-md border border-dashed border-border/70 bg-muted/30 p-3 text-xs text-muted-foreground">
          <Info className="mr-1 inline size-3.5 -translate-y-px" />
          Extra pickup/drop-off stops can be added on the Specification screen after this wizard;
          they are part of the canonical specification and are hashed at Confirm &amp; Lock.
        </div>

      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Step 5 — Priorities & authority
// ---------------------------------------------------------------------------

const ALLOWED_PERMISSION_KEYS = [
  "may_request_quote",
  "may_request_itemization",
  "may_negotiate_price",
  "may_request_fee_waivers",
  "may_request_improved_terms",
  "may_use_verified_leverage",
  "may_request_written_estimates",
] as const;

const FORBIDDEN_PERMISSION_KEYS = [
  "may_accept_offer",
  "may_pay_deposit",
  "may_change_inventory",
  "may_add_paid_services",
  "may_reveal_max_budget",
  "may_sign_or_authorize",
] as const;

const PERMISSION_LABELS: Record<string, string> = {
  may_request_quote: "Request a full itemized quote",
  may_request_itemization: "Request breakdown of line items",
  may_negotiate_price: "Negotiate on price",
  may_request_fee_waivers: "Ask to waive fees",
  may_request_improved_terms: "Ask for better terms (cancellation, deposit)",
  may_use_verified_leverage: "Use verified competitor benchmarks as leverage",
  may_request_written_estimates: "Request a written / emailed estimate",
  may_accept_offer: "Accept an offer on the customer's behalf",
  may_pay_deposit: "Authorize a deposit or hold",
  may_change_inventory: "Change the confirmed inventory",
  may_add_paid_services: "Add paid services not on the spec",
  may_reveal_max_budget: "Reveal customer's maximum budget",
  may_sign_or_authorize: "Sign or verbally authorize a contract",
};

function PrioritiesStep({ form }: { form: F }) {
  const priorities = (form.watch("customer_priorities") ?? []) as CustomerPriority[];
  const perms = { ...defaultAgentPermissions(), ...(form.watch("agent_permissions") ?? {}) };

  const togglePriority = (p: CustomerPriority) => {
    const next = priorities.includes(p) ? priorities.filter((x) => x !== p) : [...priorities, p];
    form.setValue("customer_priorities", next, { shouldDirty: true, shouldValidate: true });
  };

  const movePriority = (p: CustomerPriority, dir: -1 | 1) => {
    const i = priorities.indexOf(p);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= priorities.length) return;
    const next = priorities.slice();
    [next[i], next[j]] = [next[j], next[i]];
    form.setValue("customer_priorities", next, { shouldDirty: true, shouldValidate: true });
  };

  const setPerm = (key: string, value: boolean) => {
    form.setValue(
      "agent_permissions",
      { ...perms, [key]: value },
      { shouldDirty: true, shouldValidate: true },
    );
  };

  const unselected = CUSTOMER_PRIORITIES.filter((p) => !priorities.includes(p));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">5 · Priorities &amp; authority</CardTitle>
        <p className="text-sm text-muted-foreground">
          Structured, machine-readable settings the ranking engine and Provider Agent will rely on.
          Notes at the bottom cannot grant additional authority.
        </p>
      </CardHeader>
      <CardContent className="space-y-6">
        <FormField
          control={form.control}
          name="insurance_level"
          render={({ field }) => (
            <FormItem className="max-w-md">
              <FormLabel>Insurance / valuation</FormLabel>
              <Select onValueChange={field.onChange} value={field.value ?? ""}>
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder="Select" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {INSURANCE_LEVELS.map((v) => (
                    <SelectItem key={v} value={v}>
                      {capitalize(v.replace(/_/g, " "))}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />

        <section>
          <h3 className="text-sm font-medium">Customer priorities</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Order matters. Rank #1 gets the highest weight; the server computes final weights and
            uses them to rank quotes. Pick at least one.
          </p>
          {priorities.length > 0 ? (
            <ol className="mt-3 space-y-2">
              {priorities.map((p, idx) => (
                <li
                  key={p}
                  className="flex items-center justify-between gap-2 rounded-md border border-border/70 bg-background px-3 py-2 text-sm"
                >
                  <span>
                    <span className="mr-2 inline-flex size-5 items-center justify-center rounded-full bg-muted text-xs font-medium">
                      {idx + 1}
                    </span>
                    {CUSTOMER_PRIORITY_LABELS[p]}
                  </span>
                  <div className="flex items-center gap-1">
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={idx === 0}
                      onClick={() => movePriority(p, -1)}
                      aria-label={`Move ${CUSTOMER_PRIORITY_LABELS[p]} up`}
                    >
                      ↑
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={idx === priorities.length - 1}
                      onClick={() => movePriority(p, 1)}
                      aria-label={`Move ${CUSTOMER_PRIORITY_LABELS[p]} down`}
                    >
                      ↓
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => togglePriority(p)}
                      aria-label={`Remove ${CUSTOMER_PRIORITY_LABELS[p]}`}
                    >
                      ✕
                    </Button>
                  </div>
                </li>
              ))}
            </ol>
          ) : null}
          {unselected.length > 0 ? (
            <div className="mt-3">
              <p className="text-xs text-muted-foreground">Add a priority:</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {unselected.map((p) => (
                  <Button
                    key={p}
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => togglePriority(p)}
                  >
                    + {CUSTOMER_PRIORITY_LABELS[p]}
                  </Button>
                ))}
              </div>
            </div>
          ) : null}
        </section>

        <section>
          <h3 className="text-sm font-medium">BidPilot may</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Turn on the actions BidPilot's agent is allowed to take on your behalf during provider
            calls.
          </p>
          <div className="mt-3 space-y-2">
            {ALLOWED_PERMISSION_KEYS.map((k) => (
              <label key={k} className="flex items-start gap-2 text-sm">
                <Checkbox
                  checked={perms[k] === true}
                  onCheckedChange={(v) => setPerm(k, v === true)}
                  className="mt-0.5"
                />
                <span>{PERMISSION_LABELS[k]}</span>
              </label>
            ))}
          </div>
        </section>

        <section>
          <h3 className="text-sm font-medium text-destructive">BidPilot may NOT</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Every item below is off by default. Turn one on only if you truly want the agent to
            have that authority.
          </p>
          <div className="mt-3 space-y-2">
            {FORBIDDEN_PERMISSION_KEYS.map((k) => (
              <label key={k} className="flex items-start gap-2 text-sm">
                <Checkbox
                  checked={perms[k] === true}
                  onCheckedChange={(v) => setPerm(k, v === true)}
                  className="mt-0.5"
                />
                <span>{PERMISSION_LABELS[k]}</span>
              </label>
            ))}
          </div>
        </section>

        <FormField
          control={form.control}
          name="agent_guidance"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Additional guidance for the agent (optional)</FormLabel>
              <FormControl>
                <Textarea
                  rows={3}
                  placeholder="Tone, deal-breakers, must-hits. Notes cannot authorize booking, payment, scope changes, or acceptance."
                  {...field}
                  value={field.value ?? ""}
                />
              </FormControl>
              <FormDescription className="text-xs">
                Permissions above are authoritative. Notes here are supplementary only.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="special_instructions"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Operational notes (optional)</FormLabel>
              <FormControl>
                <Textarea
                  rows={3}
                  placeholder="Anything providers should know operationally (gate codes, contact preferences, appliance disconnect, etc.)."
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



// ---------------------------------------------------------------------------
// Step 6 — Review
// ---------------------------------------------------------------------------

function ReviewStep({
  values,
  completion,
  missing,
  ready,
  onJumpTo,
}: {
  values: JobSpecDraft;
  completion: number;
  missing: { path: string; label: string; message: string; step: WizardStep }[];
  ready: boolean;
  onJumpTo?: (step: WizardStep) => void;
}) {
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
          <div>
            <CardTitle className="text-base">6 · Review</CardTitle>
            <p className="text-sm text-muted-foreground">
              Everything below is what BidPilot will lock into the confirmed specification.
              Confirmation itself happens on the next screen.
            </p>
          </div>
          <div className="min-w-[160px]">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Completion</span>
              <span className="font-medium">{completion}%</span>
            </div>
            <Progress value={completion} className="mt-1 h-2" />
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-center gap-2">
            {ready ? (
              <Badge className="border-verified/40 bg-verified-soft text-navy">
                <Check className="mr-1 size-3" /> Ready for review
              </Badge>
            ) : (
              <Badge className="border-warn/40 bg-warn-soft text-navy">
                <AlertTriangle className="mr-1 size-3" /> Missing required fields
              </Badge>
            )}
            <Badge variant="outline">Draft is autosaved</Badge>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <ReviewCard title="Route & timing">
          <Row label="Origin" value={formatAddress(values.origin)} />
          <Row label="Destination" value={formatAddress(values.destination)} />
          <Row label="Move date" value={values.move_date || "—"} />
          <Row label="Time window" value={values.preferred_time_window ?? "—"} />
          <Row
            label="Bedrooms"
            value={values.bedroom_count === undefined ? "—" : String(values.bedroom_count)}
          />
        </ReviewCard>

        <ReviewCard title="Access">
          <Row label="Origin" value={summariseAccess(values.origin_access)} />
          <Row label="Destination" value={summariseAccess(values.destination_access)} />
        </ReviewCard>

        <ReviewCard title="Inventory">
          <Row label="Standard items" value={`${values.inventory?.length ?? 0}`} />
          <Row label="Fragile items" value={`${values.fragile_items?.length ?? 0}`} />
          <Row label="Specialty items" value={`${values.specialty_items?.length ?? 0}`} />
          {(values.inventory?.length ?? 0) +
            (values.fragile_items?.length ?? 0) +
            (values.specialty_items?.length ?? 0) >
          0 ? (
            <details className="mt-2 rounded-md border border-border/60 bg-muted/20 p-2 text-xs">
              <summary className="cursor-pointer select-none font-medium text-navy">
                Show all items
              </summary>
              <ul className="mt-2 space-y-1">
                {(values.inventory ?? []).map((it) => (
                  <li key={it.id} className="flex justify-between gap-2">
                    <span className="truncate">
                      {it.label || "(unnamed)"}
                      {it.category ? ` · ${it.category}` : ""}
                      {it.notes ? ` — ${it.notes}` : ""}
                    </span>
                    <span className="shrink-0 tabular-nums text-muted-foreground">
                      ×{it.quantity ?? 1}
                    </span>
                  </li>
                ))}
                {(values.fragile_items ?? []).map((it) => (
                  <li key={it.id} className="flex justify-between gap-2">
                    <span className="truncate">
                      Fragile · {it.label || "(unnamed)"} · {it.category}
                      {it.notes ? ` — ${it.notes}` : ""}
                    </span>
                    <span className="shrink-0 tabular-nums text-muted-foreground">
                      ×{it.quantity ?? 1}
                    </span>
                  </li>
                ))}
                {(values.specialty_items ?? []).map((it) => (
                  <li key={it.id} className="flex justify-between gap-2">
                    <span className="truncate">
                      Specialty · {it.label || "(unnamed)"} · {it.category}
                      {it.requires_disassembly ? " · disassembly" : ""}
                      {it.notes ? ` — ${it.notes}` : ""}
                    </span>
                    <span className="shrink-0 tabular-nums text-muted-foreground">
                      {it.dimensions ?? ""}
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </ReviewCard>


        <ReviewCard title="Services & protection">
          <Row label="Packing" value={values.packing_level ?? "—"} />
          <Row label="Unpacking" value={boolLabel(values.unpacking_requested)} />
          <Row
            label="Disassembly / reassembly"
            value={`${boolLabel(values.disassembly_required)} / ${boolLabel(
              values.reassembly_required,
            )}`}
          />
          <Row
            label="Storage"
            value={
              values.storage?.needed
                ? `Yes${values.storage.duration_days ? `, ${values.storage.duration_days} days` : ""}${values.storage.climate_controlled ? ", climate-controlled" : ""}`
                : "No"
            }
          />
          <Row label="Insurance" value={values.insurance_level ?? "—"} />
        </ReviewCard>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Priorities &amp; authority</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <div>
            <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Customer priorities
            </div>
            {(values.customer_priorities ?? []).length > 0 ? (
              <ol className="list-decimal space-y-0.5 pl-5">
                {(values.customer_priorities ?? []).map((p) => (
                  <li key={p}>{CUSTOMER_PRIORITY_LABELS[p as CustomerPriority] ?? p}</li>
                ))}
              </ol>
            ) : (
              <p className="text-muted-foreground">
                None selected — add at least one before Confirm &amp; Lock.
              </p>
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                BidPilot may
              </div>
              <ul className="space-y-0.5">
                {ALLOWED_PERMISSION_KEYS.map((k) => {
                  const v = (values.agent_permissions ?? {})[k] === true;
                  return (
                    <li key={k} className="flex items-start justify-between gap-3">
                      <span>{PERMISSION_LABELS[k]}</span>
                      <span className={v ? "text-verified" : "text-muted-foreground"}>
                        {v ? "Allowed" : "Not allowed"}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
            <div>
              <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                BidPilot may NOT
              </div>
              <ul className="space-y-0.5">
                {FORBIDDEN_PERMISSION_KEYS.map((k) => {
                  const v = (values.agent_permissions ?? {})[k] === true;
                  return (
                    <li key={k} className="flex items-start justify-between gap-3">
                      <span>{PERMISSION_LABELS[k]}</span>
                      <span className={v ? "text-destructive" : "text-muted-foreground"}>
                        {v ? "Allowed" : "Not allowed"}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>

          {values.agent_guidance ? (
            <div>
              <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Additional guidance (supplementary)
              </div>
              <pre className="whitespace-pre-wrap rounded-md border border-border/60 bg-muted/30 p-3 font-sans text-xs">
                {values.agent_guidance}
              </pre>
            </div>
          ) : null}

          {values.special_instructions ? (
            <div>
              <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Operational notes
              </div>
              <pre className="whitespace-pre-wrap rounded-md border border-border/60 bg-muted/30 p-3 font-sans text-xs">
                {values.special_instructions}
              </pre>
            </div>
          ) : null}
        </CardContent>
      </Card>


      {missing.length > 0 && (
        <Card className="border-warn/40 bg-warn-soft/30">
          <CardHeader>
            <CardTitle className="text-sm">Missing or invalid fields</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1 text-sm">
              {missing.map((m) => (
                <li
                  key={`${m.path}:${m.message}`}
                  className="flex items-start justify-between gap-3"
                >
                  <span>{m.message}</span>
                  {onJumpTo && (
                    <button
                      type="button"
                      onClick={() => onJumpTo(m.step)}
                      className="shrink-0 text-xs text-primary hover:underline"
                    >
                      Fix in step {m.step}
                    </button>
                  )}
                </li>
              ))}
            </ul>
            <Separator className="my-3" />
            <p className="text-xs text-muted-foreground">
              You can save and revisit these on the specification screen — the wizard won't force
              you to fix everything before continuing.
            </p>
          </CardContent>
        </Card>
      )}

      <div className="rounded-md border border-verified/30 bg-verified-soft/40 p-3 text-xs text-navy">
        <ShieldCheck className="mr-1 inline size-3.5 -translate-y-px" />
        Nothing is confirmed yet. The next screen (
        <span className="font-medium">Specification</span>) has the explicit "Confirm & lock" button
        that hashes the document and pins the version.
      </div>
    </div>
  );
}

function ReviewCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-1 text-sm">{children}</CardContent>
    </Card>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span className="max-w-[60%] break-words text-right font-medium">{value}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Formatters
// ---------------------------------------------------------------------------

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function boolLabel(v: boolean | undefined): string {
  if (v === undefined) return "—";
  return v ? "Yes" : "No";
}

function formatAddress(a: JobSpecDraft["origin"]): string {
  if (!a) return "—";
  // Include unit / apt (line2) so Review reflects exactly what will be
  // sent to providers — apartment number is the difference between the
  // right building and the right doorbell.
  const parts = [a.line1, a.line2, a.city, a.region, a.postal_code].filter(
    (p): p is string => !!p && p.length > 0,
  );
  return parts.length > 0 ? parts.join(", ") : "—";
}

// Render every material access field, including legitimate zero/false/"none"
// values. Zero stairs, floor 0, "no elevator", and "no permit required" are
// all information providers need — Review must never silently drop them.
function summariseAccess(a: JobSpecDraft["origin_access"]): string {
  if (!a) return "—";
  const bits: string[] = [];
  if (a.property_type) bits.push(a.property_type.replace(/_/g, " "));
  if (a.floor !== undefined) bits.push(`Floor ${a.floor}`);
  if (a.stairs_flights !== undefined) bits.push(`${a.stairs_flights} stairs`);
  if (a.elevator) bits.push(a.elevator === "none" ? "no elevator" : `${a.elevator} lift`);
  if (a.elevator_reservation_required !== undefined) {
    bits.push(a.elevator_reservation_required ? "reservation required" : "no reservation");
  }
  if (a.long_carry_meters !== undefined) {
    const unit = a.long_carry_unit ?? "meters";
    bits.push(`${a.long_carry_meters}${unit === "feet" ? "ft" : "m"} carry`);
  }
  if (a.parking) bits.push(`${a.parking.replace(/_/g, " ")} parking`);
  if (a.parking_permit_required !== undefined) {
    bits.push(a.parking_permit_required ? "permit required" : "no permit");
  }
  if (a.loading_dock_available === true) bits.push("loading dock");
  return bits.length > 0 ? bits.join(" · ") : "Not set";
}

