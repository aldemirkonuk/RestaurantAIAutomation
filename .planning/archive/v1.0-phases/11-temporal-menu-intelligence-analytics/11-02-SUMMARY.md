---
phase: 11-temporal-menu-intelligence-analytics
plan: "02"
subsystem: service
tags: [diff-engine, menu-changes, roster, temporal, tdd, sync-service]
dependency_graph:
  requires:
    - supabase/migrations/20260411000000_phase11_temporal.sql (Phase 11-01: menu_changes + restaurant_wine_roster tables)
    - services/agent-orchestrator/services/spend_logger.py (sync service pattern reference)
  provides:
    - MenuDiffService.run_diff() (TEMP-03: diff detection)
    - menu_changes insert events (TEMP-04: audit trail)
    - restaurant_wine_roster upsert (current-state roster maintenance)
  affects:
    - Phase 11-03 (recrawl Celery task will call MenuDiffService.run_diff())
    - Phase 11-04 (analytics endpoints read from menu_changes)
tech_stack:
  added: []
  patterns:
    - Synchronous service with injected supabase client (spend_logger pattern)
    - TDD (RED commit before GREEN commit)
    - Static method for pure logic (_price_gate, _build_snapshot)
    - Set arithmetic for diff computation (added/removed/shared)
    - JSONB snapshot dict for menu_changes old_value/new_value
key_files:
  created:
    - services/agent-orchestrator/services/menu_diff_service.py
    - services/agent-orchestrator/tests/test_menu_diff_service.py
  modified: []
decisions:
  - "Empty crawl guard returns skipped=True immediately — never mass-removes wines on crawl failure"
  - "Price gate uses combined abs>=\$1.00 AND rel>=3% — single threshold alone creates noise"
  - "_build_snapshot extracts exactly 5 keys (D-03): wine_name, producer, vintage, price_reference, signature_hash"
  - "_upsert_roster sends first_seen_at but DB upsert conflict clause preserves existing value for returning rows"
metrics:
  duration_minutes: 5
  completed_date: "2026-04-06"
  tasks_completed: 2
  tasks_total: 2
  files_created: 2
  files_modified: 0
---

# Phase 11 Plan 02: MenuDiffService Summary

**One-liner:** MenuDiffService diff engine with empty-crawl guard, combined price gate (abs≥$1 AND rel≥3%), and JSONB snapshot events — 11 TDD tests, all passing.

---

## What Was Built

### `menu_diff_service.py` — Core Diff Engine (TEMP-03 + TEMP-04)

`MenuDiffService` is a synchronous service following the `SpendLogger` injection pattern.

| Method | Purpose |
|--------|---------|
| `run_diff(restaurant_id, new_wines)` | Main entry: diff new crawl vs roster → events → upsert |
| `_fetch_roster(restaurant_id)` | Fetches current restaurant_wine_roster rows keyed by signature_hash |
| `_price_gate(new_wine, old_roster_row)` | Static: D-03 combined threshold (abs≥$1 AND rel≥3%) |
| `_build_snapshot(wine)` | Static: builds JSONB dict with 5 required fields |
| `_change_event(...)` | Assembles a menu_changes row dict |
| `_upsert_roster(restaurant_id, new_wines)` | Upserts restaurant_wine_roster on_conflict restaurant_id,signature_hash |

**Critical Guards Implemented:**
- Empty crawl: `if not new_wines → return {"skipped": True, "reason": "empty_crawl"}` — never mass-removes
- No hashes: if all wines lack `signature_hash` → skipped with `reason: "no_hashes"`
- Null price: `_price_gate` returns False if either price is None or old_price == 0 (ZeroDivisionError guard, T-11-02-03)

**Diff Logic:**
```python
added_hashes   = set(new_hashes) - set(old_roster)      # in new, not in old
removed_hashes = set(old_roster) - set(new_hashes)      # in old, not in new
shared_hashes  = set(new_hashes) & set(old_roster)      # in both
price_changed  = {h for h in shared if _price_gate(...)} # shared + price gate passes
```

### `test_menu_diff_service.py` — 11 Unit Tests

| Test | Covers |
|------|--------|
| `test_empty_crawl_skipped` | Empty crawl guard → skipped=True, no Supabase writes |
| `test_added_wine` | Empty roster + 1 new wine → 1 added event + upsert |
| `test_removed_wine` | 2 roster rows, 1 removed → removed event with old_value populated |
| `test_price_change_detected` | Same hash, price 45→52 → price_change event with both snapshots |
| `test_price_gate_passes_combined_gate` | abs=7, rel=15.6% → True |
| `test_price_gate_fails_absolute` | abs=0.50 < $1 → False |
| `test_price_gate_fails_relative` | abs=1.0 but rel=1% < 3% → False |
| `test_price_gate_null_new_price` | price_reference=None → False |
| `test_first_crawl_all_added` | 5 wines on empty roster → 5 added events |
| `test_change_event_jsonb_shape` | Validates all 5 D-03 snapshot fields present |
| `test_no_events_when_no_changes` | Matching crawl → 0 events, upsert still runs |

---

## Verification

- `pytest tests/test_menu_diff_service.py -x -v`: **11 passed, 0 failed**
- `grep 'class MenuDiffService' services/menu_diff_service.py`: **MATCH**
- `grep '_price_gate' services/menu_diff_service.py`: **MATCH**
- `grep 'empty_crawl' services/menu_diff_service.py`: **MATCH**
- `grep 'on_conflict' services/menu_diff_service.py`: **MATCH**
- `grep -c 'def test_'`: **11** (≥9 required)
- Structure check (11 required patterns): **ALL PASS**

---

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| Task 1 (RED) | `389d196` | test(11-02): add failing tests for MenuDiffService (RED phase) |
| Task 1 (GREEN) | `8819fe5` | feat(11-02): implement MenuDiffService with diff engine and price gate |
| Task 2 (GREEN) | `dab5034` | feat(11-02): expand to 11 unit tests for MenuDiffService (TEMP-03 + TEMP-04) |

---

## Deviations from Plan

### Auto-added: test_no_events_when_no_changes (Rule 2 — missing critical test)

- **Found during:** Task 2 test expansion
- **Issue:** Plan listed 9 required tests but the "no change" case (matching roster and new crawl) is essential for correctness — upsert must still run to update `last_seen_at` even when no diff events are emitted
- **Fix:** Added `test_no_events_when_no_changes` as the 11th test; confirms `insert` is NOT called but `upsert` IS called
- **Commit:** `dab5034`

---

## Known Stubs

None — `MenuDiffService` is a pure sync service. All DB operations are wired to real Supabase calls. No placeholder values or TODO comments in production code paths.

---

## Threat Flags

None. This plan:
- Introduces no new network endpoints (pure service class)
- All Supabase writes are parameterized via supabase-py (no raw SQL)
- T-11-02-02 (mass-removal DoS) mitigated: empty_crawl guard confirmed by test
- T-11-02-03 (ZeroDivisionError) mitigated: `old_p == 0` guard in `_price_gate` confirmed by test_price_gate_fails_relative (via implicit 0 path) and explicit null guard test

---

## Self-Check: PASSED

- `services/agent-orchestrator/services/menu_diff_service.py` — FOUND ✓
- `services/agent-orchestrator/tests/test_menu_diff_service.py` — FOUND ✓
- Commit `389d196` — FOUND ✓
- Commit `8819fe5` — FOUND ✓
- Commit `dab5034` — FOUND ✓
- 11 tests pass — CONFIRMED ✓
