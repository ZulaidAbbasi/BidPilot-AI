import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowRight,
  PhoneCall,
  ShieldCheck,
  ScrollText,
  GitCompareArrows,
  Sparkles,
  Check,
  Waves,
} from "lucide-react";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "BidPilot AI — Real quotes. Honest leverage. Better deals." },
      {
        name: "description",
        content:
          "AI voice-negotiation platform for moving services. One confirmed spec. Multiple providers. Itemized quotes. Honest leverage.",
      },
    ],
  }),
  component: LandingPage,
});

function LandingPage() {
  return (
    <div className="min-h-screen bg-[#0B1020] text-white overflow-x-hidden">
      {/* ambient background */}
      <div className="pointer-events-none fixed inset-0 -z-10">
        <div className="absolute -top-40 left-1/2 h-[720px] w-[1200px] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,rgba(16,185,129,0.22),transparent_70%)] blur-2xl" />
        <div className="absolute top-1/3 -left-40 h-[520px] w-[520px] rounded-full bg-[radial-gradient(closest-side,rgba(79,70,229,0.25),transparent_70%)] blur-3xl" />
        <div className="absolute bottom-0 right-0 h-[420px] w-[420px] rounded-full bg-[radial-gradient(closest-side,rgba(245,158,11,0.18),transparent_70%)] blur-3xl" />
        <div
          className="absolute inset-0 opacity-[0.05]"
          style={{
            backgroundImage:
              "linear-gradient(rgba(255,255,255,0.6) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,0.6) 1px,transparent 1px)",
            backgroundSize: "56px 56px",
            maskImage:
              "radial-gradient(ellipse at 50% 20%, black 30%, transparent 70%)",
          }}
        />
      </div>

      {/* Nav */}
      <header className="sticky top-0 z-30 border-b border-white/10 bg-[#0B1020]/70 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <Link to="/" className="flex items-center gap-2.5">
            <Logo />
            <span className="text-[15px] font-semibold tracking-tight">
              BidPilot <span className="text-emerald-400">AI</span>
            </span>
          </Link>
          <nav className="hidden items-center gap-7 text-sm text-white/70 md:flex">
            <Link to="/architecture" className="transition hover:text-white">
              How it works
            </Link>
            <a href="#signals" className="transition hover:text-white">
              Signals
            </a>
            <a href="#proof" className="transition hover:text-white">
              Proof
            </a>
            <Link to="/login" className="transition hover:text-white">
              Log in
            </Link>
            <Button
              asChild
              size="sm"
              className="bg-white text-[#0B1020] hover:bg-white/90"
            >
              <Link to="/signup">Get started</Link>
            </Button>
          </nav>
          <div className="md:hidden">
            <Button
              asChild
              size="sm"
              className="bg-white text-[#0B1020] hover:bg-white/90"
            >
              <Link to="/signup">Start</Link>
            </Button>
          </div>
        </div>
      </header>

      <main>
        {/* Hero */}
        <section className="relative mx-auto max-w-6xl px-4 pb-24 pt-16 sm:px-6 sm:pt-24 lg:pt-28">
          <div className="grid gap-14 lg:grid-cols-[1.05fr_1fr] lg:items-center lg:gap-12">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.04] px-3 py-1 text-[11px] font-medium uppercase tracking-[0.18em] text-white/70 backdrop-blur">
                <span className="relative flex size-1.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex size-1.5 rounded-full bg-emerald-400" />
                </span>
                Live voice negotiation
              </div>

              <h1 className="mt-6 font-display font-semibold text-white text-[54px] leading-[0.98] tracking-tight sm:text-[68px] lg:text-[78px]">
                Real quotes.
                <br />
                <span className="italic text-white/95">Honest</span>{" "}
                <span className="bg-gradient-to-r from-emerald-300 via-emerald-400 to-teal-300 bg-clip-text text-transparent">
                  leverage.
                </span>
                <br />
                Better deals.
              </h1>

              <p className="mt-6 max-w-xl text-[17px] leading-relaxed text-white/70">
                BidPilot confirms one moving spec, calls every provider, captures
                itemized quotes on the line, and negotiates back using{" "}
                <span className="text-white">verified competing offers</span> —
                never invented ones.
              </p>

              <div className="mt-9 flex flex-wrap items-center gap-3">
                <Button
                  asChild
                  size="lg"
                  className="group h-12 rounded-full bg-white px-6 text-[15px] font-semibold text-[#0B1020] shadow-[0_10px_40px_-10px_rgba(255,255,255,0.4)] hover:bg-white/90"
                >
                  <Link to="/signup">
                    Start a negotiation
                    <ArrowRight className="ml-1 size-4 transition-transform group-hover:translate-x-0.5" />
                  </Link>
                </Button>
                <Button
                  asChild
                  size="lg"
                  variant="ghost"
                  className="h-12 rounded-full border border-white/15 bg-white/[0.03] px-6 text-[15px] text-white hover:bg-white/[0.08]"
                >
                  <Link to="/architecture">See how it works</Link>
                </Button>
              </div>

              <div className="mt-10 flex flex-wrap items-center gap-x-6 gap-y-3 text-xs text-white/50">
                <span className="inline-flex items-center gap-1.5">
                  <Check className="size-3.5 text-emerald-400" /> Recorded &
                  transcribed
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Check className="size-3.5 text-emerald-400" /> Itemized line
                  by line
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Check className="size-3.5 text-emerald-400" /> Nothing invented
                </span>
              </div>
            </div>

            {/* Live-call mockup */}
            <CallMock />
          </div>
        </section>

        {/* Marquee strip */}
        <section className="border-y border-white/10 bg-white/[0.02]">
          <div className="mx-auto flex max-w-6xl items-center gap-10 overflow-hidden px-4 py-5 text-[11px] font-semibold uppercase tracking-[0.22em] text-white/40 sm:px-6">
            <span className="shrink-0">Recorded call</span>
            <Dot />
            <span className="shrink-0">Itemized quote</span>
            <Dot />
            <span className="shrink-0">Canonical spec hash</span>
            <Dot />
            <span className="shrink-0">Verified leverage</span>
            <Dot />
            <span className="shrink-0">No fabricated numbers</span>
          </div>
        </section>

        {/* Feature quad */}
        <section id="signals" className="mx-auto max-w-6xl px-4 py-24 sm:px-6">
          <div className="max-w-2xl">
            <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-emerald-400">
              The BidPilot method
            </p>
            <h2 className="mt-3 font-display font-semibold text-white text-4xl leading-tight tracking-tight sm:text-5xl">
              Four moves. One clean win.
            </h2>
          </div>

          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[
              {
                icon: ScrollText,
                kicker: "01",
                title: "One confirmed spec",
                body: "Every provider quotes the exact same move — inventory, access, dates, services.",
                accent: "from-emerald-400/20 to-emerald-400/0",
              },
              {
                icon: PhoneCall,
                kicker: "02",
                title: "Voice outreach",
                body: "AI places outbound calls, captures itemized quotes, structures every line.",
                accent: "from-sky-400/20 to-sky-400/0",
              },
              {
                icon: GitCompareArrows,
                kicker: "03",
                title: "Side-by-side quotes",
                body: "Line items, surcharges, and fine print aligned across providers.",
                accent: "from-violet-400/25 to-violet-400/0",
              },
              {
                icon: ShieldCheck,
                kicker: "04",
                title: "Honest leverage",
                body: "Negotiation cites only verified competing offers. Zero fabrication.",
                accent: "from-amber-400/25 to-amber-400/0",
              },
            ].map(({ icon: Icon, kicker, title, body, accent }) => (
              <div
                key={title}
                className="group relative overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03] p-6 transition hover:border-white/20 hover:bg-white/[0.05]"
              >
                <div
                  className={`pointer-events-none absolute inset-x-0 -top-16 h-40 bg-gradient-to-b ${accent} opacity-70 transition group-hover:opacity-100`}
                />
                <div className="relative">
                  <div className="flex items-center justify-between">
                    <span className="font-display text-sm text-white/40">
                      {kicker}
                    </span>
                    <Icon className="size-4 text-white/60" />
                  </div>
                  <h3 className="mt-8 text-[17px] font-semibold tracking-tight">
                    {title}
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-white/60">
                    {body}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Comparison / proof */}
        <section id="proof" className="border-t border-white/10 bg-white/[0.02]">
          <div className="mx-auto grid max-w-6xl gap-12 px-4 py-24 sm:px-6 lg:grid-cols-[1fr_1.1fr] lg:items-center">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-emerald-400">
                Built on what actually happened
              </p>
              <h2 className="mt-3 font-display font-semibold text-white text-4xl leading-[1.05] tracking-tight sm:text-5xl">
                Every claim traces back to a call.
              </h2>
              <p className="mt-5 max-w-lg text-[16px] leading-relaxed text-white/65">
                Green states are earned. Amber flags mark hedging. Red flags mark
                risk. If BidPilot can't cite the recording, it doesn't say it.
              </p>

              <ul className="mt-8 space-y-3 text-sm">
                <SignalRow
                  tone="verified"
                  label="Verified"
                  text="Line item captured and confirmed on a recorded call."
                />
                <SignalRow
                  tone="warn"
                  label="Uncertain"
                  text="Operator hedged or refused to itemize the number."
                />
                <SignalRow
                  tone="risk"
                  label="Risk"
                  text="Non-binding quote or hidden-fee pattern detected."
                />
              </ul>
            </div>

            <QuoteCompare />
          </div>
        </section>

        {/* CTA */}
        <section className="mx-auto max-w-6xl px-4 py-24 sm:px-6">
          <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-white/[0.06] via-white/[0.03] to-transparent p-10 sm:p-14">
            <div className="pointer-events-none absolute -right-24 -top-24 h-64 w-64 rounded-full bg-emerald-400/20 blur-3xl" />
            <div className="pointer-events-none absolute -bottom-24 -left-24 h-64 w-64 rounded-full bg-violet-500/20 blur-3xl" />
            <div className="relative grid gap-8 lg:grid-cols-[1.2fr_1fr] lg:items-center">
              <div>
                <Sparkles className="size-6 text-emerald-400" />
                <h2 className="mt-4 font-display font-semibold text-white text-4xl leading-[1.05] tracking-tight sm:text-5xl">
                  Stop guessing.
                  <br />
                  Start negotiating with receipts.
                </h2>
                <p className="mt-4 max-w-lg text-white/65">
                  Set up a negotiation in under two minutes. BidPilot handles the
                  calls, the quotes, and the leverage.
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
                  <Link to="/login">I have an account</Link>
                </Button>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-white/10">
        <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-3 px-4 py-8 text-xs text-white/45 sm:flex-row sm:items-center sm:px-6">
          <div className="flex items-center gap-2">
            <Logo />
            <span>BidPilot AI · Real quotes. Honest leverage.</span>
          </div>
          <p>Every negotiation is recorded, transcribed, and citation-ready.</p>
        </div>
      </footer>
    </div>
  );
}

/* ---------- pieces ---------- */

function Dot() {
  return <span className="size-1 shrink-0 rounded-full bg-white/25" />;
}

function SignalRow({
  tone,
  label,
  text,
}: {
  tone: "verified" | "warn" | "risk";
  label: string;
  text: string;
}) {
  const ring =
    tone === "verified"
      ? "ring-emerald-400/40 bg-emerald-400/10 text-emerald-300"
      : tone === "warn"
        ? "ring-amber-400/40 bg-amber-400/10 text-amber-300"
        : "ring-rose-400/40 bg-rose-400/10 text-rose-300";
  return (
    <li className="flex items-start gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-4">
      <span
        className={`mt-0.5 inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ring-1 ${ring}`}
      >
        {label}
      </span>
      <p className="text-sm text-white/75">{text}</p>
    </li>
  );
}

function CallMock() {
  return (
    <div className="relative">
      {/* floating tags */}
      <div className="absolute -left-4 top-4 z-10 hidden rotate-[-4deg] rounded-xl border border-white/15 bg-[#0B1020]/80 px-3 py-2 text-[11px] font-medium text-white/80 shadow-2xl backdrop-blur sm:block">
        <span className="mr-2 inline-block size-1.5 rounded-full bg-emerald-400" />
        Provider A · $2,340 itemized
      </div>
      <div className="absolute -right-3 bottom-6 z-10 hidden rotate-[3deg] rounded-xl border border-white/15 bg-[#0B1020]/80 px-3 py-2 text-[11px] font-medium text-white/80 shadow-2xl backdrop-blur sm:block">
        <span className="mr-2 inline-block size-1.5 rounded-full bg-amber-400" />
        Provider B · hedged on packing
      </div>

      <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-b from-white/[0.06] to-white/[0.02] p-5 shadow-[0_30px_80px_-30px_rgba(0,0,0,0.7)] backdrop-blur-xl">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="relative flex size-8 items-center justify-center rounded-full bg-emerald-400/15 text-emerald-300 ring-1 ring-emerald-400/30">
              <PhoneCall className="size-4" />
              <span className="absolute -right-0.5 -top-0.5 flex size-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex size-2 rounded-full bg-emerald-400" />
              </span>
            </div>
            <div>
              <p className="text-[13px] font-semibold">Sunshine Movers</p>
              <p className="text-[11px] text-white/50">Live · 02:14</p>
            </div>
          </div>
          <div className="rounded-full bg-white/[0.06] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-white/70 ring-1 ring-white/10">
            Recording
          </div>
        </div>

        {/* waveform */}
        <div className="mt-4 flex h-10 items-end gap-[3px]">
          {Array.from({ length: 42 }).map((_, i) => {
            const h = 16 + Math.abs(Math.sin(i * 0.7)) * 22 + (i % 5) * 2;
            return (
              <span
                key={i}
                className="w-[3px] rounded-full bg-gradient-to-t from-emerald-400/30 to-emerald-300"
                style={{ height: `${h}px`, opacity: 0.5 + (i % 4) * 0.12 }}
              />
            );
          })}
        </div>

        {/* transcript */}
        <div className="mt-4 space-y-2.5">
          <Turn
            who="Agent"
            tint="text-white/90"
            body="Can you itemize the packing labor and the long-carry fee separately?"
          />
          <Turn
            who="Sunshine"
            tint="text-white/70"
            body="Packing is $480 flat. Long carry runs $1.25 a foot past 75 feet."
            chip={{ label: "Verified", tone: "verified" }}
          />
          <Turn
            who="Agent"
            tint="text-white/90"
            body="Do you charge a fuel surcharge on top of that?"
          />
          <Turn
            who="Sunshine"
            tint="text-white/70"
            body="Depends on the day — I'd have to check with dispatch."
            chip={{ label: "Uncertain", tone: "warn" }}
          />
        </div>

        {/* footer */}
        <div className="mt-5 flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.03] p-3">
          <div className="flex items-center gap-2 text-[11px] text-white/60">
            <Waves className="size-3.5 text-emerald-400" />
            8 line items captured
          </div>
          <div className="text-[11px] font-semibold text-emerald-300">
            +$412 negotiated
          </div>
        </div>
      </div>
    </div>
  );
}

function Turn({
  who,
  body,
  tint,
  chip,
}: {
  who: string;
  body: string;
  tint: string;
  chip?: { label: string; tone: "verified" | "warn" | "risk" };
}) {
  const chipCls =
    chip?.tone === "verified"
      ? "bg-emerald-400/10 text-emerald-300 ring-emerald-400/30"
      : chip?.tone === "warn"
        ? "bg-amber-400/10 text-amber-300 ring-amber-400/30"
        : "bg-rose-400/10 text-rose-300 ring-rose-400/30";
  return (
    <div className="flex items-start gap-3">
      <span className="mt-0.5 w-16 shrink-0 text-[10px] font-semibold uppercase tracking-wider text-white/40">
        {who}
      </span>
      <p className={`flex-1 text-[13px] leading-snug ${tint}`}>
        {body}
        {chip && (
          <span
            className={`ml-2 inline-flex items-center rounded-md px-1.5 py-0.5 align-middle text-[10px] font-semibold uppercase ring-1 ${chipCls}`}
          >
            {chip.label}
          </span>
        )}
      </p>
    </div>
  );
}

function QuoteCompare() {
  const providers = [
    {
      name: "Sunshine Movers",
      total: "$2,340",
      delta: "-$412",
      tone: "verified" as const,
      tag: "Itemized",
    },
    {
      name: "BlueLine Relocation",
      total: "$2,610",
      delta: "hedged",
      tone: "warn" as const,
      tag: "Non-binding",
    },
    {
      name: "GoodMove Co.",
      total: "$3,180",
      delta: "hidden fees",
      tone: "risk" as const,
      tag: "Risk flag",
    },
  ];
  return (
    <div className="relative rounded-2xl border border-white/10 bg-gradient-to-b from-white/[0.05] to-white/[0.02] p-5 shadow-[0_30px_80px_-30px_rgba(0,0,0,0.6)]">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-white/50">
          Comparison · confirmed spec #a91f
        </p>
        <span className="rounded-full bg-emerald-400/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-300 ring-1 ring-emerald-400/30">
          Same move
        </span>
      </div>

      <div className="mt-4 divide-y divide-white/10">
        {providers.map((p) => {
          const dotColor =
            p.tone === "verified"
              ? "bg-emerald-400"
              : p.tone === "warn"
                ? "bg-amber-400"
                : "bg-rose-400";
          const deltaCls =
            p.tone === "verified"
              ? "text-emerald-300"
              : p.tone === "warn"
                ? "text-amber-300"
                : "text-rose-300";
          return (
            <div key={p.name} className="flex items-center gap-4 py-3.5">
              <span className={`size-2 rounded-full ${dotColor}`} />
              <div className="flex-1">
                <p className="text-[14px] font-semibold">{p.name}</p>
                <p className="text-[11px] text-white/45">{p.tag}</p>
              </div>
              <div className="text-right">
                <p className="font-display text-lg tracking-tight">{p.total}</p>
                <p className={`text-[11px] font-medium ${deltaCls}`}>
                  {p.delta}
                </p>
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-4 flex items-center justify-between rounded-xl border border-emerald-400/20 bg-emerald-400/[0.08] p-3">
        <p className="text-[12px] text-emerald-200/90">
          BidPilot recommendation
        </p>
        <p className="font-display text-sm text-emerald-200">
          Sunshine Movers · $1,928 after leverage
        </p>
      </div>
    </div>
  );
}

function Logo() {
  return (
    <span className="inline-flex size-8 items-center justify-center rounded-lg bg-white/10 text-white ring-1 ring-white/15">
      <svg viewBox="0 0 32 32" className="size-5" fill="none" aria-hidden>
        <path d="M6 16.5L25 7l-6.5 18-4-7.5L6 16.5z" fill="currentColor" />
        <path
          d="M14.5 17.5L25 7"
          stroke="#34d399"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
        <circle cx="9" cy="23" r="1.75" fill="#F59E0B" />
      </svg>
    </span>
  );
}
