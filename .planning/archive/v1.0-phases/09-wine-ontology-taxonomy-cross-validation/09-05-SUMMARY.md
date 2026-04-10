---
phase: 09-wine-ontology-taxonomy-cross-validation
plan: 05
subsystem: ontology-tests
tags: [tests, ontology, validation, unit-tests, tdd]
dependency_graph:
  requires: [09-01, 09-02, 09-03, 09-04]
  provides: [test coverage for ONTO-01 through ONTO-08]
  affects: [ontology_validation_service, ontology_normalization, ontology_tasks]
tech_stack:
  added: []
  patterns: [pytest, unittest.mock, MagicMock, patch.object, Celery task.apply()]
key_files:
  created:
    - services/agent-orchestrator/tests/test_ontology_validation.py
    - services/agent-orchestrator/tests/test_ontology_tasks.py
  modified: []
decisions:
  - "Used OntologyValidationService.__new__() pattern to bypass __init__ DB connection — more reliable than patching create_client"
  - "Patched services.ontology_normalization.* functions instead of services.ontology_validation_service.* because all normalization functions are lazy-imported inside methods"
  - "Vintage test uses .limit(1).execute() mock chain (not .maybe_single()) matching actual implementation"
  - "Redis dedup tests use task.apply() to run Celery task in-process with mocked redis_lib module"
  - "Grape normalization tests patch both _GRAPE_CACHE and _get_supabase to avoid live DB calls"
metrics:
  duration: "~5 minutes"
  completed: "2026-04-06"
  tasks: 2
  files: 2
---

# Phase 9 Plan 05: Phase 9 Ontology Cross-Validation Test Suite Summary

**One-liner:** 29 pytest unit tests covering all ONTO-01 through ONTO-08 requirements across 5 test classes and 2 test files, all passing in 0.30s with full mock isolation.

## What Was Built

Two test files providing complete coverage of Phase 9 ontology validation:

### `test_ontology_validation.py` — 21 tests

| Class | Tests | Requirements Covered |
|-------|-------|---------------------|
| `TestRegionCountryConsistency` | 4 | ONTO-01, ONTO-05 |
| `TestGrapeAliasNormalization` | 3 | ONTO-02 |
| `TestAppellationRuleEnforcement` | 3 | ONTO-03, ONTO-05 |
| `TestVintagePlausibility` | 5 | ONTO-04, ONTO-05 |
| `TestColorGrapeWarning` | 3 | ONTO-02, D-03 |
| `TestOntologyAutofill` | 3 | ONTO-08, D-04 |

### `test_ontology_tasks.py` — 8 tests

| Class | Tests | Requirements Covered |
|-------|-------|---------------------|
| `TestOntologyValidationPayloadStructure` | 2 | ONTO-06 |
| `TestCriticalFailureRouting` | 4 | ONTO-07, D-03 |
| `TestTaskRedisDedup` | 2 | ONTO-05 |

## Test Run Results

```
29 passed in 0.30s
```

Full verbose output:
```
tests/test_ontology_validation.py::TestRegionCountryConsistency::test_country_mismatch_is_critical PASSED
tests/test_ontology_validation.py::TestRegionCountryConsistency::test_matching_country_passes PASSED
tests/test_ontology_validation.py::TestRegionCountryConsistency::test_no_appellation_skips_check PASSED
tests/test_ontology_validation.py::TestRegionCountryConsistency::test_appellation_not_in_db_skips_check PASSED
tests/test_ontology_validation.py::TestGrapeAliasNormalization::test_shiraz_resolves_to_syrah PASSED
tests/test_ontology_validation.py::TestGrapeAliasNormalization::test_case_insensitive_alias_match PASSED
tests/test_ontology_validation.py::TestGrapeAliasNormalization::test_unknown_grape_returns_none PASSED
tests/test_ontology_validation.py::TestAppellationRuleEnforcement::test_wrong_grape_for_barolo_is_critical PASSED
tests/test_ontology_validation.py::TestAppellationRuleEnforcement::test_correct_grape_for_barolo_passes PASSED
tests/test_ontology_validation.py::TestAppellationRuleEnforcement::test_no_appellation_rule_skips_check PASSED
tests/test_ontology_validation.py::TestVintagePlausibility::test_impossible_vintage_is_critical PASSED
tests/test_ontology_validation.py::TestVintagePlausibility::test_nv_vintage_always_passes PASSED
tests/test_ontology_validation.py::TestVintagePlausibility::test_nv_variants_pass PASSED
tests/test_ontology_validation.py::TestVintagePlausibility::test_no_appellation_skips_check PASSED
tests/test_ontology_validation.py::TestVintagePlausibility::test_no_vintage_rule_skips_check PASSED
tests/test_ontology_validation.py::TestColorGrapeWarning::test_color_grape_mismatch_is_warning_not_critical PASSED
tests/test_ontology_validation.py::TestColorGrapeWarning::test_matching_color_grape_passes PASSED
tests/test_ontology_validation.py::TestColorGrapeWarning::test_unknown_grape_color_skips_check PASSED
tests/test_ontology_validation.py::TestOntologyAutofill::test_autofill_applied_when_confidence_low PASSED
tests/test_ontology_validation.py::TestOntologyAutofill::test_autofill_skipped_when_confidence_high PASSED
tests/test_ontology_validation.py::TestOntologyAutofill::test_autofill_fills_absent_field PASSED
tests/test_ontology_tasks.py::TestOntologyValidationPayloadStructure::test_result_serializes_to_correct_structure PASSED
tests/test_ontology_tasks.py::TestOntologyValidationPayloadStructure::test_result_with_multiple_failures PASSED
tests/test_ontology_tasks.py::TestCriticalFailureRouting::test_critical_failure_inserts_into_review_queue PASSED
tests/test_ontology_tasks.py::TestCriticalFailureRouting::test_critical_failure_sets_auto_blocked PASSED
tests/test_ontology_tasks.py::TestCriticalFailureRouting::test_warning_high_confidence_does_not_route PASSED
tests/test_ontology_tasks.py::TestCriticalFailureRouting::test_warning_low_confidence_routes_without_auto_blocked PASSED
tests/test_ontology_tasks.py::TestTaskRedisDedup::test_task_acquires_lock_and_calls_validate PASSED
tests/test_ontology_tasks.py::TestTaskRedisDedup::test_task_skips_if_lock_already_held PASSED
```

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `check_region_country_consistency` does not use `get_country_for_appellation`**
- **Found during:** Task 1 — reading actual implementation before writing tests
- **Issue:** The plan's test spec patched `services.ontology_validation_service.get_country_for_appellation`, but the actual `check_region_country_consistency` method uses `lookup_region_by_name` + `get_region_ancestors` from `ontology_normalization` via local imports. `get_country_for_appellation` is only used in `_apply_ontology_autofills`.
- **Fix:** Patched `services.ontology_normalization.lookup_region_by_name` to return a mock row with `country_code='IT'` directly on the row — the method short-circuits ancestor walk when `country_code` is set on the row itself.
- **Files modified:** `tests/test_ontology_validation.py`

**2. [Rule 1 - Bug] `check_vintage_plausibility` uses `.limit(1).execute()` not `.maybe_single()`**
- **Found during:** Task 1 — the plan's provided code used `.maybe_single().execute().data = mock_rules` (dict), but the actual service uses `.limit(1).execute()` with `resp.data` as a list and `rule = resp.data[0]`
- **Fix:** Mock chain updated to `.limit.return_value.execute.return_value.data = [mock_rules]` (list with one element)
- **Files modified:** `tests/test_ontology_validation.py`

**3. [Rule 2 - Missing] `normalize_grape_name` requires `_get_supabase` to be patched alongside `_GRAPE_CACHE`**
- **Found during:** Task 1 — `normalize_grape_name` calls `_get_supabase()` before checking the cache, which calls `create_client()`. Without patching `_get_supabase`, the function would fail (or return None) before reaching the cache check.
- **Fix:** Added `patch.object(norm_module, "_get_supabase", return_value=MagicMock())` alongside `_GRAPE_CACHE` patches in all grape normalization tests.
- **Files modified:** `tests/test_ontology_validation.py`

**4. [Rule 2 - Missing] Autofill patches must be at `services.ontology_normalization.*` not `services.ontology_validation_service.*`**
- **Found during:** Task 1 — `_apply_ontology_autofills` imports `get_country_for_appellation`, `get_grape_color`, `get_region_for_appellation` via local `from services.ontology_normalization import ...` inside the method. Patching at the module level of `ontology_validation_service` would not intercept these.
- **Fix:** All autofill patches use `services.ontology_normalization.get_country_for_appellation` etc.
- **Files modified:** `tests/test_ontology_validation.py`

**5. [Rule 2 - Enhancement] Added 15 extra tests beyond plan minimum (29 vs ≥14)**
- **Found during:** Task 1 & 2 — additional negative/edge cases substantially improve coverage signal
- **Extra tests:** `test_appellation_not_in_db_skips_check`, `test_case_insensitive_alias_match`, `test_unknown_grape_returns_none`, `test_correct_grape_for_barolo_passes`, `test_no_appellation_rule_skips_check`, `test_nv_variants_pass`, `test_no_appellation_skips_check` (vintage), `test_no_vintage_rule_skips_check`, `test_matching_color_grape_passes`, `test_unknown_grape_color_skips_check`, `test_autofill_fills_absent_field`, `test_result_with_multiple_failures`

## Known Stubs

None — tests exercise real service logic with mocked I/O boundaries only.

## Self-Check: PASSED

- `tests/test_ontology_validation.py`: EXISTS, 21 tests, all passing
- `tests/test_ontology_tasks.py`: EXISTS, 8 tests, all passing
- Combined: 29 tests, 0 failures, runtime 0.30s
