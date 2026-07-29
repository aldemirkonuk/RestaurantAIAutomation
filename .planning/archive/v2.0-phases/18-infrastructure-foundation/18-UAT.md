---
status: complete
phase: 18-infrastructure-foundation
source: [18-01-SUMMARY.md, 18-02-SUMMARY.md, 18-03-SUMMARY.md]
started: 2026-04-10T00:00:00Z
updated: 2026-04-10T00:00:00Z
---

## Current Test

[testing complete]

## Tests

### 1. Cold Start Smoke Test
expected: Kill any running agent process. Run `supabase db push` from scratch (or verify migrations were applied). Confirm all 6 tables exist in Supabase dashboard: idempotency_keys, decision_log, outbox, saga_state, event_store, dead_letter_queue. Then import BaseAgent — no import errors, no crashes.
result: pass

### 2. All 6 DB Tables Exist
expected: In Supabase dashboard (or via `psql \dt`), all 6 tables are present: `idempotency_keys` (PK=message_id, expires_at column), `decision_log` (correlation_id, confidence), `outbox` (partial index on published=FALSE), `saga_state` (compensations JSONB array), `event_store` (unique aggregate+sequence constraint), `dead_letter_queue` (retry_count, resolved_at).
result: pass

### 3. Idempotency — New Message
expected: Call `_check_idempotency("msg-001")` on a fresh BaseAgent. Returns False (message never processed). Then call `_mark_processed("msg-001", {"status": "ok"})`. Call `_check_idempotency("msg-001")` again — returns True. Row exists in `idempotency_keys` table.
result: pass

### 4. Idempotency — Fail Open
expected: Simulate DB unavailability (wrong Supabase URL or network block). Call `_check_idempotency("any-id")` — returns False (fails open, does NOT raise or block processing). Processing continues normally.
result: pass

### 5. Decision Logging
expected: Call `agent.log_decision(decision_type="wine_match", inputs={"name": "Opus One"}, output={"match": "cabernet"}, reasoning="keyword match", confidence=0.95)`. Row inserted in `decision_log` table with agent_name, decision_type, inputs JSONB, output JSONB, confidence=0.95, correlation_id populated.
result: pass
note: correlation_id in decision_log reflects agent._current_correlation_id at call time — NOT auto-generated inside log_decision(). Calling log_decision() outside _process_with_retry (e.g. in a test or standalone script) will produce correlation_id=NULL. Must set _current_correlation_id manually or call from within a real message processing context.

### 6. DLQ on Retry Exhaustion
expected: Send a message that always raises an exception (simulated failure). After all retries are exhausted, a row appears in `dead_letter_queue` with agent_name, original_exchange, original_routing_key, message body, error text, retry_count > 0.
result: pass
note: original_exchange/original_routing_key sourced from optional kwargs first, then message["_exchange"]/message["_routing_key"], falling back to "unknown". retry_count reflects actual attempts (e.g. 3 for max_retries=3).

### 7. Structured JSON Logging
expected: Run any agent operation and check the log output. Each log line is valid JSON containing: `timestamp`, `level`, `logger`, `message`, `agent_name`, `correlation_id`. No plain-text log lines emitted.
result: issue
reported: "Console handler (stdout) uses plain-text Formatter, not AgentJsonFormatter. Only logs/agent-orchestrator.log (file handler) emits JSON. ROADMAP criterion says 'all agent logs emit structured JSON' but console path does not comply. timestamp in JSON may be asctime string or numeric record.created depending on record."
severity: minor
note: Production log aggregation is unaffected (file handler is JSON). To validate: inspect logs/agent-orchestrator.log and json.loads each line. Proposed fix: add LOG_JSON_STDOUT=1 env flag to switch console handler to AgentJsonFormatter without breaking dev UX.

### 8. Correlation ID Propagation
expected: Send a message with `correlation_id: "trace-xyz-123"`. Verify `agent._current_correlation_id == "trace-xyz-123"`. Check that all outgoing publishes include this correlation_id. If message has no correlation_id, agent generates a UUID automatically.
result: pass
note: Bug caught and fixed during UAT — BaseAgent.publish() was not passing correlation_id kwarg to message_bus.publish(), so DynamicEvent.correlation_id stayed None and AMQP Message.correlation_id was None. Fix: BaseAgent.publish now passes correlation_id=self._current_correlation_id; MessageBus.publish sets effective_correlation_id = correlation_id or message_body.get("correlation_id"). Propagation path: Pydantic event field + JSON body + AMQP Message.correlation_id. Not propagated as x-correlation-id header (intentional).

### 9. Saga Lifecycle — Happy Path
expected: Call `start_saga("order_sync", context={"order_id": "123"}, deadline_minutes=30)` → returns a UUID saga_id, row in saga_state with status=IN_PROGRESS. Call `advance_saga(saga_id, "step_2", {"compensate": "cancel_order"})` → current_step updated, compensations array has 1 entry. Call `complete_saga(saga_id)` → status=COMPLETED, current_step=DONE.
result: pass
note: Live run confirmed via scripts/live_saga_lifecycle_test.py. start_saga inserts with current_step="INIT"; advance_saga loads+appends compensation JSONB array; complete_saga sets COMPLETED/DONE. Verified in Supabase Table Editor.

### 10. Saga Compensation
expected: Call `start_saga(...)` → get saga_id. Call `compensate_saga(saga_id, "timeout error")` → status=COMPENSATED, error field populated. Calling `compensate_saga` with an unknown saga_id does NOT raise — returns silently (idempotent).
result: pass
note: Real saga → COMPENSATED confirmed live. Silent return on unknown saga_id only works for a valid UUID not in the table (result.data empty → warning + return). An invalid UUID string (e.g. "nonexistent-uuid") may cause PostgREST to raise because the UUID column filter rejects malformed input. Tests must use str(uuid.uuid4()) for the "unknown id" case.

### 11. Event Store — Append + Sequence Conflict
expected: Call `append_event("inventory", "item-001", "stock_decremented", {"qty": 1}, sequence_number=1)` → row inserted in event_store with correlation_id. Call again with same aggregate_type + aggregate_id + sequence_number=1 → raises an exception (unique constraint prevents sequence reuse).
result: pass
note: aggregate_id column is UUID — "item-001" fails validation. Must use str(uuid.uuid4()) or a fixed test UUID. correlation_id in the row reflects agent._current_correlation_id at call time (set it first or it will be null). Duplicate raises Postgres 23505 on uq_event_store_aggregate_sequence; append_event logs and re-raises. Confirmed live.

### 12. Outbox Publisher — Poll and Dispatch
expected: Insert a row into `outbox` table with published=FALSE, exchange="test.exchange", routing_key="test.key", payload={"msg": "hello"}`. Start `OutboxPublisher` (or call `poll_and_publish()` directly). Row is dispatched to RabbitMQ and `published` is set to TRUE with `published_at` timestamp. A second row that fails dispatch does NOT block remaining rows.
result: pass
note: Confirmed via code review + mock tests (test_saga_outbox.py). Live run requires RabbitMQ up with exchange declared; publish returning False (no exception) leaves row unpublished for next poll cycle — does not abort batch. No live_outbox_publisher_test.py in-repo yet; could add one to verify DB flip via mock publish=True without Rabbit dependency.

## Summary

total: 12
passed: 11
issues: 1
pending: 0
skipped: 0

## Gaps

- truth: "All agent logs emit structured JSON with timestamp, level, logger, message, agent_name, correlation_id"
  status: failed
  reason: "User reported: Console handler (stdout) uses plain-text Formatter. Only logs/agent-orchestrator.log emits JSON. Proposed fix: LOG_JSON_STDOUT=1 env flag to switch console handler to AgentJsonFormatter."
  severity: minor
  test: 7
  artifacts: [services/agent-orchestrator/utils/logger.py lines 74-82]
  missing: [LOG_JSON_STDOUT env flag or console handler using AgentJsonFormatter]
