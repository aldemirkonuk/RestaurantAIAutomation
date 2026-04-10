---
phase: 10-critic-scores-pricing-intelligence
plan: "02"
subsystem: services
tags: [critic-scores, normalization, composite-score, markup, pricing, serper, regex]
dependency_graph:
  requires:
    - services/serper_client.py (SerperResult TypedDict interface)
    - supabase/migrations/20260405000003_master_wine_library_jsonb.sql (critic_scores JSONB stub)
  provides:
    - services/critic_score_service.py (CriticScoreService + 6 standalone functions)
  affects:
    - jobs/score_tasks.py (Plan 10-04: imports CriticScoreService for _score_async())
    - tests/test_critic_score_service.py (Plan 10-05: 39 unit tests all green)
tech_stack:
  added: []
  patterns:
    - Pure-Python stateless service module (no DB, no I/O)
    - TDD red-green cycle (test file committed before implementation)
    - Standalone functions + thin class facade (testable in isolation)
    - Domain-aware regex score extraction from Serper snippets
key_files:
  created:
    - services/agent-orchestrator/services/critic_score_service.py
    - services/agent-orchestrator/tests/test_critic_score_service.py
  modified: []
decisions:
  - "SCORE_WEIGHTS locked per D-05: WA 30%, WS 25%, Vivino 20%, Decanter 15%, JR 10% — not user-configurable"
  - "compute_composite_score returns None when < 2 sources to prevent single-source bias"
  - "parse_serper_score_snippets uses domain lookup (link URL) before falling back to expected_source for accurate attribution"
  - "compute_markup_info guards retail_price_avg == 0 explicitly (T-10-06 mitigation)"
  - "JR regex uses /20 or 'out of 20' anchored pattern; fallback _JR_LABEL_RE only fires when jancisrobinson.com in link"
metrics:
  duration_minutes: 15
  completed_date: "2026-04-06"
  tasks_completed: 1
  tasks_total: 1
  files_created: 2
  files_modified: 0
---

# Phase 10 Plan 02: CriticScoreService — Pure Python Score Math Summary

**One-liner:** Stateless `critic_score_service.py` with domain-aware regex parsing, weighted composite (WA/WS/Vivino/Decanter/JR), and anomaly-flagging markup calculator.

---

## What Was Built

`services/agent-orchestrator/services/critic_score_service.py` — a pure Python service module (no DB calls, no async I/O) that isolates all score mathematics for Phase 10's critic scoring pipeline. The module exposes 6 standalone functions and a `CriticScoreService` class facade.

### Functions

| Function | Purpose | Key Behavior |
|----------|---------|--------------|
| `normalize_score(source, raw)` | CRIT-02: Convert to 0–100 scale | Vivino ×20, JR ×5, WA/WS/Decanter passthrough |
| `compute_composite_score(scores)` | CRIT-03: Weighted average | None if <2 sources; re-weights to available sources only |
| `build_critic_score_queries(name, producer, vintage)` | Serper query builder | 6 keys: 5 critics + wine_searcher |
| `parse_serper_score_snippets(results, source)` | Regex extraction | Domain-aware source detection from URL |
| `classify_markup(ratio)` | CRIT-05: Tier classification | value/standard/premium/luxury_markup at 1.5/2.5/4.0 |
| `compute_markup_info(menu_price, retail)` | CRIT-05/06: Ratio + anomaly | Returns None if either price missing/zero; `is_anomaly` if >5x or <0.8x |

### Score Weight Constants

```python
SCORE_WEIGHTS = {
    "wine_advocate": 0.30,   # D-05 LOCKED
    "wine_spectator": 0.25,
    "vivino": 0.20,
    "decanter": 0.15,
    "jancis_robinson": 0.10,
}
# Sum: 1.00 (verified)
```

---

## Verification Results

All plan acceptance criteria pass:

```
✅ normalize_score('vivino', 4.2) == 84.0
✅ normalize_score('jancis_robinson', 16.5) == 82.5
✅ compute_composite_score({'wine_advocate': {'normalized_score': 93.0}}) is None
✅ compute_markup_info(120.0, 50.0) == {markup_ratio: 2.4, markup_classification: 'standard', is_anomaly: False}
✅ compute_markup_info(300.0, 50.0) == {markup_ratio: 6.0, markup_classification: 'luxury_markup', is_anomaly: True}
✅ build_critic_score_queries('Barolo', 'Gaja', 2019) returns dict with exactly 6 keys
✅ 39/39 pytest tests pass (test_critic_score_service.py)
```

---

## Deviations from Plan

None — plan executed exactly as written. The implementation follows the `<action>` block verbatim. TDD red-green cycle completed: failing test commit (`f350d68`) then implementation commit (`07b5d23`).

---

## Threat Mitigations Applied

| Threat | Mitigation in Code |
|--------|--------------------|
| T-10-04: Regex tampering via Serper snippets | `_WA_WS_DEC_RE` anchored to `85-99` range; `_VIVINO_RE` anchored to `3.x–5.x`; `_JR_RE` anchored to `12–20` — values outside range silently unmatched |
| T-10-06: Division by zero in markup | `retail_price_avg == 0` explicit guard returns `None` before any division |

---

## Known Stubs

None — all functions are fully implemented and return real computed values. No placeholder data flows to any output.

---

## Threat Flags

None — this module has no network endpoints, no auth paths, no file access, and no schema changes. It is a pure computation module.

---

## Self-Check: PASSED

Files created:
- ✅ `services/agent-orchestrator/services/critic_score_service.py` — FOUND
- ✅ `services/agent-orchestrator/tests/test_critic_score_service.py` — FOUND

Commits:
- ✅ `f350d68` — test(10-02): add failing tests for CriticScoreService
- ✅ `07b5d23` — feat(10-02): create CriticScoreService with all parsing and computation methods
