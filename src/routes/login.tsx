import { createFileRoute, Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AuthShell } from "@/components/auth/auth-shell";
import { useAuth } from "@/hooks/use-auth";

const schema = z.object({
  email: z.string().email("Enter a valid email"),
  password: z.string().min(1, "Enter your password"),
});

/**
 * Only allow same-origin redirects to internal /app routes. Anything else
 * (protocol-relative URLs, external hosts, other top-level paths) falls back
 * to /app to prevent open-redirect abuse after login.
 */
function safeRedirect(target: string | undefined): string {
  if (!target) return "/app";
  // Reject protocol/scheme, protocol-relative, and backslash tricks.
  if (!target.startsWith("/") || target.startsWith("//") || target.startsWith("/\\")) return "/app";
  if (target === "/app" || target.startsWith("/app/")) return target;
  // Allow the MCP OAuth consent route so signed-out users can return there.
  if (target === "/.lovable/oauth/consent" || target.startsWith("/.lovable/oauth/consent?")) return target;
  return "/app";
}

const searchSchema = z.object({
  redirect: z.string().optional(),
});

export const Route = createFileRoute("/login")({
  validateSearch: (search) => searchSchema.parse(search),
  head: () => ({
    meta: [
      { title: "Log in — BidPilot AI" },
      { name: "description", content: "Log in to your BidPilot AI workspace." },
    ],
  }),
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const { redirect } = useSearch({ from: "/login" });
  const { signIn, user, loading } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { email: "", password: "" },
  });

  const target = safeRedirect(redirect);

  useEffect(() => {
    if (!loading && user) {
      navigate({ to: target, replace: true });
    }
  }, [user, loading, navigate, target]);

  return (
    <AuthShell
      title="Welcome back"
      subtitle="Log in to continue your negotiations."
      footer={
        <div className="space-y-1">
          <p>
            Don't have an account?{" "}
            <Link
              to="/signup"
              className="font-medium text-foreground underline-offset-4 hover:underline"
            >
              Create one
            </Link>
          </p>
          <p>
            <Link
              to="/forgot-password"
              className="text-xs text-muted-foreground underline-offset-4 hover:underline"
            >
              Forgot password?
            </Link>
          </p>
        </div>
      }
    >
      <Form {...form}>
        <form
          onSubmit={form.handleSubmit(async (values) => {
            setError(null);
            setSubmitting(true);
            const { error: err } = await signIn(values.email, values.password);
            setSubmitting(false);
            if (err) {
              setError(err);
              return;
            }
            toast.success("Signed in");
            navigate({ to: target, replace: true });
          })}
          className="space-y-4"
        >
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <FormField
            control={form.control}
            name="email"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Email</FormLabel>
                <FormControl>
                  <Input
                    type="email"
                    autoComplete="email"
                    placeholder="you@company.com"
                    {...field}
                    onChange={(e) => {
                      setError(null);
                      field.onChange(e);
                    }}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="password"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Password</FormLabel>
                <FormControl>
                  <Input
                    type="password"
                    autoComplete="current-password"
                    {...field}
                    onChange={(e) => {
                      setError(null);
                      field.onChange(e);
                    }}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <Button type="submit" className="w-full" disabled={submitting}>
            {submitting ? "Signing in…" : "Log in"}
          </Button>
        </form>
      </Form>
    </AuthShell>
  );
}
