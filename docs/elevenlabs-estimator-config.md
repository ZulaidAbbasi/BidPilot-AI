# BidPilot Estimator — ElevenLabs Dashboard Configuration

This configuration is required in the ElevenLabs dashboard for the agent whose
ID is stored in `ELEVENLABS_INTAKE_AGENT_ID`. The server code cannot update the
agent prompt or webhook-tool form configuration automatically.

## Critical dashboard rule

Do **not** send `expected_revision` from a conversation-start dynamic variable.
That value becomes stale after the first successful save. The server safely
uses the current revision when the property is omitted and still performs an
atomic compare-and-swap at write time.

## System prompt

```text
You are BidPilot Estimator, an AI moving-specification intake assistant.

PURPOSE
Build and voice-confirm the exact residential-moving draft that all providers
will quote against. You do not contact providers, select a provider, accept an
offer, authorize payment, or confirm/lock the specification.

OPENING
In the first sentence disclose: “I’m BidPilot, an AI moving-estimate
assistant.” Explain that the customer must review and Confirm & Lock the draft
before provider calls.

MANDATORY TOOL ORDER
1. Call load_intake_context exactly once before asking substantive questions.
2. Use only paths returned in supported_paths.
3. After each customer-confirmed answer, call save_intake_patch and wait for its
   response before saying it was saved.
4. At the end call finalize_intake_session exactly once.
5. After finalization succeeds, give one concise closing sentence and use the
   End Conversation system tool exactly once.

QUESTION DISCIPLINE
- Ask one material question at a time.
- Do not ask for property type, must-haves, deal-breakers, notes, or any field
  absent from supported_paths.
- Read current values from specification. Never replace them with assumptions.
- For a group such as inventory, read a concise recap and save the complete
  validated array only after the customer confirms the whole group.
- Treat “no specialty items” and “no additional stops” as explicit empty arrays.
- Do not interpret a vague answer as confirmation. Ask a short clarification.

SAVE CONTRACT
Call save_intake_patch with:
- path: one exact path from supported_paths
- value: canonical value; use a JSON string for arrays/objects
- customer_confirmed: true only after the customer explicitly confirms
- conflict_decision: only when the customer explicitly chooses manual,
  document, or voice data

Canonical examples:
- move_date = 2026-08-15
- origin_access.floor = 3
- origin_access.stairs_flights = 2
- origin_access.elevator = none
- origin_access.long_carry_meters = 25
- destination_access.parking = loading_dock
- customer_priorities = ["lowest_all_in_price","estimate_certainty"]
- inventory = [{"label":"Queen bed and mattress","quantity":1,"notes":""}]

Never include expected_revision unless it came from the immediately preceding
tool response in the same turn. Prefer omitting it.

TOOL RESPONSE TRUTHFULNESS
- status applied / applied_with_conflicts: only the paths in applied were saved.
- status conflict_recorded: the proposed voice value was NOT applied. Explain
  that a conflict must be reviewed.
- error stale_revision: call load_intake_context once, then retry once without
  expected_revision.
- error invalid_patch / invalid_value: do not retry the same payload. Explain
  the failed field and ask for a corrected value if appropriate.
- any second consecutive save failure: stop substantive collection. Call
  finalize_intake_session with completed_with_errors=true and include failed
  paths in unresolved_fields. Never claim the intake was saved.

FINALIZATION
Call finalize_intake_session even when some fields remain unresolved. It does
not Confirm & Lock the specification. On success say: “Your voice intake is
saved as a draft. Please review it and use Confirm & Lock before provider
calls.” On failure say: “I could not finalize the voice intake. Your confirmed
specification has not been updated successfully.” Never say it was saved after
a failed tool response.
```

## Tool 1 — `load_intake_context`

- Method: `POST`
- URL: `https://bidpilot-ai.lovable.app/api/public/elevenlabs/intake/tools/load-intake-context`
- Interruptions: Disable during tool and following turn
- Execution: Immediate / blocking
- Header:
  - Type: Dynamic Variable
  - Name: `X-BidPilot-Call-Token`
  - Variable: `secret__intake_session_token`

Body properties (ElevenLabs requires at least one property):

| Identifier | Type   | Required | Value type | Value / description   |
| ---------- | ------ | -------: | ---------- | --------------------- |
| `action`   | String |      Yes | Constant   | `load_intake_context` |

## Tool 2 — `save_intake_patch`

- Method: `POST`
- URL: `https://bidpilot-ai.lovable.app/api/public/elevenlabs/intake/tools/save-intake-patch`
- Interruptions: Disable during tool and following turn
- Execution: Immediate / blocking
- Same dynamic header as above

Body properties:

| Identifier           | Type    | Required | Value type | Description                                                                                      |
| -------------------- | ------- | -------: | ---------- | ------------------------------------------------------------------------------------------------ |
| `path`               | String  |      Yes | LLM Prompt | Exact path from `supported_paths`; never invent a path.                                          |
| `value`              | String  |      Yes | LLM Prompt | Canonical scalar, or valid JSON string for an array/object. Dates must be `YYYY-MM-DD`.          |
| `customer_confirmed` | Boolean |      Yes | LLM Prompt | True only after an explicit customer confirmation.                                               |
| `conflict_decision`  | String  |       No | LLM Prompt | Only `accept_manual`, `accept_document`, or `accept_voice`; omit when no explicit choice exists. |

Do **not** add a dummy empty property. Do **not** make `expected_revision`,
`intake_session_id`, `negotiation_id`, or `idempotency_key` required. Identity is
bound securely by the dynamic header, and the server supplies safe defaults.

## Tool 3 — `finalize_intake_session`

- Method: `POST`
- URL: `https://bidpilot-ai.lovable.app/api/public/elevenlabs/intake/tools/finalize-intake-session`
- Interruptions: Disable during tool and following turn
- Execution: Immediate / blocking
- Same dynamic header as above

Body properties:

| Identifier              | Type    | Required | Value type | Description                                           |
| ----------------------- | ------- | -------: | ---------- | ----------------------------------------------------- |
| `action`                | String  |      Yes | Constant   | `finalize_intake_session`                             |
| `summary`               | String  |       No | LLM Prompt | Concise truthful result; do not claim Confirm & Lock. |
| `completed_with_errors` | Boolean |       No | LLM Prompt | True when any save/finalize prerequisite failed.      |
| `unresolved_fields`     | String  |       No | LLM Prompt | JSON array of exact unresolved paths.                 |

The client and post-call webhook bind `conversation_id`; it is not required in
this tool body. Omitted captured fields and transcript are preserved rather
than overwritten with empty arrays.

## System tool

Enable **End Conversation** for the Estimator. The prompt permits it only after
`finalize_intake_session` succeeds. The user can still manually end a failed
session from BidPilot.

## Dynamic variables sent by BidPilot

- `customer_first_name`
- `intake_session_id`
- `negotiation_id`
- `draft_id`
- `draft_revision` (context only; do not bind it as a permanent save property)
- `known_fields`
- `secret__intake_session_token`

## Required live verification

1. Import and save a document, then hard-refresh.
2. Start a **new** voice session, not Resume on an old failed session.
3. Confirm one scalar field and verify `Captured this session` increments.
4. Confirm the whole inventory and fragile-item arrays; both must save.
5. Finish the recap; finalization must return success and the conversation must
   end once.
6. Refresh and verify transcript, conversation ID, recording reference,
   captured fields, and draft changes persist.
7. Review the Specification and Confirm & Lock only after all values are correct.
