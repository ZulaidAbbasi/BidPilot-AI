import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { scoreProvider, type ProviderOutcomeInput } from "@/lib/ranking.server";
import { applyOutliersToScoredProviders } from "@/lib/build-report.server";

/**
 * Judge Mode data — picks the most complete negotiation belonging to the
 * signed-in user and returns a compact, honest snapshot spanning the entire
 * challenge surface. No fabricated fields; missing pieces are surfaced as
 * such so a reviewer can see exactly what has been demonstrated and what
 * hasn't.
 */
export const getJudgeModeSnapshot = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;

    // Score every negotiation by evidence completeness and pick the top.
    const { data: negotiations, error: negErr } = await supabase
      .from("negotiations")
      .select("id, title, workflow_status, created_at, updated_at, vertical, moving_date")
      .eq("user_id", userId)
      .order("updated_at", { ascending: false });
    if (negErr) throw new Error(negErr.message);
    if (!negotiations || negotiations.length === 0) {
      return { available: false as const, reason: "no_negotiations" as const };
    }

    // For scoring we need counts across several tables. Do it in parallel per
    // negotiation but capped — dev accounts usually only have a handful.
    const ids = negotiations.map((n) => n.id).slice(0, 20);

    const [callsRes, quotesRes, evidenceRes, transcriptsRes, specsRes, providersRes] =
      await Promise.all([
        supabase
          .from("calls")
          .select(
            "id, negotiation_id, provider_id, status, final_outcome, needs_review, verified_savings_amount, verified_price_changed, verified_terms_changed, recording_url, job_spec_hash, job_spec_version, call_mode, metadata, started_at, ended_at",
          )
          .in("negotiation_id", ids),
        supabase
          .from("quotes")
          .select(
            "id, negotiation_id, provider_id, call_id, quote_stage, currency, total_amount, low_amount, high_amount, estimate_type, valid_until, deposit_amount, deposit_refundable, verification_status, spec_hash, spec_version, metadata, captured_at, final_confirmed_at",
          )
          .in("negotiation_id", ids),
        supabase
          .from("quote_evidence")
          .select("id, negotiation_id, quote_id, support_status, evidence_type")
          .in("negotiation_id", ids),
        supabase
          .from("call_transcripts")
          .select("call_id, negotiation_id, sequence_number")
          .in("negotiation_id", ids),
        supabase
          .from("job_specs")
          .select("id, negotiation_id, version, specification_hash, confirmed, confirmed_at")
          .in("negotiation_id", ids)
          .eq("confirmed", true),
        supabase
          .from("providers")
          .select("id, negotiation_id, name, source")
          .in("negotiation_id", ids),
      ]);

    const calls = callsRes.data ?? [];
    const quotes = quotesRes.data ?? [];
    const evidence = evidenceRes.data ?? [];
    const transcripts = transcriptsRes.data ?? [];
    const specs = specsRes.data ?? [];
    const providers = providersRes.data ?? [];

    const score = (negId: string) => {
      const nCalls = calls.filter((c) => c.negotiation_id === negId);
      const nQuotes = quotes.filter((q) => q.negotiation_id === negId);
      const nSpec = specs.find((s) => s.negotiation_id === negId);
      const nTranscripts = transcripts.filter((t) => t.negotiation_id === negId);
      const finalizedCalls = nCalls.filter((c) => c.final_outcome != null).length;
      const styleSet = new Set(
        nCalls
          .map((c) => (c.metadata as Record<string, unknown> | null)?.rehearsal_style)
          .filter(Boolean),
      );
      return (
        (nSpec ? 30 : 0) +
        finalizedCalls * 8 +
        nQuotes.length * 4 +
        styleSet.size * 6 +
        (nTranscripts.length > 0 ? 10 : 0) +
        Math.min(nCalls.length, 5)
      );
    };

    const top = [...ids].sort((a, b) => score(b) - score(a))[0];
    const topScore = score(top);
    const negotiation = negotiations.find((n) => n.id === top)!;

    const nCalls = calls.filter((c) => c.negotiation_id === top);
    const nQuotes = quotes.filter((q) => q.negotiation_id === top);
    const nEvidence = evidence.filter((e) => e.negotiation_id === top);
    const nTranscripts = transcripts.filter((t) => t.negotiation_id === top);
    const nSpec = specs.find((s) => s.negotiation_id === top) ?? null;
    const nProviders = providers.filter((p) => p.negotiation_id === top);

    // Same-spec integrity buckets.
    const matched = (h: string | null | undefined, v: number | null | undefined) =>
      !!nSpec && h === nSpec.specification_hash && (nSpec.version === v || v == null);

    const matchedCalls = nCalls.filter((c) => matched(c.job_spec_hash, c.job_spec_version));
    const matchedQuotes = nQuotes.filter((q) => matched(q.spec_hash, q.spec_version));

    // Style coverage — real values from call.metadata.rehearsal_style.
    const styles = Array.from(
      new Set(
        nCalls
          .map(
            (c) =>
              (c.metadata as Record<string, unknown> | null)?.rehearsal_style as string | undefined,
          )
          .filter((s): s is string => !!s),
      ),
    );

    // Leverage evidence: quotes that carry leverage metadata.
    const leverageMoves = nQuotes.filter((q) => {
      const md = (q.metadata as Record<string, unknown> | null) ?? {};
      return (
        md.leverage_quote_id != null ||
        md.price_before_leverage != null ||
        md.price_after_leverage != null
      );
    });

    // Price / term improvements — verified fields on calls.
    const improvements = nCalls
      .filter((c) => c.verified_price_changed || c.verified_terms_changed)
      .map((c) => ({
        callId: c.id,
        priceChanged: !!c.verified_price_changed,
        termsChanged: !!c.verified_terms_changed,
        savings: c.verified_savings_amount != null ? Number(c.verified_savings_amount) : null,
      }));

    const verifiedSavings = nCalls.reduce(
      (sum, c) => sum + Number(c.verified_savings_amount ?? 0),
      0,
    );

    // Recording references — count of calls with a stored URL (URL itself is
    // NOT returned; access remains gated by signed server function).
    const recordingCount = nCalls.filter((c) => !!c.recording_url).length;

    const finalizedCalls = nCalls.filter((c) => c.final_outcome != null);
    const auditableFailedCalls = nCalls.filter(
      (c) => c.status === "failed" || c.needs_review,
    ).length;

    // Intake provenance — look at agent_events for voice/document sources.
    const { data: intakeEvents } = await supabase
      .from("agent_events")
      .select("event_type, metadata, created_at")
      .eq("negotiation_id", top);

    const intake = {
      voice: (intakeEvents ?? []).some(
        (e) => e.event_type === "SPEC_VOICE_CAPTURED" || e.event_type === "INTAKE_VOICE",
      ),
      document: (intakeEvents ?? []).some(
        (e) => e.event_type === "SPEC_DOCUMENT_IMPORTED" || e.event_type === "INTAKE_DOCUMENT",
      ),
    };

    // Completeness gates - drive the "authentic completed demonstration" badge.
    const gates = {
      confirmedSpec: !!nSpec,
      threeStyles: styles.length >= 3,
      matchedCalls: matchedCalls.length > 0,
      itemizedQuotes: nQuotes.some((q) => q.total_amount != null),
      leverage: leverageMoves.length > 0,
      improvement: improvements.length > 0,
      transcript: nTranscripts.length > 0,
      recording: recordingCount > 0,
      verifiedSavings: verifiedSavings > 0,
    };
    const gatesPassed = Object.values(gates).filter(Boolean).length;
    const gatesTotal = Object.keys(gates).length;
    const isAuthenticDemo = gatesPassed >= 7; // ≥7/9 = "authentic completed demonstration"

    // Server-side low-outlier detection over the same-spec, evidence-supported,
    // FINAL + final_confirmed comparable set — identical helper the Final Report
    // uses. Judge Mode surfaces the results read-only; no browser math.
    const nLineItems = (
      await supabase
        .from("quote_line_items")
        .select("id, quote_id, amount, conditional")
        .in("quote_id", nQuotes.map((q) => q.id))
    ).data ?? [];

    const bundlesByKey = new Map<string, ProviderOutcomeInput>();
    for (const call of matchedCalls) {
      const providerName = nProviders.find((p) => p.id === call.provider_id)?.name ?? "Provider";
      const key = `${call.provider_id ?? "none"}::${call.id}`;
      const relatedQuotes = matchedQuotes
        .filter((q) => q.call_id === call.id && q.provider_id === call.provider_id)
        .map((q) => {
          const items = nLineItems.filter((li) => li.quote_id === q.id);
          const ev = nEvidence.filter((e) => e.quote_id === q.id);
          return {
            id: q.id,
            quote_stage: q.quote_stage,
            total_amount: q.total_amount != null ? Number(q.total_amount) : null,
            high_amount:
              (q as { high_amount: number | string | null }).high_amount != null
                ? Number((q as { high_amount: number | string | null }).high_amount)
                : null,
            estimate_type: (q as { estimate_type: string | null }).estimate_type ?? null,
            valid_until: (q as { valid_until: string | null }).valid_until ?? null,
            deposit_amount:
              (q as { deposit_amount: number | string | null }).deposit_amount != null
                ? Number((q as { deposit_amount: number | string | null }).deposit_amount)
                : null,
            deposit_refundable:
              (q as { deposit_refundable: boolean | null }).deposit_refundable ?? null,
            verification_status: q.verification_status,
            final_confirmed:
              q.quote_stage === "FINAL" &&
              (q as { final_confirmed_at: string | null }).final_confirmed_at != null,
            line_item_count: items.length,
            conditional_line_item_count: items.filter((li) => li.conditional).length,
            supported_evidence: ev.filter((e) => e.support_status === "supported").length,
            contradictory_evidence: ev.filter((e) => e.support_status === "contradictory").length,
            unsupported_evidence: ev.filter((e) => e.support_status === "unsupported").length,
            missing_evidence: ev.filter((e) => e.support_status === "missing_evidence").length,
            leverage_quote_id: null,
            price_before_leverage: null,
            price_after_leverage: null,
          };
        });
      bundlesByKey.set(key, {
        providerId: call.provider_id ?? "",
        providerName,
        callId: call.id,
        callMode: call.call_mode,
        finalOutcome: call.final_outcome,
        needsReview: Boolean(call.needs_review),
        callbackTime: null,
        hasRecording: Boolean(call.recording_url),
        hasTranscript: nTranscripts.some((t) => t.call_id === call.id),
        quotes: relatedQuotes,
      });
    }
    const scored = Array.from(bundlesByKey.values()).map((b) => scoreProvider(b, []));
    const lowOutliers = applyOutliersToScoredProviders(scored);


    return {
      available: true as const,
      completenessScore: topScore,
      isAuthenticDemo,
      gatesPassed,
      gatesTotal,
      negotiation: {
        id: negotiation.id,
        title: negotiation.title,
        workflowStatus: negotiation.workflow_status,
        vertical: negotiation.vertical,
        movingDate: negotiation.moving_date,
        updatedAt: negotiation.updated_at,
      },
      confirmedSpec: nSpec
        ? {
            version: nSpec.version,
            hash: nSpec.specification_hash,
            confirmedAt: nSpec.confirmed_at,
          }
        : null,
      intake,
      counts: {
        providers: nProviders.length,
        calls: nCalls.length,
        finalizedCalls: finalizedCalls.length,
        auditableFailedCalls,
        matchedCalls: matchedCalls.length,
        quotes: nQuotes.length,
        matchedQuotes: matchedQuotes.length,
        transcriptTurns: nTranscripts.length,
        recordings: recordingCount,
        evidenceRows: nEvidence.length,
      },
      styles,
      leverageMoves: leverageMoves.map((q) => {
        const md = (q.metadata as Record<string, unknown> | null) ?? {};
        return {
          quoteId: q.id,
          providerId: q.provider_id,
          before: typeof md.price_before_leverage === "number" ? md.price_before_leverage : null,
          after: typeof md.price_after_leverage === "number" ? md.price_after_leverage : null,
        };
      }),
      improvements,
      verifiedSavings,
      alternatives: negotiations
        .filter((n) => n.id !== top)
        .slice(0, 5)
        .map((n) => ({
          id: n.id,
          title: n.title,
          status: n.workflow_status,
          score: score(n.id),
        })),
      gates,
      lowOutliers,
    };
  });
