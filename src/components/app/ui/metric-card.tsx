import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

export function MetricCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = "default",
  trend,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon?: LucideIcon;
  tone?: "default" | "verified" | "warn" | "risk" | "live";
  trend?: ReactNode;
}) {
  const accent =
    tone === "verified"
      ? "text-verified"
      : tone === "warn"
        ? "text-warn-foreground"
        : tone === "risk"
          ? "text-risk"
          : tone === "live"
            ? "text-live"
            : "text-navy";
  const iconWrap =
    tone === "verified"
      ? "bg-verified-soft text-verified"
      : tone === "warn"
        ? "bg-warn-soft text-warn-foreground"
        : tone === "risk"
          ? "bg-risk-soft text-risk"
          : tone === "live"
            ? "bg-live-soft text-live"
            : "bg-muted text-navy-soft";
  return (
    <div className="group relative flex flex-col gap-3 rounded-xl border border-border bg-card p-5 shadow-[var(--shadow-card)] transition-colors hover:border-navy/20">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          {label}
        </span>
        {Icon && (
          <span className={`inline-flex size-7 items-center justify-center rounded-md ${iconWrap}`}>
            <Icon className="size-3.5" />
          </span>
        )}
      </div>
      <div className="flex items-baseline gap-2">
        <div className={`text-[28px] font-semibold leading-none tracking-tight tabular-nums ${accent}`}>
          {value}
        </div>
        {trend && <span className="text-xs text-muted-foreground">{trend}</span>}
      </div>
      {hint && <div className="text-xs leading-relaxed text-muted-foreground">{hint}</div>}
    </div>
  );
}
