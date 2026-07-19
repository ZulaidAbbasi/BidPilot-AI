import { auth, defineMcp } from "@lovable.dev/mcp-js";
import listNegotiations from "./tools/list-negotiations";
import getNegotiation from "./tools/get-negotiation";
import listProviders from "./tools/list-providers";
import listQuotes from "./tools/list-quotes";
import listCalls from "./tools/list-calls";
import recentAgentEvents from "./tools/recent-agent-events";

const projectRef = import.meta.env.VITE_SUPABASE_PROJECT_ID ?? "project-ref-unset";

export default defineMcp({
  name: "bidpilot-ai-mcp",
  title: "BidPilot AI",
  version: "0.1.0",
  instructions:
    "Tools for the BidPilot AI negotiation workspace. Read the signed-in user's negotiations, providers, quotes, calls, and agent events to help them prepare, negotiate, and finalize moving deals. All tools act as the authenticated user via RLS — never invent negotiation ids.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [
    listNegotiations,
    getNegotiation,
    listProviders,
    listQuotes,
    listCalls,
    recentAgentEvents,
  ],
});
