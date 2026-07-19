import { createFileRoute } from "@tanstack/react-router";
import { ConversationProvider } from "@elevenlabs/react";
import { AgentControlRoom } from "@/components/app/control-room/control-room";

type ControlRoomSearch = {
  providerId?: string;
  callMode?: "QUOTE_GATHERING" | "NEGOTIATION";
  leverageQuoteId?: string;
};

export const Route = createFileRoute("/app/negotiations/$id/control-room")({
  head: () => ({ meta: [{ title: "Agent Control Room — BidPilot AI" }] }),
  validateSearch: (search: Record<string, unknown>): ControlRoomSearch => {
    const out: ControlRoomSearch = {};
    if (typeof search.providerId === "string") out.providerId = search.providerId;
    if (search.callMode === "QUOTE_GATHERING" || search.callMode === "NEGOTIATION") {
      out.callMode = search.callMode;
    }
    if (typeof search.leverageQuoteId === "string") {
      out.leverageQuoteId = search.leverageQuoteId;
    }
    return out;
  },
  component: ControlRoomPage,
});

function ControlRoomPage() {
  const { id } = Route.useParams();
  const { providerId } = Route.useSearch();
  return (
    <ConversationProvider>
      <AgentControlRoom negotiationId={id} initialProviderId={providerId ?? null} />
    </ConversationProvider>
  );
}
