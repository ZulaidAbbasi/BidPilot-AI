import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { errorResult, jsonResult, supabaseForUser, unauthenticated } from "../supabase";

export default defineTool({
  name: "list_quotes",
  title: "List quotes",
  description:
    "List saved quotes for a negotiation, including line items. Useful for comparing providers and computing verified savings.",
  inputSchema: {
    negotiation_id: z.string().uuid().describe("UUID of the negotiation."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ negotiation_id }, ctx) => {
    if (!ctx.isAuthenticated()) return unauthenticated();
    const sb = supabaseForUser(ctx);
    const { data: quotes, error } = await sb
      .from("quotes")
      .select("*, quote_line_items(*)")
      .eq("negotiation_id", negotiation_id)
      .order("created_at", { ascending: false });
    if (error) return errorResult(error.message);
    return jsonResult(quotes ?? []);
  },
});
