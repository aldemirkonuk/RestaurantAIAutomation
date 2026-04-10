# Plan 07-01 Summary — DB Migrations + field_confidence.py

**Phase**: 07 — Full-Field Extraction & Per-Field Confidence Framework
**Plan**: 01 (Wave 1)
**Status**: COMPLETE
**Completed**: 2026-04-06

## What was built

### 4 Supabase migration files

| File | What it provides |
|------|-----------------|
| `20260405000000_field_confidence.sql` | `field_confidence JSONB` column on `master_wine_library_submissions` + GIN index |
| `20260405000001_field_review_queue.sql` | `field_review_queue` table with status/source constraints + 3 indexes |
| `20260405000002_calibration_tables.sql` | `field_calibration` + `confidence_thresholds` tables + 20-row seed |
| `20260405000003_master_wine_library_jsonb.sql` | 6 JSONB columns on `master_wine_library` (grape_family, wine_structure, sensory_profile, practical_attributes, region_hierarchy, critic_scores stub) |

### Python helper: `services/agent-orchestrator/services/field_confidence.py`

Exports:
- `VISION_FIELDS` — 18 fields Vision extraction targets
- `ENRICHMENT_FIELDS` — 14 fields Haiku enrichment targets
- `JSONB_ENRICHMENT_KEYS` — 6 JSONB column names
- `DEFAULT_REVIEW_THRESHOLD = 0.5`
- `DEFAULT_ACCEPT_THRESHOLD = 0.8`
- `build_field_confidence(wine_dict, source)` → field_confidence JSONB
- `merge_field_confidence(existing, new, overwrite_lower)` → merged JSONB
- `route_fields_by_threshold(fc, ...)` → (accepted, review_list, rejected)
- `compute_completeness_from_fc(fc, fields)` → float 0–1
- `should_auto_block(fc)` → bool

Syntax check: PASSED

## Requirements covered

- FCONF-03: field_confidence column ✓
- FCONF-05: field_review_queue table ✓
- FCONF-08: 6 JSONB columns on master_wine_library ✓
- FCONF-09: field_calibration table ✓
- FCONF-10: confidence_thresholds table + default seed ✓

## Next: Wave 2 (Plans 02, 03, 04 — parallel)
