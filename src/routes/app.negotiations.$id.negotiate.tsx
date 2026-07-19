import { createFileRoute } from "@tanstack/react-router";
import { PageBody, EmptyState } from "@/components/app/page";
import { Handshake } from "lucide-react";

export const Route = createFileRoute("/app/negotiations/$id/negotiate")({
  head: () => ({ meta: [{ title: "Negotiate — BidPilot AI" }] }),
  component: NegotiatePage,
});

function NegotiatePage() {
  return (
    <PageBody>
      <EmptyState
        icon={Handshake}
        title="Negotiation not started"
        description="Once at least two comparable quotes exist, BidPilot can call providers back and cite verified competing offers. No fabricated numbers."
      />
    </PageBody>
  );
}
