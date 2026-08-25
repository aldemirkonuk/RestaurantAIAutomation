---
plan: 20-05
status: complete
committed: true
---

# Plan 20-05 Summary: NotificationAgent DLQ Escalation Guard

## What was built

Added a `_dlq_escalated: set` guard to `NotificationAgent` that prevents the DLQ re-trigger loop. Once an `event_id` is escalated to the dead-letter queue after 3 consecutive failures, all subsequent deliveries of that same `event_id` are silently dropped — no handler is called, no retry counter is incremented, and `_send_to_dlq` is not called again. Also fixed `retry_count` in the DLQ payload to use the actual counter value rather than the hardcoded literal `3`.

## Files changed

- `services/agent-orchestrator/agents/notification_agent.py` — Added `self._dlq_escalated: set = set()` to `__init__`; added early-return guard checking `_effective_event_id in self._dlq_escalated` before `_track_notification_delivery`; changed `retry_count=3` to `retry_count=self._notification_retry_counts[_effective_event_id]`; added `self._dlq_escalated.add(_effective_event_id)` and `return` after `_send_to_dlq` (no longer re-raises after DLQ).
- `services/agent-orchestrator/tests/test_notification_agent_hardening.py` — Added `a._dlq_escalated = set()` to the shared fixture; added 3 new tests in `TestHARD03DLQ`: `test_dlq_not_retriggered_on_fourth_failure`, `test_dlq_escalated_drops_delivery_silently`, `test_retry_count_in_dlq_payload_is_accurate`.

## Verification

```
16 passed in 0.65s
```

All 13 pre-existing tests continue to pass. All 3 new tests pass on first run after the fixture was corrected to include `_dlq_escalated`.

## Deviations from plan

**[Rule 2 - Missing critical functionality] Fixture missing `_dlq_escalated` attribute**

- Found during: test run after implementation
- Issue: The test fixture constructs `NotificationAgent` via `__new__()` bypassing `__init__`, and manually sets instance attributes. It set `_notification_retry_counts` but not `_dlq_escalated`, causing `AttributeError` in `process_message`.
- Fix: Added `a._dlq_escalated = set()` to the shared `agent` fixture.
- Files modified: `tests/test_notification_agent_hardening.py`
- Commit: e6a9c75

## Key decisions

- The guard is placed *before* `_track_notification_delivery` (not after idempotency gate) so that no DB row is inserted for dropped messages — the event is fully discarded with a warning log only.
- After DLQ escalation the handler returns rather than re-raising. This means the outer `except Exception` in `process_message` does not log an error for the escalation call — the message is considered handled, not errored.
- `retry_count` in the DLQ payload is now the live counter value. At the threshold it will always be exactly 3 for the current logic, but passing the real value makes the DLQ payload honest and forward-compatible if the threshold is changed.
