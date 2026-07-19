/**
 * Document intake for the JobSpec draft.
 *
 * Accepts a user-uploaded document (PDF, image, CSV, or plain text) and
 * returns a *partial* JobSpec draft extracted by an LLM. The caller is
 * responsible for reconciling conflicts against the existing draft and
 * explicitly accepting each field — this function never writes to the
 * database. Voice-captured data is never silently overwritten.
 *
 * Multi-input intake requirement: both ElevenLabs voice intake and document
 * intake populate the same `job_spec_drafts.specification` shape.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { JobSpecDraftSchema, type JobSpecDraft } from "./job-spec";

const MAX_BYTES = 12 * 1024 * 1024; // 12 MB decoded

const ALLOWED_MIME = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "text/csv",
  "text/plain",
]);

const InputSchema = z.object({
  negotiationId: z.string().uuid(),
  fileName: z.string().min(1).max(200),
  mimeType: z.string().min(1).max(120),
  // data URL: data:<mime>;base64,<b64>
  dataUrl: z.string().min(32).max(20_000_000),
});

const EXTRACTION_SYSTEM = `You extract structured moving-job specifications from a document (inventory list, quote request, email, or scan).
Return ONLY a JSON object matching the schema below. Omit fields the document does not clearly state. Never invent values.
Fields you may return (all optional):
- move_date: "YYYY-MM-DD"
- preferred_time_window: one of "morning"|"afternoon"|"evening"|"flexible"
- bedroom_count: integer 0..20
- origin: { line1, line2?, city, region?, postal_code, country? }
- destination: same shape
- additional_stops: array of { address, purpose: one of "pickup"|"dropoff"|"storage"|"other", notes? } for any intermediate stop
- inventory: array of { label, quantity, notes? } - one entry per distinct item/group
- fragile_items: array of { label, category: one of "artwork"|"electronics"|"glass"|"china"|"mirror"|"instrument"|"other", quantity, approx_value_usd?, notes? }
- specialty_items: array of { label, category: one of "piano"|"safe"|"gun_safe"|"pool_table"|"hot_tub"|"gym_equipment"|"aquarium"|"chandelier"|"antique"|"other", weight_lbs?, dimensions?, requires_disassembly, notes? }
- packing_level: one of "none"|"fragile_only"|"partial"|"full"
- unpacking_requested, disassembly_required, reassembly_required: booleans
- storage: { needed, duration_days?, climate_controlled? }
- insurance_level: one of "basic"|"standard"|"full_value"
- special_instructions: string
- notes: array of short strings for anything you had to guess or that was ambiguous
Return exactly: {"extracted": <object>, "notes": [<string>...]}.`;

type ExtractionResult = {
  extracted: Partial<JobSpecDraft>;
  notes: string[];
  model: string;
  document: { fileName: string; mimeType: string; bytes: number };
};

function decodeDataUrl(dataUrl: string, expectedMime: string) {
  const m = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(dataUrl);
  if (!m) throw new Error("Invalid data URL");
  const mime = m[1];
  const isB64 = !!m[2];
  const payload = m[3];
  if (mime !== expectedMime) {
    throw new Error(`MIME mismatch: header ${mime} vs declared ${expectedMime}`);
  }
  if (!isB64) throw new Error("Only base64 data URLs are supported");
  const buf = Buffer.from(payload, "base64");
  if (buf.byteLength > MAX_BYTES) {
    throw new Error(`File too large (${buf.byteLength} bytes; max ${MAX_BYTES})`);
  }
  return buf;
}

function buildContentBlocks(
  mimeType: string,
  fileName: string,
  dataUrl: string,
  decoded: Buffer,
) {
  // Prompt text is common to all shapes.
  const instruction = {
    type: "text" as const,
    text: `Extract the moving specification from the attached document (${fileName}). Return JSON only.`,
  };

  if (mimeType === "application/pdf") {
    return [
      instruction,
      { type: "file", file: { filename: fileName, file_data: dataUrl } },
    ];
  }
  if (mimeType.startsWith("image/")) {
    return [
      instruction,
      { type: "image_url", image_url: { url: dataUrl } },
    ];
  }
  // text/csv, text/plain — decode and inline as text so the model sees rows.
  const text = decoded.toString("utf-8").slice(0, 200_000);
  return [
    instruction,
    { type: "text", text: `--- BEGIN DOCUMENT (${fileName}) ---\n${text}\n--- END DOCUMENT ---` },
  ];
}

/**
 * Sanitise the LLM output against the draft schema. Anything the model
 * hallucinated that doesn't type-check is dropped and reported as a note.
 */
function coerceToDraft(raw: unknown, notesOut: string[]): Partial<JobSpecDraft> {
  if (!raw || typeof raw !== "object") return {};
  const rec = raw as Record<string, unknown>;

  // Attach IDs to inventory-style arrays before schema-check (schema requires id).
  const withIds = (arr: unknown) => {
    if (!Array.isArray(arr)) return undefined;
    return arr
      .filter((v): v is Record<string, unknown> => !!v && typeof v === "object")
      .map((v) => ({
        id:
          typeof v.id === "string" && v.id.length > 0
            ? v.id
            : `ex_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`,
        ...v,
      }));
  };

  const candidate: Record<string, unknown> = { ...rec };
  if ("inventory" in candidate) candidate.inventory = withIds(candidate.inventory);
  if ("fragile_items" in candidate) candidate.fragile_items = withIds(candidate.fragile_items);
  if ("specialty_items" in candidate) candidate.specialty_items = withIds(candidate.specialty_items);
  if ("additional_stops" in candidate) {
    const raw = candidate.additional_stops;
    candidate.additional_stops = Array.isArray(raw)
      ? raw.map((row, index) => {
          if (typeof row !== "object" || row === null) return row;
          const v = row as Record<string, unknown>;
          const purpose = typeof v.purpose === "string" ? v.purpose : "other";
          return {
            id:
              typeof v.id === "string" && v.id.length > 0
                ? v.id
                : `ex_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`,
            label:
              typeof v.label === "string" && v.label.trim().length > 0
                ? v.label
                : `Stop ${index + 1}`,
            stop_order: typeof v.stop_order === "number" ? v.stop_order : index,
            ...v,
          };
        })
      : raw;
  }

  const parsed = JobSpecDraftSchema.safeParse(candidate);
  if (parsed.success) return parsed.data;

  // Retry, dropping keys that fail. Cheap approach: drop each top-level key
  // touched by an issue and re-parse once.
  const bad = new Set<string>();
  for (const iss of parsed.error.issues) {
    const key = String(iss.path[0] ?? "");
    if (key) bad.add(key);
  }
  const filtered: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(candidate)) {
    if (!bad.has(k)) filtered[k] = v;
  }
  const retry = JobSpecDraftSchema.safeParse(filtered);
  for (const k of bad) notesOut.push(`Dropped invalid extracted field: ${k}`);
  return retry.success ? retry.data : {};
}

export const extractSpecFromDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => InputSchema.parse(data))
  .handler(async ({ data, context }): Promise<ExtractionResult> => {
    const { supabase, userId } = context;

    if (!ALLOWED_MIME.has(data.mimeType)) {
      throw new Error(
        `Unsupported document type "${data.mimeType}". Upload PDF, image (PNG/JPEG/WebP), CSV, or plain text.`,
      );
    }

    // Ownership check via RLS-scoped client.
    const { data: neg, error: negErr } = await supabase
      .from("negotiations")
      .select("id, user_id")
      .eq("id", data.negotiationId)
      .maybeSingle();
    if (negErr) throw new Error(`Failed to load negotiation: ${negErr.message}`);
    if (!neg || neg.user_id !== userId) throw new Error("Negotiation not found");

    const decoded = decodeDataUrl(data.dataUrl, data.mimeType);

    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("Extraction is not configured (missing LOVABLE_API_KEY)");

    const model = "openai/gpt-5.5";
    const body = {
      model,
      messages: [
        { role: "system", content: EXTRACTION_SYSTEM },
        {
          role: "user",
          content: buildContentBlocks(data.mimeType, data.fileName, data.dataUrl, decoded),
        },
      ],
      response_format: { type: "json_object" },
    };

    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Lovable-API-Key": key,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errBody = await res.text();
      if (res.status === 429) {
        throw new Error("AI extraction is rate limited. Try again in a moment.");
      }
      if (res.status === 402) {
        throw new Error("AI extraction credits exhausted. Add credits in workspace billing.");
      }
      throw new Error(`Extraction failed [${res.status}]: ${errBody.slice(0, 500)}`);
    }

    const json = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = json.choices?.[0]?.message?.content ?? "";
    let parsedRaw: unknown = null;
    try {
      parsedRaw = JSON.parse(content);
    } catch {
      throw new Error("Extraction model did not return valid JSON.");
    }

    const notes: string[] = [];
    const rawEnvelope =
      parsedRaw && typeof parsedRaw === "object"
        ? (parsedRaw as { extracted?: unknown; notes?: unknown })
        : {};
    const modelNotes = Array.isArray(rawEnvelope.notes)
      ? rawEnvelope.notes.filter((n): n is string => typeof n === "string")
      : [];
    notes.push(...modelNotes);

    const extracted = coerceToDraft(rawEnvelope.extracted ?? parsedRaw, notes);

    return {
      extracted,
      notes,
      model,
      document: {
        fileName: data.fileName,
        mimeType: data.mimeType,
        bytes: decoded.byteLength,
      },
    };
  });
