import { createFileRoute, Link } from "@tanstack/react-router";
import { PageBody } from "@/components/app/page";
import { SpecImportPanel } from "@/components/app/spec-import";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FileText, MicVocal, ClipboardList } from "lucide-react";

export const Route = createFileRoute("/app/negotiations/$id/intake")({
  head: () => ({ meta: [{ title: "Intake — BidPilot AI" }] }),
  component: IntakePage,
});

function IntakePage() {
  const { id } = Route.useParams();
  return (
    <PageBody>
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ClipboardList className="h-4 w-4" /> Multi-input intake
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <p>
              Populate the canonical specification from any combination of manual entry, a document
              upload, or a voice intake session. Every source writes into the same draft — you
              always review and confirm before providers see it.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button asChild variant="outline" size="sm">
                <Link to="/app/negotiations/$id/specification" params={{ id }}>
                  <FileText className="mr-1.5 h-3.5 w-3.5" /> Open specification editor
                </Link>
              </Button>
              <Button asChild variant="outline" size="sm">
                <Link to="/app/negotiations/$id/voice-intake" params={{ id }}>
                  <MicVocal className="mr-1.5 h-3.5 w-3.5" /> Start voice intake
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>

        <SpecImportPanel negotiationId={id} />
      </div>
    </PageBody>
  );
}
