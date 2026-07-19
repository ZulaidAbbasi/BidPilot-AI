import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
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
  name: z.string().min(2, "Enter your name"),
  email: z.string().email("Enter a valid email"),
  password: z.string().min(8, "At least 8 characters"),
});

export const Route = createFileRoute("/signup")({
  head: () => ({
    meta: [
      { title: "Create account — BidPilot AI" },
      { name: "description", content: "Create a BidPilot AI workspace." },
    ],
  }),
  component: SignupPage,
});

function SignupPage() {
  const navigate = useNavigate();
  const { signUp, user, loading } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);

  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { name: "", email: "", password: "" },
  });

  useEffect(() => {
    // Only redirect if a real session exists (email confirmation disabled or
    // already verified). If we're showing the "check your email" screen, don't
    // bounce away — the user has no session yet.
    if (!loading && user && !pendingEmail) navigate({ to: "/app", replace: true });
  }, [user, loading, navigate, pendingEmail]);

  if (pendingEmail) {
    return (
      <AuthShell
        title="Check your email"
        subtitle={`We sent a confirmation link to ${pendingEmail}. Click it to activate your account, then log in.`}
        footer={
          <p>
            Already confirmed?{" "}
            <Link
              to="/login"
              className="font-medium text-foreground underline-offset-4 hover:underline"
            >
              Log in
            </Link>
          </p>
        }
      >
        <Alert>
          <AlertDescription>
            The confirmation link expires after a short window. If you don't see the email, check
            your spam folder or try signing up again.
          </AlertDescription>
        </Alert>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Create your workspace"
      subtitle="Start your first moving negotiation in minutes."
      footer={
        <p>
          Already have an account?{" "}
          <Link
            to="/login"
            className="font-medium text-foreground underline-offset-4 hover:underline"
          >
            Log in
          </Link>
        </p>
      }
    >
      <Form {...form}>
        <form
          onSubmit={form.handleSubmit(async (values) => {
            setError(null);
            setSubmitting(true);
            const { error: err, needsEmailConfirmation } = await signUp(
              values.email,
              values.password,
              values.name,
            );
            setSubmitting(false);
            if (err) {
              setError(err);
              return;
            }
            if (needsEmailConfirmation) {
              setPendingEmail(values.email);
              toast.success("Account created — check your email to confirm.");
              return;
            }
            toast.success("Account created");
            navigate({ to: "/app", replace: true });
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
            name="name"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Full name</FormLabel>
                <FormControl>
                  <Input
                    autoComplete="name"
                    placeholder="Jane Rivera"
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
            name="email"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Work email</FormLabel>
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
                    autoComplete="new-password"
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
            {submitting ? "Creating account…" : "Create account"}
          </Button>
        </form>
      </Form>
    </AuthShell>
  );
}
