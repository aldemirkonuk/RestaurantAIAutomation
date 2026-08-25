---
phase: 20
slug: wave-1-level-4-hardening
nyquist_compliant: true
tests_automated: 74
tests_manual: 0
gaps_found: 0
gaps_resolved: 0
audited: "2026-04-12"
---

# Phase 20: Validation Report

**Phase Goal:** Bring 4 golden path agents (InventoryEngine, POSIntegrationAgent, NotificationAgent, ReportingAgent) from Level 1.5 to Level 4 using BaseAgent infrastructure.
**Audited:** 2026-04-12
**Status:** NYQUIST-COMPLIANT — all requirements have automated verification

---

## Test Infrastructure

| Tool | Config | Command |
|------|--------|---------|
| pytest | `services/agent-orchestrator/pytest.ini` | `cd services/agent-orchestrator && python -m pytest tests/test_{agent}_hardening.py -v` |
| pytest-asyncio | `pytest.ini` | async test support for all agent handlers |

---

## Requirement-to-Test Map

### HARD-01: InventoryEngine → Level 4

**Requirement:** Wire idempotency, decision logging, event sourcing, and sequence monotonicity. Write 15+ integration tests.

| Test File | Tests | Command |
|-----------|-------|---------|
| `services/agent-orchestrator/tests/test_inventory_engine_hardening.py` | 24 | `python -m pytest tests/test_inventory_engine_hardening.py -v` |

| Test Name | Behavior Verified |
|-----------|------------------|
| test_duplicate_message_skipped | Idempotency deduplication — second call skipped |
| test_first_message_processed | Idempotency — first call processes |
| test_idempotency_check_fail_open | Fails open on DB error |
| test_mark_processed_called_after_success | _mark_processed called post-success |
| test_delivery_idempotency | Idempotency in delivery handler |
| test_dedup_falls_back_to_payload_event_id | Fallback to payload.event_id when message_id missing |
| test_missing_message_id_and_event_id_logs_warning | Warning logged when both fields absent |
| test_stock_update_logs_decision | log_decision called in stock_evaluated handler |
| test_decision_log_includes_inventory_id | Decision log captures inventory_id |
| test_manual_correction_confidence_0_7 | ReportingAgent log_decision confidence value |
| test_delivery_decision_type | Decision type "delivery_processed" |
| test_stock_update_appends_event | append_event called in stock handler |
| test_event_store_has_correct_event_type | Event type matches handler |
| test_delivery_event_type | Delivery event type correct |
| test_manual_correction_event_type | Manual correction event type correct |
| test_sequence_increments_per_aggregate | Monotonic sequence per aggregate |
| test_different_aggregates_have_independent_sequences | Independent sequences per aggregate |
| test_manual_correction_sequence_continues_after_stock | Sequence continues across event types |
| test_missing_inventory_id_returns_early | Guard clause on missing ID |
| test_missing_message_id_proceeds | Missing message_id does not block |
| test_database_error_does_not_raise | DB error caught, does not raise |
| test_manual_correction_missing_manager_id_returns_early | Guard on missing manager_id |
| test_delivery_missing_order_id_returns_early | Guard on missing order_id |
| test_stock_evaluated_zero_stock_allowed | Zero-stock edge case handled |

**Status:** COVERED — 24 tests, all passing (confirmed in 20-06-SUMMARY.md: "22 passed in 0.66s"; 20-08-SUMMARY.md: "42 passed in 0.81s")

---

### HARD-02: POSIntegrationAgent → Level 4

**Requirement:** Wire webhook dedup, Toast polling fallback, composite idempotency key, saga state. Write 15+ integration tests.

| Test File | Tests | Command |
|-----------|-------|---------|
| `services/agent-orchestrator/tests/test_pos_integration_hardening.py` | 18 | `python -m pytest tests/test_pos_integration_hardening.py -v` |

Key behaviors verified:
- HMAC-SHA256 signature verification (raw bytes, Phase 19 fix)
- Composite idempotency key `f"{order_guid}:{event_type_raw}"`
- Saga start/advance/complete/compensate wiring
- Toast polling fallback (empty-items → polling saga)
- Top-level `items` fallback shape (Gap D, plan 20-08)
- Dedup key fallback chain (Gap E, plan 20-08)

**Status:** COVERED — 18 tests, all passing (confirmed in 20-08-SUMMARY.md: "42 passed in 0.81s")

---

### HARD-03: NotificationAgent → Level 4

**Requirement:** Wire delivery tracking (notification_deliveries table), DLQ after 3 failures, persisted rate limits. Write 10+ integration tests.

| Test File | Tests | Command |
|-----------|-------|---------|
| `services/agent-orchestrator/tests/test_notification_agent_hardening.py` | 16 | `python -m pytest tests/test_notification_agent_hardening.py -v` |

Key behaviors verified:
- notification_deliveries row inserted per dispatch (pending → sent/failed)
- DLQ triggered at exactly 3 failures
- _dlq_escalated guard prevents infinite re-escalation (Gap, plan 20-05)
- test_dlq_not_retriggered_on_fourth_failure
- test_dlq_escalated_drops_delivery_silently
- test_retry_count_in_dlq_payload_is_accurate

**Status:** COVERED — 16 tests, all passing (confirmed in 20-05-SUMMARY.md: "16 passed in 0.65s")

---

### HARD-04: ReportingAgent → Level 4

**Requirement:** Real inventory + sales reports, real PDF export, idempotent scheduling, decision logging. Write 10+ integration tests.

| Test File | Tests | Command |
|-----------|-------|---------|
| `services/agent-orchestrator/tests/test_reporting_agent_hardening.py` | 16 | `python -m pytest tests/test_reporting_agent_hardening.py -v` |

Key behaviors verified:
- Composite idempotency key `f"{restaurant_id}:{report_type}:{date_str}"`
- log_decision("report_generated") on every trigger
- UTC midnight warning logged for near-midnight scheduling
- date_source field in log_decision output (plan 20-07)
- test_missing_date_logs_warning
- test_explicit_date_overrides_utc
- test_log_decision_output_includes_date_source

**Status:** COVERED — 16 tests, all passing (confirmed in 20-07-SUMMARY.md: "16 passed in 0.60s")

---

## Regression Tests

| Test File | Tests | Purpose |
|-----------|-------|---------|
| `tests/test_inventory_engine_bugs.py` | 19+ | Phase 19 bug regressions (race condition, dead code) |
| `tests/test_pos_integration_bugs.py` | ~12 | Phase 19 bug regressions (hmac, wine detection, signature) |
| `tests/test_notification_agent_bugs.py` | ~10 | Phase 19 bug regressions (rate limit persistence, batch processor) |
| `tests/test_reporting_agent_bugs.py` | ~10 | Phase 19 bug regressions (self.db fix, stub reports, PDF export) |

All regression suites continued passing after Phase 20 changes (confirmed in plan summaries).

---

## Wave 2 Addendum Coverage (Plans 20-05 through 20-08)

| Plan | Bug Fixed | Tests Added | File |
|------|-----------|------------|------|
| 20-05 | DLQ re-trigger guard (_dlq_escalated set) | 3 | test_notification_agent_hardening.py |
| 20-06 | Per-aggregate monotonic sequence_number | 3 | test_inventory_engine_hardening.py |
| 20-07 | UTC midnight warning + date_source in log_decision | 3 | test_reporting_agent_hardening.py |
| 20-08 | Top-level items saga fallback; dedup key fallback chain | 4 | test_pos_integration_hardening.py + test_inventory_engine_hardening.py |

---

## Manual-Only Items

None — all requirements have automated test coverage.

---

## Sign-Off

| Dimension | Status |
|-----------|--------|
| All HARD requirements have tests | PASS |
| Tests exceed minimum counts | PASS (HARD-01: 24≥15, HARD-02: 18≥15, HARD-03: 16≥10, HARD-04: 16≥10) |
| Wave 2 addendum behaviors tested | PASS (13 additional tests across plans 05-08) |
| Regression suite still passing | PASS (all bug test files confirmed green) |
| Manual-only gaps | 0 |

**Nyquist compliant: YES**

---

## Validation Audit 2026-04-12

| Metric | Count |
|--------|-------|
| Requirements audited | 4 (HARD-01..04) |
| Gaps found | 0 |
| Automated tests mapped | 74 |
| Manual-only | 0 |

_Audited: 2026-04-12_
_Verifier: Claude (gsd-nyquist-auditor)_
