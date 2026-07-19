import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { errorResult, jsonResult, supabaseForUser, unauthenticated } from "../supabase";

export default defineTool({
  name: "list_providers",
  title: "List providers",
  description: "List providers attached to a negotiation the user owns.",
  inputSchema: {
    negotiation_id: z.string().uuid().describe("UUID of the negotiation."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ negotiation_id }, ctx) => {
    if (!ctx.isAuthenticated()) return unauthenticated();
    const { data, error } = await supabaseForUser(ctx)
      .from("providers")
      .select("*")
      .eq("negotiation_id", negotiation_id)
      .order("created_at", { ascending: true });
    if (error) return errorResult(error.message);
    return jsonResult(data ?? []);
  },
});
