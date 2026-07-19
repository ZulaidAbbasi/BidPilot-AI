import { reconcile, type LineItemRow, type QuoteRow } from "@/lib/call-reconciliation.server";

type FinalEventMetadata = {
  changed_terms?: unknown;
  red_flags?: unknown;
  validation?: {
    claimed_price_changed?: unknown;
    claimed_savings?: unknown;
    claimed_terms_changed?: unknown;
  };
};

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}

/**
 * Re-run quote/transcript reconciliation from persisted records.
 * This is intentionally called after the ElevenLabs post-call transcript lands,
 * because finalization often happens before the post-call webhook is delivered.
 */
export async function persistCallReconciliation(callId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { data: call, error: callErr } = await supabaseAdmin
    .from("calls")
    .select(
      "id, negotiation_id, status, final_outcome, webhook_received_at, verified_terms_changed",
    )
    .eq("id", callId)
    .maybeSingle();
  if (callErr || !call) {
    throw new Error(callErr?.message ?? "Call not found for reconciliation");
  }

  const { data: quotesRaw, error: quoteErr } = await supabaseAdmin
    .from("quotes")
    .select(
      "id, quote_stage, total_amount, low_amount, high_amount, deposit_amount, terms, price_change_conditions, captured_at",
    )
    .eq("call_id", callId);
  if (quoteErr) throw new Error(quoteErr.message);
  const quotes = (quotesRaw ?? []) as QuoteRow[];

  const quoteIds = quotes.map((quote) => quote.id);
  const lineItemsByQuote: Record<string, LineItemRow[]> = {};
  if (quoteIds.length > 0) {
    const { data: rows, error: lineErr } = await supabaseAdmin
      .from("quote_line_items")
      .select("id, quote_id, label, amount, provider_words, category, included")
      .in("quote_id", quoteIds);
    if (lineErr) throw new Error(lineErr.message);
    for (const row of (rows ?? []) as Array<LineItemRow & { quote_id: string }>) {
      (lineItemsByQuote[row.quote_id] ||= []).push({
        id: row.id,
        label: row.label,
        amount: row.amount,
        provider_words: row.provider_words,
        category: row.category ?? null,
        included: row.included ?? null,
      });
    }
  }


  const { data: transcriptRaw, error: transcriptErr } = await supabaseAdmin
    .from("call_transcripts")
    .select("id, text, sequence_number, started_at_ms")
    .eq("call_id", callId)
    .order("sequence_number", { ascending: true });
  if (transcriptErr) throw new Error(transcriptErr.message);
  const transcripts = (transcriptRaw ?? []) as Array<{
    id: string;
    text: string;
    sequence_number: number;
    started_at_ms: number | null;
  }>;

  const { data: finalEvent } = await supabaseAdmin
    .from("agent_events")
    .select("metadata")
    .eq("call_id", callId)
    .eq("event_type", "CALL_FINALIZED")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const metadata = (finalEvent?.metadata ?? {}) as FinalEventMetadata;
  const changedTerms = stringArray(metadata.changed_terms);
  const redFlags = stringArray(metadata.red_flags);

  const result = reconcile(quotes, lineItemsByQuote, transcripts);
  const verifiedSavings =
    result.initialTotal != null && result.finalTotal != null
      ? Math.max(0, result.initialTotal - result.finalTotal)
      : null;

  const transcriptText = transcripts
    .map((row) => row.text)
    .join("\n")
    .toLowerCase();
  const initial = quotes.find((quote) => quote.quote_stage === "INITIAL");
  const final = quotes.find((quote) => quote.quote_stage === "FINAL");
  const quoteTermsDiffer =
    initial != null && final != null && (initial.terms ?? "") !== (final.terms ?? "");
  const changedTermSupported = changedTerms.some((term) =>
    transcriptText.includes(term.toLowerCase().slice(0, 40)),
  );
  const verifiedTermsChanged = quoteTermsDiffer || changedTermSupported;

  if (quoteIds.length > 0) {
    const { error: deleteErr } = await supabaseAdmin
      .from("quote_evidence")
      .delete()
      .in("quote_id", quoteIds);
    if (deleteErr) throw new Error(deleteErr.message);

    if (result.evidence.length > 0) {
      const { error: evidenceErr } = await supabaseAdmin.from("quote_evidence").insert(
        result.evidence.map((item) => ({
          negotiation_id: call.negotiation_id,
          quote_id: item.quote_id,
          quote_line_item_id: item.quote_line_item_id,
          transcript_id: item.transcript_id,
          evidence_type: item.evidence_type,
          support_status: item.support_status,
          extracted_text: item.extracted_text,
          timestamp_ms: item.timestamp_ms,
        })),
      );
      if (evidenceErr) throw new Error(evidenceErr.message);
    }

    const priceEvidenceByQuote = new Map(
      result.evidence
        .filter((item) => item.evidence_type === "price")
        .map((item) => [item.quote_id, item.support_status]),
    );
    await Promise.all(
      quoteIds.map((quoteId) => {
        const status = priceEvidenceByQuote.get(quoteId);
        const verification_status =
          status === "supported"
            ? "verified"
            : status === "contradictory"
              ? "flagged"
              : "unverified";
        return supabaseAdmin.from("quotes").update({ verification_status }).eq("id", quoteId);
      }),
    );
  }

  const criticalMissingEvidence = result.evidence.some(
    (item) =>
      (item.evidence_type === "price" || item.evidence_type === "line_item") &&
      item.support_status === "missing_evidence",
  );
  const needsReview =
    transcripts.length === 0 ||
    result.contradictions > 0 ||
    redFlags.length > 0 ||
    criticalMissingEvidence;

  let targetStatus = call.status ?? "in_progress";
  if (call.final_outcome) {
    const successful =
      call.final_outcome === "quote_received" || call.final_outcome === "negotiation_completed";
    const terminal = needsReview ? "needs_review" : successful ? "completed" : "failed";

    // Terminal transitions must originate from `processing`. Bridge from
    // `ending` explicitly so the state-transition trigger accepts the change.
    if (call.status === "ending") {
      await supabaseAdmin
        .from("calls")
        .update({ status: "processing" })
        .eq("id", call.id);
    }
    targetStatus = terminal;
  }

  const reconciledAt = new Date().toISOString();
  const { error: updateErr } = await supabaseAdmin
    .from("calls")
    .update({
      verified_savings_amount: verifiedSavings,
      verified_price_changed: result.priceChanged,
      verified_terms_changed: verifiedTermsChanged,
      needs_review: needsReview,
      reconciled_at: reconciledAt,
      status: targetStatus,
      transcript_pending: false,
    })
    .eq("id", callId);
  if (updateErr) throw new Error(updateErr.message);


  await supabaseAdmin.from("agent_events").insert({
    negotiation_id: call.negotiation_id,
    call_id: callId,
    agent_name: "reconciliation",
    event_type: "CALL_RECONCILED",
    event_status: needsReview ? "warning" : "success",
    summary: needsReview
      ? "Transcript reconciliation completed with review items"
      : "Transcript reconciliation completed",
    metadata: {
      transcript_turns: transcripts.length,
      quote_count: quotes.length,
      evidence_count: result.evidence.length,
      contradictions: result.contradictions,
      missing_critical_evidence: criticalMissingEvidence,
      verified_savings: verifiedSavings,
    },
  });

  if (targetStatus === "completed") {
    await supabaseAdmin
      .from("negotiations")
      .update({ workflow_status: "NEGOTIATION_COMPLETE" })
      .eq("id", call.negotiation_id)
      .in("workflow_status", [
        "CALLING_PROVIDERS",
        "QUOTES_RECEIVED",
        "AUDITING_QUOTES",
        "READY_TO_NEGOTIATE",
        "NEGOTIATING",
        "NEGOTIATION_COMPLETE",
      ]);
  } else if (needsReview) {
    await supabaseAdmin
      .from("negotiations")
      .update({ workflow_status: "CLARIFICATION_REQUIRED" })
      .eq("id", call.negotiation_id)
      .in("workflow_status", [
        "CALLING_PROVIDERS",
        "QUOTES_RECEIVED",
        "AUDITING_QUOTES",
        "READY_TO_NEGOTIATE",
        "NEGOTIATING",
        "CLARIFICATION_REQUIRED",
      ]);
  }

  return {
    status: targetStatus,
    needsReview,
    verifiedSavings,
    verifiedPriceChanged: result.priceChanged,
    verifiedTermsChanged,
    contradictions: result.contradictions,
    evidenceCount: result.evidence.length,
  };
}
