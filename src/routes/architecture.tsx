import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowRight,
  ArrowUpRight,
  BadgeCheck,
  ClipboardList,
  DatabaseZap,
  FileBarChart2,
  FileCheck2,
  Handshake,
  LockKeyhole,
  PhoneCall,
  Scale,
  ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/architecture")({
  head: () => ({
    meta: [
      { title: "Architecture — BidPilot AI" },
      {
        name: "description",
        content:
          "A clear look at BidPilot AI's negotiation architecture: intake, confirmed spec, provider calls, quote reconciliation, evidence, and final report.",
      },
    ],
  }),
  component: ArchitecturePage,
});

const stages = [
  {
    n: "01",
    icon: ClipboardList,
    title: "Structured intake",
    body: "The move starts as typed, uploaded, or spoken inputs. BidPilot resolves details into explicit fields instead of burying ambiguity in notes.",
    output: "Draft job spec",
  },
  {
    n: "02",
    icon: FileCheck2,
    title: "Confirmed specification",
    body: "The user locks the inventory, access conditions, services, authority, schedule, and additional stops into a canonical version.",
    output: "Version + hash",
  },
  {
    n: "03",
    icon: PhoneCall,
    title: "Provider voice calls",
    body: "Provider calls run with the exact same spec. Each call records transcript, recording reference, call mode, provider style, and tool events.",
    output: "Transcript + call record",
  },
  {
    n: "04",
    icon: Scale,
    title: "Quote reconciliation",
    body: "Snapshots and line items are grouped by provider and call, then checked against transcript evidence for support, contradiction, or gaps.",
    output: "Evidence verdicts",
  },
  {
    n: "05",
    icon: Handshake,
    title: "Leverage loop",
    body: "Negotiation mode injects verified competing offers. The agent can push for a better deal without inventing numbers.",
    output: "Before / after price",
  },
  {
    n: "06",
    icon: FileBarChart2,
    title: "Ranked report",
    body: "Usable outcomes are ranked by price, confidence, evidence quality, risk, and savings. The final answer is decision-ready.",
    output: "Final recommendation",
  },
];

const lanes = [
  { label: "Spec", value: "canonical JSON", icon: FileCheck2 },
  { label: "Calls", value: "conversation IDs", icon: PhoneCall },
  { label: "Quotes", value: "snapshots + lines", icon: DatabaseZap },
  { label: "Evidence", value: "transcript excerpts", icon: ShieldCheck },
];

function ArchitecturePage() {
  return (
    <div className="marketing-page">
      <header className="marketing-nav sticky top-0 z-40">
        <div className="marketing-container flex h-16 items-center justify-between">
          <Link to="/" className="flex items-center gap-3" aria-label="BidPilot AI home">
            <Logo />
            <span className="font-display text-[15px] font-bold text-white">BidPilot AI</span>
          </Link>
          <div className="flex items-center gap-3">
            <Button
              asChild
              variant="ghost"
              size="sm"
              className="hidden rounded-full font-bold text-white/80 hover:bg-white/8 hover:text-white sm:inline-flex"
            >
              <Link to="/">Home</Link>
            </Button>
            <Button asChild size="sm" className="rounded-full px-4 font-bold">
              <Link to="/app">
                Open workspace <ArrowUpRight className="ml-1 size-3.5" />
              </Link>
            </Button>
          </div>
        </div>
      </header>

      <main>
        <section className="relative overflow-hidden">
          <div className="soft-grid-bg pointer-events-none absolute inset-x-0 top-0 h-[36rem]" />
          <div className="marketing-container relative grid gap-12 pb-20 pt-16 lg:grid-cols-[0.95fr_1.05fr] lg:items-end lg:pt-24">
            <div>
              <p className="ink-eyebrow inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 backdrop-blur-sm">
                <span className="size-1.5 rounded-full bg-[#4f6bff] shadow-[0_0_10px_2px_rgb(79_107_255/0.6)]" />
                Architecture
              </p>
              <h1 className="ink-heading mt-7 max-w-3xl font-display text-[42px] font-extrabold leading-[1.04] sm:text-[62px]">
                A negotiation pipeline that stays accountable.
              </h1>
              <p className="mt-6 max-w-2xl text-[17px] leading-8 text-white/70">
                BidPilot is designed around one rule: if the system cannot trace a price or claim to
                the confirmed spec and provider transcript, it does not become leverage.
              </p>
            </div>

            <ArchitectureMap />
          </div>
        </section>

        <section className="ink-section">
          <div className="marketing-container grid gap-4 py-8 sm:grid-cols-2 lg:grid-cols-4">
            {lanes.map((lane) => (
              <div
                key={lane.label}
                className="ink-card ink-card-hover flex items-center gap-3 rounded-2xl p-4"
              >
                <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-[#4f6bff]/25 to-[#0f9d83]/20 text-[#a8b8ff] ring-1 ring-white/10">
                  <lane.icon className="size-5" />
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-bold text-white">{lane.label}</p>
                  <p className="truncate text-xs font-medium text-white/55">{lane.value}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="marketing-container py-24">
          <div className="max-w-2xl">
            <p className="ink-eyebrow">Six-stage flow</p>
            <h2 className="ink-heading mt-4 font-display text-4xl font-extrabold leading-tight sm:text-5xl">
              From messy request to defensible recommendation.
            </h2>
          </div>

          <div className="mt-12 grid gap-4 lg:grid-cols-2">
            {stages.map((stage) => (
              <div
                key={stage.n}
                className="ink-card ink-card-hover ink-grain overflow-hidden rounded-[1.75rem] p-6"
              >
                <div className="relative flex gap-5">
                  <div className="flex flex-col items-center gap-3">
                    <span className="flex size-12 items-center justify-center rounded-2xl bg-gradient-to-br from-[#1a2247] to-[#0b1122] font-display text-sm font-extrabold text-white ring-1 ring-white/10">
                      {stage.n}
                    </span>
                    <stage.icon className="size-5 text-[#7d92ff]" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <h3 className="font-display text-2xl font-extrabold text-white">
                        {stage.title}
                      </h3>
                      <span className="rounded-full border border-white/10 bg-white/6 px-3 py-1 text-xs font-bold text-white/80">
                        {stage.output}
                      </span>
                    </div>
                    <p className="mt-3 text-[15px] leading-7 text-white/65">{stage.body}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="ink-section">
          <div className="marketing-container grid gap-10 py-24 lg:grid-cols-[0.92fr_1.08fr] lg:items-center">
            <div>
              <p className="ink-eyebrow">Evidence policy</p>
              <h2 className="ink-heading mt-4 max-w-xl font-display text-4xl font-extrabold leading-tight sm:text-5xl">
                Every outcome has a visible confidence trail.
              </h2>
              <p className="mt-5 max-w-xl text-[16px] leading-7 text-white/70">
                The UI makes weak spots obvious. Supported claims can be trusted, contradictory
                claims need review, and missing evidence cannot quietly become a recommendation.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <PolicyCard
                title="Supported"
                text="Transcript excerpt agrees with the quote."
                tone="verified"
              />
              <PolicyCard
                title="Contradictory"
                text="Transcript conflicts with saved quote."
                tone="risk"
              />
              <PolicyCard
                title="Missing evidence"
                text="Quote exists before transcript arrives."
                tone="warn"
              />
              <PolicyCard
                title="Unsupported"
                text="Claim cannot be proven from the call."
                tone="live"
              />
            </div>
          </div>
        </section>

        <section className="marketing-container py-24">
          <div className="ink-card ink-grain overflow-hidden rounded-[2rem] p-8 sm:p-12">
            <div className="relative grid gap-10 lg:grid-cols-[1fr_auto] lg:items-center">
              <div>
                <BadgeCheck className="size-7 text-[#7d92ff]" />
                <h2 className="ink-heading mt-4 max-w-2xl font-display text-4xl font-extrabold leading-tight sm:text-5xl">
                  Built for a product demo people can follow.
                </h2>
                <p className="mt-4 max-w-2xl text-[16px] leading-7 text-white/70">
                  Intake, provider styles, quote capture, negotiation mode, integrity view,
                  evidence, readiness, and final report now read as one continuous product story.
                </p>
              </div>
              <Button asChild size="lg" className="h-12 rounded-full px-6 font-bold">
                <Link to="/signup">
                  Try the workflow <ArrowRight className="ml-1 size-4" />
                </Link>
              </Button>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

function ArchitectureMap() {
  return (
    <div className="ink-card ink-grain overflow-hidden rounded-[2rem] p-5">
      <div className="relative grid gap-3 sm:grid-cols-2">
        <MapNode label="Intake" value="voice + document + form" />
        <MapNode label="Spec" value="canonical hash" />
        <MapNode label="Calls" value="ElevenLabs conversation" />
        <MapNode label="Report" value="ranked usable outcomes" />
      </div>
      <div className="relative mt-4 overflow-hidden rounded-3xl border border-white/12 bg-gradient-to-br from-[#4f6bff]/30 via-[#1a2247] to-[#0b1122] p-5">
        <div
          aria-hidden
          className="pointer-events-none absolute -right-16 -top-16 size-48 rounded-full bg-[#4f6bff]/25 blur-3xl"
        />
        <div className="relative flex items-center justify-between gap-4">
          <div>
            <p className="text-xs font-extrabold uppercase tracking-[0.18em] text-white/60">
              Rule engine
            </p>
            <p className="mt-2 font-display text-2xl font-extrabold text-white">
              No proof, no leverage.
            </p>
          </div>
          <ShieldCheck className="size-9 text-white/85" />
        </div>
      </div>
    </div>
  );
}

function MapNode({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur-sm transition hover:border-white/20 hover:bg-white/8">
      <p className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-white/50">
        {label}
      </p>
      <p className="mt-2 font-display text-lg font-extrabold text-white">{value}</p>
    </div>
  );
}

function PolicyCard({
  title,
  text,
  tone,
}: {
  title: string;
  text: string;
  tone: "verified" | "warn" | "risk" | "live";
}) {
  const dot =
    tone === "verified"
      ? { bg: "bg-[#0f9d83]", glow: "shadow-[0_0_12px_2px_rgb(15_157_131/0.55)]" }
      : tone === "warn"
        ? { bg: "bg-amber-400", glow: "shadow-[0_0_12px_2px_rgb(251_191_36/0.5)]" }
        : tone === "risk"
          ? { bg: "bg-rose-500", glow: "shadow-[0_0_12px_2px_rgb(244_63_94/0.55)]" }
          : { bg: "bg-[#7d92ff]", glow: "shadow-[0_0_12px_2px_rgb(125_146_255/0.55)]" };
  return (
    <div className="ink-card ink-card-hover rounded-3xl p-5">
      <div className="flex items-center gap-2.5">
        <span className={`inline-block size-2 rounded-full ${dot.bg} ${dot.glow}`} />
        <h3 className="font-display text-xl font-extrabold text-white">{title}</h3>
      </div>
      <p className="mt-3 text-sm leading-6 text-white/65">{text}</p>
    </div>
  );
}

function Logo() {
  return (
    <span className="flex size-10 items-center justify-center rounded-2xl bg-gradient-to-br from-[#4f6bff] to-[#0f9d83] text-white shadow-[0_6px_20px_-6px_rgb(79_107_255/0.6)] ring-1 ring-white/15">
      <LockKeyhole className="size-5" />
    </span>
  );
}
