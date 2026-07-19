import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Lock, ShieldCheck, Truck, Plus, Building2, Phone, Globe, MapPin, Trash2, Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { PageBody, LoadingState, EmptyState } from "@/components/app/page";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

  const addProvider = useMutation({
    mutationFn: async (input: {
      name: string;
      phone: string;
      website: string;
      location: string;
    }) => {
      const payload = {
        negotiation_id: id,
        name: input.name.trim(),
        phone: input.phone.trim() || null,
        website: input.website.trim() || null,
        location: input.location.trim() || null,
        source: "manual",
      };
      const { error } = await supabase.from("providers").insert(payload);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Provider added");
      qc.invalidateQueries({ queryKey: ["providers", id] });
      setOpen(false);
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
              Confirm the specification before contacting providers. Every quote
              must be tied to a hash-locked document so we can hold providers to
              the same scope.
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
          onSubmit={(v) => addProvider.mutate(v)}
          submitting={addProvider.isPending}
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
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSubmit: (v: { name: string; phone: string; website: string; location: string }) => void;
  submitting: boolean;
}) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [website, setWebsite] = useState("");
  const [location, setLocation] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    onSubmit({ name, phone, website, location });
  };

  // Reset when closing
  const handleOpenChange = (v: boolean) => {
    if (!v) {
      setName("");
      setPhone("");
      setWebsite("");
      setLocation("");
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
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add provider</DialogTitle>
          <DialogDescription>
            A target moving company to negotiate against this specification.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3">
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
              Add provider
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
