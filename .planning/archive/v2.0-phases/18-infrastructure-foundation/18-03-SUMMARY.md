---
plan: 18-03
phase: 18-infrastructure-foundation
status: completed
completed_at: 2026-04-10
---

# Summary: Saga State Management + Outbox Publisher

## What Was Built
Extended BaseAgent with saga orchestration helpers and event store append, plus a new standalone `OutboxPublisher` background worker for reliable event delivery.

## Key Files Created/Modified
- `services/agent-orchestrator/core/base_agent.py` — 5 new methods (start_saga, advance_saga, complete_saga, compensate_saga, append_event)
- `services/agent-orchestrator/core/outbox_publisher.py` — new background polling worker
- `services/agent-orchestrator/tests/test_saga_outbox.py` — 18 unit tests (all passing)

## What Each Addition Does
- `start_saga(saga_type, context, deadline_minutes)` — inserts INTO `saga_state` with IN_PROGRESS status, returns UUID saga_id
- `advance_saga(saga_id, step, compensation_info)` — updates step, appends compensation info to JSONB array
- `complete_saga(saga_id)` — sets status=COMPLETED, current_step=DONE
- `compensate_saga(saga_id, error)` — sets status=COMPENSATED + error, logs compensation count
- `append_event(aggregate_type, aggregate_id, event_type, payload, sequence_number)` — append-only insert to `event_store` with correlation_id; raises on unique constraint violation (prevents sequence reuse)
- `OutboxPublisher.poll_and_publish()` — selects up to 50 unpublished rows ordered by created_at ASC, dispatches each to RabbitMQ, marks published=TRUE with published_at; per-row failures are logged and skipped (don't block batch)
- `OutboxPublisher.run(poll_interval_seconds)` — background loop; `stop()` for graceful shutdown

## Decisions Made
- `start_saga` raises on DB error (saga creation failure should not be silent)
- `append_event` raises on DB error (unique constraint violation signals sequence conflict — caller must handle)
- `compensate_saga` returns silently if saga_id not found (idempotent compensation)
- OutboxPublisher batch_size=50 to bound per-poll DB load
- Single dispatch failure does not abort the batch — remaining rows continue

## Test Results
18/18 tests passed covering: start_saga (status/UUID/deadline/DB error), advance_saga (step update/compensation append), complete_saga (COMPLETED status), compensate_saga (COMPENSATED/missing graceful), append_event (insert/correlation_id/DB error raises), OutboxPublisher (polls/dispatches/marks/continues-on-failure/noop/stop).

## Commit
`322a5c6` — feat(18-03): add saga helpers, event store, outbox publisher to BaseAgent — 18 tests pass
