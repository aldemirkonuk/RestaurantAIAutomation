---
phase: 09-wine-ontology-taxonomy-cross-validation
verified: 2026-04-06T00:00:00Z
status: gaps_found
score: 7/8 must-haves verified
gaps:
  - truth: "appellation_rules table seeded with ≥100 major appellations including Barolo+Nebbiolo rules, in valid JSONB format"
    status: failed
    reason: "09_appellation_rules_seed.sql inserts required_grapes and allowed_grapes using PostgreSQL array literal syntax (e.g. '{grape,Nebbiolo,min_pct}') instead of valid JSON (e.g. '[{\"grape\": \"Nebbiolo\", \"min_pct\": 100}]'). PostgreSQL will throw 'ERROR: invalid input syntax for type json' when the seed migration is executed, preventing appellation rules from loading. All grape↔appellation cross-validation would silently become a no-op (lookup_appellation_rules returns None for every appellation)."
    artifacts:
      - path: "supabase/migrations/seed/09_appellation_rules_seed.sql"
        issue: "JSONB columns required_grapes and allowed_grapes populated with PostgreSQL array literal syntax {grape,Nebbiolo,min_pct} — not valid JSON. All 121 rows affected."
    missing:
      - "Fix all INSERT statements in 09_appellation_rules_seed.sql: replace '{grape,Nebbiolo,min_pct}' with '[{\"grape\": \"Nebbiolo\", \"min_pct\": 100}]'::jsonb"
      - "Fix all allowed_grapes values: replace '{grape,Canaiolo,grape,Colorino,...}' with '[{\"grape\": \"Canaiolo\"}, {\"grape\": \"Colorino\"}, ...]'::jsonb"
      - "Verify migration runs without error against a local Postgres instance"
---

# Phase 9: Wine Ontology, Taxonomy & Cross-Validation — Verification Report

**Phase Goal:** Build a structured wine knowledge system — region hierarchies, grape family taxonomies, appellation classification rules, and vintage plausibility matrices — that enables automated cross-validation of every field on every wine record.
**Verified:** 2026-04-06T00:00:00Z
**Status:** GAPS FOUND (1 blocker)
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | wine_regions table exists with ltree+parent_id tree structure, ≥2,000 entries | ✓ VERIFIED | 2,002 INSERT rows; path ltree + parent_id UUID both present (D-02) |
| 2 | grape_varieties table exists with ≥400 varieties, color, family, aliases | ✓ VERIFIED | 401 INSERT rows; color/family/aliases columns present with GIN index |
| 3 | appellation_rules table defined correctly; ≥100 major appellations including Barolo+Nebbiolo | ✗ FAILED | Table DDL correct, 121 rows defined — but seed JSONB format is invalid (see Gaps) |
| 4 | vintage_rules table encodes release-delay rules with Champagne NV present | ✓ VERIFIED | 52 rules; Champagne NV row: `allows_nv=true, min_release_delay_months=15` |
| 5 | Cross-validation engine runs 4 checks per wine record | ✓ VERIFIED | `run_ontology_validation` runs all 4 checkers; Celery task wired to web_verify and haiku paths |
| 6 | Validation results stored as ontology_validation JSONB with checks_passed/failed/failures | ✓ VERIFIED | Column added in migration; structure matches spec; written by service layer |
| 7 | Critical failures auto-flag wine (auto_blocked=True + field_review_queue insert) | ✓ VERIFIED | `_route_failures` sets `auto_blocked=True` for CRITICAL; WARNING routes only if confidence < 0.8 |
| 8 | Deterministic autofills set confidence=1.0 with source="ontology" | ✓ VERIFIED | `_apply_ontology_autofills` checks < DEFAULT_ACCEPT_THRESHOLD (0.8), writes confidence=1.0, source="ontology" |

**Score:** 7/8 truths verified (1 blocked by seed format bug)

---

## Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `supabase/migrations/20260409000000_phase9_ontology.sql` | 4 tables + ontology_validation column | ✓ VERIFIED | All 4 tables created; ontology_validation JSONB + ontology_validated_at added; field_review_queue constraint extended |
| `supabase/migrations/seed/09_wine_regions_seed.sql` | ≥2,000 entries | ✓ VERIFIED | 2,002 INSERT rows |
| `supabase/migrations/seed/09_grape_varieties_seed.sql` | ≥400 varieties | ✓ VERIFIED | 401 INSERT rows |
| `supabase/migrations/seed/09_appellation_rules_seed.sql` | ≥100 rows, valid JSONB, Barolo+Nebbiolo present | ✗ STUB (INVALID JSONB) | 121 rows defined; `required_grapes='{grape,Nebbiolo,min_pct}'` is PostgreSQL array syntax, NOT valid JSON — migration would fail at runtime |
| `supabase/migrations/seed/09_vintage_rules_seed.sql` | Champagne NV present | ✓ VERIFIED | Row: `('Champagne NV', 'standard', 15, true, ...)` |
| `services/agent-orchestrator/services/ontology_normalization.py` | 7+ functions + alias cache | ✓ VERIFIED | 8 public functions + `_ensure_grape_cache`; lazy-loaded module-level `_GRAPE_CACHE` dict |
| `services/agent-orchestrator/services/ontology_validation_service.py` | 4 checkers + `_route_failures` + `_apply_ontology_autofills` + `run_ontology_validation` | ✓ VERIFIED | All 7 required methods present and substantive |
| `services/agent-orchestrator/jobs/ontology_tasks.py` | Celery task + Redis NX dedup | ✓ VERIFIED | `ontology_validate_task` with `SET NX ex=3600`; finally block releases lock |
| `services/agent-orchestrator/jobs/celery_app.py` | `jobs.ontology_tasks` in imports | ✓ VERIFIED | Line 23: `"jobs.ontology_tasks"` present in imports tuple |
| `services/agent-orchestrator/jobs/web_verify_tasks.py` | `ontology_validate_task.delay` present | ✓ VERIFIED | Line 390: `ontology_validate_task.delay(wine_id)` in `_verify_async` |
| `services/agent-orchestrator/jobs/haiku_tasks.py` | Ontology fallback trigger present | ✓ VERIFIED | Lines 147-148: fallback path when web verify skipped |
| `services/agent-orchestrator/tests/test_ontology_validation.py` | ≥8 tests | ✓ VERIFIED | 21 tests (4 classes: region/country, alias normalization, appellation rules, autofill) |
| `services/agent-orchestrator/tests/test_ontology_tasks.py` | ≥6 tests | ✓ VERIFIED | 8 tests |

---

## Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `haiku_tasks._enrich_async` | `ontology_validate_task` | `ontology_validate_task.delay(wine_id)` | ✓ WIRED | Lines 147-148: fallback path when `web_verify_skipped=True` |
| `web_verify_tasks._verify_async` | `ontology_validate_task` | `ontology_validate_task.delay(wine_id)` | ✓ WIRED | Lines 389-392: primary path at end of successful web verification |
| `ontology_validate_task` | `OntologyValidationService.run_ontology_validation` | late import in `_validate_sync` | ✓ WIRED | `_validate_sync` late-imports and calls `service.run_ontology_validation(wine_id)` |
| `run_ontology_validation` | `_route_failures` | direct call | ✓ WIRED | Line 612: `self._route_failures(wine_id, failures, updated_fc)` |
| `_route_failures` | `field_review_queue` INSERT + `auto_blocked=True` | supabase insert + update | ✓ WIRED | CRITICAL → both; WARNING → only if confidence < 0.8 (D-03) |
| `celery_app.py` | `jobs.ontology_tasks` | `imports` tuple | ✓ WIRED | `"jobs.ontology_tasks"` in celery `imports` config |

---

## Design Decision Compliance

| Decision | Requirement | Status | Evidence |
|----------|-------------|--------|---------|
| D-02 | `wine_regions` has BOTH `path ltree` AND `parent_id UUID` | ✓ VERIFIED | Both columns in DDL; `path ltree` GiST/BTree indexes; `parent_id UUID REFERENCES wine_regions(id)`; comment explicitly documents dual-column design |
| D-03 | `_route_failures`: CRITICAL always routes; WARNING only if fc.confidence < 0.8 | ✓ VERIFIED | `if failure.severity == "critical": should_route = True` / `elif failure.severity == "warning" and current_confidence < DEFAULT_ACCEPT_THRESHOLD` |
| D-04 | `_apply_ontology_autofills`: checks confidence < 0.8 before overwriting | ✓ VERIFIED | `_should_autofill` returns `existing_conf < DEFAULT_ACCEPT_THRESHOLD` |
| Chain | haiku_tasks fallback when web verify skipped | ✓ VERIFIED | `if web_verify_skipped: ontology_validate_task.delay(wine_id)` — comment: "fallback path" |

---

## Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| All 29 tests pass | `python3 -m pytest tests/test_ontology_validation.py tests/test_ontology_tasks.py -q` | `29 passed in 0.29s` | ✓ PASS |
| JSONB seed format valid JSON | `python3 -c "import json; json.loads('{grape,Nebbiolo,min_pct}')"` | `INVALID JSON: Expecting property name enclosed in double quotes` | ✗ FAIL |

---

## Gaps Summary

**1 blocker gap** preventing full goal achievement in production:

### GAP: Invalid JSONB format in appellation_rules seed data

**File:** `supabase/migrations/seed/09_appellation_rules_seed.sql`

All 121 INSERT statements populate the `required_grapes JSONB` and `allowed_grapes JSONB` columns using PostgreSQL array literal syntax instead of valid JSON:

```sql
-- WRONG (PostgreSQL array literal — INVALID JSONB):
'{grape,Nebbiolo,min_pct}'

-- CORRECT (valid JSONB):
'[{"grape": "Nebbiolo", "min_pct": 100}]'::jsonb
```

**Impact chain:**
1. When the seed migration runs, PostgreSQL raises `ERROR: invalid input syntax for type json` — the migration fails
2. `appellation_rules` table remains empty
3. `lookup_appellation_rules(appellation_name)` returns `None` for every lookup
4. `check_grape_appellation_compatibility` always returns `None` (no rules found → skip)
5. The Barolo+France example from the phase goal would **not** be caught
6. SC-3 (≥100 appellations with JSONB rules) is not met in a live database

**Note:** Unit tests pass because they mock `lookup_appellation_rules` to return properly formatted `[{"grape": "Nebbiolo", "min_pct": 100}]` dicts — bypassing the broken seed data entirely. The service logic is architecturally correct; only the seed data needs fixing.

**Fix:** Regenerate or patch `09_appellation_rules_seed.sql` so that `required_grapes` and `allowed_grapes` use valid JSONB array-of-objects syntax. Example for Barolo DOCG:

```sql
INSERT INTO appellation_rules (appellation_name, required_grapes, allowed_grapes, ...)
VALUES ('Barolo DOCG',
        '[{"grape": "Nebbiolo", "min_pct": 100}]'::jsonb,
        '[]'::jsonb,
        ...);
```

---

## Anti-Patterns Found

| File | Pattern | Severity | Impact |
|------|---------|----------|--------|
| `09_appellation_rules_seed.sql` (all 121 rows) | `required_grapes='{grape,Nebbiolo,min_pct}'` — invalid JSONB | 🛑 Blocker | Migration fails; appellation cross-validation silently becomes no-op |

---

## Human Verification Required

None — all architectural wiring is verifiable programmatically. The single gap (JSONB format) is deterministic and confirmed by JSON parse test.

---

_Verified: 2026-04-06T00:00:00Z_
_Verifier: Claude (gsd-verifier)_
