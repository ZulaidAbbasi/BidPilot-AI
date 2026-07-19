import { createFileRoute } from "@tanstack/react-router";
import { ConversationProvider } from "@elevenlabs/react";
import { AgentControlRoom } from "@/components/app/control-room/control-room";

export const Route = createFileRoute("/app/negotiations/$id/control-room")({
  head: () => ({ meta: [{ title: "Agent Control Room — BidPilot AI" }] }),
  component: ControlRoomPage,
});

function ControlRoomPage() {
  const { id } = Route.useParams();
  return (
    <ConversationProvider>
      <AgentControlRoom negotiationId={id} />
    </ConversationProvider>
  );
}
