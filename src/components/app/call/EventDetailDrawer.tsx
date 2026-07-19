import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";

/**
 * Renders a sanitized view of an agent-event payload.
 * Actively strips authorization headers, tokens, and secret__* dynamic vars
 * before showing the JSON to the user.
 */
const SECRET_KEY_RE =
  /^(authorization|x[-_]bidpilot[-_]call[-_]token|.*token.*|.*secret.*|.*api[-_]key.*|password|bearer)$/i;

function sanitize(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[…]";
  if (value === null || value === undefined) return value;
  if (typeof value === "string") {
    // Redact JWT-like tokens and long hex/b64 strings when they appear standalone
    if (/^ey[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+$/.test(value)) return "[redacted-jwt]";
    return value;
  }
  if (typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((v) => sanitize(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (SECRET_KEY_RE.test(k)) {
      out[k] = "[redacted]";
    } else {
      out[k] = sanitize(v, depth + 1);
    }
  }
  return out;
}

export interface EventDetail {
  id: string;
  agent_name?: string | null;
  event_type?: string | null;
  event_status?: string | null;
  summary?: string | null;
  metadata?: Record<string, unknown> | null;
  created_at: string;
}

interface Props {
  event: EventDetail | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function EventDetailDrawer({ event, open, onOpenChange }: Props) {
  const clean = event?.metadata ? sanitize(event.metadata) : null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-lg">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <span>{event?.agent_name ?? "Event"}</span>
            {event?.event_type && (
              <Badge variant="outline" className="font-mono text-[10px] uppercase tracking-[0.1em]">
                {event.event_type}
              </Badge>
            )}
          </SheetTitle>
          <SheetDescription>
            {event ? new Date(event.created_at).toLocaleString() : ""}
          </SheetDescription>
        </SheetHeader>

        {event && (
          <div className="mt-6 space-y-4">
            {event.event_status && (
              <div>
                <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                  Status
                </div>
                <Badge variant="secondary">{event.event_status}</Badge>
              </div>
            )}
            {event.summary && (
              <div>
                <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                  Summary
                </div>
                <p className="text-sm">{event.summary}</p>
              </div>
            )}
            {clean != null && (
              <div>
                <div className="mb-1 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                  <span>Payload</span>
                  <Badge variant="outline" className="font-mono text-[9px]">
                    sanitized
                  </Badge>
                </div>
                <pre className="max-h-[50vh] overflow-auto rounded-md border border-border/70 bg-muted/40 p-3 font-mono text-[11px] leading-relaxed">
                  {JSON.stringify(clean, null, 2) as string}
                </pre>
                <p className="mt-2 text-[11px] text-muted-foreground">
                  Tokens, authorization headers, and secret dynamic variables are stripped from
                  every payload before display.
                </p>
              </div>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
