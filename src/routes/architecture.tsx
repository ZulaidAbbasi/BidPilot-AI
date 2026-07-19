import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowRight,
  ArrowUpRight,
  ClipboardList,
  FileCheck2,
  PhoneCall,
  Scale,
  Handshake,
  FileBarChart2,
} from "lucide-react";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/architecture")({
  head: () => ({
    meta: [
      { title: "How it works — BidPilot AI" },
      {
        name: "description",
        content:
          "How BidPilot AI turns one confirmed moving spec into verified competing quotes and honest negotiation leverage.",
      },
    ],
  }),
  component: ArchitecturePage,
});

const stages = [
  {
    n: "01",
    icon: ClipboardList,
    title: "Intake",
    body: "Structured capture of inventory, access, dates, and services. Nothing is inferred silently — every ambiguity is surfaced as amber for you to resolve.",
    highlight: "12 structured fields",
    accent: "from-emerald-400/25",
  },
  {
    n: "02",
    icon: FileCheck2,
    title: "Specification",
    body: "One canonical spec is confirmed and hashed. Every provider quotes against the exact same document — no moving targets, no scope drift.",
    highlight: "SHA-256 spec hash",
    accent: "from-teal-400/25",
  },
  {
    n: "03",
    icon: PhoneCall,
    title: "Provider outreach",
    body: "AI voice agent places outbound calls, requests itemized quotes, and captures every line with recording-level provenance.",
    highlight: "Live-recorded calls",
    accent: "from-sky-400/25",
  },
  {
    n: "04",
    icon: Scale,
    title: "Quote normalization",
    body: "Line items, surcharges, valuation, and fine print are aligned across providers so you compare like-for-like — not apples to invoices.",
    highlight: "Line-by-line diff",
    accent: "from-violet-400/25",
  },
  {
    n: "05",
    icon: Handshake,
    title: "Negotiation",
    body: "AI calls back citing only verified competing offers. No invented numbers, no fabricated leverage, no bluffs the agent can't defend.",
    highlight: "Cited leverage only",
    accent: "from-amber-400/25",
  },
  {
    n: "06",
    icon: FileBarChart2,
    title: "Report",
    body: "Final offers with a full audit trail — which claim came from which call, where uncertainty sits, and where risk still remains.",
    highlight: "Every claim cited",
    accent: "from-rose-400/25",
  },
];

function ArchitecturePage() {
  return (
    <div className="min-h-screen bg-[#0B1020] text-white overflow-x-hidden">
      {/* ambient */}
      <div className="pointer-events-none fixed inset-0 -z-10">
        <div className="absolute -top-40 left-1/3 h-[640px] w-[900px] rounded-full bg-[radial-gradient(closest-side,rgba(16,185,129,0.18),transparent_70%)] blur-3xl" />
        <div className="absolute bottom-0 right-0 h-[520px] w-[520px] rounded-full bg-[radial-gradient(closest-side,rgba(79,70,229,0.22),transparent_70%)] blur-3xl" />
        <div
          className="absolute inset-0 opacity-[0.04]"
          style={{
            backgroundImage:
              "linear-gradient(rgba(255,255,255,0.6) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,0.6) 1px,transparent 1px)",
            backgroundSize: "56px 56px",
            maskImage:
              "radial-gradient(ellipse at 40% 10%, black 30%, transparent 70%)",
          }}
        />
      </div>

      <header className="sticky top-0 z-30 border-b border-white/10 bg-[#0B1020]/70 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <Link
            to="/"
            className="inline-flex items-center gap-2 text-sm text-white/80 transition hover:text-white"
          >
            <span className="inline-flex size-7 items-center justify-center rounded-lg bg-white/10 ring-1 ring-white/15">
              <svg
                viewBox="0 0 32 32"
                className="size-4"
                fill="none"
                aria-hidden
              >
                <path
                  d="M6 16.5L25 7l-6.5 18-4-7.5L6 16.5z"
                  fill="currentColor"
                />
                <path
                  d="M14.5 17.5L25 7"
                  stroke="#34d399"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>
            </span>
            <span className="font-semibold tracking-tight">BidPilot AI</span>
          </Link>
          <Button
            asChild
            size="sm"
            className="bg-white text-[#0B1020] hover:bg-white/90"
          >
            <Link to="/app">
              Open workspace <ArrowUpRight className="ml-1 size-3.5" />
            </Link>
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 pb-24 pt-20 sm:px-6 sm:pt-28">
        {/* Hero */}
        <div className="max-w-3xl">
          <p className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.04] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-white/70 backdrop-blur">
            How it works
          </p>
          <h1 className="mt-6 font-display font-semibold text-white text-[52px] leading-[0.98] tracking-tight sm:text-[64px]">
            One spec.{" "}
            <span className="italic text-white/95">Many providers.</span>
            <br />
            <span className="bg-gradient-to-r from-emerald-300 to-teal-300 bg-clip-text text-transparent">
              Verified leverage.
            </span>
          </h1>
          <p className="mt-6 max-w-2xl text-[17px] leading-relaxed text-white/70">
            BidPilot AI never invents pricing, quotes, or transcripts. Every
            negotiation move is grounded in something a provider actually said
            on a recorded call. Here's the pipeline, end to end.
          </p>
        </div>

        {/* Timeline */}
        <ol className="relative mt-20 space-y-6">
          <div
            aria-hidden
            className="absolute left-6 top-4 hidden h-[calc(100%-2rem)] w-px bg-gradient-to-b from-white/20 via-white/10 to-transparent sm:block lg:left-10"
          />
          {stages.map((s, i) => (
            <li key={s.n} className="relative">
              <div className="grid gap-6 sm:grid-cols-[auto_1fr] sm:gap-8 lg:grid-cols-[80px_1fr]">
                {/* number bubble */}
                <div className="relative flex sm:justify-center">
                  <div className="relative z-10 flex size-12 items-center justify-center rounded-2xl border border-white/15 bg-[#0B1020] font-display text-lg text-emerald-300 shadow-[0_0_0_4px_rgba(11,16,32,1)]">
                    {s.n}
                  </div>
                </div>

                {/* card */}
                <div
                  className="group relative overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03] p-6 transition hover:border-white/20 hover:bg-white/[0.05] sm:p-7"
                  style={{
                    transform: i % 2 === 1 ? "translateX(0)" : undefined,
                  }}
                >
                  <div
                    className={`pointer-events-none absolute inset-x-0 -top-24 h-48 bg-gradient-to-b ${s.accent} to-transparent opacity-60 transition group-hover:opacity-100`}
                  />
                  <div className="relative flex flex-wrap items-start justify-between gap-4">
                    <div className="max-w-xl">
                      <div className="flex items-center gap-2.5">
                        <s.icon className="size-4 text-white/70" />
                        <h2 className="font-display text-2xl font-semibold tracking-tight text-white sm:text-3xl">
                          {s.title}
                        </h2>
                      </div>
                      <p className="mt-3 text-[15px] leading-relaxed text-white/65">
                        {s.body}
                      </p>
                    </div>
                    <span className="rounded-full border border-emerald-400/25 bg-emerald-400/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-emerald-300">
                      {s.highlight}
                    </span>
                  </div>
                </div>
              </div>
            </li>
          ))}
        </ol>

        {/* Signal rules */}
        <section className="mt-24">
          <div className="max-w-2xl">
            <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-emerald-400">
              Signal rules
            </p>
            <h2 className="mt-3 font-display font-semibold text-white text-4xl tracking-tight sm:text-5xl">
              Green is earned. Amber is honest. Red is loud.
            </h2>
          </div>
          <div className="mt-10 grid gap-4 sm:grid-cols-3">
            <SignalCard
              tone="verified"
              title="Emerald · Verified"
              text="Claim captured and confirmed on a recorded call. The transcript backs it up, word for word."
            />
            <SignalCard
              tone="warn"
              title="Amber · Uncertain"
              text="Provider hedged, refused to itemize, or gave a non-binding number. We surface it, we don't hide it."
            />
            <SignalCard
              tone="risk"
              title="Red · Risk"
              text="Hidden-fee pattern or contradiction with a prior statement. Fix it before signing anything."
            />
          </div>
        </section>

        {/* CTA */}
        <section className="mt-24 overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-white/[0.06] via-white/[0.03] to-transparent p-10 sm:p-14">
          <div className="grid gap-8 lg:grid-cols-[1.2fr_1fr] lg:items-center">
            <div>
              <h2 className="font-display font-semibold text-white text-4xl leading-[1.05] tracking-tight sm:text-5xl">
                Ready to negotiate with receipts?
              </h2>
              <p className="mt-4 max-w-xl text-white/65">
                Set up a negotiation, confirm your spec, and let BidPilot handle
                the calls. You review verified offers, not vibes.
              </p>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row lg:justify-end">
              <Button
                asChild
                size="lg"
                className="h-12 rounded-full bg-white px-6 text-[15px] font-semibold text-[#0B1020] hover:bg-white/90"
              >
                <Link to="/signup">
                  Start free <ArrowRight className="ml-1 size-4" />
                </Link>
              </Button>
              <Button
                asChild
                size="lg"
                variant="ghost"
                className="h-12 rounded-full border border-white/15 bg-white/[0.03] px-6 text-white hover:bg-white/[0.08]"
              >
                <Link to="/">Back to home</Link>
              </Button>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-white/10">
        <div className="mx-auto max-w-6xl px-4 py-8 text-xs text-white/45 sm:px-6">
          BidPilot AI · Every negotiation is recorded, transcribed, and
          citation-ready.
        </div>
      </footer>
    </div>
  );
}

function SignalCard({
  tone,
  title,
  text,
}: {
  tone: "verified" | "warn" | "risk";
  title: string;
  text: string;
}) {
  const config = {
    verified: {
      ring: "border-emerald-400/25",
      glow: "from-emerald-400/20",
      dot: "bg-emerald-400",
      badge: "text-emerald-300",
    },
    warn: {
      ring: "border-amber-400/25",
      glow: "from-amber-400/20",
      dot: "bg-amber-400",
      badge: "text-amber-300",
    },
    risk: {
      ring: "border-rose-400/25",
      glow: "from-rose-400/20",
      dot: "bg-rose-400",
      badge: "text-rose-300",
    },
  }[tone];
  return (
    <div
      className={`group relative overflow-hidden rounded-2xl border bg-white/[0.03] p-6 transition hover:bg-white/[0.05] ${config.ring}`}
    >
      <div
        className={`pointer-events-none absolute inset-x-0 -top-16 h-40 bg-gradient-to-b ${config.glow} to-transparent opacity-70 transition group-hover:opacity-100`}
      />
      <div className="relative">
        <div className="flex items-center gap-2">
          <span className={`size-2 rounded-full ${config.dot}`} />
          <p className={`text-[13px] font-semibold ${config.badge}`}>{title}</p>
        </div>
        <p className="mt-3 text-[14px] leading-relaxed text-white/70">{text}</p>
      </div>
    </div>
  );
}
