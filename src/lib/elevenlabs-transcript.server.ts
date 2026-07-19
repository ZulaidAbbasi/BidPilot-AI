type RawTranscriptTurn = {
  role?: unknown;
  message?: unknown;
  original_message?: unknown;
  time_in_call_secs?: unknown;
};

export type NormalizedTranscriptTurn = {
  role: string;
  message: string;
  time_in_call_secs?: number;
};

export function speakerFromRole(role: string): "agent" | "user" | "provider" | "system" | "tool" {
  const normalized = role.toLowerCase();
  if (normalized === "agent" || normalized === "assistant") return "agent";
  if (normalized === "user" || normalized === "customer" || normalized === "provider") {
    return "provider";
  }
  if (normalized === "tool") return "tool";
  return "system";
}

export function normalizeElevenLabsTranscript(value: unknown): NormalizedTranscriptTurn[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((turn: RawTranscriptTurn) => {
      const message =
        typeof turn.message === "string" && turn.message.trim()
          ? turn.message.trim()
          : typeof turn.original_message === "string" && turn.original_message.trim()
            ? turn.original_message.trim()
            : "";
      const role = typeof turn.role === "string" && turn.role.trim() ? turn.role.trim() : "system";
      const time =
        typeof turn.time_in_call_secs === "number" && Number.isFinite(turn.time_in_call_secs)
          ? turn.time_in_call_secs
          : undefined;
      return { role, message, time_in_call_secs: time };
    })
    .filter((turn) => turn.message.length > 0);
}

export async function fetchElevenLabsConversationTranscript(
  conversationId: string,
): Promise<NormalizedTranscriptTurn[]> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) return [];

  const response = await fetch(
    `https://api.elevenlabs.io/v1/convai/conversations/${encodeURIComponent(conversationId)}`,
    { headers: { "xi-api-key": apiKey } },
  );

  if (!response.ok) {
    console.warn("[elevenlabs transcript] conversation fetch failed", {
      status: response.status,
      conversation_id: conversationId,
    });
    return [];
  }

  const data = (await response.json()) as { transcript?: unknown };
  return normalizeElevenLabsTranscript(data.transcript);
}

export async function persistElevenLabsTranscript(params: {
  callId: string;
  negotiationId: string;
  conversationId: string;
  transcript: NormalizedTranscriptTurn[];
  markWebhookReceived?: boolean;
  metadata?: Record<string, unknown>;
}) {
  const { callId, negotiationId, conversationId, transcript, markWebhookReceived = false } = params;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  if (transcript.length > 0) {
    const rows = transcript.map((turn, idx) => ({
      call_id: callId,
      negotiation_id: negotiationId,
      conversation_id: conversationId,
      speaker: speakerFromRole(turn.role),
      text: turn.message,
      started_at_ms:
        typeof turn.time_in_call_secs === "number"
          ? Math.round(turn.time_in_call_secs * 1000)
          : null,
      ended_at_ms: null,
      sequence_number: idx,
      source: "elevenlabs",
    }));

    const { error } = await supabaseAdmin
      .from("call_transcripts")
      .upsert(rows, { onConflict: "call_id,sequence_number" });
    if (error) throw new Error(error.message);
  }

  const transcriptText = transcript.map((turn) => `${turn.role}: ${turn.message}`).join("\n");
  const update: Record<string, unknown> = {
    transcript_text: transcriptText || null,
  };
  if (markWebhookReceived) update.webhook_received_at = new Date().toISOString();
  if (params.metadata) update.metadata = params.metadata;

  await supabaseAdmin
    .from("calls")
    .update(update as never)
    .eq("id", callId);
  return { transcriptText, transcriptTurns: transcript.length };
}

export async function recoverElevenLabsTranscriptForCall(params: {
  callId: string;
  negotiationId: string;
  conversationId: string | null;
}) {
  if (!params.conversationId) return { transcriptTurns: 0, transcriptText: "" };
  const transcript = await fetchElevenLabsConversationTranscript(params.conversationId);
  if (transcript.length === 0) return { transcriptTurns: 0, transcriptText: "" };
  return persistElevenLabsTranscript({
    callId: params.callId,
    negotiationId: params.negotiationId,
    conversationId: params.conversationId,
    transcript,
  });
}
