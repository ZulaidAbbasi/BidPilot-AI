import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { errorResult, jsonResult, supabaseForUser, unauthenticated } from "../supabase";

export default defineTool({
  name: "recent_agent_events",
  title: "Recent agent events",
  description:
    "Return recent agent events for a negotiation — useful to summarize what the negotiation agent has been doing.",
  inputSchema: {
    negotiation_id: z.string().uuid().describe("UUID of the negotiation."),
    limit: z
      .number()
      .int()
      .min(1)
      .max(100)
      .optional()
      .describe("Max events to return (default 20)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ negotiation_id, limit }, ctx) => {
    if (!ctx.isAuthenticated()) return unauthenticated();
    const { data, error } = await supabaseForUser(ctx)
      .from("agent_events")
      .select("*")
      .eq("negotiation_id", negotiation_id)
      .order("created_at", { ascending: false })
      .limit(limit ?? 20);
    if (error) return errorResult(error.message);
    return jsonResult(data ?? []);
  },
});
