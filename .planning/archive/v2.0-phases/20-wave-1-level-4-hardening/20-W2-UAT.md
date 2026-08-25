---
status: complete
phase: 20-wave-1-level-4-hardening (Wave 2)
source: [20-05-SUMMARY.md, 20-06-SUMMARY.md, 20-07-SUMMARY.md, 20-08-SUMMARY.md]
started: 2026-04-11T00:00:00Z
updated: 2026-04-11T00:00:00Z
result: 6/6 passed, 0 issues
---

## Current Test

<!-- OVERWRITE each test - shows where we are -->

number: 4
name: ReportingAgent warns when date is missing from message
expected: |
  Run the edge case tests:
    cd services/agent-orchestrator
    python3 -m pytest tests/test_reporting_agent_hardening.py::TestHARD04EdgeCases -v
  Expected: 3 new tests pass:
  - test_missing_date_logs_warning — message with no date field emits WARNING containing "defaulting to UTC date"
  - test_explicit_date_overrides_utc — message with date="2026-04-10" uses that date in idempotency key
  - test_log_decision_output_includes_date_source — log_decision output dict contains date_source: "caller" or "utc_default"
awaiting: user response

## Tests

### 1. Full Wave 2 test suite passes
expected: |
  Run all 4 hardened agent test files together:
    cd services/agent-orchestrator
    python3 -m pytest tests/test_notification_agent_hardening.py tests/test_inventory_engine_hardening.py tests/test_reporting_agent_hardening.py tests/test_pos_integration_hardening.py -v
  Expected: 74 passed, 0 failed. All Wave 2 additions (DLQ guard, sequence monotonicity, UTC warning, payload shape guards) green.
result: pass
notes: "74/74 passed in ~1.2s. 1 RuntimeWarning (coroutine '_batch_processor' never awaited) — noise from shared mock setup, not a failure. Future: silence with -W error by patching _batch_processor in fixtures."

### 2. DLQ re-trigger guard: poison message only escalates once
expected: |
  Run the DLQ guard tests specifically:
    cd services/agent-orchestrator
    python3 -m pytest tests/test_notification_agent_hardening.py::TestHARD03DLQ -v
  Expected: 5 tests in TestHARD03DLQ all pass (2 original + 3 new guard tests):
  - test_dlq_not_retriggered_on_fourth_failure — _send_to_dlq called exactly 1 time (not 2) after 4 deliveries of same event_id
  - test_dlq_escalated_drops_delivery_silently — 4th call returns early, no handler called, no DLQ call
  - test_retry_count_in_dlq_payload_is_accurate — DLQ payload carries actual retry count (3), not hardcoded literal
result: pass
notes: "5/5 passed (class has 2 original tests + 3 new guard tests). All 3 guard scenarios green."

### 3. InventoryEngine sequence numbers increment per-aggregate
expected: |
  Run the event sourcing tests:
    cd services/agent-orchestrator
    python3 -m pytest tests/test_inventory_engine_hardening.py::TestHARD01EventSourcing -v
  Expected: 7 tests in TestHARD01EventSourcing all pass (4 original + 3 new sequence tests):
  - test_sequence_increments_per_aggregate — two StockUpdated events for same inventory_id get sequence_number 1 then 2
  - test_different_aggregates_have_independent_sequences — two different inventory_ids each start at sequence 1
  - test_manual_correction_sequence_continues_after_stock — stock event (seq 1) then manual correction (seq 2) for same aggregate
result: pass
notes: "7/7 passed (~0.5s). 4 original event-sourcing tests continue to pass alongside 3 new sequence tests."

### 4. ReportingAgent warns when date is missing from message
expected: |
  Run the edge case tests:
    cd services/agent-orchestrator
    python3 -m pytest tests/test_reporting_agent_hardening.py::TestHARD04EdgeCases -v
  Expected: 7 tests in TestHARD04EdgeCases all pass (4 original + 3 new):
  - test_missing_date_logs_warning — message with no date field emits WARNING containing "defaulting to UTC date"
  - test_explicit_date_overrides_utc — message with date="2026-04-10" uses that date in idempotency key
  - test_log_decision_output_includes_date_source — log_decision output dict contains date_source: "caller" or "utc_default"
result: pass
notes: "7/7 passed (~0.5s). 4 original edge-case tests continue to pass alongside 3 new date/date_source tests."

### 5. POS top-level items fallback + InventoryEngine dedup key fallback
expected: |
  Run the payload shape guard tests:
    cd services/agent-orchestrator
    python3 -m pytest tests/test_pos_integration_hardening.py::TestHARD02EdgeCases tests/test_inventory_engine_hardening.py::TestHARD01Idempotency -v
  Expected: 12 tests across both classes all pass (8 original + 4 new):
  - test_top_level_items_triggers_saga_when_selections_empty — {"items": [], "data": {"order": {}}} triggers _handle_incomplete_webhook
  - test_top_level_items_used_when_nested_missing — top-level items=[{wine item}] produces wine detection without saga
  - test_dedup_falls_back_to_payload_event_id — message with no message_id but payload.event_id="abc" deduplicates on "abc"
  - test_missing_message_id_and_event_id_logs_warning — message with neither field emits WARNING containing "idempotency bypassed"
result: pass
notes: "12/12 passed (~0.6s). 8 original tests (POS EdgeCases + Inventory Idempotency) continue green alongside 4 new guard tests."

### 6. Code inspection: _dlq_escalated guard is before _track_notification_delivery
expected: |
  Open services/agent-orchestrator/agents/notification_agent.py and verify:
  1. __init__ contains: self._dlq_escalated: set = set()
  2. In process_message, the _dlq_escalated check appears BEFORE _track_notification_delivery
  3. After _send_to_dlq call: self._dlq_escalated.add(_effective_event_id) then return (no re-raise)
  This ordering ensures dropped messages never write a DB delivery row.
result: pass
notes: |
  All three confirmed via code inspection (lines 97-98, 377-388, 463-473):
  1. _dlq_escalated initialized at line 97-98 with HARD-03 comment
  2. Guard at lines 379-382 returns before _track_notification_delivery at line 384 — no DB insert for escalated events
  3. Lines 471-472: _dlq_escalated.add then return; outer except not entered for this path; inner raise only hit below threshold

## Summary

total: 6
passed: 6
issues: 0
pending: 0
skipped: 0

## Gaps

[none — all 6 tests passed, 0 issues found]
