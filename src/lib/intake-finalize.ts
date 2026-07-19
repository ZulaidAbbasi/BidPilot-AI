import { z } from "zod";

export const IntakeTranscriptTurnSchema = z.object({
  role: z.enum(["agent", "user", "system"]),
  text: z.string().max(4000),
  at: z.string().optional(),
});

function parseJsonish(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed) return value;
  if (!trimmed.startsWith("[") && !trimmed.startsWith("{")) return value;
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

function parseOptionalBoolean(value: unknown): unknown {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes"].includes(normalized)) return true;
    if (["false", "0", "no"].includes(normalized)) return false;
  }
  return value;
}

const FinalizeBodySchema = z
  .object({
    action: z.literal("finalize_intake_session").optional(),
    intake_session_id: z.string().uuid().optional(),
    negotiation_id: z.string().uuid().optional(),
    conversation_id: z.string().min(1).max(200).optional(),
    transcript: z.preprocess(parseJsonish, z.array(IntakeTranscriptTurnSchema).max(400)).optional(),
    captured_fields: z
      .preprocess(parseJsonish, z.array(z.string().min(1).max(160)).max(250))
      .optional(),
    unresolved_fields: z
      .preprocess(parseJsonish, z.array(z.string().min(1).max(160)).max(250))
      .optional(),
    summary: z.string().max(3000).optional(),
    recording_url: z.string().max(1000).optional(),
    completed_with_errors: z.preprocess(parseOptionalBoolean, z.boolean().optional()),
  })
  .passthrough();

export type FinalizeIntakeBody = z.infer<typeof FinalizeBodySchema>;

export function parseFinalizeIntakeBody(input: unknown): FinalizeIntakeBody {
  return FinalizeBodySchema.parse(input ?? {});
}

export function mergeIntakeFieldLists(existing: unknown, incoming?: string[]): string[] {
  const prior = Array.isArray(existing)
    ? existing.filter((value): value is string => typeof value === "string" && value.length > 0)
    : [];
  return Array.from(new Set([...prior, ...(incoming ?? [])]));
}
