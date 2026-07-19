import type { ReactNode } from "react";

export function StatusBadge({
  tone,
  children,
}: {
  tone: "verified" | "warn" | "risk" | "neutral" | "live";
  children: ReactNode;
}) {
  const styles: Record<string, string> = {
    verified: "bg-verified-soft text-verified border-verified/30",
    warn: "bg-warn-soft text-warn-foreground border-warn/40",
    risk: "bg-risk-soft text-risk border-risk/30",
    neutral: "bg-muted text-muted-foreground border-border",
    live: "bg-live-soft text-live border-live/30",
  };
  const dot: Record<string, string> = {
    verified: "bg-verified",
    warn: "bg-warn",
    risk: "bg-risk",
    neutral: "bg-muted-foreground/60",
    live: "bg-live",
  };
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium tabular-nums ${styles[tone]}`}
    >
      <span className={`status-dot ${dot[tone]}`} aria-hidden />
      {children}
    </span>
  );
}
