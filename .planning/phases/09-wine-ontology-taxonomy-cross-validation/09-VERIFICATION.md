# Phase 9: Wine Ontology, Taxonomy & Cross-Validation — Verification

**Date:** 2026-04-06
**Verdict:** PASSED
**Tests:** 29/29 passing (0.44s)

## Success Criteria

| # | Criterion | Status |
|---|-----------|--------|
| SC-1 | `wine_regions` table — tree structure, ≥2,000 entries, ltree + parent_id | PASS (2,002 rows) |
| SC-2 | `grape_varieties` table — ≥400 varieties, color/family/aliases | PASS (401 rows) |
| SC-3 | `appellation_rules` table — ≥100 appellations, valid JSONB, Barolo+Nebbiolo | PASS (121 rows, 0 JSONB errors) |
| SC-4 | `vintage_rules` table — release-delay rules, Champagne NV | PASS (52 rows) |
| SC-5 | Cross-validation engine — 4 checkers, wired via Celery pipeline | PASS |
| SC-6 | `ontology_validation` JSONB written per wine — checks_passed/failed/failures[] | PASS |
| SC-7 | CRITICAL failures → auto_blocked=True + field_review_queue; WARNING gated on fc < 0.8 | PASS |
| SC-8 | Deterministic autofills — confidence=1.0, source="ontology", threshold guard | PASS |

## Design Decision Compliance

| Decision | Requirement | Status |
|----------|-------------|--------|
| D-01 | Mixed seed sources, Claude Opus batch prompts, SQL files, no redistribution-prohibited data | PASS |
| D-02 | ltree extension probe + both `path ltree` AND `parent_id UUID` on wine_regions | PASS |
| D-03 | CRITICAL×3 + WARNING×1, all simultaneous; WARNING conditional on field_confidence < 0.8 | PASS |
| D-04 | Autofill only writes when existing confidence < 0.8 OR NULL; confidence=1.0, source="ontology" | PASS |

## Pipeline Chain

```
Vision Extraction → Haiku Enrichment → Web Verification (primary)
                                     ↘ Ontology Validation (from web_verify: primary path)
                                     ↘ Ontology Validation (from haiku_tasks fallback when web verify skipped)
```

Both paths verified in `web_verify_tasks.py` and `haiku_tasks.py`.

## Files Delivered

| File | Purpose |
|------|---------|
| `supabase/migrations/20260409000000_phase9_ontology.sql` | DDL for 4 tables + schema additions |
| `scripts/generate_ontology_seed.py` | Claude Opus batch seed generator |
| `supabase/migrations/seed/09_wine_regions_seed.sql` | 2,002 region rows |
| `supabase/migrations/seed/09_grape_varieties_seed.sql` | 401 grape rows |
| `supabase/migrations/seed/09_appellation_rules_seed.sql` | 121 rules (valid JSONB) |
| `supabase/migrations/seed/09_vintage_rules_seed.sql` | 52 vintage rules |
| `services/agent-orchestrator/services/ontology_normalization.py` | 7 DB lookup helpers + alias cache |
| `services/agent-orchestrator/services/ontology_validation_service.py` | 4 checkers + autofill + routing |
| `services/agent-orchestrator/jobs/ontology_tasks.py` | Celery task with Redis NX dedup |
| `services/agent-orchestrator/tests/test_ontology_validation.py` | 21 unit tests |
| `services/agent-orchestrator/tests/test_ontology_tasks.py` | 8 integration tests |

## Blocker Found and Fixed

The appellation_rules seed file initially used PostgreSQL array literal syntax for JSONB columns (`'{grape,Nebbiolo,min_pct}'`) instead of valid JSON (`'[{"grape": "Nebbiolo", "min_pct": 100}]'`). Fixed via Python transform script before final verification. All 121 rows verified as valid JSON.
