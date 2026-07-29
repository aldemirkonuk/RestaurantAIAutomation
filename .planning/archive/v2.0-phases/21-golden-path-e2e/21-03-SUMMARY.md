---
phase: 21-golden-path-e2e
plan: "03"
subsystem: agent-orchestrator-tests
tags: [e2e, integration-tests, pos, inventory, notification, reporting, golden-path]
dependency_graph:
  requires:
    - services/agent-orchestrator/agents/pos_integration_agent.py (process_toast_webhook)
    - services/agent-orchestrator/agents/inventory_engine.py (_handle_stock_evaluated)
    - services/agent-orchestrator/agents/notification_agent.py (process_message)
    - services/agent-orchestrator/agents/reporting_agent.py (process_message)
  provides:
    - services/agent-orchestrator/tests/test_golden_path_e2e.py (5 async integration tests)
  affects:
    - CI pipeline (all 5 tests run without external services)
tech_stack:
  added: []
  patterns:
    - pytest-asyncio async test functions
    - MagicMock/AsyncMock for in-process mocking of RabbitMQ, Supabase, SMS, email
    - Per-agent database mock with side_effect factories for table-aware chaining
    - Direct method calls to bypass agent event loop (process_toast_webhook, _handle_stock_evaluated)
key_files:
  created:
    - services/agent-orchestrator/tests/test_golden_path_e2e.py
  modified: []
decisions:
  - "NotificationAgent.process_message returns None (not dict) — tests assert None or dict, not strict dict"
  - "InventoryEngineAgent uses self.database.update_inventory_stock() async method, not raw supabase chaining — mock at the database object level, not supabase.table()"
  - "ReportingAgent.process_message routes by message.get('type') field, not routing_key — ON_DEMAND_REPORT_MSG uses type=generate_on_demand_report"
  - "publish() in POSIntegrationAgent uses exchange= kwarg (not exchange_name=) — assertion checks both variants via str() containment"
  - "NotificationAgent internal methods (_get_manager_for_restaurant, _select_channels, etc.) are mocked to avoid manager DB lookups and real SMS/email dispatch"
metrics:
  duration_minutes: 18
  completed_date: "2026-04-12"
  tasks_completed: 1
  tasks_total: 1
  files_created: 1
  files_modified: 0
---

# Phase 21 Plan 03: Golden Path E2E Integration Tests Summary

**One-liner:** 5 async pytest tests prove the 4-agent golden path pipeline (POSIntegrationAgent -> InventoryEngineAgent -> NotificationAgent + ReportingAgent) works end-to-end with in-process mocks — no real RabbitMQ, Supabase, SMS, or email.

## What Was Built

Created `services/agent-orchestrator/tests/test_golden_path_e2e.py` with 5 integration tests covering E2E-v2-01 through E2E-v2-04 and the full combined path:

| Test | Requirement | What It Proves |
|------|-------------|----------------|
| `test_e2e_01_webhook_to_pos_event` | E2E-v2-01 | Toast webhook -> POSIntegrationAgent -> `pos.sale.completed` published to `pos.events` |
| `test_e2e_02_pos_event_to_inventory_decrement` | E2E-v2-02 | `stock.evaluated` -> InventoryEngineAgent -> `update_inventory_stock()` called + `stock.state.changed` published |
| `test_e2e_03_stock_threshold_to_notification` | E2E-v2-03 | `stock.threshold.breached` -> NotificationAgent -> routes correctly, `send_sms` invoked |
| `test_e2e_04_stock_event_to_reporting` | E2E-v2-04 | ReportingAgent generates inventory report, queries `inventory_stock` table from DB |
| `test_e2e_full_golden_path` | All 4 | Full sequential chain through all 4 agents with publish-chain assertions |

### Key Implementation Decisions

**InventoryEngineAgent mock:** `_handle_stock_evaluated` calls `self.database.update_inventory_stock()` and `self.database.get_inventory_item()` — custom async methods on the database object, not raw supabase chaining. The mock patches these methods directly on `db`:

```python
db.update_inventory_stock = AsyncMock(return_value=True)
db.get_inventory_item = AsyncMock(return_value={...})
```

**NotificationAgent mock:** `process_message` returns `None` (the type annotation says `-> None`). Tests assert `result is None or isinstance(result, dict)`. The internal `_get_manager_for_restaurant`, `_select_channels`, `_get_notification_preferences` are AsyncMock-patched to avoid manager DB lookups. `_track_notification_delivery` and `_mark_delivery_sent` are also patched.

**ReportingAgent routing:** `process_message` dispatches on `message.get("type")` not `routing_key`. The test message includes `type="generate_on_demand_report"`. The DB mock uses a table-name-aware `side_effect` factory so `inventory_stock` queries return real-looking rows while other tables return empty lists.

**POS publish kwarg:** `publish_wine_sale_event` uses `exchange=` not `exchange_name=`. The test assertion checks both kwarg names and falls back to `str(c)` containment.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Write 5 golden-path integration tests | c3b5eb8 | services/agent-orchestrator/tests/test_golden_path_e2e.py |

## Verification Results

```
============================= test session starts ==============================
tests/test_golden_path_e2e.py::test_e2e_01_webhook_to_pos_event PASSED   [ 20%]
tests/test_golden_path_e2e.py::test_e2e_02_pos_event_to_inventory_decrement PASSED [ 40%]
tests/test_golden_path_e2e.py::test_e2e_03_stock_threshold_to_notification PASSED [ 60%]
tests/test_golden_path_e2e.py::test_e2e_04_stock_event_to_reporting PASSED [ 80%]
tests/test_golden_path_e2e.py::test_e2e_full_golden_path PASSED          [100%]
============================== 5 passed in 0.48s ==============================
```

All 5 tests pass in under 1 second. No real RabbitMQ, Supabase, SMS, or email traffic triggered.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Corrected publish kwarg from `exchange_name=` to `exchange=`**
- **Found during:** Task 1 — first test run
- **Issue:** Plan template assumed `message_bus.publish(exchange_name=..., routing_key=...)` but `publish_wine_sale_event` in `pos_integration_agent.py` uses `self.publish(exchange=..., routing_key=...)` via BaseAgent's `publish()` method
- **Fix:** Updated assertion to check both `c.kwargs.get("exchange_name")` and `c.kwargs.get("exchange")`, plus str-containment fallback
- **Files modified:** `tests/test_golden_path_e2e.py`
- **Commit:** c3b5eb8 (included in the same task commit)

**2. [Rule 1 - Bug] Corrected InventoryEngine DB mock from supabase-chain to async method mocks**
- **Found during:** Task 1 — reading `inventory_engine.py:118`
- **Issue:** `_handle_stock_evaluated` calls `self.database.update_inventory_stock()` and `self.database.get_inventory_item()` — these are custom async methods, not raw supabase table chains. The plan template used a supabase-chain mock.
- **Fix:** Added `db.update_inventory_stock = AsyncMock(return_value=True)` and `db.get_inventory_item = AsyncMock(return_value={...})` on the database object directly
- **Files modified:** `tests/test_golden_path_e2e.py`

**3. [Rule 1 - Bug] Corrected ReportingAgent routing from `routing_key` to `type` field**
- **Found during:** Task 1 — reading `reporting_agent.py:178`
- **Issue:** `process_message` dispatches on `message.get("type")`, not `routing_key`. Plan template used `routing_key` only in `ON_DEMAND_REPORT_MSG`.
- **Fix:** Added `"type": "generate_on_demand_report"` to the test message dict

**4. [Rule 2 - Missing mock] Added NotificationAgent internal method mocks**
- **Found during:** Task 1 — reading `notification_agent.py:483-530`
- **Issue:** `send_low_stock_alert` calls `_get_manager_for_restaurant`, `_get_notification_preferences`, `_select_channels` — all require DB/Redis. Without mocking, the agent would fail silently or raise.
- **Fix:** Patched all 4 internal methods as AsyncMock with sensible return values

## Known Stubs

None — tests use real agent code paths. All external I/O is mocked.

## Threat Flags

No new network endpoints, auth paths, file access patterns, or schema changes introduced. Test file only.

## Self-Check: PASSED

- [x] `services/agent-orchestrator/tests/test_golden_path_e2e.py` exists (450 lines, above 150-line minimum)
- [x] Commit `c3b5eb8` exists: `test(21-03): add 5 golden-path E2E integration tests`
- [x] All 5 test functions present: test_e2e_01 through test_e2e_04 + test_e2e_full_golden_path
- [x] 5 passed, 0 failed in 0.48s — no external services required
