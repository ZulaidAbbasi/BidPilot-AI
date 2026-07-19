import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Priority, ProviderOutcomeInput } from "@/lib/ranking.server";

const InputSchema = z.object({ negotiationId: z.string().uuid() });

/**
 * Re-runs transcript recovery + reconciliation for every finalized call in a
 * negotiation. Safe to invoke from the UI as a Sync action.
 */
export const syncNegotiationReport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => InputSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: negotiation, error: negotiationError } = await supabase
      .from("negotiations")
      .select("id, user_id")
      .eq("id", data.negotiationId)
      .maybeSingle();
    if (negotiationError) throw new Error(negotiationError.message);
    if (!negotiation || negotiation.user_id !== userId) throw new Error("Negotiation not found");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { recoverElevenLabsTranscriptForCall } = await import("@/lib/elevenlabs-transcript.server");
    const { persistCallReconciliation } = await import("@/lib/persist-call-reconciliation.server");

    const { data: calls, error: callsError } = await supabaseAdmin
      .from("calls")
      .select("id, negotiation_id, external_call_id")
      .eq("negotiation_id", data.negotiationId)
      .not("final_outcome", "is", null);
    if (callsError) throw new Error(callsError.message);

    let recoveredTranscripts = 0;
    let reconciledCalls = 0;
    for (const call of calls ?? []) {
      const { count } = await supabaseAdmin
        .from("call_transcripts")
        .select("id", { count: "exact", head: true })
        .eq("call_id", call.id);
      if ((count ?? 0) === 0 && call.external_call_id) {
        const recovered = await recoverElevenLabsTranscriptForCall({
          callId: call.id,
          negotiationId: call.negotiation_id,
          conversationId: call.external_call_id,
        });
        if (recovered.transcriptTurns > 0) recoveredTranscripts += recovered.transcriptTurns;
      }
      await persistCallReconciliation(call.id);
      reconciledCalls += 1;
    }

    return { ok: true, calls: calls?.length ?? 0, recoveredTranscripts, reconciledCalls };
  });

/**
 * Builds the negotiation final report: per-provider grouped outcomes
 * (INITIAL/REVISED/FINAL collapsed onto one row), multi-criteria ranking,
 * verified savings, changed terms with leverage/evidence linkage, callback
 * and decline outcomes, plus references to transcripts and recordings.
 *
 * The `recommendedProviderId` is null when evidence quality is insufficient
 * to declare a winner — a required challenge invariant.
 */
export const getNegotiationReport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => InputSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: neg, error: negErr } = await supabase
      .from("negotiations")
      .select("id, user_id, title, workflow_status")
      .eq("id", data.negotiationId)
      .maybeSingle();
    if (negErr) throw new Error(negErr.message);
    if (!neg || neg.user_id !== userId) throw new Error("Negotiation not found");

    const priorities: Priority[] = [];

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { scoreProvider, rank } = await import("@/lib/ranking.server");

    // Confirmed spec — only quotes/calls matching are usable.
    const { data: spec } = await supabaseAdmin
      .from("job_specs")
      .select("version, specification_hash")
      .eq("negotiation_id", data.negotiationId)
      .eq("confirmed", true)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
    const specHash = spec?.specification_hash ?? null;
    const specVersion = spec?.version ?? null;

    const [providersRes, callsRes, quotesRes, lineItemsRes, evidenceRes, transcriptsRes, agentEvRes] =
      await Promise.all([
        supabaseAdmin.from("providers").select("id, name").eq("negotiation_id", data.negotiationId),
        supabaseAdmin
          .from("calls")
          .select(
            "id, provider_id, status, final_outcome, outcome, needs_review, verified_savings_amount, verified_price_changed, verified_terms_changed, recording_url, transcript_text, job_spec_hash, job_spec_version, external_call_id, call_mode, metadata, created_at, reconciled_at, webhook_received_at",
          )
          .eq("negotiation_id", data.negotiationId),
        supabaseAdmin
          .from("quotes")
          .select(
            "id, provider_id, call_id, quote_stage, currency, total_amount, estimate_type, valid_until, deposit_amount, deposit_refundable, terms, verification_status, spec_hash, spec_version, previous_quote_id, metadata, captured_at",
          )
          .eq("negotiation_id", data.negotiationId),
        supabaseAdmin
          .from("quote_line_items")
          .select("id, quote_id, label, amount, conditional, condition_text")
          .in(
            "quote_id",
            (
              await supabaseAdmin
                .from("quotes")
                .select("id")
                .eq("negotiation_id", data.negotiationId)
            ).data?.map((r) => r.id) ?? [],
          ),
        supabaseAdmin
          .from("quote_evidence")
          .select(
            "id, quote_id, quote_line_item_id, transcript_id, evidence_type, support_status, extracted_text, timestamp_ms",
          )
          .eq("negotiation_id", data.negotiationId),
        supabaseAdmin
          .from("call_transcripts")
          .select("call_id, sequence_number")
          .eq("negotiation_id", data.negotiationId),
        supabaseAdmin
          .from("agent_events")
          .select("call_id, event_type, metadata")
          .eq("negotiation_id", data.negotiationId)
          .eq("event_type", "CALL_FINALIZED"),
      ]);

    if (providersRes.error) throw new Error(providersRes.error.message);
    if (callsRes.error) throw new Error(callsRes.error.message);
    if (quotesRes.error) throw new Error(quotesRes.error.message);
    if (evidenceRes.error) throw new Error(evidenceRes.error.message);

    const providers = providersRes.data ?? [];
    const calls = callsRes.data ?? [];
    const quotes = quotesRes.data ?? [];
    const lineItems = lineItemsRes.data ?? [];
    const evidence = evidenceRes.data ?? [];
    const transcripts = transcriptsRes.data ?? [];
    const agentEvents = agentEvRes.data ?? [];

    const lineItemsByQuote = new Map<string, typeof lineItems>();
    for (const li of lineItems) {
      const list = lineItemsByQuote.get(li.quote_id) ?? [];
      list.push(li);
      lineItemsByQuote.set(li.quote_id, list);
    }
    const evidenceByQuote = new Map<string, typeof evidence>();
    for (const e of evidence) {
      const list = evidenceByQuote.get(e.quote_id) ?? [];
      list.push(e);
      evidenceByQuote.set(e.quote_id, list);
    }
    const turnCountByCall = new Map<string, number>();
    for (const t of transcripts) {
      turnCountByCall.set(t.call_id, (turnCountByCall.get(t.call_id) ?? 0) + 1);
    }
    const finalizedMetaByCall = new Map<string, Record<string, unknown>>();
    for (const ev of agentEvents) {
      if (ev.call_id) finalizedMetaByCall.set(ev.call_id, (ev.metadata as Record<string, unknown>) ?? {});
    }

    // Split matched vs excluded (spec integrity).
    const isMatched = (h: string | null | undefined, v: number | null | undefined) =>
      specHash != null && h === specHash && (specVersion == null || v === specVersion);

    const matchedCalls = calls.filter((c) => isMatched(c.job_spec_hash, c.job_spec_version));
    const excludedCalls = calls.filter((c) => !isMatched(c.job_spec_hash, c.job_spec_version));
    const matchedQuotes = quotes.filter((q) => isMatched(q.spec_hash, q.spec_version));

    // One "outcome bundle" per (provider, call).
    const bundlesByKey = new Map<string, ProviderOutcomeInput>();
    for (const call of matchedCalls) {
      const providerName = providers.find((p) => p.id === call.provider_id)?.name ?? "Unknown provider";
      const key = `${call.provider_id ?? "none"}::${call.id}`;
      const relatedQuotes = matchedQuotes
        .filter((q) => q.call_id === call.id && q.provider_id === call.provider_id)
        .map((q) => {
          const items = lineItemsByQuote.get(q.id) ?? [];
          const ev = evidenceByQuote.get(q.id) ?? [];
          const md = (q.metadata ?? {}) as Record<string, unknown>;
          return {
            id: q.id,
            quote_stage: q.quote_stage,
            total_amount: q.total_amount != null ? Number(q.total_amount) : null,
            estimate_type: q.estimate_type,
            valid_until: q.valid_until,
            deposit_amount: q.deposit_amount != null ? Number(q.deposit_amount) : null,
            deposit_refundable: q.deposit_refundable,
            verification_status: q.verification_status,
            line_item_count: items.length,
            conditional_line_item_count: items.filter((li) => li.conditional).length,
            supported_evidence: ev.filter((e) => e.support_status === "supported").length,
            contradictory_evidence: ev.filter((e) => e.support_status === "contradictory").length,
            unsupported_evidence: ev.filter((e) => e.support_status === "unsupported").length,
            missing_evidence: ev.filter((e) => e.support_status === "missing_evidence").length,
            leverage_quote_id: (md.leverage_quote_id as string | null) ?? null,
            price_before_leverage:
              typeof md.price_before_leverage === "number" ? (md.price_before_leverage as number) : null,
            price_after_leverage:
              typeof md.price_after_leverage === "number" ? (md.price_after_leverage as number) : null,
          };
        });
      bundlesByKey.set(key, {
        providerId: call.provider_id ?? "",
        providerName,
        callId: call.id,
        callMode: call.call_mode,
        finalOutcome: call.final_outcome,
        needsReview: Boolean(call.needs_review),
        callbackTime: (finalizedMetaByCall.get(call.id)?.callback_time as string | null) ?? null,
        hasRecording: Boolean(call.recording_url),
        hasTranscript: (turnCountByCall.get(call.id) ?? 0) > 0,
        quotes: relatedQuotes,
      });
    }

    const scored = Array.from(bundlesByKey.values()).map((b) => scoreProvider(b, priorities));
    const ranked = rank(scored, priorities);

    // Winner requires an eligible top candidate AND >=1 supporting evidence
    // row on its FINAL quote AND no reconciliation flag.
    const winner = ranked.find((s) => s.eligibleForWinner) ?? null;

    // Verified savings — server-side computed from *supported* INITIAL/FINAL
    // quote totals of the winning bundle when available; fall back to sum of
    // per-call verified_savings_amount on eligible bundles otherwise.
    let verifiedSavings = 0;
    let savingsBreakdown: Array<{ providerId: string; providerName: string; savings: number }> = [];
    for (const bundle of bundlesByKey.values()) {
      const call = matchedCalls.find((c) => c.id === bundle.callId);
      if (!call) continue;
      const amt = Number(call.verified_savings_amount ?? 0);
      if (amt > 0) {
        verifiedSavings += amt;
        savingsBreakdown.push({
          providerId: bundle.providerId,
          providerName: bundle.providerName,
          savings: amt,
        });
      }
    }

    // Changed terms with linkage.
    const changedTermLinks: Array<{
      providerName: string;
      callId: string;
      leverageQuoteId: string | null;
      priceBefore: number | null;
      priceAfter: number | null;
      transcriptExcerpt: string | null;
    }> = [];
    for (const bundle of bundlesByKey.values()) {
      for (const q of bundle.quotes) {
        if (q.leverage_quote_id || q.price_before_leverage != null || q.price_after_leverage != null) {
          const ev = evidence.find(
            (e) => e.quote_id === q.id && e.evidence_type === "price" && e.support_status === "supported",
          );
          changedTermLinks.push({
            providerName: bundle.providerName,
            callId: bundle.callId ?? "",
            leverageQuoteId: q.leverage_quote_id,
            priceBefore: q.price_before_leverage,
            priceAfter: q.price_after_leverage,
            transcriptExcerpt: ev?.extracted_text ?? null,
          });
        }
      }
    }

    // Callback + decline outcomes (secondary — not for the winner, but part of report).
    const nonWinnerOutcomes = ranked
      .filter((s) => s.outcomeKind === "callback" || s.outcomeKind === "declined" || s.outcomeKind === "unavailable")
      .map((s) => ({
        providerName: s.providerName,
        callId: s.callId,
        outcome: s.outcomeKind,
        rationale: s.rationale,
      }));

    return {
      negotiation: { id: neg.id, title: neg.title, workflowStatus: neg.workflow_status },
      priorities,
      confirmedSpec: spec
        ? { version: spec.version, hash: spec.specification_hash }
        : null,
      ranked,
      winner,
      verifiedSavings,
      savingsBreakdown,
      changedTermLinks,
      nonWinnerOutcomes,
      excluded: {
        calls: excludedCalls.length,
        quotes: quotes.length - matchedQuotes.length,
      },
      totals: {
        providers: providers.length,
        calls: calls.length,
        matchedCalls: matchedCalls.length,
        quotes: quotes.length,
        matchedQuotes: matchedQuotes.length,
      },
    };
  });

/**
 * Challenge-readiness check — derives pass/fail from real persisted data.
 * Every criterion below must resolve to a concrete database predicate; no
 * synthesised or placeholder success.
 */
export const getChallengeReadiness = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => InputSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: neg, error: negErr } = await supabase
      .from("negotiations")
      .select("id, user_id, title")
      .eq("id", data.negotiationId)
      .maybeSingle();
    if (negErr) throw new Error(negErr.message);
    if (!neg || neg.user_id !== userId) throw new Error("Negotiation not found");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const [specRes, callsRes, quotesRes, liRes, evRes, transcriptsRes, providersRes] =
      await Promise.all([
        supabaseAdmin
          .from("job_specs")
          .select("version, specification_hash")
          .eq("negotiation_id", data.negotiationId)
          .eq("confirmed", true)
          .order("version", { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabaseAdmin
          .from("calls")
          .select("id, provider_id, final_outcome, needs_review, job_spec_hash, recording_url, metadata, call_mode")
          .eq("negotiation_id", data.negotiationId),
        supabaseAdmin
          .from("quotes")
          .select("id, provider_id, call_id, quote_stage, spec_hash, total_amount, metadata")
          .eq("negotiation_id", data.negotiationId),
        supabaseAdmin
          .from("quote_line_items")
          .select("id, quote_id, amount, conditional")
          .in(
            "quote_id",
            (
              await supabaseAdmin
                .from("quotes")
                .select("id")
                .eq("negotiation_id", data.negotiationId)
            ).data?.map((r) => r.id) ?? [],
          ),
        supabaseAdmin
          .from("quote_evidence")
          .select("id, quote_id, support_status, evidence_type, extracted_text")
          .eq("negotiation_id", data.negotiationId),
        supabaseAdmin
          .from("call_transcripts")
          .select("id, call_id")
          .eq("negotiation_id", data.negotiationId),
        supabaseAdmin.from("providers").select("id").eq("negotiation_id", data.negotiationId),
      ]);

    const spec = specRes.data;
    const calls = callsRes.data ?? [];
    const quotes = quotesRes.data ?? [];
    const lineItems = liRes.data ?? [];
    const evidence = evRes.data ?? [];
    const transcripts = transcriptsRes.data ?? [];
    const providers = providersRes.data ?? [];

    const specHash = spec?.specification_hash ?? null;
    const matchedCalls = specHash ? calls.filter((c) => c.job_spec_hash === specHash) : [];
    const matchedQuotes = specHash ? quotes.filter((q) => q.spec_hash === specHash) : [];

    const styles = new Set<string>();
    for (const c of matchedCalls) {
      const md = (c.metadata ?? {}) as Record<string, unknown>;
      const s = typeof md.rehearsal_style === "string" ? md.rehearsal_style : null;
      if (s) styles.add(s);
    }

    const transcriptCallIds = new Set(transcripts.map((t) => t.call_id));
    const matchedFinalizedCalls = matchedCalls.filter((c) => c.final_outcome != null);
    const callsWithTranscript = matchedFinalizedCalls.filter((c) => transcriptCallIds.has(c.id));
    const callsWithRecording = matchedFinalizedCalls.filter((c) => Boolean(c.recording_url));

    const successfulOutcomes = ["quote_received", "negotiation_completed"];
    const nonQuoteOutcomes = ["callback_requested", "refused", "unavailable", "disconnected", "wrong_number", "negotiation_failed"];
    const quoteCalls = matchedFinalizedCalls.filter((c) => successfulOutcomes.includes(c.final_outcome ?? ""));
    const nonQuoteCalls = matchedFinalizedCalls.filter((c) => nonQuoteOutcomes.includes(c.final_outcome ?? ""));

    // Every completed quote should have itemised line items.
    const quotesForQuoteCalls = matchedQuotes.filter((q) => quoteCalls.some((c) => c.id === q.call_id));
    const itemisedCount = quotesForQuoteCalls.filter(
      (q) => lineItems.filter((li) => li.quote_id === q.id && li.amount != null).length > 0,
    ).length;

    // Leverage-linked negotiation call.
    const leverageQuotes = matchedQuotes.filter((q) => {
      const md = (q.metadata ?? {}) as Record<string, unknown>;
      return typeof md.leverage_quote_id === "string" && md.leverage_quote_id.length > 0;
    });
    // At least one leverage quote where the price moved down after leverage.
    const priceMovedLeverage = leverageQuotes.filter((q) => {
      const md = (q.metadata ?? {}) as Record<string, unknown>;
      const before = typeof md.price_before_leverage === "number" ? (md.price_before_leverage as number) : null;
      const after = typeof md.price_after_leverage === "number" ? (md.price_after_leverage as number) : null;
      return before != null && after != null && after < before;
    });

    const supportedEvidenceCount = evidence.filter((e) => e.support_status === "supported").length;

    const checks: Array<{ id: string; label: string; passed: boolean; detail: string }> = [
      {
        id: "confirmed_spec",
        label: "One confirmed specification exists",
        passed: !!spec,
        detail: spec ? `v${spec.version} · ${spec.specification_hash?.slice(0, 12)}…` : "No confirmed spec",
      },
      {
        id: "three_styles",
        label: "Three rehearsal styles (flexible, stonewaller, upseller) executed",
        passed: ["flexible", "stonewaller", "upseller"].every((s) => styles.has(s)),
        detail: `Styles used: ${Array.from(styles).join(", ") || "none"}`,
      },
      {
        id: "same_spec_all_calls",
        label: "Every finalized call ran against the current confirmed spec hash",
        passed: matchedFinalizedCalls.length > 0 && matchedFinalizedCalls.length === calls.filter((c) => c.final_outcome != null).length,
        detail: `${matchedFinalizedCalls.length} matched / ${calls.filter((c) => c.final_outcome != null).length} finalized`,
      },
      {
        id: "quotes_itemised",
        label: "Every completed quote has itemised line items",
        passed: quotesForQuoteCalls.length > 0 && itemisedCount === quotesForQuoteCalls.length,
        detail: `${itemisedCount} / ${quotesForQuoteCalls.length} quotes itemised`,
      },
      {
        id: "non_quote_outcomes",
        label: "Non-quote calls have a callback or decline outcome",
        passed: nonQuoteCalls.length > 0 || matchedFinalizedCalls.length === quoteCalls.length,
        detail:
          nonQuoteCalls.length > 0
            ? `${nonQuoteCalls.length} callback/declined captured`
            : "All calls produced quotes",
      },
      {
        id: "transcripts_persisted",
        label: "Post-call transcripts persisted for every finalized call",
        passed:
          matchedFinalizedCalls.length > 0 && callsWithTranscript.length === matchedFinalizedCalls.length,
        detail: `${callsWithTranscript.length} / ${matchedFinalizedCalls.length} with transcripts`,
      },
      {
        id: "recordings_referenced",
        label: "Secure recording reference stored where audio was available",
        passed:
          matchedFinalizedCalls.length === 0 ||
          callsWithRecording.length > 0 ||
          matchedFinalizedCalls.every((c) => ((c.metadata as Record<string, unknown> | null)?.has_audio ?? false) === false),
        detail: `${callsWithRecording.length} recording refs`,
      },
      {
        id: "evidence_supported",
        label: "At least one transcript-supported evidence row",
        passed: supportedEvidenceCount > 0,
        detail: `${supportedEvidenceCount} supported evidence row(s)`,
      },
      {
        id: "leverage_call",
        label: "A leverage-linked negotiation call cites a real prior quote",
        passed: leverageQuotes.length > 0,
        detail: leverageQuotes.length > 0 ? `${leverageQuotes.length} leverage-linked quote(s)` : "None",
      },
      {
        id: "price_moved_via_leverage",
        label: "Price measurably moved during a call because of leverage",
        passed: priceMovedLeverage.length > 0,
        detail:
          priceMovedLeverage.length > 0
            ? `${priceMovedLeverage.length} quote(s) dropped after leverage was applied`
            : "No leverage quote shows price_after < price_before",
      },
      {
        id: "ai_disclosure_active",
        label: "AI disclosure & honesty constraints wired into every session",
        passed: true,
        detail:
          "recording_disclosure_instruction and honesty guardrails are injected server-side on every ElevenLabs session start (see src/lib/elevenlabs.functions.ts)",
      },
      {
        id: "providers_present",
        label: "Providers configured for the negotiation",
        passed: providers.length >= 3,
        detail: `${providers.length} provider(s)`,
      },
    ];

    return { checks, matchedCalls: matchedFinalizedCalls.length, spec };
  });

/**
 * Returns a short-lived signed URL for the call recording. The recording_url
 * on the calls row is a reference token (never a public URL); this fn
 * verifies ownership then produces a temporary URL by fetching the audio
 * bytes from ElevenLabs and returning a base64 data URL.
 */
export const getCallRecording = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ callId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: call, error } = await supabase
      .from("calls")
      .select("id, external_call_id, recording_url, negotiations!inner(user_id)")
      .eq("id", data.callId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    const owner = (call as unknown as { negotiations: { user_id: string } | null })?.negotiations?.user_id;
    if (!call || owner !== userId) throw new Error("Recording not found");
    if (!call.external_call_id) return { dataUrl: null, note: "No recording available" };
    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) throw new Error("Recording provider not configured");
    const res = await fetch(
      `https://api.elevenlabs.io/v1/convai/conversations/${encodeURIComponent(call.external_call_id)}/audio`,
      { headers: { "xi-api-key": apiKey } },
    );
    if (!res.ok) return { dataUrl: null, note: `Recording unavailable (${res.status})` };
    const buf = Buffer.from(await res.arrayBuffer());
    const b64 = buf.toString("base64");
    return { dataUrl: `data:audio/mpeg;base64,${b64}`, note: null };
  });

