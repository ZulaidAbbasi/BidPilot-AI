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
    <div className="relative min-h-screen overflow-hidden bg-background text-foreground">
      {/* soft warm ambient background */}
      <div className="pointer-events-none fixed inset-0 -z-10">
        <div className="absolute inset-0 soft-grid-bg opacity-70" />
        <div
          className="absolute -top-40 left-1/3 h-[640px] w-[900px] rounded-full blur-3xl"
          style={{
            background:
              "radial-gradient(closest-side, color-mix(in oklab, var(--primary) 20%, transparent), transparent 70%)",
          }}
        />
        <div
          className="absolute bottom-0 right-0 h-[520px] w-[520px] rounded-full blur-3xl"
          style={{
            background:
              "radial-gradient(closest-side, color-mix(in oklab, var(--verified) 18%, transparent), transparent 70%)",
          }}
        />
      </div>

      <div className="grid min-h-screen grid-rows-[auto_1fr] lg:grid-cols-2 lg:grid-rows-1">
        <div className="flex items-center justify-between gap-3 border-b border-border px-6 py-4 lg:flex-col lg:items-start lg:justify-between lg:border-b-0 lg:border-r lg:px-12 lg:py-12">
          <Link
            to="/"
            className="inline-flex items-center gap-2 text-sm font-medium text-foreground/85 transition hover:text-foreground"
          >
            <span className="relative inline-flex size-8 items-center justify-center rounded-lg bg-gradient-to-br from-[#4f6bff] to-[#0f9d83] text-white shadow-lg shadow-[#4f6bff]/30">
              <svg viewBox="0 0 32 32" className="size-4" fill="none" aria-hidden>
                <path d="M6 16.5L25 7l-6.5 18-4-7.5L6 16.5z" fill="currentColor" />
              </svg>
            </span>
            <span className="font-semibold tracking-tight">BidPilot AI</span>
          </Link>
          <div className="hidden max-w-md space-y-4 lg:block">
            <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-primary">
              Honest leverage
            </p>
            <p className="font-display text-4xl leading-[1.05] tracking-tight text-foreground">
              One confirmed spec. <span className="italic text-foreground/80">Many providers.</span>{" "}
              <span className="text-primary">Verified offers.</span>
            </p>
            <p className="text-sm text-muted-foreground">
              BidPilot AI negotiates only with what actually happened on a call.
            </p>
          </div>
          <p className="hidden text-xs text-muted-foreground lg:block">
            Every negotiation is recorded, transcribed, and citation-ready.
          </p>
        </div>

        <div className="flex items-start justify-center px-6 py-10 sm:px-10 lg:items-center lg:py-12">
          <div className="w-full max-w-sm">
            <h1 className="font-display text-4xl font-semibold tracking-tight">{title}</h1>
            {subtitle && <p className="mt-2 text-sm text-muted-foreground">{subtitle}</p>}
            <div className="mt-8">{children}</div>
            {footer && <div className="mt-6 text-sm text-muted-foreground">{footer}</div>}
          </div>
        </div>
      </div>
    </div>
  );
}
