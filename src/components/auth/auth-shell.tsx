import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

export function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="grid min-h-screen grid-rows-[auto_1fr] bg-background lg:grid-cols-2 lg:grid-rows-1">
      <div className="flex items-center justify-between gap-3 border-b border-border/70 bg-navy px-6 py-4 text-primary-foreground lg:flex-col lg:justify-between lg:border-b-0 lg:border-r lg:px-12 lg:py-12">
        <Link
          to="/"
          className="inline-flex items-center gap-2 text-sm font-medium opacity-90 hover:opacity-100"
        >
          <span className="inline-flex size-6 items-center justify-center rounded bg-primary-foreground/10">
            <svg
              viewBox="0 0 24 24"
              className="size-3.5"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path d="M4 17l6-6 4 4 6-8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          BidPilot AI
        </Link>
        <div className="hidden max-w-md space-y-4 lg:block">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] opacity-70">
            Honest leverage
          </p>
          <p className="font-display text-3xl leading-tight">
            One confirmed spec. Multiple providers. Verified competing offers.
          </p>
          <p className="text-sm opacity-80">
            BidPilot AI negotiates only with what actually happened on a call.
          </p>
        </div>
        <p className="hidden text-xs opacity-60 lg:block">
          Frontend preview · Not connected to external services.
        </p>
      </div>

      <div className="flex items-start justify-center px-6 py-10 sm:px-10 lg:items-center lg:py-12">
        <div className="w-full max-w-sm">
          <h1 className="font-display text-3xl tracking-tight">{title}</h1>
          {subtitle && <p className="mt-2 text-sm text-muted-foreground">{subtitle}</p>}
          <div className="mt-8">{children}</div>
          {footer && <div className="mt-6 text-sm text-muted-foreground">{footer}</div>}
        </div>
      </div>
    </div>
  );
}
