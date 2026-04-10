---
phase: 09-wine-ontology-taxonomy-cross-validation
plan: "03"
subsystem: ontology-validation
tags: [ontology, grape-normalization, region-hierarchy, cross-validation, field-confidence]
dependency_graph:
  requires:
    - "07: field_confidence framework (merge_field_confidence, DEFAULT_ACCEPT_THRESHOLD)"
    - "08: web verification (field_confidence JSONB written to master_wine_library_submissions)"
    - "09-01: Phase 9 migration (wine_regions, grape_varieties, appellation_rules, vintage_rules, field_review_queue source constraint)"
  provides:
    - "ontology_normalization.py: DB lookup helpers (normalize_grape_name, lookup_appellation_rules, get_region_ancestors)"
    - "ontology_validation_service.py: OntologyValidationService with 4 checkers + autofill + JSONB persistence"
  affects:
    - "09-04: ontology_tasks.py Celery task calls run_ontology_validation()"
    - "master_wine_library_submissions: ontology_validation JSONB + ontology_validated_at + auto_blocked"
    - "field_review_queue: CRITICAL failures inserted with source='ontology'"
tech_stack:
  added: []
  patterns:
    - "supabase-py iterative parent_id traversal (adjacency-list, max 10 hops)"
    - "module-level lazy-loaded alias cache (_GRAPE_CACHE dict)"
    - "Pydantic BaseModel for OntologyCheckFailure + OntologyValidationResult"
    - "merge_field_confidence(overwrite_lower=True) with DEFAULT_ACCEPT_THRESHOLD guard"
key_files:
  created:
    - services/agent-orchestrator/services/ontology_normalization.py
    - services/agent-orchestrator/services/ontology_validation_service.py
  modified: []
decisions:
  - "Iterative parent_id traversal (not recursive SQL CTE): supabase-py does not support raw SQL; max 10 hops with visited set prevents infinite loops on circular data (T-09-07)"
  - "Module-level _GRAPE_CACHE: loaded once from DB on first call; covers name, canonical_name, aliases — no user input reaches alias lookup directly (T-09-06)"
  - "D-04 autofill guard: check existing_conf < DEFAULT_ACCEPT_THRESHOLD BEFORE calling merge_field_confidence to enforce policy strictly (T-09-08)"
  - "D-03 WARNING routing: WARNING failures only insert into field_review_queue if field confidence < 0.8 — high-confidence confirmed fields are not re-queued for review"
  - "Country code mapping: hardcoded dict maps English country names to ISO-2 codes; unknown names fall back to first-2-chars-uppercase (acceptable for MVP)"
metrics:
  duration: "~15 minutes"
  completed_date: "2026-04-06"
  tasks_completed: 2
  files_created: 2
---

# Phase 9 Plan 03: Ontology Normalization + Validation Service Summary

**One-liner:** Supabase-backed grape alias normalization with iterative region-ancestor traversal and 4-checker CRITICAL/WARNING validation engine writing ontology_validation JSONB with D-03/D-04 routing.

## Tasks Completed

| # | Task | Status | Commit |
|---|------|--------|--------|
| 1 | Create ontology_normalization.py (7 public functions + _GRAPE_CACHE) | ✅ | see final commit |
| 2 | Create ontology_validation_service.py (4 checkers + autofill + routing) | ✅ | see final commit |

## Functions / Classes Created

### `services/agent-orchestrator/services/ontology_normalization.py`

| Symbol | Type | Description |
|--------|------|-------------|
| `_GRAPE_CACHE` | module-level var | Lazy-loaded `{lower_alias: canonical_name}` dict |
| `_get_supabase()` | private fn | Creates supabase client from settings |
| `_ensure_grape_cache(supabase)` | private fn | Loads all grape_varieties into _GRAPE_CACHE once |
| `normalize_grape_name(raw_name)` | public fn | Resolves alias → canonical (e.g. "Shiraz" → "Syrah") |
| `normalize_grape_name_batch(raw_names)` | public fn | Batch alias resolution |
| `lookup_appellation_rules(appellation_name)` | public fn | Fetches appellation_rules row by ILIKE match |
| `lookup_region_by_name(region_name)` | public fn | Fetches wine_regions row; prefers level='appellation' |
| `get_region_ancestors(region_id)` | public fn | Iterative parent_id chase (max 10 hops, T-09-07) |
| `get_country_for_appellation(appellation_name)` | public fn | Convenience: appellation → ISO country_code |
| `get_region_for_appellation(appellation_name)` | public fn | Convenience: appellation → region-level ancestor row |
| `get_grape_color(canonical_grape_name)` | public fn | Returns grape color ('red'/'white'/'rosé'/'orange') |

### `services/agent-orchestrator/services/ontology_validation_service.py`

| Symbol | Type | Description |
|--------|------|-------------|
| `OntologyCheckFailure` | Pydantic model | check, severity, expected, found, message |
| `OntologyValidationResult` | Pydantic model | checks_passed/failed/total, failures[], autofills_applied, validated_at |
| `OntologyValidationService` | class | Main validation service |
| `check_region_country_consistency()` | checker | CRITICAL if appellation ↔ country mismatch |
| `check_grape_appellation_compatibility()` | checker | CRITICAL if grape not allowed/required by appellation rules |
| `check_vintage_plausibility()` | checker | CRITICAL if vintage not yet releasable per vintage_rules delay |
| `check_color_grape_consistency()` | checker | WARNING if wine color contradicts grape's known color |
| `_apply_ontology_autofills()` | private method | D-04: fills country/region/color with confidence=1.0, source="ontology" |
| `_route_failures()` | private method | D-03: CRITICAL → field_review_queue + auto_blocked; WARNING → queue only if conf < 0.8 |
| `run_ontology_validation()` | public method | Main entry point: fetch → normalize → check → autofill → write JSONB → route |

## Verification Results

```
$ python3 -m py_compile services/agent-orchestrator/services/ontology_normalization.py
ontology_normalization.py: Syntax OK  (exit 0)

$ python3 -m py_compile services/agent-orchestrator/services/ontology_validation_service.py
ontology_validation_service.py: Syntax OK  (exit 0)

$ python3 -c "from services.ontology_normalization import normalize_grape_name, ..."
ontology_normalization imports: OK

$ python3 -c "from services.ontology_validation_service import OntologyValidationService, ..."
ontology_validation_service imports: OK

$ grep -c "def check_" services/agent-orchestrator/services/ontology_validation_service.py
4  (all 4 checkers present)
```

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None — both services make live Supabase calls. All DB queries require the Phase 9 migration (09-01) to be applied before runtime use.

## Threat Flags

No new network endpoints, auth paths, or file access patterns introduced beyond what is documented in the plan's threat model (T-09-06 through T-09-09). All mitigations applied:
- T-09-06: _GRAPE_CACHE loaded once, no user input reaches alias lookup
- T-09-07: max 10 hops + visited set in get_region_ancestors
- T-09-08: DEFAULT_ACCEPT_THRESHOLD guard in _apply_ontology_autofills before merge_field_confidence
- T-09-09: all queries use .eq()/.ilike()/.contains() — no string interpolation into SQL

## Self-Check: PASSED

- [x] `services/agent-orchestrator/services/ontology_normalization.py` exists
- [x] `services/agent-orchestrator/services/ontology_validation_service.py` exists
- [x] Both files pass `python3 -m py_compile`
- [x] Both files import successfully
- [x] 4 checkers present in ontology_validation_service.py
- [x] `merge_field_confidence` used with `overwrite_lower=True`
- [x] `DEFAULT_ACCEPT_THRESHOLD` guard present
- [x] `auto_blocked: True` set on CRITICAL failures
- [x] `source="ontology"` in field_review_queue inserts
