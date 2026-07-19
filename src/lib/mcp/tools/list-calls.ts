import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { errorResult, jsonResult, supabaseForUser, unauthenticated } from "../supabase";

export default defineTool({
  name: "list_calls",
  title: "List calls",
  description:
    "List agent calls (provider rehearsals and live calls) for a negotiation, including outcomes and status.",
  inputSchema: {
    negotiation_id: z.string().uuid().describe("UUID of the negotiation."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ negotiation_id }, ctx) => {
    if (!ctx.isAuthenticated()) return unauthenticated();
    const { data, error } = await supabaseForUser(ctx)
      .from("calls")
      .select("*")
      .eq("negotiation_id", negotiation_id)
      .order("created_at", { ascending: false });
    if (error) return errorResult(error.message);
    return jsonResult(data ?? []);
  },
});
