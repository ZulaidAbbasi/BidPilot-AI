import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Lock,
  ShieldCheck,
  Truck,
  Plus,
  Building2,
  Phone,
  Globe,
  MapPin,
  Trash2,
  Loader2,
  AlertTriangle,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { PageBody, LoadingState, EmptyState } from "@/components/app/page";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogTrigger,
  DialogDescription,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { shortHash } from "@/lib/job-spec-canonical";
import {
  DEFAULT_NEXT_ACTION,
  NEXT_ACTION_META,
  buildControlRoomSearch,
  evaluateLeverageOptions,
  resolveNextActionSubmission,
  sanitizeProviderInput,
  type LeverageQuoteRow,
  type NextAction,
} from "@/lib/provider-next-action";

export const Route = createFileRoute("/app/negotiations/$id/providers")({
  head: () => ({ meta: [{ title: "Providers — BidPilot AI" }] }),
  component: ProvidersPage,
});

type Provider = {
  id: string;
  name: string;
  phone: string | null;
  website: string | null;
  location: string | null;
  source: string | null;
  created_at: string;
};

function ProvidersPage() {
  const { id } = Route.useParams();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  const versions = useQuery({
    queryKey: ["job-spec-versions", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("job_specs")
        .select("id, version, specification_hash, confirmed_at")
        .eq("negotiation_id", id)
        .eq("confirmed", true)
        .order("version", { ascending: false })
        .limit(1);
      if (error) throw error;
      return data ?? [];
    },
  });

  const providers = useQuery({
    queryKey: ["providers", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("providers")
        .select("id, name, phone, website, location, source, created_at")
        .eq("negotiation_id", id)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as Provider[];
    },
  });

  const specHash = versions.data?.[0]?.specification_hash ?? "";

  // Load all FINAL-confirmed comparable quotes for this negotiation once —
  // the modal filters them per selected provider before showing the picker.
  // Uses the SAME shared eligibility function the server-side start path
  // uses; no client-side leverage rule is duplicated or weakened here.
  const leverageCandidates = useQuery({
    enabled: !!specHash,
    queryKey: ["leverage-candidates", id, specHash],
    queryFn: async () => {
      const { data: quotes, error } = await supabase
        .from("quotes")
        .select(
          "id, provider_id, spec_hash, quote_stage, final_confirmed_at, verification_status, valid_until, total_amount, currency, captured_at, call_id, providers(name)",
        )
        .eq("negotiation_id", id)
        .eq("spec_hash", specHash)
        .eq("quote_stage", "FINAL")
        .not("final_confirmed_at", "is", null);
      if (error) throw error;
      const rows = quotes ?? [];
      if (rows.length === 0) return [] as LeverageQuoteRow[];
      const callIds = Array.from(new Set(rows.map((r) => r.call_id).filter(Boolean))) as string[];
      const quoteIds = rows.map((r) => r.id);
      const [{ data: calls }, { data: evs }] = await Promise.all([
        callIds.length
          ? supabase
              .from("calls")
              .select("id, status, needs_review")
              .in("id", callIds)
          : Promise.resolve({ data: [] as Array<{ id: string; status: string; needs_review: boolean | null }> }),
        supabase
          .from("quote_evidence")
          .select("quote_id, evidence_type, support_status")
          .in("quote_id", quoteIds),
      ]);
      const callById = new Map<string, { status: string; needs_review: boolean | null }>();
      for (const c of calls ?? []) {
        callById.set(c.id as string, { status: c.status as string, needs_review: c.needs_review });
      }
      const evByQuote = new Map<string, Array<{ evidence_type: string; support_status: string }>>();
      for (const e of evs ?? []) {
        const arr = evByQuote.get(e.quote_id as string) ?? [];
        arr.push({
          evidence_type: e.evidence_type as string,
          support_status: e.support_status as string,
        });
        evByQuote.set(e.quote_id as string, arr);
      }
      return rows.map<LeverageQuoteRow>((r) => ({
        id: r.id as string,
        provider_id: r.provider_id as string,
        provider_name:
          (r.providers as { name: string } | null | undefined)?.name ?? null,
        spec_hash: (r.spec_hash as string | null) ?? null,
        quote_stage: r.quote_stage as string,
        final_confirmed_at: r.final_confirmed_at as string | null,
        verification_status: (r.verification_status as string) ?? "unverified",
        valid_until: (r.valid_until as string | null) ?? null,
        total_amount: r.total_amount != null ? Number(r.total_amount) : null,
        currency: (r.currency as string | null) ?? null,
        captured_at: r.captured_at as string,
        call: r.call_id ? callById.get(r.call_id as string) ?? null : null,
        evidence: evByQuote.get(r.id as string) ?? [],
      }));
    },
  });

  const addProvider = useMutation({
    mutationFn: async (args: {
      input: { name: string; phone: string; website: string; location: string };
      nextAction: NextAction;
      leverageQuoteId: string | null;
    }) => {
      const clean = sanitizeProviderInput(args.input);
      if (!clean.name) throw new Error("Provider name is required");
      const { data, error } = await supabase
        .from("providers")
        .insert({
          negotiation_id: id,
          name: clean.name,
          phone: clean.phone,
          website: clean.website,
          location: clean.location,
          source: "manual",
        })
        .select("id")
        .single();
      if (error) throw error;
      return { providerId: data.id as string, nextAction: args.nextAction, leverageQuoteId: args.leverageQuoteId };
    },
    onSuccess: async (res) => {
      qc.invalidateQueries({ queryKey: ["providers", id] });
      if (res.nextAction === "add_only") {
        toast.success("Provider added");
        setOpen(false);
        return;
      }
      // Prepared — but no voice credits are spent until the user clicks
      // "Start voice call" in the Control Room.
      const search = buildControlRoomSearch({
        providerId: res.providerId,
        submission:
          res.nextAction === "quote_gathering"
            ? { nextAction: "quote_gathering", callMode: "QUOTE_GATHERING", leverageQuoteId: null }
            : {
                nextAction: "negotiation",
                callMode: "NEGOTIATION",
                leverageQuoteId: res.leverageQuoteId!,
              },
      });
      toast.success(
        res.nextAction === "quote_gathering"
          ? "Provider added — quote gathering call prepared"
          : "Provider added — negotiation call prepared",
      );
      setOpen(false);
      if (search) {
        navigate({
          to: "/app/negotiations/$id/control-room",
          params: { id },
          search,
        });
      }
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const removeProvider = useMutation({
    mutationFn: async (providerId: string) => {
      const { error } = await supabase.from("providers").delete().eq("id", providerId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Provider removed");
      qc.invalidateQueries({ queryKey: ["providers", id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (versions.isLoading) {
    return (
      <PageBody>
        <LoadingState label="Checking for a confirmed specification" />
      </PageBody>
    );
  }

  const latest = versions.data?.[0];

  if (!latest) {
    return (
      <PageBody>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Lock className="size-4 text-muted-foreground" />
              Provider calls are locked
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <p>
              Confirm the specification before contacting providers. Every quote must be tied to a
              hash-locked document so we can hold providers to the same scope.
            </p>
            <Button asChild size="sm">
              <Link to="/app/negotiations/$id/specification" params={{ id }}>
                Go to specification
              </Link>
            </Button>
          </CardContent>
        </Card>
      </PageBody>
    );
  }

  const rows = providers.data ?? [];

  return (
    <PageBody>
      <Card className="mb-4">
        <CardHeader className="pb-3">
          <CardTitle className="flex flex-wrap items-center gap-2 text-base">
            <ShieldCheck className="size-4 text-emerald-600" />
            Quoting against v{latest.version}
            <code className="font-mono text-xs text-muted-foreground">
              {shortHash(latest.specification_hash ?? "", 12)}
            </code>
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0 text-sm text-muted-foreground">
          <p className="flex items-center gap-2">
            <Truck className="size-4" />
            Add vetted moving providers to call against this locked spec.
          </p>
        </CardContent>
      </Card>

      <div className="mb-3 flex items-center justify-between">
        <div>
          <h2 className="text-lg tracking-tight">Providers</h2>
          <p className="text-xs text-muted-foreground">
            {rows.length} provider{rows.length === 1 ? "" : "s"}
          </p>
        </div>
        <AddProviderDialog
          open={open}
          onOpenChange={setOpen}
          submitting={addProvider.isPending}
          specHash={latest.specification_hash ?? ""}
          negotiationId={id}
          leverageCandidates={leverageCandidates.data ?? []}
          onSubmit={(v) => addProvider.mutate(v)}
        />
      </div>

      {providers.isLoading ? (
        <LoadingState label="Loading providers" />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={Building2}
          title="No providers yet"
          description="Add at least one provider so BidPilot has a target to call."
          action={
            <Button size="sm" onClick={() => setOpen(true)}>
              <Plus className="mr-1 size-4" /> Add provider
            </Button>
          }
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {rows.map((p) => (
            <Card key={p.id} className="border-border/70">
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-2">
                  <CardTitle className="text-sm font-semibold">{p.name}</CardTitle>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7 text-muted-foreground hover:text-destructive"
                    onClick={() => removeProvider.mutate(p.id)}
                    disabled={removeProvider.isPending}
                    aria-label="Remove provider"
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-1.5 pt-0 text-xs text-muted-foreground">
                {p.phone && (
                  <p className="flex items-center gap-2">
                    <Phone className="size-3" />
                    {p.phone}
                  </p>
                )}
                {p.website && (
                  <p className="flex items-center gap-2 truncate">
                    <Globe className="size-3" />
                    <a
                      href={p.website.startsWith("http") ? p.website : `https://${p.website}`}
                      target="_blank"
                      rel="noreferrer"
                      className="truncate hover:text-foreground"
                    >
                      {p.website}
                    </a>
                  </p>
                )}
                {p.location && (
                  <p className="flex items-center gap-2">
                    <MapPin className="size-3" />
                    {p.location}
                  </p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </PageBody>
  );
}

function AddProviderDialog({
  open,
  onOpenChange,
  onSubmit,
  submitting,
  leverageCandidates,
  specHash,
  negotiationId,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSubmit: (v: {
    input: { name: string; phone: string; website: string; location: string };
    nextAction: NextAction;
    leverageQuoteId: string | null;
  }) => void;
  submitting: boolean;
  leverageCandidates: LeverageQuoteRow[];
  specHash: string;
  negotiationId: string;
}) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [website, setWebsite] = useState("");
  const [location, setLocation] = useState("");
  const [nextAction, setNextAction] = useState<NextAction>(DEFAULT_NEXT_ACTION);
  const [leverageQuoteId, setLeverageQuoteId] = useState<string>("");
  const [confirmation, setConfirmation] = useState<null | {
    nextAction: NextAction;
    leverageQuoteId: string | null;
  }>(null);

  // For a not-yet-created provider we have no `id`, so eligibility is
  // "any candidate that could still be from a different provider than
  // the one being created and passes every other rule". We treat the
  // target providerId as a sentinel that no candidate can match, so
  // same-provider rejections don't spuriously fire before insert.
  const evaluated = useMemo(
    () =>
      evaluateLeverageOptions({
        candidates: leverageCandidates,
        currentProviderId: "__new_provider__",
        currentSpecHash: specHash,
        currentNegotiationId: negotiationId,
      }),
    [leverageCandidates, specHash, negotiationId],
  );
  const eligibleIds = useMemo(() => evaluated.eligible.map((q) => q.id), [evaluated]);

  const negotiationDisabled = evaluated.eligible.length === 0;
  const submitMeta = NEXT_ACTION_META[nextAction];

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const r = resolveNextActionSubmission({
      nextAction,
      providerName: name,
      selectedLeverageQuoteId: leverageQuoteId || null,
      eligibleLeverageIds: eligibleIds,
    });
    if (!r.ok) {
      toast.error(r.error.message);
      return;
    }
    // Show a confirmation preview first — user then clicks "Continue"
    // to actually insert. This is the "confirmation screen" step from
    // the spec and reinforces "no voice call has started yet".
    setConfirmation({
      nextAction: r.submission.nextAction,
      leverageQuoteId:
        r.submission.nextAction === "negotiation" ? r.submission.leverageQuoteId : null,
    });
  };

  const commit = () => {
    if (!confirmation) return;
    onSubmit({
      input: { name, phone, website, location },
      nextAction: confirmation.nextAction,
      leverageQuoteId: confirmation.leverageQuoteId,
    });
  };

  const handleOpenChange = (v: boolean) => {
    if (!v) {
      setName("");
      setPhone("");
      setWebsite("");
      setLocation("");
      setNextAction(DEFAULT_NEXT_ACTION);
      setLeverageQuoteId("");
      setConfirmation(null);
    }
    onOpenChange(v);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="mr-1 size-4" /> Add provider
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add provider</DialogTitle>
          <DialogDescription>
            A target moving company to negotiate against this specification.
          </DialogDescription>
        </DialogHeader>

        {confirmation ? (
          <ConfirmationScreen
            name={name.trim()}
            nextAction={confirmation.nextAction}
            leverage={
              confirmation.leverageQuoteId
                ? leverageCandidates.find((q) => q.id === confirmation.leverageQuoteId) ?? null
                : null
            }
            specHash={specHash}
            submitting={submitting}
            onBack={() => setConfirmation(null)}
            onConfirm={commit}
          />
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="p-name">
                Name <span className="text-destructive">*</span>
              </Label>
              <Input
                id="p-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Acme Moving Co."
                autoFocus
                required
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="p-phone">Phone</Label>
                <Input
                  id="p-phone"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+1 555 123 4567"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="p-website">Website</Label>
                <Input
                  id="p-website"
                  value={website}
                  onChange={(e) => setWebsite(e.target.value)}
                  placeholder="acmemoving.com"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="p-location">Location</Label>
              <Input
                id="p-location"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="Brooklyn, NY"
              />
            </div>

            <div className="space-y-2 rounded-md border p-3">
              <Label className="text-sm font-semibold">Next action</Label>
              <RadioGroup
                value={nextAction}
                onValueChange={(v) => setNextAction(v as NextAction)}
                className="gap-2"
              >
                <NextActionOption
                  value="add_only"
                  selected={nextAction}
                  label={NEXT_ACTION_META.add_only.label}
                  description={NEXT_ACTION_META.add_only.description}
                />
                <NextActionOption
                  value="quote_gathering"
                  selected={nextAction}
                  label={NEXT_ACTION_META.quote_gathering.label}
                  description={NEXT_ACTION_META.quote_gathering.description}
                />
                <NextActionOption
                  value="negotiation"
                  selected={nextAction}
                  label={NEXT_ACTION_META.negotiation.label}
                  description={NEXT_ACTION_META.negotiation.description}
                  disabled={negotiationDisabled}
                  disabledReason={evaluated.disabledReason}
                />
              </RadioGroup>

              {nextAction === "negotiation" && !negotiationDisabled && (
                <div className="space-y-1.5 pt-1">
                  <Label htmlFor="leverage-quote" className="text-xs">
                    Verified comparable quote
                  </Label>
                  <Select value={leverageQuoteId} onValueChange={setLeverageQuoteId}>
                    <SelectTrigger id="leverage-quote">
                      <SelectValue placeholder="Select a verified competing offer" />
                    </SelectTrigger>
                    <SelectContent>
                      {evaluated.eligible.map((q) => (
                        <SelectItem key={q.id} value={q.id}>
                          {q.provider_name ?? "Provider"} —{" "}
                          {q.total_amount != null
                            ? `${q.currency ?? "USD"} ${q.total_amount.toLocaleString()}`
                            : "amount unavailable"}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>

            <DialogFooter className="pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => handleOpenChange(false)}
                disabled={submitting}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={submitting || !name.trim()}>
                {submitting && <Loader2 className="mr-1 size-4 animate-spin" />}
                {submitMeta.submitLabel}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function NextActionOption({
  value,
  selected,
  label,
  description,
  disabled,
  disabledReason,
}: {
  value: NextAction;
  selected: NextAction;
  label: string;
  description: string;
  disabled?: boolean;
  disabledReason?: string | null;
}) {
  const isSelected = selected === value;
  return (
    <label
      className={`flex cursor-pointer items-start gap-2 rounded-md border p-2 text-sm ${
        disabled
          ? "cursor-not-allowed opacity-60"
          : isSelected
            ? "border-primary bg-primary/5"
            : "hover:bg-muted/40"
      }`}
    >
      <RadioGroupItem value={value} disabled={disabled} className="mt-0.5" />
      <div className="space-y-0.5">
        <div className="font-medium">{label}</div>
        <div className="text-xs text-muted-foreground">{description}</div>
        {disabled && disabledReason && (
          <div className="flex items-start gap-1.5 pt-1 text-xs text-amber-700 dark:text-amber-500">
            <AlertTriangle className="mt-0.5 size-3 shrink-0" />
            <span>{disabledReason}</span>
          </div>
        )}
      </div>
    </label>
  );
}

function ConfirmationScreen({
  name,
  nextAction,
  leverage,
  specHash,
  submitting,
  onBack,
  onConfirm,
}: {
  name: string;
  nextAction: NextAction;
  leverage: LeverageQuoteRow | null;
  specHash: string;
  submitting: boolean;
  onBack: () => void;
  onConfirm: () => void;
}) {
  const callMode =
    nextAction === "negotiation"
      ? "NEGOTIATION"
      : nextAction === "quote_gathering"
        ? "QUOTE_GATHERING"
        : null;
  return (
    <div className="space-y-3 text-sm">
      <div className="rounded-md border bg-muted/30 p-3 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs uppercase tracking-wide text-muted-foreground">Provider</span>
          <span className="font-medium">{name}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs uppercase tracking-wide text-muted-foreground">Call mode</span>
          {callMode ? (
            <Badge variant="outline">{callMode === "NEGOTIATION" ? "Negotiation" : "Quote gathering"}</Badge>
          ) : (
            <span className="text-xs">No call prepared</span>
          )}
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs uppercase tracking-wide text-muted-foreground">Spec</span>
          <code className="font-mono text-xs">{shortHash(specHash, 12)}</code>
        </div>
        {leverage && (
          <div className="flex items-center justify-between">
            <span className="text-xs uppercase tracking-wide text-muted-foreground">Leverage</span>
            <span className="text-xs">
              {leverage.provider_name ?? "Provider"}
              {leverage.total_amount != null
                ? ` · ${leverage.currency ?? "USD"} ${leverage.total_amount.toLocaleString()}`
                : ""}
            </span>
          </div>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        No voice call has started yet. You&apos;ll click <strong>Start voice call</strong> in the
        Control Room to actually place the call.
      </p>
      <DialogFooter className="pt-1">
        <Button type="button" variant="outline" onClick={onBack} disabled={submitting}>
          Review call setup
        </Button>
        <Button type="button" onClick={onConfirm} disabled={submitting}>
          {submitting && <Loader2 className="mr-1 size-4 animate-spin" />}
          {nextAction === "add_only" ? "Add provider" : "Start voice call"}
        </Button>
      </DialogFooter>
    </div>
  );
}
