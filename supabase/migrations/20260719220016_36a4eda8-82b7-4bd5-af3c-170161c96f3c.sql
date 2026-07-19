UPDATE public.intake_sessions
SET status = 'interrupted',
    ended_at = COALESCE(ended_at, now()),
    summary = COALESCE(summary, 'Preserved for audit. save_intake_patch returned HTTP 400 x4 during the voice session; no fields captured; draft revision unchanged at 1. Root cause: tool payload shape mismatch. Fixed in a later deploy (endpoint now accepts both batch and single-field payloads and logs failed attempts to agent_events).')
WHERE id = '475da66a-59fa-4d3e-a9ee-3536356163e6'
  AND status = 'active';