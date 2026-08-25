---
phase: 19-wave-1-bug-fixes
plan: "01"
subsystem: inventory-engine
tags:
  - bug-fix
  - optimistic-locking
  - dead-code
  - database
dependency_graph:
  requires: []
  provides:
    - optimistic-locking-update-stock
    - inventory-engine-dead-code-removed
  affects:
    - inventory_engine.py
    - database.py
    - inventory_stock migration
tech_stack:
  added: []
  patterns:
    - optimistic-locking-read-then-conditional-update
    - retry-loop-on-version-conflict
key_files:
  created:
    - supabase/migrations/20260415000000_inventory_stock_version.sql
    - services/agent-orchestrator/tests/test_inventory_engine_bugs.py
  modified:
    - services/agent-orchestrator/core/database.py
    - services/agent-orchestrator/agents/inventory_engine.py
decisions:
  - "Table targeted by migration is restaurant_inventory (the actual InventoryRepository table_name), not inventory_stock as stated in the plan — code and migration are consistent"
  - "Supabase Python client uses synchronous .execute() calls throughout database.py — update_stock follows the same pattern (no await on supabase chain calls)"
  - "max_retries=3 with no sleep between retries accepted as-is per T-19-01-02 threat disposition"
metrics:
  duration: "15m"
  completed: "2026-04-10"
  tasks_completed: 1
  tasks_total: 1
  files_changed: 4
---

# Phase 19 Plan 01: InventoryEngine — Optimistic Locking + Dead Code Removal Summary

Fixed two bugs in InventoryEngineAgent: replaced the read-then-overwrite stock update with a three-attempt optimistic locking loop (SELECT version, UPDATE WHERE version = N, retry on empty RETURNING), and removed the never-used `update_queue` / `batch_size` dead code and the `cleanup()` block that referenced them.

## What Was Fixed

### BUG-01: Race condition in stock updates (optimistic locking)

**Root cause:** `InventoryRepository.update_stock()` previously called `self.update(inventory_id, {"stock_live": new_stock})` which issued a plain `UPDATE ... WHERE id = X` with no version check. Two concurrent writers reading `stock_live = 10` would both write `9`, netting `-1` instead of `-2`.

**Fix applied in `services/agent-orchestrator/core/database.py`:**
- New signature adds `max_retries: int = 3`
- Each attempt: SELECT `id, stock_live, version` for fresh read
- UPDATE sets `stock_live`, increments `version`, filters on `WHERE id = X AND version = expected_version`
- Empty `data` list from Supabase signals another writer won → retry with fresh read
- After `max_retries` exhausted → logs error, returns `None`
- Audit log via `_log_stock_change` is fire-and-forget as before

**Migration `supabase/migrations/20260415000000_inventory_stock_version.sql`:**
- `ALTER TABLE restaurant_inventory ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 0`
- `CREATE INDEX IF NOT EXISTS idx_restaurant_inventory_version ON restaurant_inventory (id, version)`
- Safe to run on existing data: `DEFAULT 0` initialises all rows without data loss

### BUG-02: Dead code removal

**Root cause:** `InventoryEngineAgent.__init__` declared `self.update_queue: List[Dict[str, Any]] = []` and `self.batch_size = 10` that were never read or written outside of `cleanup()`, which contained a no-op TODO block referencing them.

**Fix applied in `services/agent-orchestrator/agents/inventory_engine.py`:**
- Deleted both `update_queue` and `batch_size` assignments from `__init__`
- Removed the `if self.update_queue:` block from `cleanup()`, leaving only `self.logger.info("✓ Inventory Engine cleaned up")`
- `List` import retained — still used in `get_subscribed_routing_keys` return type

## Test Results

All 5 tests in `services/agent-orchestrator/tests/test_inventory_engine_bugs.py` pass:

```
tests/test_inventory_engine_bugs.py::TestBUG02DeadCodeRemoval::test_no_update_queue_attribute PASSED
tests/test_inventory_engine_bugs.py::TestBUG02DeadCodeRemoval::test_no_batch_size_attribute PASSED
tests/test_inventory_engine_bugs.py::TestBUG01OptimisticLocking::test_successful_update_returns_item PASSED
tests/test_inventory_engine_bugs.py::TestBUG01OptimisticLocking::test_conflict_triggers_retry PASSED
tests/test_inventory_engine_bugs.py::TestBUG01OptimisticLocking::test_exhausted_retries_returns_none PASSED
5 passed in 0.31s
```

## Verification Checks

1. `grep update_queue|batch_size inventory_engine.py` → zero matches
2. `.eq("version", expected_version)` present in `database.py` line 875
3. Migration file exists at `supabase/migrations/20260415000000_inventory_stock_version.sql`
4. All 5 tests pass

## Deviations from Plan

### Note: Table name discrepancy in plan description

The plan objective and task description used the table name `inventory_stock`, but `InventoryRepository.__init__` (line 782 of `database.py`) sets `table_name = "restaurant_inventory"`. The migration file correctly targets `restaurant_inventory` to match the actual code. The test harness uses `repo.table_name = "inventory_stock"` as a mock override (irrelevant to production behaviour). No code changes were needed for this — tracked for documentation clarity only.

None of the plan's required code changes deviated from specification.

## Known Stubs

None. Both fixes are fully wired: the version column migration is deployed-ready, the optimistic lock is active in `update_stock`, and the dead code is gone.

## Threat Flags

No new security-relevant surface introduced. The optimistic locking fix mitigates T-19-01-01 (Tampering) as planned.

## Self-Check: PASSED

- `services/agent-orchestrator/tests/test_inventory_engine_bugs.py` — EXISTS, 5 tests PASS
- `supabase/migrations/20260415000000_inventory_stock_version.sql` — EXISTS
- `services/agent-orchestrator/core/database.py` `.eq("version", expected_version)` — FOUND at line 875
- `services/agent-orchestrator/agents/inventory_engine.py` zero matches for `update_queue`/`batch_size` — CONFIRMED
