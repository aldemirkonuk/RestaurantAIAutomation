---
phase: 24-provider-communication-pipeline-email-intelligence
plan: "05"
subsystem: agent-orchestrator
tags: [provider-conversation, level-4, idempotency, dlq, d19-context, commitment-guard, learning-loop]
dependency_graph:
  requires: ["24-01", "24-03"]
  provides: ["ProviderConversationAgent Level 4 with audit trail, safety, and DB context quality"]
  affects: ["provider_conversation_sessions", "procurement_conversations", "decision_log", "provider_knowledge"]
tech_stack:
  added: []
  patterns:
    - "Feature flag gated behavior (PROV_AGENT_LEVEL4_ENABLED=false default, canary rollout)"
    - "Idempotency guard + dead letter queue on process_message()"
    - "D-19 DB context injection surviving session restart"
    - "AI-SPEC §6 commitment language regex block (UCC contract formation defense)"
    - "Learning loop: manager edit diff → Haiku preference extraction → JSONB append"
key_files:
  modified:
    - services/agent-orchestrator/agents/provider_conversation_agent.py
    - services/agent-orchestrator/config/settings.py
decisions:
  - "D-19 context (last_3_db_interactions, open_orders, credit_terms) fetched inside _get_db_context_for_prompt() with individual try/except per query — DB failure returns safe empty defaults"
  - "close_relationship fetched alongside credit_terms (same providers row) to minimize queries"
  - "Commitment language check is always active (not gated by L4 flag) — this is a safety invariant per AI-SPEC §6"
  - "record_correction() is a public method callable by Plan 24-07 approval flow"
  - "PROV_AGENT_LEVEL4_ENABLED=false (default) causes zero behavioral change — idempotency, log_decision, DLQ all gated"
metrics:
  duration: "~15 minutes"
  completed_date: "2026-05-13"
  tasks_completed: 2
  tasks_total: 2
  files_modified: 2
---

# Phase 24 Plan 05: ProviderConversationAgent Level 4 — D-19 Context Injection + Safety Guardrails Summary

## One-liner

Six surgical edits harden ProviderConversationAgent with idempotency+DLQ, audit trail (log_decision), DB-persisted context injection (last_3_db_interactions / open_orders / credit_terms), commitment language regex safety block, close-relationship tone mode, and manager learning loop.

## What Was Built

### Task 1: PROV_AGENT_LEVEL4_ENABLED flag + `_get_db_context_for_prompt()`

**`config/settings.py`** — New `prov_agent_level4_enabled: bool` field (default False, env `PROV_AGENT_LEVEL4_ENABLED`). Canary rollout per D-05/R-11.

**`provider_conversation_agent.py` — structural additions:**
- Imports: `from config.settings import Settings`, `from services.model_clients import get_haiku_client`
- `COMMITMENT_PATTERNS` module-level list — 8 regex patterns covering purchase commitment language (AI-SPEC §6 guardrail)
- `RESPONSE_SYSTEM_PROMPT` extended with 4 new placeholders: `{tone_instruction}`, `{last_3_db_interactions}`, `{open_orders}`, `{credit_terms}`
- `AuditEntry.commitment_language_detected: bool = False` — flag for callers
- `_get_db_context_for_prompt(provider_id, restaurant_id)` — fetches and returns all 4 D-19 context fields:
  - `last_3_db_interactions` from `procurement_conversations` (last 3, ordered newest-first, truncated to 200 chars/message)
  - `open_orders` from `procurement_orders` WHERE status IN ('pending','approved','ordered','negotiating')
  - `credit_terms` from `negotiation_facts` WHERE commitment_type='AGREEMENT' AND fact_field ILIKE '%payment%'; fallback to `providers.notes`
  - `close_relationship` from `providers` table — fetched alongside credit_terms to minimize round-trips; each query in its own try/except with safe empty defaults

### Task 2: Five surgical edits to wire Level 4 behavior

**Edit 1 — `process_message()` idempotency + DLQ (PROV_AGENT_LEVEL4_ENABLED gated):**
- Idempotency key: `prov_conv:{conversation_id|message_id}`
- `_check_idempotency(key)` at top → early return if duplicate
- Entire routing logic wrapped in try/except → `_send_to_dlq()` on permanent failure, `_mark_processed()` on success

**Edit 2 — `_generate_response()` D-19 context injection:**
- Added `restaurant_id: str = ""` parameter (all 3 callers updated)
- When L4 enabled: `db_ctx = await self._get_db_context_for_prompt(...)` before format()
- When disabled: empty dict (RESPONSE_SYSTEM_PROMPT format() still receives all kwargs)
- `tone_instruction` derived from `db_ctx["close_relationship"]` (Edit 5 close-relationship mode)
- `RESPONSE_SYSTEM_PROMPT.format()` updated with `tone_instruction`, `last_3_db_interactions`, `open_orders`, `credit_terms`

**Edit 3 — `log_decision()` in `_generate_response()` (PROV_AGENT_LEVEL4_ENABLED gated):**
- Called with `decision_type="draft_generated"` after LLM response is captured
- Inputs include `provider_id`, `intent_type`, `context_injected` keys, `close_relationship` flag

**Edit 4 — Commitment language safety (AI-SPEC §6):**
- `_check_commitment_language(draft_text)` — synchronous method; regex matches any COMMITMENT_PATTERNS against lowercased draft
- Called unconditionally in `_generate_response()` — sets `audit.commitment_language_detected = True` and logs warning
- Also added to `_handle_scarcity_auto_reply()` (the only auto-send path that bypasses approval): `auto_send = False` if commitment language detected → returns early without sending

**Edit 5 — Close-relationship mode + Learning loop:**
- `close_relationship=True` → `tone_instruction = "warm, personal, first-name tone..."` in prompt
- `record_correction(original_draft, edited_draft, provider_id, restaurant_id)` public method:
  - Calls `log_decision(decision_type="correction", ...)` unconditionally
  - Async Haiku call extracts preference string ("tone: ...", "style: ...", "avoid: ...")
  - Appends to `conversation_context.manager_instructions[]` via Supabase RPC `jsonb_array_append`
  - Called by Plan 24-07 approval flow when manager edits a draft before sending

## Deviations from Plan

**1. [Rule 2 - Auto-add] Added `close_relationship` to `_get_db_context_for_prompt()` return**
- **Found during:** Task 1 implementation
- **Issue:** Plan's Edit 5 uses `provider.get("close_relationship", False)` but `_generate_response()` doesn't have a `provider` dict — only `provider_id`
- **Fix:** Added `close_relationship` as a 4th key in `_get_db_context_for_prompt()` return dict, fetched from `providers` table alongside credit_terms fallback query. Minimizes DB round-trips.
- **Files modified:** `provider_conversation_agent.py` (`_get_db_context_for_prompt`)

**2. [Rule 2 - Auto-add] Commitment language check also added to `_handle_scarcity_auto_reply()`**
- **Found during:** Task 2 implementation
- **Issue:** Plan says to add check "in the method that decides auto-send vs pending_approval". `_handle_scarcity_auto_reply()` is the only method that actually auto-sends (bypasses approval). Procurement intent flow already routes to approval unconditionally.
- **Fix:** Added `auto_send` flag + `_check_commitment_language()` call before `_send_message()` in `_handle_scarcity_auto_reply()`. If commitment language detected → returns early without sending (pending_approval path to be implemented in 24-07).
- **Files modified:** `provider_conversation_agent.py`

**3. [Rule 1 - Bug] Resolved git conflict markers in settings.py**
- **Found during:** Task 1 settings.py edit
- **Issue:** StrReplace tool created conflict markers (`<<<<<<< Updated upstream`) instead of clean replacement due to file state from prior plan waves
- **Fix:** Applied second StrReplace to remove conflict markers and keep correct content
- **Files modified:** `config/settings.py`

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| 1 | `7eb4305` | feat(24-05): add PROV_AGENT_LEVEL4_ENABLED flag and _get_db_context_for_prompt() |
| 2 | `c5b4dd8` | feat(24-05): wire Level 4 additions to ProviderConversationAgent |

## Threat Surface Scan

All new surfaces were in the plan's `<threat_model>`:
- T-24-05-01 (Repudiation): `_check_commitment_language()` + `auto_send=False` in `_handle_scarcity_auto_reply()` ✓
- T-24-05-02 (Tampering): `last_3_db_interactions` truncated to 200 chars/message in `_get_db_context_for_prompt()` ✓
- T-24-05-03 (EoP): `PROV_AGENT_LEVEL4_ENABLED=false` default ✓
- T-24-05-04 (InfoDisc): credit_terms are procurement operational data, no PII ✓

No new unplanned network endpoints or trust boundary surfaces introduced.

## Known Stubs

- `record_correction()` calls Supabase RPC `jsonb_array_append` which may not be deployed yet — this is intentional; the RPC is a Phase 24-07 prerequisite. The function will log a warning and silently skip if the RPC is absent (existing `except Exception` handler).

## Self-Check

| Check | Result |
|-------|--------|
| `grep -c "COMMITMENT_PATTERNS"` ≥ 1 | 2 ✓ |
| `grep -c "last_3_db_interactions"` ≥ 2 | 5 ✓ |
| `grep -c "log_decision"` ≥ 2 | 2 ✓ |
| `grep -c "_check_idempotency\|_send_to_dlq"` ≥ 2 | 2 ✓ |
| Python import passes | `import ok` ✓ |
| `config/settings.py` has `prov_agent_level4_enabled` | ✓ |
| `config/settings.py` has `PROV_AGENT_LEVEL4_ENABLED` env var | ✓ |

## Self-Check: PASSED
