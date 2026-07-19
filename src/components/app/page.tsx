import type { ReactNode } from "react";

export function PageHeader({
  title,
  description,
  actions,
  eyebrow,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  eyebrow?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4 border-b border-border bg-background px-5 py-7 sm:flex-row sm:items-end sm:justify-between sm:px-10 sm:py-9">
      <div className="min-w-0">
        {eyebrow && (
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
            {eyebrow}
          </p>
        )}
        <h1 className="mt-1.5 truncate text-[26px] font-semibold tracking-tight sm:text-[30px]">
          {title}
        </h1>
        {description && (
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function PageBody({
  children,
  narrow = false,
}: {
  children: ReactNode;
  narrow?: boolean;
}) {
  return (
    <div
      className={`px-5 py-7 sm:px-10 sm:py-9 ${narrow ? "mx-auto max-w-3xl" : ""}`}
    >
      {children}
    </div>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card px-6 py-16 text-center">
      <div className="flex size-12 items-center justify-center rounded-xl bg-muted text-muted-foreground ring-1 ring-border/60">
        <Icon className="size-5" />
      </div>
      <h3 className="mt-4 text-base font-semibold">{title}</h3>
      <p className="mt-1.5 max-w-md text-sm leading-relaxed text-muted-foreground">{description}</p>
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}

export function LoadingState({ label = "Loading" }: { label?: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center gap-3 rounded-xl border border-border bg-card px-5 py-10 text-sm text-muted-foreground"
    >
      <span className="inline-flex size-4 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-foreground" />
      {label}…
    </div>
  );
}

export function ErrorState({
  title = "Something went wrong",
  description = "Try again in a moment.",
  onRetry,
}: {
  title?: string;
  description?: string;
  onRetry?: () => void;
}) {
  return (
    <div className="rounded-xl border border-risk/40 bg-risk-soft/70 px-5 py-6">
      <p className="text-sm font-semibold text-navy">{title}</p>
      <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-3 inline-flex items-center rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium hover:bg-accent"
        >
          Try again
        </button>
      )}
    </div>
  );
}
