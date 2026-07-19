import { Link, useRouterState } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarFooter,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import {
  Command,
  Home,
  LifeBuoy,
  ListChecks,
  Network,
  PlusCircle,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { statusTone } from "@/lib/workflow";
import { UserMenu } from "@/components/app/user-menu";

export function AppSidebar({ onOpenCommand }: { onOpenCommand: () => void }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { user } = useAuth();

  const recents = useQuery({
    queryKey: ["sidebar-recent-negotiations", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("negotiations")
        .select("id, title, workflow_status")
        .order("updated_at", { ascending: false })
        .limit(4);
      if (error) throw error;
      return data ?? [];
    },
  });

  const isHome = pathname === "/app";
  const isInNegotiations = pathname.startsWith("/app/negotiations");

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="border-b border-sidebar-border/70 pb-2">
        <Link to="/app" className="flex items-center gap-2.5 px-2 py-2">
          <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-navy text-white shadow-sm ring-1 ring-navy/10">
            <svg viewBox="0 0 32 32" className="size-4" fill="none" aria-hidden>
              <path d="M6 16.5L25 7l-6.5 18-4-7.5L6 16.5z" fill="currentColor" />
              <path d="M14.5 17.5L25 7" stroke="#10b981" strokeWidth="1.5" strokeLinecap="round" />
              <circle cx="9" cy="23" r="1.75" fill="#F59E0B" />
            </svg>
          </span>
          <span className="min-w-0 leading-tight group-data-[collapsible=icon]:hidden">
            <span className="block truncate text-[14px] font-semibold tracking-tight text-navy">
              BidPilot
            </span>
            <span className="block text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
              Intelligence
            </span>
          </span>
        </Link>
      </SidebarHeader>

      <SidebarContent className="gap-1">
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  onClick={onOpenCommand}
                  tooltip="Command menu (⌘K)"
                  className="justify-between text-muted-foreground hover:text-foreground"
                >
                  <span className="flex items-center gap-2">
                    <Command />
                    <span>Search</span>
                  </span>
                  <span className="kbd-chip group-data-[collapsible=icon]:hidden">⌘K</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/80">
            Workspace
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={isHome} tooltip="Command center">
                  <Link to="/app">
                    <Home />
                    <span>Command center</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={isInNegotiations} tooltip="All negotiations">
                  <Link to="/app/negotiations">
                    <ListChecks />
                    <span>Negotiations</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton asChild tooltip="New negotiation">
                  <Link to="/app/negotiations/new" search={{ id: undefined, step: 1 }}>
                    <PlusCircle />
                    <span>New negotiation</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {recents.data && recents.data.length > 0 && (
          <SidebarGroup>
            <SidebarGroupLabel className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/80">
              Recent
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {recents.data.map((n) => {
                  const tone = statusTone(n.workflow_status);
                  const dot =
                    tone === "verified"
                      ? "bg-verified"
                      : tone === "warn"
                        ? "bg-warn"
                        : tone === "risk"
                          ? "bg-risk"
                          : "bg-muted-foreground/50";
                  const active = pathname.includes(`/negotiations/${n.id}`);
                  return (
                    <SidebarMenuItem key={n.id}>
                      <SidebarMenuButton
                        asChild
                        isActive={active}
                        tooltip={n.title}
                        size="sm"
                        className="text-[13px]"
                      >
                        <Link
                          to="/app/negotiations/$id/overview"
                          params={{ id: n.id }}
                        >
                          <span className={`status-dot ${dot} shrink-0`} aria-hidden />
                          <span className="truncate">{n.title}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border/70">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild tooltip="Architecture" size="sm" className="text-[13px] text-muted-foreground">
              <Link to="/architecture">
                <Network />
                <span>Architecture</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton tooltip="Help" disabled size="sm" className="text-[13px] text-muted-foreground">
              <LifeBuoy />
              <span>Help</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        <div className="mt-1 group-data-[collapsible=icon]:hidden">
          <UserMenu variant="sidebar" />
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
