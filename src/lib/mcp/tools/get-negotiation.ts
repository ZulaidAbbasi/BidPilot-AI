import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { errorResult, jsonResult, supabaseForUser, unauthenticated } from "../supabase";

export default defineTool({
  name: "get_negotiation",
  title: "Get negotiation",
  description:
    "Fetch a single negotiation the user owns, including the latest confirmed job spec version and current workflow status.",
  inputSchema: {
    negotiation_id: z.string().uuid().describe("UUID of the negotiation."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ negotiation_id }, ctx) => {
    if (!ctx.isAuthenticated()) return unauthenticated();
    const sb = supabaseForUser(ctx);
    const [neg, spec] = await Promise.all([
      sb.from("negotiations").select("*").eq("id", negotiation_id).maybeSingle(),
      sb
        .from("job_specs")
        .select("id, version, sha256, created_at")
        .eq("negotiation_id", negotiation_id)
        .order("version", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);
    if (neg.error) return errorResult(neg.error.message);
    if (!neg.data) return errorResult("Negotiation not found");
    return jsonResult({ negotiation: neg.data, latest_confirmed_spec: spec.data ?? null });
  },
});
