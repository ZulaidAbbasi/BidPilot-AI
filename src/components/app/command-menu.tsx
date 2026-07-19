import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import {
  Home,
  ListChecks,
  PlusCircle,
  LogOut,
  FileText,
  PhoneCall,
  Network,
} from "lucide-react";
import { workflowLabel } from "@/lib/workflow";

export function useCommandMenu() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return { open, setOpen };
}

export function CommandMenu({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const navigate = useNavigate();
  const { user, signOut } = useAuth();

  const recents = useQuery({
    queryKey: ["cmdk-negotiations", user?.id],
    enabled: !!user && open,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("negotiations")
        .select("id, title, workflow_status, updated_at")
        .order("updated_at", { ascending: false })
        .limit(8);
      if (error) throw error;
      return data ?? [];
    },
  });

  const go = (fn: () => void) => {
    onOpenChange(false);
    // Give the dialog a tick to close before navigating.
    setTimeout(fn, 0);
  };

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="Jump to a negotiation, page, or action…" />
      <CommandList>
        <CommandEmpty>No matches.</CommandEmpty>
        <CommandGroup heading="Navigate">
          <CommandItem onSelect={() => go(() => navigate({ to: "/app" }))}>
            <Home className="mr-2 size-4" />
            Command center
          </CommandItem>
          <CommandItem onSelect={() => go(() => navigate({ to: "/app/negotiations" }))}>
            <ListChecks className="mr-2 size-4" />
            All negotiations
          </CommandItem>
          <CommandItem onSelect={() => go(() => navigate({ to: "/app/negotiations/new", search: { id: undefined, step: 1 } }))}>
            <PlusCircle className="mr-2 size-4" />
            New negotiation
          </CommandItem>
          <CommandItem onSelect={() => go(() => navigate({ to: "/architecture" }))}>
            <Network className="mr-2 size-4" />
            Architecture
          </CommandItem>
        </CommandGroup>
        {recents.data && recents.data.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Recent negotiations">
              {recents.data.map((n) => (
                <CommandItem
                  key={n.id}
                  value={`${n.title} ${n.id}`}
                  onSelect={() =>
                    go(() =>
                      navigate({
                        to: "/app/negotiations/$id/overview",
                        params: { id: n.id },
                      }),
                    )
                  }
                >
                  <ListChecks className="mr-2 size-4" />
                  <span className="truncate">{n.title}</span>
                  <span className="ml-auto text-[10px] uppercase tracking-wider text-muted-foreground">
                    {workflowLabel(n.workflow_status)}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}
        <CommandSeparator />
        <CommandGroup heading="Account">
          <CommandItem
            onSelect={() =>
              go(async () => {
                await signOut();
                navigate({ to: "/login", replace: true });
              })
            }
          >
            <LogOut className="mr-2 size-4" />
            Sign out
          </CommandItem>
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Help">
          <CommandItem disabled>
            <FileText className="mr-2 size-4" /> How BidPilot works
          </CommandItem>
          <CommandItem disabled>
            <PhoneCall className="mr-2 size-4" /> Provider call playbook
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
