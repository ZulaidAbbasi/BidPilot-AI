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
  BadgeCheck,
  Command,
  FileText,
  Gavel,
  Home,
  Inbox,
  LifeBuoy,
  ListChecks,
  Network,
  PhoneCall,
  PlusCircle,
  Receipt,
  Route as RouteIcon,
  ScrollText,
  ShieldCheck,
  Users,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { statusTone } from "@/lib/workflow";
import { UserMenu } from "@/components/app/user-menu";

const WORKSPACE_ITEMS: ReadonlyArray<{
  to: "/app" | "/app/negotiations" | "/app/judge-mode";
  label: string;
  icon: typeof Home;
  exact?: boolean;
}> = [
  { to: "/app", label: "Command center", icon: Home, exact: true },
  { to: "/app/negotiations", label: "Negotiations", icon: ListChecks },
  { to: "/app/judge-mode", label: "Judge Mode", icon: BadgeCheck },
];

const WORKFLOW_ITEMS = [
  { key: "overview", label: "Overview", icon: RouteIcon },
  { key: "intake", label: "Intake", icon: Inbox },
  { key: "specification", label: "Specification", icon: FileText },
  { key: "providers", label: "Providers", icon: Users },
  { key: "calls", label: "Calls", icon: PhoneCall },
  { key: "quotes", label: "Quotes", icon: Receipt },
  { key: "negotiate", label: "Negotiate", icon: Gavel },
  { key: "evidence", label: "Evidence", icon: ScrollText },
  { key: "report", label: "Final report", icon: BadgeCheck },
] as const;

function extractNegotiationId(pathname: string): string | null {
  const match = pathname.match(/^\/app\/negotiations\/([^/]+)(\/|$)/);
  if (!match) return null;
  const id = match[1];
  if (id === "new" || id === "index") return null;
  return id;
}

export function AppSidebar({ onOpenCommand }: { onOpenCommand: () => void }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { user } = useAuth();
  const negotiationId = extractNegotiationId(pathname);

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

  const currentNeg = useQuery({
    queryKey: ["sidebar-active-negotiation", negotiationId],
    enabled: !!negotiationId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("negotiations")
        .select("id, title, workflow_status")
        .eq("id", negotiationId!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="border-b border-sidebar-border/70 pb-2">
        <Link
          to="/app"
          className="flex items-center gap-2.5 px-2 py-2"
          aria-label="BidPilot workspace"
        >
          <span className="relative inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-[#4f6bff] to-[#0f9d83] text-white shadow-lg shadow-[#4f6bff]/30">
            <svg viewBox="0 0 32 32" className="size-4" fill="none" aria-hidden>
              <path d="M6 16.5L25 7l-6.5 18-4-7.5L6 16.5z" fill="currentColor" />
            </svg>
            <span className="absolute -right-0.5 -top-0.5 size-2 rounded-full bg-[#0f9d83] ring-2 ring-sidebar" />
          </span>
          <span className="min-w-0 leading-tight group-data-[collapsible=icon]:hidden">
            <span className="block truncate text-[14px] font-semibold tracking-tight text-sidebar-foreground">
              BidPilot
            </span>
            <span className="block font-mono text-[9px] uppercase tracking-[0.22em] text-sidebar-foreground/45">
              Evidence Intelligence
            </span>
          </span>
        </Link>
      </SidebarHeader>

      <SidebarContent className="gap-1">
        {/* Command menu */}
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  onClick={onOpenCommand}
                  tooltip="Command menu (⌘K)"
                  aria-label="Open command menu"
                  className="justify-between text-sidebar-foreground/70 hover:text-sidebar-foreground"
                >
                  <span className="flex items-center gap-2">
                    <Command data-sidebar="nav-icon" />
                    <span>Search</span>
                  </span>
                  <span className="kbd-chip !bg-sidebar-accent !text-sidebar-foreground/70 !border-sidebar-border group-data-[collapsible=icon]:hidden">
                    ⌘K
                  </span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {/* Workspace */}
        <SidebarGroup>
          <SidebarGroupLabel className="font-mono text-[9px] uppercase tracking-[0.22em] text-sidebar-foreground/45">
            Workspace
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {WORKSPACE_ITEMS.map((item) => {
                const active = item.exact ? pathname === item.to : pathname.startsWith(item.to);
                return (
                  <SidebarMenuItem key={item.to}>
                    <SidebarMenuButton
                      asChild
                      isActive={active}
                      tooltip={item.label}
                      className="nav-item"
                    >
                      <Link to={item.to}>
                        <item.icon data-sidebar="nav-icon" />
                        <span>{item.label}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
              <SidebarMenuItem>
                <SidebarMenuButton asChild tooltip="New negotiation" className="nav-item">
                  <Link to="/app/negotiations/new" search={{ id: undefined, step: 1 }}>
                    <PlusCircle data-sidebar="nav-icon" />
                    <span>New negotiation</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {/* Workflow — context-aware, appears inside a negotiation */}
        {negotiationId && (
          <SidebarGroup>
            <SidebarGroupLabel className="flex items-center justify-between font-mono text-[9px] uppercase tracking-[0.22em] text-sidebar-foreground/45">
              <span>Workflow</span>
              {currentNeg.data && (
                <span
                  className={`status-dot shrink-0 ${
                    statusTone(currentNeg.data.workflow_status) === "verified"
                      ? "bg-verified"
                      : statusTone(currentNeg.data.workflow_status) === "warn"
                        ? "bg-warn"
                        : statusTone(currentNeg.data.workflow_status) === "risk"
                          ? "bg-risk"
                          : "bg-primary"
                  }`}
                  aria-hidden
                />
              )}
            </SidebarGroupLabel>
            {currentNeg.data && (
              <div className="mb-1 px-2 group-data-[collapsible=icon]:hidden">
                <p className="truncate text-[12.5px] font-semibold text-sidebar-foreground">
                  {currentNeg.data.title}
                </p>
                <p className="font-mono text-[10px] text-sidebar-foreground/45">
                  #{currentNeg.data.id.slice(0, 8)}
                </p>
              </div>
            )}
            <SidebarGroupContent>
              <SidebarMenu>
                {WORKFLOW_ITEMS.map((item) => {
                  const to = `/app/negotiations/${negotiationId}/${item.key}` as const;
                  const active = pathname === to || pathname.startsWith(`${to}/`);
                  return (
                    <SidebarMenuItem key={item.key}>
                      <SidebarMenuButton
                        asChild
                        isActive={active}
                        tooltip={item.label}
                        size="sm"
                        className="nav-item text-[13px]"
                      >
                        <Link
                          to={
                            `/app/negotiations/$id/${item.key}` as
                              | "/app/negotiations/$id/overview"
                              | "/app/negotiations/$id/intake"
                              | "/app/negotiations/$id/specification"
                              | "/app/negotiations/$id/providers"
                              | "/app/negotiations/$id/calls"
                              | "/app/negotiations/$id/quotes"
                              | "/app/negotiations/$id/negotiate"
                              | "/app/negotiations/$id/evidence"
                              | "/app/negotiations/$id/report"
                          }
                          params={{ id: negotiationId }}
                        >
                          <item.icon data-sidebar="nav-icon" />
                          <span>{item.label}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        {/* Recent — only when NOT inside a specific negotiation */}
        {!negotiationId && recents.data && recents.data.length > 0 && (
          <SidebarGroup>
            <SidebarGroupLabel className="font-mono text-[9px] uppercase tracking-[0.22em] text-sidebar-foreground/45">
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
                          : "bg-sidebar-foreground/40";
                  return (
                    <SidebarMenuItem key={n.id}>
                      <SidebarMenuButton
                        asChild
                        tooltip={n.title}
                        size="sm"
                        className="nav-item text-[13px]"
                      >
                        <Link to="/app/negotiations/$id/overview" params={{ id: n.id }}>
                          <span
                            className={`status-dot ${dot} shrink-0`}
                            data-sidebar="nav-icon"
                            aria-hidden
                          />
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
            <SidebarMenuButton
              asChild
              tooltip="Architecture"
              size="sm"
              className="nav-item text-[13px] text-sidebar-foreground/70"
            >
              <Link to="/architecture">
                <Network data-sidebar="nav-icon" />
                <span>Architecture</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton
              tooltip="Help — coming soon"
              disabled
              size="sm"
              className="nav-item text-[13px] text-sidebar-foreground/50"
            >
              <LifeBuoy data-sidebar="nav-icon" />
              <span>Help</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        <div className="mt-1 group-data-[collapsible=icon]:hidden">
          <UserMenu variant="sidebar" />
        </div>
        {/* keep import used */}
        <span className="hidden">
          <ShieldCheck />
        </span>
      </SidebarFooter>
    </Sidebar>
  );
}
