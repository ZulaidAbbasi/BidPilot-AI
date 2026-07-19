import { useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { ChevronsUpDown, LogOut, Settings, User } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";

function initials(nameOrEmail: string) {
  const source = nameOrEmail.trim();
  if (!source) return "?";
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return source.slice(0, 2).toUpperCase();
}

export function UserMenu({ variant = "topbar" }: { variant?: "topbar" | "sidebar" }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user, signOut } = useAuth();

  const { data: profile } = useQuery({
    queryKey: ["profile", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("full_name")
        .eq("id", user!.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const displayName = profile?.full_name?.trim() || user?.email || "Account";
  const email = user?.email ?? "";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {variant === "sidebar" ? (
          <Button
            variant="ghost"
            className="h-auto w-full justify-start gap-2.5 rounded-lg px-2 py-2 hover:bg-sidebar-accent"
          >
            <Avatar className="size-8">
              <AvatarFallback className="bg-navy text-[11px] text-primary-foreground">
                {initials(displayName)}
              </AvatarFallback>
            </Avatar>
            <span className="min-w-0 flex-1 text-left leading-tight">
              <span className="block truncate text-[13px] font-medium">{displayName}</span>
              {email && (
                <span className="block truncate text-[11px] text-muted-foreground">{email}</span>
              )}
            </span>
            <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" />
          </Button>
        ) : (
          <Button variant="ghost" size="sm" className="gap-2 pl-1 pr-2">
            <Avatar className="size-7">
              <AvatarFallback className="bg-navy text-primary-foreground text-xs">
                {initials(displayName)}
              </AvatarFallback>
            </Avatar>
            <span className="hidden max-w-[10rem] truncate text-sm font-medium sm:inline">
              {displayName}
            </span>
          </Button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="font-normal">
          <div className="truncate text-sm font-medium">{displayName}</div>
          {email && <div className="truncate text-xs text-muted-foreground">{email}</div>}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled>
          <User className="mr-2 size-4" /> Profile
        </DropdownMenuItem>
        <DropdownMenuItem disabled>
          <Settings className="mr-2 size-4" /> Settings
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={async () => {
            await queryClient.cancelQueries();
            queryClient.clear();
            await signOut();
            toast.success("Signed out");
            navigate({ to: "/login", replace: true });
          }}
        >
          <LogOut className="mr-2 size-4" /> Log out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
