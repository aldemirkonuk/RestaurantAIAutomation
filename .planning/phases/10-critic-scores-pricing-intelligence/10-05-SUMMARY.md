---
phase: 10-critic-scores-pricing-intelligence
plan: "05"
subsystem: testing
tags: [pytest, unit-tests, mocking, crit-01, crit-02, crit-03, crit-04, crit-05, crit-06, d-02]
dependency_graph:
  requires:
    - "10-02"  # critic_score_service.py (functions under test)
    - "10-03"  # dataset_ingestion_service.py (functions under test)
    - "10-04"  # score_tasks.py (Celery tasks under test)
  provides:
    - "Automated test gate for Phase 10"
    - "Redis NX dedup verified (CRIT-01)"
    - "Markup anomaly thresholds verified (CRIT-06)"
    - "Non-destructive JSONB guard verified (D-02)"
  affects: []
tech_stack:
  added: []
  patterns:
    - "unittest.mock.patch at module boundary for Redis, Supabase"
    - "monkeypatch.setattr for DATASET_SOURCES glob paths"
    - "tmp_path fixture for real filesystem JSONL/CSV in integration-style tests"
    - "score_lookup_task.run() for synchronous Celery task invocation"
key_files:
  created:
    - services/agent-orchestrator/tests/test_score_tasks.py
    - services/agent-orchestrator/tests/test_dataset_ingestion.py
  modified: []
decisions:
  - "test_critic_score_service.py was pre-existing from Plan 10-02 TDD RED phase with 39 passing tests — verified but not re-created"
  - "Celery task.request cannot be patched via patch.object (proxy property); tests use _score_async mock instead"
  - "Lock delete assertion: lock is NOT deleted when lock is never acquired (return before try block)"
  - "tmp_path + monkeypatch used for DatasetIngestionService integration tests requiring real filesystem reads"
metrics:
  duration: "~12 minutes"
  completed: "2026-04-06"
  tasks_completed: 2
  tasks_total: 2
  files_created: 2
  total_test_count: 85
  new_tests: 46
---

# Phase 10 Plan 05: Test Suite for Critic Scores + Dataset Ingestion Summary

**One-liner:** 85 passing pytest tests verifying Redis NX dedup, markup anomaly detection, and non-destructive JSONB enrichment across three test files.

## What Was Built

### Task 1: test_critic_score_service.py (CRIT-02/03/04/05/06) — Pre-existing

`test_critic_score_service.py` was already created during Plan 10-02's TDD RED phase and committed with 39 tests. All 39 pass and cover:

- `TestNormalizeScore` — 5 assertions (WA, WS, Vivino×20, JR×5, Decanter passthrough)
- `TestScoreWeights` — 4 assertions (sum=1.0, 5 sources, WA=0.30, Vivino=0.20)
- `TestCompositeScore` — 6 assertions (None for <2 sources, float for 2+, weighted math, ignored sources)
- `TestBuildCriticScoreQueries` — 5 assertions (6 keys, vintage in query, no "None" string, producer included)
- `TestParseSerperScoreSnippets` — 5 assertions (WA, Vivino, Wine-Searcher, JR extractions, empty returns None)
- `TestClassifyMarkup` — 4 assertions (value/standard/premium/luxury_markup tiers)
- `TestComputeMarkupInfo` — 6 assertions (standard, >5x anomaly, <0.8x anomaly, None guards, zero retail)
- `TestCriticScoreServiceFacade` — 3 assertions (facade methods delegate correctly)

### Task 2: test_score_tasks.py (CRIT-01/05/06) — Created

19 tests in 5 classes:

| Class | Tests | Coverage |
|-------|-------|----------|
| `TestRedisNXDedup` | 5 | Lock key format, NX behavior, lock not deleted when not acquired, dataset task uses different key |
| `TestBudgetCapBehavior` | 2 | skipped_budget_cap status propagated, rescore_stale queues correctly |
| `TestMarkupCascadeUpdate` | 5 | 2.4x standard, NULL menu_price skipped, empty rows no error, value tier, multiple rows |
| `TestAnomalyFlagging` | 5 | >5x triggers review, <0.8x triggers review, 2x no review, exactly 5x NOT anomaly, source=pricing_anomaly |
| `TestRescoreStaleWines` | 2 | Empty library queues 0, fresh wines not re-queued |

### Task 2: test_dataset_ingestion.py (D-02) — Created

27 tests in 5 classes:

| Class | Tests | Coverage |
|-------|-------|----------|
| `TestFieldMatch` | 9 | Identical, case-insensitive, empty/None guards, dissimilar, threshold=0.85 |
| `TestWineMatches` | 8 | Perfect 4-field, zero match, CSV no-producer 3-field, vintage int vs str, MIN_MATCH_COUNT, partial |
| `TestDiscoverDatasets` | 3 | Empty glob, path+format keys, nonexistent directory |
| `TestDatasetIngestionServiceNonDestructive` | 6 | not_found, skipped (no files), wine_structure NOT overwritten, empty JSONB enriched, all-populated skipped, no-match |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Celery request property cannot be patched**
- **Found during:** Task 2 `test_lock_released_even_on_exception`
- **Issue:** `patch.object(score_lookup_task, "request")` raises `AttributeError: property has no setter` — Celery tasks use a proxy object for request context
- **Fix:** Rewrote test to patch `_score_async` to raise and `score_lookup_task.retry` to raise, then verify `r.delete()` still called in finally
- **Files modified:** `tests/test_score_tasks.py`

**2. [Rule 1 - Bug] Lock delete assertion reversed**
- **Found during:** Task 2 first test run
- **Issue:** Test asserted `mock_redis.delete.assert_called_once_with(...)` when lock NOT acquired. But `r.delete()` is inside the `finally` block of `try:` — the `finally` is only entered when the lock IS acquired (code returns before the try block otherwise)
- **Fix:** Changed assertion to `mock_redis.delete.assert_not_called()`
- **Files modified:** `tests/test_score_tasks.py`

## Known Stubs

None — all tests use mocks with explicit return values, no stubs that block plan goal.

## Threat Flags

None — these are test-only files with no new network endpoints, auth paths, or schema changes.

## Self-Check: PASSED

| Check | Result |
|-------|--------|
| `test_score_tasks.py` exists | FOUND |
| `test_dataset_ingestion.py` exists | FOUND |
| Commit 52a4e55 exists | FOUND |
| All 85 tests pass | PASSED |
