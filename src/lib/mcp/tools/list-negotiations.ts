import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { errorResult, jsonResult, supabaseForUser, unauthenticated } from "../supabase";

export default defineTool({
  name: "list_negotiations",
  title: "List negotiations",
  description:
    "List the signed-in user's negotiations, most recent first. Returns id, title, vertical, workflow_status, moving_date, and created_at.",
  inputSchema: {
    limit: z
      .number()
      .int()
      .min(1)
      .max(100)
      .optional()
      .describe("Max negotiations to return (default 25)."),
    status: z
      .string()
      .optional()
      .describe("Optional workflow_status filter, e.g. DRAFT, IN_NEGOTIATION."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ limit, status }, ctx) => {
    if (!ctx.isAuthenticated()) return unauthenticated();
    let q = supabaseForUser(ctx)
      .from("negotiations")
      .select("id, title, vertical, workflow_status, moving_date, created_at")
      .order("created_at", { ascending: false })
      .limit(limit ?? 25);
    if (status) q = q.eq("workflow_status", status);
    const { data, error } = await q;
    if (error) return errorResult(error.message);
    return jsonResult(data ?? []);
  },
});
