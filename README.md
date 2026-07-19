# BidPilot AI

> **Real quotes. Honest leverage. Better deals.**

BidPilot AI is an evidence-backed voice negotiation platform for residential moving services. It creates one canonical moving specification, reuses that exact scope across provider calls, captures itemized quotes, negotiates with verified leverage, and produces a transparent recommendation supported by transcripts, structured outcomes, recordings, and risk analysis.

- **Live App:** https://bidpilot-ai.lovable.app/
- **Hackathon:** Hack-Nation 6th Global AI Hackathon
- **Challenge:** ElevenLabs — The Negotiator
- **Primary Vertical:** United States residential moving services
- **Developer:** Zulaid Ahmad Abbasi

---

## Table of Contents

1. [Overview](#overview)
2. [Problem](#problem)
3. [Solution](#solution)
4. [Core Workflow](#core-workflow)
5. [Key Features](#key-features)
6. [Voice-Agent Architecture](#voice-agent-architecture)
7. [Quote and Negotiation Model](#quote-and-negotiation-model)
8. [Evidence and Trust](#evidence-and-trust)
9. [System Architecture](#system-architecture)
10. [Technology Stack](#technology-stack)
11. [Data Model](#data-model)
12. [API and Webhooks](#api-and-webhooks)
13. [Security](#security)
14. [Challenge Alignment](#challenge-alignment)
15. [Demo Guide](#demo-guide)
16. [Local Development](#local-development)
17. [Environment Variables](#environment-variables)
18. [Testing](#testing)
19. [Deployment](#deployment)
20. [Current Status](#current-status)
21. [Final Acceptance Checklist](#final-acceptance-checklist)
22. [Roadmap](#roadmap)
23. [Project Principles](#project-principles)
24. [License](#license)

---

## Overview

Moving quotes are difficult to compare because providers use different pricing structures, estimate types, exclusions, and assumptions. A low headline quote may exclude stairs, long carry, packing materials, deposits, taxes, travel time, or other charges that appear later.

BidPilot AI combines:

- guided customer intake,
- document understanding,
- versioned and confirmed specifications,
- ElevenLabs voice agents,
- authenticated webhook tools,
- itemized quote persistence,
- honest negotiation,
- transcript reconciliation,
- evidence scoring,
- risk detection,
- and decision reporting.

BidPilot is not a generic chatbot and not a simple quote form. It is an operational voice-negotiation system built around evidence integrity.

---

## Problem

A customer preparing for a move normally has to:

1. Contact several moving companies.
2. Repeat the same information on every call.
3. Remember which provider included which service.
4. Track deposits, cancellation rules, estimate types, and hidden fees.
5. Compare numbers that may not describe the same scope.
6. Negotiate without knowing whether a competing offer is genuinely comparable.
7. Trust that the final bill will resemble the phone estimate.

This process fails because:

- the job specification changes between calls,
- quotes are not itemized consistently,
- providers may omit material conditions,
- customers lack a defensible audit trail,
- and competing offers are often used without verifying scope equality.

---

## Solution

BidPilot closes the entire loop.

### 1. Build one canonical specification

The customer provides move details through:

- guided manual intake,
- document upload,
- and an ElevenLabs voice-intake workflow when deployed.

All paths must update the same `job_spec_drafts.specification` document.

### 2. Review and confirm

The customer resolves missing fields and conflicts, then explicitly confirms the specification.

The application creates:

- a confirmed version,
- canonical JSON,
- and a SHA-256 specification hash.

### 3. Call providers

The ElevenLabs provider agent:

- identifies itself as AI,
- explains whom it represents,
- loads verified server context,
- presents the same confirmed scope,
- asks concise questions,
- handles interruptions and friction,
- and records structured outcomes.

### 4. Capture itemized quotes

BidPilot stores:

- initial offers,
- revised offers,
- final offers,
- fees,
- deposits,
- inclusions,
- exclusions,
- estimate type,
- validity,
- cancellation conditions,
- price-change conditions,
- commitments,
- unresolved questions,
- and red flags.

### 5. Negotiate honestly

A competing quote may be used only when it is:

- stored,
- current,
- comparable,
- tied to the same specification hash,
- supported by evidence,
- and returned as eligible leverage.

The agent may never invent a bid, scope, price, deadline, or concession.

### 6. Reconcile evidence

Post-call processing links structured claims to:

- provider,
- call,
- conversation,
- transcript text,
- timestamps,
- recording reference,
- specification version and hash,
- and quote stage.

### 7. Recommend the strongest deal

The final decision layer considers:

- all-in price,
- estimate certainty,
- scope completeness,
- hidden-fee risk,
- deposit terms,
- cancellation terms,
- provider role,
- availability,
- evidence quality,
- customer priorities,
- and unresolved risks.

---

## Core Workflow

```text
Customer intake
      ↓
Manual form / document extraction / voice interview
      ↓
Canonical job specification draft
      ↓
Conflict resolution and review
      ↓
Customer confirmation
      ↓
Specification version + SHA-256 hash
      ↓
Provider selection
      ↓
ElevenLabs live calls
      ↓
INITIAL quote + itemized fees
      ↓
REVISED quote when price or terms change
      ↓
FINAL quote when closing offer is confirmed
      ↓
Structured call outcome
      ↓
Post-call transcript and recording processing
      ↓
Evidence reconciliation
      ↓
Verified leverage negotiation
      ↓
Ranked final recommendation
```

---

## Key Features

### Customer Intake

- Structured route and timing
- Origin and destination addresses
- Date flexibility
- Property types
- Floors and stair flights
- Elevators and reservation requirements
- Parking and permits
- Long-carry distance
- Building restrictions
- Room-by-room inventory
- Large, fragile, and specialty items
- Packing and unpacking
- Disassembly and reassembly
- Storage
- Additional stops
- Customer priorities
- Must-haves and deal breakers
- Negotiation authority
- Autosave
- Friendly validation
- Explicit specification confirmation

### Document Intake

Supported input types include configured combinations of:

- PDF
- PNG
- JPEG
- WebP
- GIF
- CSV
- plain text

The document flow provides:

- server-side MIME and size validation,
- multimodal structured extraction,
- schema validation,
- current-value versus extracted-value comparison,
- explicit conflict resolution,
- selective merge,
- no silent overwrites,
- and no automatic confirmation.

### Specification Integrity

- Canonical JSON
- SHA-256 hashing
- Versioned confirmation
- Immutable confirmed records
- Editable drafts
- New version on reconfirmation
- Version/hash stored on calls
- Same-spec integrity checks
- Non-comparable status for mismatches

### Provider Management

- Provider identity
- Phone
- Website
- Location
- Source
- Carrier/broker status when known
- Provider rehearsal style
- Call status
- Quote stage
- Evidence state
- Same-spec comparability

### ElevenLabs Control Room

- Live status
- Provider identity
- Call mode
- Timer
- Connection state
- Specification verification
- Context-loaded state
- Transcript feed
- Tool activity
- Quote progress
- Evidence status
- Risk status
- Final outcome
- Microphone controls
- End-call control
- Responsive mobile layout

### Quote Capture

- `INITIAL`
- `REVISED`
- `FINAL`
- Total amount
- Low/high range
- Currency
- Estimate type
- Deposit
- Deposit refundability
- Quote validity
- Included services
- Excluded services
- Terms
- Price-change conditions
- Verification status
- Provider wording
- Idempotent retries

### Quote Line Items

Supported categories:

- labor
- transport
- packing
- materials
- fuel
- stairs
- long carry
- heavy item
- storage
- insurance/valuation
- deposit
- surcharge
- discount
- tax
- other

Each line item may preserve:

- label,
- amount,
- quantity,
- unit,
- inclusion status,
- conditional status,
- condition text,
- provider wording,
- transcript span,
- timestamp,
- and evidence source.

### Negotiation

- Quote gathering mode
- Negotiation mode
- Authority enforcement
- Same-spec leverage verification
- Eligible leverage only
- Fee-waiver requests
- Price-match requests
- Deposit negotiation
- Cancellation negotiation
- Estimate-certainty negotiation
- Service-inclusion negotiation
- Written-estimate request
- Limited escalation

### Friction Handling

Designed for:

- interruptions,
- vague estimates,
- refusal to quote,
- callback requests,
- busy dispatchers,
- hard-sell urgency,
- budget probing,
- voicemail,
- no answer,
- wrong number,
- transfer,
- date/route unavailability,
- hostility,
- hang-up,
- disconnection,
- and safe tool failure.

### Structured Outcomes

Allowed outcomes:

- `quote_received`
- `callback_requested`
- `refused`
- `unavailable`
- `disconnected`
- `wrong_number`
- `negotiation_completed`
- `negotiation_failed`

### Evidence and Reporting

- Transcript persistence
- Speaker and sequence tracking
- Timestamps
- Protected recording references
- Quote-to-transcript evidence
- Supported claims
- Contradictions
- Unsupported claims
- Missing evidence
- Needs-review state
- Server-verified price change
- Server-verified terms change
- Server-verified savings
- Ranked provider comparison
- Plain-language reasoning

---

## Voice-Agent Architecture

BidPilot should use two separate ElevenLabs agents.

### Agent A — BidPilot Estimator

Customer-facing voice intake agent.

Responsibilities:

- load the current draft,
- ask professional-estimator questions,
- save customer-confirmed answers,
- resolve document conflicts,
- identify unknown information,
- and finish the voice session without confirming the specification.

Recommended tools:

- `load_intake_context`
- `save_intake_patch`
- `finalize_intake_session`

The application—not the voice agent—performs final confirmation and hashing.

### Agent B — BidPilot Provider Negotiator

Provider-facing quote and negotiation agent.

Responsibilities:

- load verified call context,
- use the confirmed specification,
- capture itemized offers,
- negotiate using eligible leverage,
- save quote stages,
- and finalize one structured outcome.

Current provider tools:

- `load_call_context`
- `save_quote_snapshot`
- `save_quote_line_item`
- `finalize_call_outcome`

### Required Live Styles

#### Flexible Provider

- Gives a complete initial quote
- May reduce price or waive a fee
- May reject unrealistic demands
- Confirms final terms after negotiation

#### Stonewaller / Callback Provider

- Avoids immediate pricing
- May require a survey
- Provides callback details or a documented refusal
- Must not be forced into a complete quote

#### Upseller / Hidden-Fee Provider

- Gives an attractive base amount
- Reveals conditional fees when asked
- May defend or waive a fee
- Preserves all conditions in the transcript

These profiles must guide behavior without forcing a scripted outcome.

---

## Quote and Negotiation Model

### Quote Stages

```text
INITIAL
   ↓
REVISED — only after a material price or term change
   ↓
FINAL — after the provider confirms the closing offer
```

### Example

```text
INITIAL
Total: $1,500
Stair fee: $100
Deposit: $200 refundable
Estimate type: non-binding

REVISED
Total: $1,400
Stair fee: still separate

FINAL
Total: $1,350
Stair fee: included
Deposit: $200 refundable
Written estimate: promised
```

### Verified Savings

The browser and model do not determine verified savings.

```text
verified savings = supported INITIAL total - supported FINAL total
```

Savings are valid only when:

- both stages exist,
- they belong to the same provider/call context,
- scope is comparable,
- amounts are supported by evidence,
- and reconciliation finds no material contradiction.

### Honest Leverage

The agent may say:

> “I have a verified comparable offer for [exact amount] using the same confirmed move specification. Can you match or beat that total?”

It may not:

- name a competitor without permission,
- reveal maximum budget,
- exaggerate a quote,
- describe non-binding as binding,
- use different-scope leverage,
- use suspicious outliers,
- or invent urgency.

---

## Evidence and Trust

BidPilot separates four layers.

### Provider Statement

What the provider actually said.

### Structured Claim

What the agent saved as a price, fee, inclusion, exclusion, condition, or changed term.

### Evidence Support

Possible states:

- `supported`
- `contradictory`
- `unsupported`
- `missing_evidence`

### Verification

Whether the claim can safely affect:

- savings,
- leverage,
- ranking,
- or recommendation.

A smooth conversation is not verification.  
A repeated number is not automatically verification.  
A low price is not automatically the best deal.

---

## System Architecture

```text
┌──────────────────────────────────────────────────────────┐
│                     BidPilot Web App                     │
│ React + TypeScript + authenticated operational UI       │
└──────────────────────────┬───────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────┐
│                  Application Server Layer                │
│ Auth actions, Zod validation, session creation, tools    │
└──────────────┬──────────────────────────────┬────────────┘
               │                              │
               ▼                              ▼
┌──────────────────────────┐      ┌─────────────────────────┐
│ Supabase Auth/PostgreSQL │      │ ElevenLabs Agents      │
│ RLS, specs, calls,       │      │ Voice, ASR, TTS, tools │
│ providers, quotes,       │      └────────────┬────────────┘
│ evidence, events         │                   │
└──────────────┬───────────┘                   ▼
               │                 ┌─────────────────────────┐
               │                 │ Authenticated Webhooks  │
               │                 │ Context / quote / final │
               │                 └────────────┬────────────┘
               │                              │
               ▼                              ▼
┌──────────────────────────┐      ┌─────────────────────────┐
│ AI Document Extraction   │      │ Post-call Webhook      │
│ Multimodal canonical     │      │ HMAC verification      │
│ specification output     │      │ transcript/recording   │
└──────────────────────────┘      └────────────┬────────────┘
                                              │
                                              ▼
                                 ┌─────────────────────────┐
                                 │ Evidence Reconciliation │
                                 │ Claims ↔ transcript     │
                                 └────────────┬────────────┘
                                              │
                                              ▼
                                 ┌─────────────────────────┐
                                 │ Decision and Reporting  │
                                 │ Verified comparison     │
                                 └─────────────────────────┘
```

---

## Technology Stack

### Frontend

- React
- TypeScript
- TanStack Router
- TanStack Query
- React Hook Form
- Zod
- shadcn/ui
- Sonner
- Responsive operational UI

### Voice and AI

- ElevenLabs Agents
- ElevenLabs React SDK
- ElevenLabs webhook tools
- ElevenLabs post-call webhooks
- OpenAI multimodal extraction through Lovable AI Gateway

### Backend and Data

- Supabase Auth
- PostgreSQL
- Row-Level Security
- Server-side functions
- Service-role protected operations
- Canonical JSON hashing
- SHA-256
- HMAC verification
- Postgres-backed rate limiting

### Development

- Lovable
- Bun
- Vite/Nitro-compatible build
- Vitest
- TypeScript type checking
- Playwright-compatible browser testing

---

## Data Model

### `negotiations`

Stores:

- owner,
- title,
- route,
- move date,
- workflow status,
- timestamps.

### `job_spec_drafts`

Stores the editable canonical specification draft.

### `job_specs`

Stores confirmed versions:

- specification JSON,
- version,
- specification hash,
- confirmation state,
- confirmation timestamp.

### `providers`

Stores provider identity and contact details.

### `calls`

Stores:

- negotiation,
- provider,
- call mode,
- status,
- specification version/hash,
- ElevenLabs conversation ID,
- final outcome,
- verified price change,
- verified terms change,
- verified savings,
- needs-review state,
- webhook timestamp,
- reconciliation timestamp.

### `call_tool_tokens`

Stores only hashes of short-lived call-tool tokens.

### `quotes`

Stores:

- call,
- provider,
- external reference,
- stage,
- total/range,
- currency,
- estimate type,
- deposit,
- validity,
- inclusions,
- exclusions,
- conditions,
- verification status.

### `quote_line_items`

Stores itemized fees, services, discounts, exclusions, and conditions.

### `call_transcripts`

Stores sequence number, speaker, text, and timestamps.

### `call_recordings`

Stores protected recording references.

### `quote_evidence`

Links structured claims to transcript evidence.

### `agent_events`

Stores observable events such as:

- call started,
- context loaded,
- specification verified,
- quote captured,
- line item saved,
- call finalized.

### `call_webhook_events`

Stores idempotent post-call webhook processing records.

---

## API and Webhooks

### Load Provider Context

```http
POST /api/public/elevenlabs/tools/load-call-context
```

Returns verified:

- call,
- provider,
- mode,
- confirmed specification,
- specification version/hash,
- authority,
- benchmark,
- eligible leverage.

### Save Quote Snapshot

```http
POST /api/public/elevenlabs/tools/save-quote-snapshot
```

Saves or updates an `INITIAL`, `REVISED`, or `FINAL` quote.

### Save Quote Line Item

```http
POST /api/public/elevenlabs/tools/save-quote-line-item
```

Attaches a confirmed item to the correct quote.

### Finalize Call Outcome

```http
POST /api/public/elevenlabs/tools/finalize-call-outcome
```

Stores the final outcome and triggers server-side verification.

### Post-Call Webhook

```http
POST /api/public/elevenlabs/post-call
```

Performs:

- signature verification,
- idempotency,
- transcript persistence,
- recording-reference persistence,
- reconciliation,
- processing-state updates.

### Tool Authentication

```http
X-BidPilot-Call-Token: {{secret__call_tool_token}}
```

The raw token must never be:

- logged,
- stored,
- shown in the UI,
- inserted into transcripts,
- or exposed to the LLM.

---

## Security

### Authentication and Authorization

- Supabase authentication
- User-owned negotiations
- RLS-protected access
- Server-derived ownership
- No browser-supplied owner authority

### Specification Integrity

- Canonicalization
- SHA-256 hashing
- Versioned confirmation
- Immutability
- Mismatch rejection

### Tool Security

- Short-lived per-call tokens
- Token hashes only
- Expiration
- Provider/call binding
- Specification version/hash checks
- No workspace-wide browser token

### Webhook Security

- HMAC verification
- Timing-safe comparison
- Event-hash idempotency
- Replay protection
- Sanitized errors

### Validation

- Zod schemas
- UUID validation
- Enum validation
- Date validation
- Range validation
- String sanitation
- Length limits
- Optional-value normalization

### Rate Limiting

Atomic Postgres-backed rate limits protect public voice endpoints.

### Evidence Safety

- Protected recording references
- Server-computed savings
- Review state for contradictions
- Unsupported claims excluded from recommendation

---

## Challenge Alignment

BidPilot targets the ElevenLabs **The Negotiator** challenge.

### Estimator

Required:

- ElevenLabs voice interview,
- at least one document type,
- one shared structured specification,
- customer confirmation,
- verbatim reuse across calls.

BidPilot includes manual and document intake. Full completion requires the customer voice-intake agent to persist into the same canonical draft and pass the final live acceptance test.

### Caller

Required:

- live calls,
- three distinct negotiation styles,
- same scope,
- itemized comparable quotes,
- friction handling,
- structured outcome per call.

BidPilot includes provider calls, context verification, quote persistence, and structured outcomes. The final demo must use three clean live calls with one confirmed hash.

### Closer

Required:

- real stored leverage,
- measurable price or term improvement,
- transcripts and recordings,
- ranked recommendation.

BidPilot includes leverage eligibility, staged quotes, finalization, evidence, and reporting architecture. Final compliance requires one clean leverage-driven negotiation and a populated final report.

### Honesty

The system forbids:

- fake bids,
- invented inventory,
- invented urgency,
- invented availability,
- unsupported savings,
- unauthorized acceptance,
- silent scope changes,
- different-spec leverage.

---

## Demo Guide

Use a fresh negotiation for judging.

### 1. Create the Move

Enter:

- route,
- date,
- access,
- inventory,
- services,
- priorities,
- authority.

### 2. Upload a Document

Show:

- extracted fields,
- current fields,
- conflicts,
- explicit merge decisions.

### 3. Complete Voice Intake

Show that customer voice answers update the same draft.

### 4. Confirm the Specification

Show:

- review,
- version,
- shortened hash,
- explicit lock.

### 5. Add Three Providers

Use:

- flexible,
- stonewaller/callback,
- upseller/hidden-fee.

### 6. Run Quote Calls

Show:

- context loaded,
- hash verified,
- transcript,
- initial quote,
- line items,
- structured outcome.

### 7. Run Negotiation

Use a stored comparable quote as leverage.

Show:

- leverage source,
- before amount/terms,
- leverage request,
- after amount/terms,
- final quote,
- final outcome.

### 8. Show Evidence and Report

Show:

- transcript support,
- recording reference,
- verified savings,
- comparison,
- risks,
- ranking,
- recommendation.

---

## Local Development

### Prerequisites

- Bun
- Supabase project
- ElevenLabs account
- Lovable project or equivalent runtime
- AI Gateway/OpenAI access

### Install

```bash
bun install
```

### Development

```bash
bun run dev
```

Check `package.json` if the repository uses a different command.

### Typecheck

```bash
bun run typecheck
```

### Build

```bash
bun run build
```

### Unit Tests

```bash
bunx vitest run
```

### Security Tests

```bash
bun run test:security
```

---

## Environment Variables

Never commit secrets. Use `.env.example` as the source of truth.

Typical categories:

### Supabase

```text
SUPABASE_URL
SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
```

### ElevenLabs

```text
ELEVENLABS_API_KEY
ELEVENLABS_PROVIDER_AGENT_ID
ELEVENLABS_WEBHOOK_SECRET
```

A separate intake-agent ID should be configured when the customer voice agent is deployed.

### AI Extraction

```text
OPENAI_API_KEY
```

or Lovable AI Gateway configuration.

### Application

```text
APP_URL
NODE_ENV
```

### Rules

- Never expose the ElevenLabs API key to the browser.
- Never expose the Supabase service-role key to the browser.
- Never persist raw call-tool tokens.
- Never place secrets in system prompts.
- Never log Authorization headers.

---

## Testing

### Unit Tests

Cover:

- canonical hashing,
- workflow transitions,
- reconciliation,
- quote stages,
- evidence states,
- supported amount parsing.

### Security Tests

Cover:

- unsigned webhook,
- forged signature,
- duplicate webhook,
- invalid token,
- expired token,
- cross-call token,
- wrong provider,
- stale specification version,
- stale specification hash,
- duplicate finalization,
- invalid savings claim,
- unsupported price-change claim,
- transcript mismatch,
- RLS isolation,
- concurrent rate limiting.

### Manual Voice Tests

Required:

- microphone permission,
- customer voice intake,
- provider quote call,
- interruption,
- “Are you a robot?”,
- callback,
- refusal,
- hidden-fee disclosure,
- revision,
- final confirmation,
- verified leverage,
- post-call transcript,
- recording reference,
- final report.

### Clean Challenge Test

```text
voice intake + document intake
→ same canonical draft
→ customer-confirmed specification
→ same version/hash across calls
→ three live styles
→ itemized outcomes
→ verified leverage
→ measurable improvement
→ transcript and recording evidence
→ ranked recommendation
```

---

## Deployment

**Production URL:** https://bidpilot-ai.lovable.app/

### Checklist

- Production secrets configured
- Supabase migrations applied
- RLS enabled
- ElevenLabs agent IDs configured
- Tools attached to correct agents
- Dynamic variables injected
- Secret token restricted to headers
- Post-call webhook configured
- Build passes
- Typecheck passes
- Unit tests pass
- Security tests pass
- One real end-to-end flow verified

### ElevenLabs Tool Header

```text
Type: Dynamic Variable
Name: X-BidPilot-Call-Token
Variable: secret__call_tool_token
```

---

## Current Status

The project has demonstrated:

- authentication,
- RLS,
- confirmed-specification hashing,
- same-spec call integrity,
- document extraction,
- live provider voice conversations,
- context loading,
- quote snapshot persistence,
- quote line-item persistence,
- structured finalization,
- workflow events,
- responsive UI,
- type safety,
- builds,
- and security tests.

The project should not claim full challenge completion until every final acceptance item below has real evidence.

---

## Final Acceptance Checklist

Use one fresh negotiation.

### Intake

- [ ] ElevenLabs customer voice intake saves to the same canonical draft.
- [ ] A real document populates the same draft.
- [ ] Conflicts are resolved explicitly.
- [ ] Customer confirms one specification.
- [ ] Confirmed version/hash are created.

### Calls

- [ ] Three distinct live styles are completed.
- [ ] All calls use the same version/hash.
- [ ] Each quote is structured and itemized.
- [ ] Each call ends with a structured outcome.
- [ ] Friction handling is demonstrated.

### Negotiation

- [ ] A real stored comparable quote becomes eligible leverage.
- [ ] Another provider receives that verified leverage.
- [ ] Price or a material term changes because of it.
- [ ] Initial, revised, and final stages are correct.

### Evidence

- [ ] Full transcripts are persisted.
- [ ] Recording references are securely available.
- [ ] Quote claims are supported by transcript evidence.
- [ ] Contradictions are surfaced.
- [ ] Missing evidence is not used as proof.

### Reporting

- [ ] Verified savings are computed server-side.
- [ ] All usable outcomes are ranked.
- [ ] Recommendation explains why the winner ranks first.
- [ ] Alternatives are explained.
- [ ] Transcript and recording evidence are cited.
- [ ] Readiness matrix shows all official criteria as PASS.

---

## Roadmap

### Immediate

- Complete persistent customer voice intake
- Run three clean negotiation styles
- Complete leverage-driven negotiation
- Complete transcript reconciliation
- Complete secure recording display
- Complete ranked final report
- Complete readiness matrix

### Product Expansion

- Twilio/SIP outbound telephony
- Provider discovery
- Parallel calling
- Callback scheduling
- Written-estimate ingestion
- Provider verification integrations
- Quote-expiry monitoring
- Customer approval workflow
- Human handoff
- Negotiation replay
- Golden call evaluation sets

### Future Verticals

- auto repair,
- contractor bids,
- storage,
- freight,
- equipment rental,
- wedding vendors,
- medical billing.

Each vertical should be configured through:

- job-spec schema,
- fee taxonomy,
- benchmark rules,
- red flags,
- leverage rules,
- outcome scoring.

---

## Project Principles

1. One confirmed job.
2. One comparable scope.
3. Real voice conversations.
4. Structured outcomes.
5. Itemized evidence.
6. Verified leverage only.
7. No fake bids.
8. No invented inventory.
9. No silent scope changes.
10. No unsupported savings.
11. No unauthorized acceptance.
12. No recommendation without sufficient evidence.

> When a fact cannot be verified, BidPilot does not use it as fact.

---

## License

No open-source license is declared yet.

Add a `LICENSE` file before offering the repository for reuse.

---

## Contact

**Zulaid Ahmad Abbasi**  
Creator and developer of BidPilot AI

**Live App:** https://bidpilot-ai.lovable.app/

---

## Acknowledgements

Built for the Hack-Nation 6th Global AI Hackathon and the ElevenLabs **The Negotiator** challenge.

BidPilot demonstrates how voice agents can move beyond conversation and become accountable systems for gathering evidence, negotiating honestly, and helping users make safer decisions.
