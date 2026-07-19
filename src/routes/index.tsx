import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  BadgeCheck,
  Check,
  FileCheck2,
  GitCompareArrows,
  Hash,
  Info,
  Layers,
  Lock,
  Mic2,
  PhoneCall,
  Quote,
  Radio,
  ShieldCheck,
  Sparkles,
  TrendingDown,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "BidPilot AI — Real quotes. Honest leverage." },
      {
        name: "description",
        content:
          "AI that negotiates moving quotes and proves every dollar it saves. One confirmed spec, live ElevenLabs calls, transcript-backed evidence, and a ranked recommendation.",
      },
      { property: "og:title", content: "BidPilot AI — Evidence-backed negotiation" },
      {
        property: "og:description",
        content:
          "One confirmed spec. Real provider calls. Verified leverage. A ranked, evidence-backed recommendation.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: LandingPage,
});

function LandingPage() {
  return (
    <div className="marketing-page font-sans">
      <MarketingNav />
      <main>
        <HeroSection />
        <TrustStrip />
        <HowItWorks />
        <ControlRoomShowcase />
        <BeforeAfter />
        <TranscriptToEvidence />
        <FinalReportPreview />
        <SecuritySection />
        <FinalCta />
      </main>
      <MarketingFooter />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Reveal-on-scroll helper (pure IntersectionObserver, no deps)        */
/* ------------------------------------------------------------------ */

function useReveal<T extends HTMLElement>(options?: IntersectionObserverInit) {
  const ref = useRef<T | null>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            setShown(true);
            io.disconnect();
            break;
          }
        }
      },
      { threshold: 0.18, rootMargin: "0px 0px -8% 0px", ...options },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [options]);
  return { ref, shown };
}

function Reveal({
  children,
  delay = 0,
  className = "",
  as: Tag = "div",
}: {
  children: React.ReactNode;
  delay?: number;
  className?: string;
  as?: keyof React.JSX.IntrinsicElements;
}) {
  const { ref, shown } = useReveal<HTMLDivElement>();
  const Comp = Tag as React.ElementType;
  return (
    <Comp
      ref={ref}
      style={{ transitionDelay: `${delay}ms` }}
      className={`transition-all duration-700 ease-[cubic-bezier(0.2,0.8,0.2,1)] ${
        shown ? "translate-y-0 opacity-100" : "translate-y-5 opacity-0"
      } ${className}`}
    >
      {children}
    </Comp>
  );
}

/* ------------------------------------------------------------------ */
/* NAV                                                                 */
/* ------------------------------------------------------------------ */

function MarketingNav() {
  return (
    <header className="marketing-nav sticky top-0 z-40">
      <div className="marketing-container flex h-16 items-center justify-between gap-3">
        <Link to="/" className="flex min-w-0 items-center gap-2.5" aria-label="BidPilot AI">
          <Logo />
          <div className="min-w-0 leading-tight">
            <div className="font-display text-[15px] font-semibold tracking-tight text-white">
              BidPilot
            </div>
            <div className="font-mono text-[9px] uppercase tracking-[0.24em] text-white/50">
              Evidence Intelligence
            </div>
          </div>
        </Link>

        <nav className="hidden items-center gap-8 text-[13px] font-medium text-white/70 md:flex">
          <a href="#how" className="transition hover:text-white">
            How it works
          </a>
          <a href="#control-room" className="transition hover:text-white">
            Control Room
          </a>
          <a href="#report" className="transition hover:text-white">
            Report
          </a>
          <a href="#security" className="transition hover:text-white">
            Security
          </a>
          <Link to="/architecture" className="transition hover:text-white">
            Architecture
          </Link>
          <Link to="/login" className="transition hover:text-white">
            Login
          </Link>
        </nav>

        <Button
          asChild
          className="h-9 shrink-0 rounded-full bg-white px-4 text-[13px] font-semibold text-[#0a0f1e] shadow-lg shadow-[#4f6bff]/20 hover:bg-white/90 sm:px-5"
        >
          <Link to="/signup">
            <span className="hidden sm:inline">Start a Negotiation</span>
            <span className="sm:hidden">Start</span>
            <ArrowRight className="ml-1 size-4" />
          </Link>
        </Button>
      </div>
    </header>
  );
}

function Logo() {
  return (
    <span className="relative inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-[#4f6bff] to-[#0f9d83] shadow-lg shadow-[#4f6bff]/40">
      <svg viewBox="0 0 32 32" className="size-4 text-white" fill="none" aria-hidden>
        <path d="M6 16.5L25 7l-6.5 18-4-7.5L6 16.5z" fill="currentColor" />
      </svg>
      <span className="absolute -right-0.5 -top-0.5 size-2 rounded-full bg-[#0f9d83] ring-2 ring-[#0a0f1e]" />
    </span>
  );
}

/* ================================================================== */
/* 1. HERO                                                             */
/* ================================================================== */

function HeroSection() {
  return (
    <section className="relative">
      <div
        className="hero-grid-bg pointer-events-none absolute inset-x-0 top-0 h-[52rem]"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute left-1/2 top-40 h-[420px] w-[820px] -translate-x-1/2 rounded-full bg-[#4f6bff]/25 blur-[120px]"
        aria-hidden
      />

      <div className="marketing-container relative grid gap-14 pb-24 pt-16 lg:grid-cols-[0.95fr_1.05fr] lg:items-center lg:gap-12 lg:pb-32 lg:pt-24">
        {/* LEFT */}
        <div>
          <div className="ink-badge">
            <span className="relative flex size-2 items-center justify-center">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-[#0f9d83] opacity-75" />
              <span className="relative inline-flex size-2 rounded-full bg-[#0f9d83]" />
            </span>
            Live negotiation infrastructure · v1.0
          </div>

          <h1 className="mt-8 font-display text-[40px] font-semibold leading-[1.02] tracking-[-0.03em] text-white sm:text-[60px] lg:text-[72px]">
            AI that negotiates moving quotes—
            <br className="hidden sm:block" />
            <span className="relative inline-block">
              <span className="shimmer-text">and proves</span>
            </span>{" "}
            every dollar it saves.
          </h1>

          <p className="mt-6 max-w-xl text-[15px] leading-[1.75] text-white/65 sm:text-[16px]">
            BidPilot creates one confirmed move specification, calls providers with ElevenLabs,
            captures every fee, negotiates with verified leverage, and ranks the strongest
            evidence-backed deal.
          </p>

          <div className="mt-9 flex flex-col gap-3 sm:flex-row sm:items-center">
            <Button
              asChild
              size="lg"
              className="h-12 rounded-full bg-[#4f6bff] px-6 text-[14px] font-semibold text-white shadow-xl shadow-[#4f6bff]/40 hover:bg-[#4f6bff]/90"
            >
              <Link to="/signup">
                Start a Negotiation <ArrowRight className="ml-1 size-4" />
              </Link>
            </Button>
            <Button
              asChild
              size="lg"
              variant="outline"
              className="h-12 rounded-full border-white/15 bg-transparent px-6 text-[14px] font-semibold text-white hover:border-white/30 hover:bg-white/[0.04] hover:text-white"
            >
              <a href="#control-room">
                <Radio className="mr-2 size-4 text-[#0f9d83]" /> Watch a Live Negotiation
              </a>
            </Button>
          </div>

          <dl className="mt-12 grid max-w-lg grid-cols-3 gap-6 border-t border-white/[0.06] pt-6">
            <StatMini label="Verified savings" value="$150" tone="verified" />
            <StatMini label="Same spec proof" value="SHA-256" tone="mono" />
            <StatMini label="Evidence status" value="Supported" tone="verified" />
          </dl>
        </div>

        {/* RIGHT — Animated negotiation preview */}
        <div className="relative">
          <NegotiationPreview />
        </div>
      </div>
    </section>
  );
}

function StatMini({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "verified" | "mono";
}) {
  return (
    <div>
      <dt className="font-mono text-[10px] uppercase tracking-[0.18em] text-white/40">{label}</dt>
      <dd
        className={`mt-1 font-display text-[18px] font-semibold ${
          tone === "verified" ? "text-[#4ecdb0]" : "text-white"
        }`}
      >
        {value}
      </dd>
    </div>
  );
}

/* -- Negotiation preview animation ---------------------------------- */

const HERO_STEPS = [
  { key: "initial", label: "Initial quote captured", delay: 300 },
  { key: "transcript", label: "Transcript line landed", delay: 1500 },
  { key: "leverage", label: "Leverage eligible", delay: 2700 },
  { key: "revised", label: "Provider revised offer", delay: 3900 },
  { key: "verified", label: "Savings verified server-side", delay: 5100 },
  { key: "evidence", label: "Evidence reconciled", delay: 6300 },
  { key: "final", label: "Recommendation ranked", delay: 7500 },
] as const;
type HeroStep = (typeof HERO_STEPS)[number]["key"];

function NegotiationPreview() {
  const [active, setActive] = useState<Set<HeroStep>>(new Set());

  useEffect(() => {
    const timers = HERO_STEPS.map((s) =>
      window.setTimeout(() => {
        setActive((prev) => {
          const next = new Set(prev);
          next.add(s.key);
          return next;
        });
      }, s.delay),
    );
    // Loop once after a pause
    const loop = window.setTimeout(() => setActive(new Set()), 12000);
    const restart = window.setTimeout(() => {
      HERO_STEPS.forEach((s) => {
        window.setTimeout(() => {
          setActive((prev) => new Set(prev).add(s.key));
        }, s.delay);
      });
    }, 12400);
    return () => {
      timers.forEach(clearTimeout);
      clearTimeout(loop);
      clearTimeout(restart);
    };
  }, []);

  const on = (k: HeroStep) => active.has(k);
  const priceInitial = "$1,500";
  const priceLeverage = "$1,400";
  const priceFinal = on("revised") ? "$1,350" : on("leverage") ? "$1,400" : priceInitial;

  return (
    <div className="ink-panel relative overflow-hidden p-5 sm:p-7">
      {/* header */}
      <div className="flex items-center justify-between gap-3 border-b border-white/[0.06] pb-4">
        <div className="flex items-center gap-2.5">
          <span className="grid size-8 place-items-center rounded-lg bg-white/[0.06] ring-1 ring-white/10">
            <PhoneCall className="size-4 text-[#8ea0ff]" />
          </span>
          <div>
            <div className="text-[13px] font-semibold text-white">Provider · Blue Line Movers</div>
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-white/40">
              conv_08k · REVISED · Same spec
            </div>
          </div>
        </div>
        <span className="live-pulse inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-[#0f9d83]/15 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-[#7ee7ce]">
          <span className="size-1.5 rounded-full bg-[#0f9d83]" /> live
        </span>
      </div>

      {/* Waveform */}
      <div className="flex items-end gap-1 py-4 text-[#4f6bff]/80">
        {Array.from({ length: 42 }).map((_, i) => (
          <span
            key={i}
            className="wave-bar"
            style={{
              height: `${8 + ((i * 13) % 22)}px`,
              animationDelay: `${(i * 40) % 900}ms`,
              opacity: 0.5 + ((i * 7) % 40) / 100,
            }}
          />
        ))}
      </div>

      {/* Quote ladder */}
      <div className="space-y-2.5">
        <QuoteRow
          label="INITIAL OFFER"
          amount={priceInitial}
          active={on("initial")}
          strike={on("revised") || on("leverage")}
        />
        <QuoteRow
          label="VERIFIED LEVERAGE"
          amount={priceLeverage}
          active={on("leverage")}
          hint="Blue Line · $1,400 · same spec"
          tone="warn"
          strike={on("revised")}
        />
        <QuoteRow
          label="FINAL OFFER"
          amount={priceFinal}
          active={on("revised")}
          tone="primary"
          bold
        />
        <div
          className={`flex items-center justify-between rounded-xl border border-[#0f9d83]/30 bg-[#0f9d83]/12 px-4 py-3 transition-all duration-500 ${
            on("verified") ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0"
          }`}
        >
          <div className="flex items-center gap-2">
            <BadgeCheck className="size-4 text-[#4ecdb0]" />
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#7ee7ce]">
              Savings Verified
            </span>
          </div>
          <span className="font-display text-[20px] font-semibold text-[#4ecdb0]">$150</span>
        </div>
      </div>

      {/* Evidence checklist */}
      <div className="mt-5 grid grid-cols-2 gap-2 border-t border-white/[0.06] pt-4">
        <EvidenceRow label="Same specification" on={on("verified")} />
        <EvidenceRow label="Transcript supported" on={on("evidence")} />
        <EvidenceRow label="Stair fee included" on={on("evidence")} />
        <EvidenceRow label="Deposit refundable" on={on("final")} />
      </div>

      {/* Live event log */}
      <div className="mt-5 rounded-xl border border-white/[0.06] bg-black/20 p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-white/40">
            Agent event stream
          </span>
          <span className="font-mono text-[10px] text-white/30">/api/tools</span>
        </div>
        <ul className="space-y-1 font-mono text-[11px] text-white/60">
          {HERO_STEPS.map((s) => (
            <li
              key={s.key}
              className={`flex items-center gap-2 transition-opacity duration-300 ${
                on(s.key) ? "opacity-100" : "opacity-30"
              }`}
            >
              <span
                className={`size-1.5 rounded-full ${on(s.key) ? "bg-[#0f9d83]" : "bg-white/20"}`}
              />
              <span className="text-white/50">
                {new Date(1_700_000_000 + s.delay).toISOString().slice(11, 19)}
              </span>
              <span className={on(s.key) ? "text-white/85" : "text-white/40"}>{s.label}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function QuoteRow({
  label,
  amount,
  active,
  hint,
  tone = "neutral",
  strike,
  bold,
}: {
  label: string;
  amount: string;
  active: boolean;
  hint?: string;
  tone?: "neutral" | "primary" | "warn";
  strike?: boolean;
  bold?: boolean;
}) {
  const toneStyles =
    tone === "primary"
      ? "border-[#4f6bff]/40 bg-[#4f6bff]/10"
      : tone === "warn"
        ? "border-[#d9a441]/30 bg-[#d9a441]/8"
        : "border-white/10 bg-white/[0.03]";
  return (
    <div
      className={`flex items-center justify-between rounded-xl border px-4 py-3 transition-all duration-500 ${toneStyles} ${
        active ? "translate-y-0 opacity-100" : "translate-y-2 opacity-40"
      }`}
    >
      <div className="min-w-0">
        <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-white/50">
          {label}
        </div>
        {hint ? <div className="mt-0.5 truncate text-[11px] text-white/50">{hint}</div> : null}
      </div>
      <div
        className={`font-display font-semibold tabular-nums ${
          bold ? "text-[22px] text-white" : "text-[17px] text-white/85"
        } ${strike ? "line-through decoration-white/25" : ""}`}
      >
        {amount}
      </div>
    </div>
  );
}

function EvidenceRow({ label, on }: { label: string; on: boolean }) {
  return (
    <div
      className={`flex items-center gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-[12px] transition-all duration-500 ${
        on ? "text-white/85" : "text-white/35"
      }`}
    >
      <span
        className={`grid size-4 place-items-center rounded-full transition-colors ${
          on ? "bg-[#0f9d83]/25 text-[#4ecdb0]" : "bg-white/[0.06] text-white/40"
        }`}
      >
        <Check className="size-3" />
      </span>
      <span className="truncate">{label}</span>
    </div>
  );
}

/* ================================================================== */
/* 2. TRUST STRIP                                                      */
/* ================================================================== */

function TrustStrip() {
  const items = [
    { icon: Mic2, label: "ElevenLabs Voice Agents" },
    { icon: Hash, label: "Same-Spec Verification" },
    { icon: Quote, label: "Transcript Evidence" },
    { icon: BadgeCheck, label: "Server-Verified Savings" },
    { icon: Lock, label: "Secure Call Records" },
  ];
  return (
    <section className="border-y border-white/[0.05] bg-black/20 py-8">
      <div className="marketing-container">
        <Reveal className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {items.map((it, i) => (
            <Reveal
              key={it.label}
              delay={i * 90}
              className="flex items-center justify-center gap-2.5 rounded-xl border border-white/[0.07] bg-white/[0.02] px-4 py-3"
            >
              <it.icon className="size-4 text-[#8ea0ff]" />
              <span className="text-[12px] font-medium text-white/80">{it.label}</span>
            </Reveal>
          ))}
        </Reveal>
      </div>
    </section>
  );
}

/* ================================================================== */
/* 3. HOW IT WORKS                                                     */
/* ================================================================== */

const FLOW_STEPS = [
  {
    icon: FileCheck2,
    title: "Voice + Documents",
    desc: "Import quotes and specs from voice or PDFs.",
  },
  { icon: Hash, title: "Confirmed Specification", desc: "One canonical spec, SHA-256 sealed." },
  {
    icon: PhoneCall,
    title: "Provider Calls",
    desc: "ElevenLabs runs the same interview across providers.",
  },
  { icon: TrendingDown, title: "Honest Leverage", desc: "Only real, cited competitor pricing." },
  { icon: Quote, title: "Evidence Reconciliation", desc: "Transcripts back every dollar." },
  { icon: BadgeCheck, title: "Ranked Recommendation", desc: "Server-verified savings, ranked." },
];

function HowItWorks() {
  const { ref, shown } = useReveal<HTMLDivElement>();
  return (
    <section id="how" className="relative py-24 sm:py-28">
      <div className="marketing-container">
        <div className="max-w-2xl">
          <div className="ink-badge">
            <Layers className="size-3 text-[#8ea0ff]" /> How it works
          </div>
          <h2 className="mt-5 font-display text-[32px] font-semibold leading-[1.08] tracking-[-0.022em] text-white sm:text-[46px]">
            Six steps from raw quote to ranked evidence.
          </h2>
          <p className="mt-4 max-w-xl text-[15px] leading-[1.7] text-white/60">
            The connecting line draws itself as you scroll. Each step is a real product surface —
            not a metaphor.
          </p>
        </div>

        <div ref={ref} className="relative mt-14">
          {/* Connecting line */}
          <div className="pointer-events-none absolute left-6 top-4 hidden h-[calc(100%-2rem)] w-px overflow-hidden bg-white/5 lg:block">
            <div
              className="absolute inset-x-0 top-0 origin-top bg-gradient-to-b from-[#4f6bff] via-[#4f6bff]/60 to-[#0f9d83] transition-transform duration-[2400ms] ease-[cubic-bezier(0.2,0.8,0.2,1)]"
              style={{ height: "100%", transform: shown ? "scaleY(1)" : "scaleY(0)" }}
            />
          </div>

          <ol className="grid gap-4 lg:grid-cols-2">
            {FLOW_STEPS.map((s, i) => (
              <Reveal key={s.title} delay={i * 140} className="relative lg:pl-16">
                {/* node */}
                <span className="absolute left-0 top-3 hidden size-12 place-items-center rounded-2xl border border-white/10 bg-[#0e142a] shadow-[0_10px_30px_-12px_rgba(79,107,255,0.55)] lg:grid">
                  <s.icon className="size-5 text-[#8ea0ff]" />
                </span>
                <div className="ink-panel-soft flex items-start gap-3 p-5">
                  <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-white/[0.05] lg:hidden">
                    <s.icon className="size-4 text-[#8ea0ff]" />
                  </span>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-white/40">
                        Step {String(i + 1).padStart(2, "0")}
                      </span>
                    </div>
                    <div className="mt-1 font-display text-[18px] font-semibold text-white">
                      {s.title}
                    </div>
                    <p className="mt-1 text-[13.5px] leading-[1.6] text-white/60">{s.desc}</p>
                  </div>
                </div>
              </Reveal>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}

/* ================================================================== */
/* 4. LIVE CONTROL ROOM SHOWCASE                                       */
/* ================================================================== */

const CR_TABS = [
  { key: "conv", label: "Conversation" },
  { key: "quote", label: "Quote Progress" },
  { key: "evidence", label: "Evidence" },
  { key: "decision", label: "Decision" },
] as const;
type CrTab = (typeof CR_TABS)[number]["key"];

function ControlRoomShowcase() {
  const [tab, setTab] = useState<CrTab>("conv");
  return (
    <section id="control-room" className="relative py-24 sm:py-28">
      <div
        className="pointer-events-none absolute left-1/2 top-1/3 h-[500px] w-[900px] -translate-x-1/2 rounded-full bg-[#4f6bff]/12 blur-[140px]"
        aria-hidden
      />
      <div className="marketing-container relative">
        <div className="mb-10 flex flex-wrap items-end justify-between gap-6">
          <div className="max-w-2xl">
            <div className="ink-badge">
              <Radio className="size-3 text-[#0f9d83]" /> Live Control Room
            </div>
            <h2 className="mt-5 font-display text-[32px] font-semibold leading-[1.08] tracking-[-0.022em] text-white sm:text-[46px]">
              One operator surface. Every negotiation signal.
            </h2>
          </div>
          <div className="hidden text-right font-mono text-[11px] uppercase tracking-[0.18em] text-white/40 sm:block">
            conv_8801kxwrenhe6cbq8850v4pp1ye
            <br />
            spec 4b1a…c9de · v2
          </div>
        </div>

        <div className="ink-panel overflow-hidden">
          {/* Tab bar */}
          <div className="border-b border-white/[0.06]">
            <div className="marketing-container flex items-center gap-1 overflow-x-auto px-3 py-2">
              {CR_TABS.map((t) => (
                <button
                  key={t.key}
                  onClick={() => setTab(t.key)}
                  className={`shrink-0 rounded-full px-4 py-1.5 text-[12.5px] font-medium transition-all duration-200 ${
                    tab === t.key
                      ? "bg-white/[0.08] text-white ring-1 ring-white/15"
                      : "text-white/55 hover:text-white/85"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          {/* Stable-height panel */}
          <div className="relative min-h-[420px] p-5 sm:p-7">
            <CrPanel visible={tab === "conv"}>
              <ConversationTab />
            </CrPanel>
            <CrPanel visible={tab === "quote"}>
              <QuoteTab />
            </CrPanel>
            <CrPanel visible={tab === "evidence"}>
              <EvidenceTab />
            </CrPanel>
            <CrPanel visible={tab === "decision"}>
              <DecisionTab />
            </CrPanel>
          </div>
        </div>
      </div>
    </section>
  );
}

function CrPanel({ visible, children }: { visible: boolean; children: React.ReactNode }) {
  return (
    <div
      className={`transition-all duration-500 ease-[cubic-bezier(0.2,0.8,0.2,1)] ${
        visible
          ? "relative translate-y-0 opacity-100"
          : "pointer-events-none absolute inset-0 -translate-y-1 opacity-0"
      }`}
      aria-hidden={!visible}
    >
      {children}
    </div>
  );
}

function ConversationTab() {
  const lines = [
    {
      who: "Agent",
      text: "Confirming the same specification—two-bedroom, three flights, no elevator.",
    },
    {
      who: "Provider",
      text: "Yes. All-in total is thirteen hundred fifty dollars including stairs.",
    },
    {
      who: "Agent",
      text: "Blue Line quoted fourteen hundred yesterday on the same spec. Is fifty dollars refundable if canceled?",
    },
    { who: "Provider", text: "Deposit is fully refundable up to seven days prior." },
  ];
  return (
    <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
      <div>
        <div className="flex items-center gap-2 pb-3">
          <span className="live-pulse inline-flex size-2 rounded-full bg-[#0f9d83]" />
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-white/40">
            Live transcript · Blue Line Movers
          </span>
        </div>
        <div className="flex items-end gap-1 pb-4 text-[#4f6bff]/70">
          {Array.from({ length: 56 }).map((_, i) => (
            <span
              key={i}
              className="wave-bar"
              style={{ height: `${6 + ((i * 11) % 26)}px`, animationDelay: `${(i * 55) % 900}ms` }}
            />
          ))}
        </div>
        <ul className="space-y-3">
          {lines.map((l, i) => (
            <li
              key={i}
              className={`rounded-xl border border-white/[0.06] p-3.5 ${
                l.who === "Agent" ? "bg-[#4f6bff]/8" : "bg-white/[0.02]"
              }`}
            >
              <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.18em] text-white/40">
                {l.who}
              </div>
              <p className="text-[13.5px] leading-[1.55] text-white/85">{l.text}</p>
            </li>
          ))}
        </ul>
      </div>
      <aside className="space-y-3">
        <MiniStat
          title="Specification"
          value="Verified · v2"
          icon={<Hash className="size-4" />}
          tone="verified"
        />
        <MiniStat
          title="Quote captured"
          value="$1,350 · REVISED"
          icon={<FileCheck2 className="size-4" />}
          tone="primary"
        />
        <MiniStat
          title="Leverage eligible"
          value="Blue Line · $1,400"
          icon={<TrendingDown className="size-4" />}
          tone="warn"
        />
        <MiniStat
          title="Final offer"
          value="$1,350 all-in"
          icon={<BadgeCheck className="size-4" />}
          tone="verified"
        />
      </aside>
    </div>
  );
}

function QuoteTab() {
  const rows = [
    { stage: "INITIAL", amt: "$1,500", note: "Base + labor" },
    { stage: "REVISED", amt: "$1,400", note: "Leverage applied" },
    { stage: "FINAL", amt: "$1,350", note: "Stairs included" },
  ];
  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_1fr]">
      <div className="ink-panel-soft p-4">
        <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-white/40">
          Quote ladder · same spec
        </div>
        <div className="mt-3 space-y-2">
          {rows.map((r) => (
            <div
              key={r.stage}
              className="flex items-center justify-between rounded-lg border border-white/[0.06] bg-black/20 px-3 py-2.5"
            >
              <div>
                <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-white/50">
                  {r.stage}
                </div>
                <div className="text-[12px] text-white/55">{r.note}</div>
              </div>
              <div className="font-display text-[18px] font-semibold tabular-nums text-white">
                {r.amt}
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="ink-panel-soft p-4">
        <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-white/40">
          Line items
        </div>
        <ul className="mt-3 space-y-2 text-[13px]">
          {[
            ["Base move", "$950"],
            ["Stairs (3 flights)", "Included"],
            ["Packing materials", "$120"],
            ["Fuel surcharge", "$80"],
            ["Deposit (refundable)", "$200"],
          ].map(([k, v]) => (
            <li
              key={k}
              className="flex justify-between border-b border-white/[0.04] pb-2 text-white/70"
            >
              <span>{k}</span>
              <span className="font-mono text-white/85">{v}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function EvidenceTab() {
  const rows = [
    {
      label: "Final total $1,350",
      status: "supported",
      src: "“…total is thirteen hundred fifty…”",
    },
    { label: "Stairs included", status: "supported", src: "“…including stairs.”" },
    {
      label: "Deposit refundable",
      status: "supported",
      src: "“…refundable up to seven days prior.”",
    },
    { label: "Blanket wrap fee", status: "missing_evidence", src: "No transcript reference" },
  ];
  const badge = (s: string) =>
    s === "supported"
      ? "bg-[#0f9d83]/15 text-[#7ee7ce] border-[#0f9d83]/30"
      : "bg-[#d9a441]/12 text-[#ecc575] border-[#d9a441]/30";
  const meta = (s: string) =>
    s === "supported" ? "reconciled 08:12:41" : "flagged 08:12:41 · needs review";
  return (
    <div className="space-y-3">
      {rows.map((r) => (
        <div
          key={r.label}
          className="grid grid-cols-[1fr_auto] items-start gap-3 rounded-xl border border-white/[0.06] bg-black/20 p-4 sm:grid-cols-[1fr_1.2fr_auto]"
        >
          <div>
            <div className="text-[13.5px] font-semibold text-white/90">{r.label}</div>
            <div className="mt-1 font-mono text-[11px] text-white/45">{meta(r.status)}</div>
          </div>
          <div className="col-span-2 order-3 text-[12.5px] italic leading-[1.55] text-white/60 sm:order-none sm:col-span-1">
            {r.src}
          </div>
          <span
            className={`shrink-0 rounded-full border px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.16em] ${badge(r.status)}`}
          >
            {r.status.replace("_", " ")}
          </span>
        </div>
      ))}
    </div>
  );
}

function DecisionTab() {
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      {[
        {
          name: "Blue Line Movers",
          price: "$1,350",
          tag: "Recommended",
          tone: "primary" as const,
          why: "Lowest evidence-backed total. Deposit refundable.",
        },
        {
          name: "Anchor Van Lines",
          price: "$1,420",
          tag: "Runner-up",
          tone: "neutral" as const,
          why: "No stairs commitment on transcript.",
        },
        {
          name: "Ridge Logistics",
          price: "$1,610",
          tag: "Higher risk",
          tone: "warn" as const,
          why: "Hidden fuel surcharge revealed post-quote.",
        },
      ].map((p) => (
        <div
          key={p.name}
          className={`ink-panel-soft p-5 ${p.tone === "primary" ? "ring-1 ring-[#4f6bff]/40" : ""}`}
        >
          <div className="flex items-center justify-between">
            <span
              className={`rounded-full px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.16em] ${
                p.tone === "primary"
                  ? "bg-[#4f6bff]/15 text-[#8ea0ff]"
                  : p.tone === "warn"
                    ? "bg-[#d9a441]/15 text-[#ecc575]"
                    : "bg-white/[0.06] text-white/60"
              }`}
            >
              {p.tag}
            </span>
            <span className="font-display text-[22px] font-semibold text-white">{p.price}</span>
          </div>
          <div className="mt-3 text-[15px] font-semibold text-white">{p.name}</div>
          <p className="mt-1 text-[13px] leading-[1.55] text-white/60">{p.why}</p>
        </div>
      ))}
    </div>
  );
}

function MiniStat({
  title,
  value,
  icon,
  tone,
}: {
  title: string;
  value: string;
  icon: React.ReactNode;
  tone: "verified" | "primary" | "warn";
}) {
  const toneClass =
    tone === "verified"
      ? "text-[#7ee7ce] bg-[#0f9d83]/15 border-[#0f9d83]/25"
      : tone === "warn"
        ? "text-[#ecc575] bg-[#d9a441]/12 border-[#d9a441]/25"
        : "text-[#8ea0ff] bg-[#4f6bff]/12 border-[#4f6bff]/25";
  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3.5">
      <div className="flex items-center gap-2">
        <span className={`grid size-7 place-items-center rounded-lg border ${toneClass}`}>
          {icon}
        </span>
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-white/45">
          {title}
        </span>
      </div>
      <div className="mt-2 font-display text-[15px] font-semibold text-white">{value}</div>
    </div>
  );
}

/* ================================================================== */
/* 5. BEFORE VS AFTER                                                  */
/* ================================================================== */

function BeforeAfter() {
  const [pos, setPos] = useState(52); // percent
  return (
    <section className="relative py-24 sm:py-28">
      <div className="marketing-container">
        <div className="max-w-2xl">
          <div className="ink-badge">
            <GitCompareArrows className="size-3 text-[#8ea0ff]" /> Before vs After
          </div>
          <h2 className="mt-5 font-display text-[32px] font-semibold leading-[1.08] tracking-[-0.022em] text-white sm:text-[46px]">
            Guesswork on the left. Evidence on the right.
          </h2>
        </div>

        {/* Desktop: draggable comparison */}
        <div
          className="ink-panel relative mt-10 hidden select-none overflow-hidden lg:block"
          role="group"
          aria-label="Comparison between before BidPilot and with BidPilot"
        >
          <div className="grid grid-cols-2">
            <ComparisonSide
              tone="before"
              items={[
                "Repeated calls, no shared spec",
                "Inconsistent scope per provider",
                "Hidden fees discovered later",
                "Manual notes, lost commitments",
                "Uncertain savings",
              ]}
            />
            <ComparisonSide
              tone="after"
              items={[
                "One confirmed specification",
                "Structured, identical calls",
                "Itemized quotes, every fee",
                "Verified leverage from real quotes",
                "Evidence-backed recommendation",
              ]}
            />
          </div>

          {/* Overlay mask */}
          <div
            className="pointer-events-none absolute inset-0"
            style={
              {
                background:
                  "linear-gradient(90deg, rgba(10,15,30,0.0) 0%, rgba(10,15,30,0.0) var(--pos), rgba(10,15,30,0.65) calc(var(--pos) + 0.5%), rgba(10,15,30,0.75) 100%)",
                "--pos": `${pos}%`,
              } as React.CSSProperties
            }
          />
          {/* Divider */}
          <div
            className="absolute inset-y-0 z-10 w-px bg-gradient-to-b from-[#4f6bff] via-white/70 to-[#0f9d83]"
            style={{ left: `${pos}%` }}
          />
          <button
            aria-label="Drag comparison"
            className="absolute top-1/2 z-20 grid size-11 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border border-white/20 bg-[#0a0f1e] shadow-2xl shadow-black/60"
            style={{ left: `${pos}%` }}
          >
            <GitCompareArrows className="size-4 text-white" />
          </button>
          <input
            type="range"
            min={8}
            max={92}
            value={pos}
            onChange={(e) => setPos(Number(e.target.value))}
            aria-label="Reveal amount"
            className="absolute inset-x-0 top-1/2 z-30 h-11 w-full -translate-y-1/2 cursor-ew-resize opacity-0"
          />
        </div>

        {/* Mobile: accessible toggle stack */}
        <div className="mt-10 grid gap-4 lg:hidden">
          <ComparisonSide
            tone="before"
            items={[
              "Repeated calls, no shared spec",
              "Inconsistent scope per provider",
              "Hidden fees discovered later",
              "Manual notes, lost commitments",
              "Uncertain savings",
            ]}
          />
          <ComparisonSide
            tone="after"
            items={[
              "One confirmed specification",
              "Structured, identical calls",
              "Itemized quotes, every fee",
              "Verified leverage from real quotes",
              "Evidence-backed recommendation",
            ]}
          />
        </div>
      </div>
    </section>
  );
}

function ComparisonSide({ tone, items }: { tone: "before" | "after"; items: string[] }) {
  const isAfter = tone === "after";
  return (
    <div
      className={`p-7 sm:p-10 ${isAfter ? "bg-gradient-to-br from-[#0e142a] to-[#0a0f1e]" : "bg-black/25"}`}
    >
      <div className="flex items-center gap-2">
        <span
          className={`rounded-full px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.18em] ${
            isAfter ? "bg-[#0f9d83]/15 text-[#7ee7ce]" : "bg-white/[0.06] text-white/50"
          }`}
        >
          {isAfter ? "With BidPilot" : "Before BidPilot"}
        </span>
      </div>
      <h3 className="mt-4 font-display text-[22px] font-semibold text-white">
        {isAfter ? "Evidence, not promises" : "Guesswork, not evidence"}
      </h3>
      <ul className="mt-5 space-y-2.5">
        {items.map((t) => (
          <li key={t} className="flex items-start gap-2.5 text-[13.5px] text-white/75">
            <span
              className={`mt-0.5 grid size-4 shrink-0 place-items-center rounded-full ${
                isAfter ? "bg-[#0f9d83]/25 text-[#4ecdb0]" : "bg-white/[0.08] text-white/55"
              }`}
            >
              {isAfter ? <Check className="size-3" /> : <X className="size-3" />}
            </span>
            {t}
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ================================================================== */
/* 6. TRANSCRIPT TO EVIDENCE                                           */
/* ================================================================== */

function TranscriptToEvidence() {
  return (
    <section className="relative py-24 sm:py-28">
      <div className="marketing-container">
        <div className="max-w-2xl">
          <div className="ink-badge">
            <Quote className="size-3 text-[#8ea0ff]" /> Transcript → Evidence
          </div>
          <h2 className="mt-5 font-display text-[32px] font-semibold leading-[1.08] tracking-[-0.022em] text-white sm:text-[46px]">
            Every spoken commitment becomes structured proof.
          </h2>
        </div>

        <div className="mt-12 grid gap-6 lg:grid-cols-[1fr_auto_1fr] lg:items-center">
          <Reveal className="ink-panel-soft relative p-6">
            <div className="mb-3 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-white/45">
              <Mic2 className="size-3" /> Provider · voice
            </div>
            <Quote className="absolute right-4 top-4 size-6 text-white/10" />
            <p className="font-display text-[22px] leading-[1.35] text-white/95 sm:text-[26px]">
              “The all-in total is{" "}
              <span className="rounded-md bg-[#4f6bff]/25 px-1">
                thirteen hundred fifty dollars
              </span>
              , including <span className="rounded-md bg-[#0f9d83]/25 px-1">stairs</span>.”
            </p>
            <div className="mt-4 flex items-center gap-2 font-mono text-[11px] text-white/45">
              <span className="size-1.5 rounded-full bg-[#0f9d83]" /> conv_08k · 00:04:17
            </div>
          </Reveal>

          <Reveal delay={220} className="hidden lg:block">
            <div className="relative h-24 w-16">
              <div className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-gradient-to-b from-[#4f6bff] to-[#0f9d83]" />
              <ArrowRight className="absolute left-1/2 top-1/2 size-6 -translate-x-1/2 -translate-y-1/2 rotate-0 text-[#8ea0ff]" />
            </div>
          </Reveal>

          <Reveal delay={340} className="ink-panel p-6">
            <div className="mb-4 flex items-center justify-between">
              <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-white/45">
                Structured evidence
              </div>
              <span className="rounded-full border border-[#0f9d83]/30 bg-[#0f9d83]/12 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.16em] text-[#7ee7ce]">
                Supported
              </span>
            </div>
            <ul className="space-y-2.5">
              {[
                ["Final total", "$1,350"],
                ["Stairs", "Included"],
                ["Status", "Supported"],
                ["Evidence confidence", "High"],
              ].map(([k, v]) => (
                <li
                  key={k}
                  className="flex items-center justify-between rounded-lg border border-white/[0.06] bg-black/20 px-3.5 py-2.5"
                >
                  <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-white/45">
                    {k}
                  </span>
                  <span className="font-display text-[15px] font-semibold text-white">{v}</span>
                </li>
              ))}
            </ul>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

/* ================================================================== */
/* 7. FINAL REPORT PREVIEW                                             */
/* ================================================================== */

function FinalReportPreview() {
  return (
    <section id="report" className="relative py-24 sm:py-28">
      <div className="marketing-container">
        <div className="mb-10 max-w-2xl">
          <div className="ink-badge">
            <BadgeCheck className="size-3 text-[#4ecdb0]" /> Final Report
          </div>
          <h2 className="mt-5 font-display text-[32px] font-semibold leading-[1.08] tracking-[-0.022em] text-white sm:text-[46px]">
            A decision document, not a spreadsheet.
          </h2>
        </div>

        <Reveal className="ink-panel overflow-hidden">
          <div className="grid gap-0 lg:grid-cols-[1.2fr_1fr]">
            {/* Left: recommendation */}
            <div className="border-b border-white/[0.06] p-7 lg:border-b-0 lg:border-r">
              <div className="flex items-center gap-2">
                <span className="rounded-full bg-[#4f6bff]/15 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-[#8ea0ff]">
                  Rank 01 · Recommended
                </span>
                <span className="rounded-full border border-[#0f9d83]/30 bg-[#0f9d83]/12 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.16em] text-[#7ee7ce]">
                  Evidence: High
                </span>
              </div>
              <h3 className="mt-4 font-display text-[26px] font-semibold text-white sm:text-[30px]">
                Blue Line Movers
              </h3>

              <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3">
                <ReportStat label="Final price" value="$1,350" />
                <ReportStat label="Verified savings" value="$150" tone="verified" />
                <ReportStat label="Estimate type" value="All-in" />
                <ReportStat label="Deposit" value="$200 refundable" />
                <ReportStat label="Cancellation risk" value="Low" tone="verified" />
                <ReportStat label="Evidence quality" value="4 / 4 supported" />
              </div>

              <div className="mt-6 rounded-xl border border-white/[0.06] bg-black/20 p-4">
                <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-white/45">
                  Why it ranks first
                </div>
                <p className="mt-2 text-[13.5px] leading-[1.6] text-white/80">
                  Same specification, lowest transcript-verified total, refundable deposit, and
                  stairs already included. Verified leverage from Anchor prevented an end-of-call
                  surprise fee.
                </p>
              </div>
            </div>

            {/* Right: runners up */}
            <div className="space-y-3 bg-black/20 p-7">
              <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-white/45">
                Why alternatives rank lower
              </div>
              {[
                {
                  rank: "02",
                  name: "Anchor Van Lines",
                  price: "$1,420",
                  reason: "No stairs commitment on transcript. Missing evidence.",
                  tone: "warn" as const,
                },
                {
                  rank: "03",
                  name: "Ridge Logistics",
                  price: "$1,610",
                  reason: "Hidden fuel surcharge revealed post-quote. Contradictory.",
                  tone: "risk" as const,
                },
              ].map((r) => (
                <div
                  key={r.rank}
                  className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-white/50">
                      Rank {r.rank}
                    </span>
                    <span className="font-display text-[16px] font-semibold text-white">
                      {r.price}
                    </span>
                  </div>
                  <div className="mt-1 text-[14px] font-semibold text-white">{r.name}</div>
                  <p className="mt-1 text-[12.5px] leading-[1.55] text-white/60">{r.reason}</p>
                  <div
                    className={`mt-2 inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.16em] ${
                      r.tone === "warn"
                        ? "border-[#d9a441]/30 bg-[#d9a441]/12 text-[#ecc575]"
                        : "border-[#e85d5d]/30 bg-[#e85d5d]/12 text-[#f4a4a4]"
                    }`}
                  >
                    <Info className="size-3" />{" "}
                    {r.tone === "warn" ? "Missing evidence" : "Contradictory"}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

function ReportStat({ label, value, tone }: { label: string; value: string; tone?: "verified" }) {
  return (
    <div>
      <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-white/45">{label}</div>
      <div
        className={`mt-1 font-display text-[17px] font-semibold ${
          tone === "verified" ? "text-[#4ecdb0]" : "text-white"
        }`}
      >
        {value}
      </div>
    </div>
  );
}

/* ================================================================== */
/* 8. SECURITY                                                         */
/* ================================================================== */

function SecuritySection() {
  const nodes = [
    { icon: Lock, label: "Short-lived call tokens" },
    { icon: Hash, label: "Hashed secrets" },
    { icon: ShieldCheck, label: "HMAC webhook verification" },
    { icon: Layers, label: "Row-Level Security" },
    { icon: BadgeCheck, label: "Server-side savings verification" },
    { icon: TrendingDown, label: "Verified leverage only" },
  ];
  return (
    <section id="security" className="relative py-24 sm:py-28">
      <div className="marketing-container">
        <div className="max-w-2xl">
          <div className="ink-badge">
            <ShieldCheck className="size-3 text-[#4ecdb0]" /> Security
          </div>
          <h2 className="mt-5 font-display text-[32px] font-semibold leading-[1.08] tracking-[-0.022em] text-white sm:text-[46px]">
            Built for calls that carry real money.
          </h2>
        </div>

        <div className="mt-12 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {nodes.map((n, i) => (
            <Reveal
              key={n.label}
              delay={i * 90}
              className="ink-panel-soft flex items-center gap-3 p-5"
            >
              <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-white/10 bg-white/[0.04]">
                <n.icon className="size-4 text-[#8ea0ff]" />
              </span>
              <div className="min-w-0">
                <div className="text-[14px] font-semibold text-white">{n.label}</div>
                <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-white/40">
                  Enforced server-side
                </div>
              </div>
            </Reveal>
          ))}
        </div>

        <Reveal
          delay={200}
          className="mt-6 flex flex-wrap items-center gap-3 rounded-2xl border border-white/[0.07] bg-black/20 p-5 font-mono text-[11px] text-white/55"
        >
          <span className="rounded-md bg-white/[0.06] px-2 py-1 text-white/80">agent</span>
          <ArrowRight className="size-3 text-white/40" />
          <span className="rounded-md bg-white/[0.06] px-2 py-1 text-white/80">signed token</span>
          <ArrowRight className="size-3 text-white/40" />
          <span className="rounded-md bg-white/[0.06] px-2 py-1 text-white/80">tool endpoint</span>
          <ArrowRight className="size-3 text-white/40" />
          <span className="rounded-md bg-white/[0.06] px-2 py-1 text-white/80">
            RLS-scoped write
          </span>
          <ArrowRight className="size-3 text-white/40" />
          <span className="rounded-md bg-[#0f9d83]/12 px-2 py-1 text-[#7ee7ce]">
            HMAC-verified webhook
          </span>
        </Reveal>
      </div>
    </section>
  );
}

/* ================================================================== */
/* 9. FINAL CTA                                                        */
/* ================================================================== */

function FinalCta() {
  return (
    <section className="relative py-24 sm:py-28">
      <div className="marketing-container">
        <div className="relative overflow-hidden rounded-[28px] border border-white/10 bg-gradient-to-br from-[#0e142a] via-[#0a0f1e] to-[#0e142a] p-10 sm:p-14">
          <div
            className="pointer-events-none absolute -right-20 -top-20 size-[420px] rounded-full bg-[#4f6bff]/20 blur-3xl"
            aria-hidden
          />
          <div
            className="pointer-events-none absolute -bottom-32 -left-24 size-[360px] rounded-full bg-[#0f9d83]/12 blur-3xl"
            aria-hidden
          />

          <div className="relative grid gap-10 lg:grid-cols-[1.1fr_auto] lg:items-center">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-white/60">
                <Sparkles className="size-3 text-[#8ea0ff]" /> Ready when you are
              </div>
              <h2 className="mt-5 max-w-2xl font-display text-[34px] font-semibold leading-[1.05] tracking-[-0.02em] text-white sm:text-[52px]">
                Stop comparing promises.
                <br />
                Start comparing evidence.
              </h2>
              <p className="mt-5 max-w-xl text-[15px] leading-[1.7] text-white/60">
                Confirm one spec. Call three providers. Watch itemized quotes, transcripts, and
                verified savings assemble themselves into a ranked report.
              </p>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row lg:flex-col">
              <Button
                asChild
                size="lg"
                className="h-12 rounded-full bg-[#4f6bff] px-6 text-[14px] font-semibold text-white shadow-xl shadow-[#4f6bff]/40 hover:bg-[#4f6bff]/90"
              >
                <Link to="/signup">
                  Build My Moving Specification <ArrowRight className="ml-1 size-4" />
                </Link>
              </Button>
              <Button
                asChild
                size="lg"
                variant="outline"
                className="h-12 rounded-full border-white/15 bg-transparent px-6 text-[14px] font-semibold text-white hover:border-white/30 hover:bg-white/[0.04] hover:text-white"
              >
                <Link to="/login">Open workspace</Link>
              </Button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* FOOTER                                                              */
/* ------------------------------------------------------------------ */

function MarketingFooter() {
  return (
    <footer className="border-t border-white/[0.06]">
      <div className="marketing-container flex flex-col gap-4 py-8 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2.5">
          <Logo />
          <div className="text-[13px] font-medium text-white/60">
            BidPilot AI · Real quotes. Honest leverage.
          </div>
        </div>
        <div className="flex items-center gap-6 font-mono text-[11px] uppercase tracking-[0.16em] text-white/40">
          <Link to="/architecture" className="transition hover:text-white/80">
            Architecture
          </Link>
          <Link to="/login" className="transition hover:text-white/80">
            Login
          </Link>
          <Link to="/signup" className="transition hover:text-white/80">
            Start
          </Link>
        </div>
      </div>
    </footer>
  );
}
