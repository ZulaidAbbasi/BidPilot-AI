-- Keep at most one active voice-intake session per negotiation.
-- Older duplicate active sessions are preserved as interrupted audit records.
WITH ranked_active AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY negotiation_id
      ORDER BY started_at DESC, id DESC
    ) AS row_number
  FROM public.intake_sessions
  WHERE status = 'active'
)
UPDATE public.intake_sessions AS sessions
SET
  status = 'interrupted',
  ended_at = COALESCE(sessions.ended_at, now()),
  summary = COALESCE(
    NULLIF(sessions.summary, ''),
    'Superseded while enforcing one active voice-intake session per negotiation.'
  )
WHERE sessions.id IN (
  SELECT id
  FROM ranked_active
  WHERE row_number > 1
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_intake_sessions_one_active_per_negotiation
  ON public.intake_sessions (negotiation_id)
  WHERE status = 'active';
