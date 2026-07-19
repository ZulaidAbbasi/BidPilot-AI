import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
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

const schema = z
  .object({
    password: z.string().min(8, "At least 8 characters"),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, {
    path: ["confirm"],
    message: "Passwords do not match",
  });

export const Route = createFileRoute("/reset-password")({
  head: () => ({ meta: [{ title: "Set new password — BidPilot AI" }] }),
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  const navigate = useNavigate();
  const { updatePassword } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { password: "", confirm: "" },
  });

  return (
    <AuthShell
      title="Set a new password"
      subtitle="Choose a strong password you haven't used before."
    >
      <Form {...form}>
        <form
          onSubmit={form.handleSubmit(async ({ password }) => {
            setError(null);
            setSubmitting(true);
            const { error: err } = await updatePassword(password);
            setSubmitting(false);
            if (err) return setError(err);
            toast.success("Password updated");
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
            name="password"
            render={({ field }) => (
              <FormItem>
                <FormLabel>New password</FormLabel>
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
          <FormField
            control={form.control}
            name="confirm"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Confirm password</FormLabel>
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
            {submitting ? "Saving…" : "Save password"}
          </Button>
        </form>
      </Form>
    </AuthShell>
  );
}
