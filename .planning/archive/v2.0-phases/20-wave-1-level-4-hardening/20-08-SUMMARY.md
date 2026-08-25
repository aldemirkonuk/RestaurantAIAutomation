---
plan: 20-08
phase: 20
status: complete
committed: true
commit: 657eef9
tags: [hardening, pos-integration, inventory-engine, idempotency, payload-shape]
key-decisions:
  - Used top-level items fallback before saga trigger rather than alongside it — preserves saga as last resort
  - Mocked _check_idempotency directly in Gap E test rather than intercepting supabase table chain (more reliable)
---

# Plan 20-08 Summary: Payload Shape Guard Rails

## What was built

Two silent-failure gaps in the WineOps agent layer were closed:

**Gap D — POS top-level items shape:** `handle_order_completed` previously only read `order.selections` (nested Toast shape). Callers sending `{"items": [...], "order_guid": "x"}` at the envelope top level bypassed item extraction entirely. The fix adds a fallback: if nested `selections` is empty, check `webhook_data["items"]` before triggering the polling saga. A debug log records which source resolved items (`nested selections` / `top-level items` / `saga fallback`).

**Gap E — InventoryEngine dedup key:** `_handle_stock_evaluated`, `_handle_order_delivered`, and `_handle_manual_correction` all used bare `message.get("message_id", "")`. If the message bus omits `message_id`, the empty string bypasses `_check_idempotency` silently. The fix applies a fallback chain: `message_id → payload.event_id → event_id → ""`, with an explicit `WARNING` log when no stable key is found.

## Files changed

- `services/agent-orchestrator/agents/pos_integration_agent.py` — Added top-level `items` fallback in `handle_order_completed` before saga trigger; added debug observability log for item source
- `services/agent-orchestrator/agents/inventory_engine.py` — Replaced bare `message.get("message_id", "")` with 3-step fallback chain in all three stock handlers; added warning log on missing key
- `services/agent-orchestrator/tests/test_pos_integration_hardening.py` — Added 2 Gap D tests in `TestHARD02EdgeCases`: saga triggered when both paths empty; top-level items used without saga when nested missing
- `services/agent-orchestrator/tests/test_inventory_engine_hardening.py` — Added 2 Gap E tests in `TestHARD01Idempotency`: fallback resolves `payload.event_id`; missing both fields emits WARNING

## Verification

```
42 passed in 0.81s
```

All 38 pre-existing tests continued to pass. 4 new tests added, all green. Total: 42 passed, 0 failed.

## Key decisions

- **Fallback before saga, not alongside it:** The top-level `items` check is inserted between the nested extraction attempt and the saga trigger. This keeps the saga as a true last resort and avoids unnecessary API polling when the caller simply used a different payload shape.
- **Direct mock of `_check_idempotency` for Gap E test:** Intercepting the supabase table chain for the idempotency key capture proved unreliable with MagicMock chaining. Replacing `agent._check_idempotency` with a capturing async function is simpler and tests the same invariant: that the handler resolves the correct key before calling the dedup gate.

## Deviations from Plan

None — plan executed exactly as written, with one test implementation detail adjusted (mock strategy for `test_dedup_falls_back_to_payload_event_id` used direct method patch instead of supabase table interception to achieve the same assertion reliably).

## Self-Check: PASSED

- `services/agent-orchestrator/agents/pos_integration_agent.py` — FOUND (modified)
- `services/agent-orchestrator/agents/inventory_engine.py` — FOUND (modified)
- `services/agent-orchestrator/tests/test_pos_integration_hardening.py` — FOUND (modified)
- `services/agent-orchestrator/tests/test_inventory_engine_hardening.py` — FOUND (modified)
- Commit `657eef9` — FOUND
