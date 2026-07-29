---
plan: 20-06
status: complete
committed: true
---

# Plan 20-06 Summary: InventoryEngine Event Sequence Monotonicity

## What was built

Replaced the hard-coded `sequence_number=1` in all three `append_event` calls inside `InventoryEngineAgent` with a per-aggregate monotonic counter. Added `_event_sequence: dict[str, int]` to `__init__` and a `_next_sequence(aggregate_id)` helper that atomically increments and returns the counter for each aggregate. This makes event replay possible — each event for a given inventory item now carries a strictly increasing sequence number.

## Files changed

- `services/agent-orchestrator/agents/inventory_engine.py` — added `_event_sequence` dict to `__init__`, added `_next_sequence()` helper method, replaced `sequence_number=1` with `self._next_sequence(str(inventory_id))` in `_handle_stock_evaluated`, `_handle_order_delivered`, and `_handle_manual_correction`
- `services/agent-orchestrator/tests/test_inventory_engine_hardening.py` — added 3 new tests to `TestHARD01EventSourcing`: `test_sequence_increments_per_aggregate`, `test_different_aggregates_have_independent_sequences`, `test_manual_correction_sequence_continues_after_stock`

## Verification

```
22 passed in 0.66s
```

All 19 existing tests continued to pass. All 3 new sequence monotonicity tests passed on first run.

## Key decisions

- Counter is in-memory only (resets on agent restart) — intentional for Phase 20 scope; persistent sequence via DB query is deferred to a later phase
- Counter keyed on `str(inventory_id)` to match the `aggregate_id` string type passed to `append_event`
- `_next_sequence` is a synchronous method (no async needed — pure in-memory dict operation)
