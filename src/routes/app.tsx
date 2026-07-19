import { createFileRoute, Outlet, useRouterState, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { AppSidebar } from "@/components/app/app-sidebar";
import { UserMenu } from "@/components/app/user-menu";
import { CommandMenu, useCommandMenu } from "@/components/app/command-menu";
import { SidebarProvider, SidebarInset, SidebarTrigger } from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { Search } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";

export const Route = createFileRoute("/app")({
  ssr: false,
  component: AppLayout,
});

function AppLayout() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const cmd = useCommandMenu();

  useEffect(() => {
    if (!loading && !user) {
      navigate({
        to: "/login",
        search: { redirect: pathname },
        replace: true,
      });
    }
  }, [loading, user, navigate, pathname]);

  if (loading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div
          role="status"
          aria-live="polite"
          className="flex items-center gap-3 text-sm text-muted-foreground"
        >
          <span className="inline-flex size-4 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-foreground" />
          Restoring session…
        </div>
      </div>
    );
  }

  return (
    <SidebarProvider>
      <AppSidebar onOpenCommand={() => cmd.setOpen(true)} />
      <SidebarInset className="app-shell">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-background/90 px-4 backdrop-blur-md sm:px-6">
          <SidebarTrigger className="-ml-1 text-muted-foreground hover:text-foreground" />
          <div className="ml-auto flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => cmd.setOpen(true)}
              className="hidden h-9 gap-2 border-border bg-card px-3 text-muted-foreground shadow-none hover:bg-accent md:inline-flex"
            >
              <Search className="size-3.5" />
              <span className="text-[13px]">Search…</span>
              <span className="kbd-chip ml-2">⌘K</span>
            </Button>
            <UserMenu />
          </div>
        </header>
        <div className="min-h-[calc(100dvh-3.5rem)]">
          <Outlet />
        </div>
      </SidebarInset>
      <CommandMenu open={cmd.open} onOpenChange={cmd.setOpen} />
    </SidebarProvider>
  );
}
