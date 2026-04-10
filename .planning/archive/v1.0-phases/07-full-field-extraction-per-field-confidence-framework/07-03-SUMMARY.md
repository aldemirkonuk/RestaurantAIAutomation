# Plan 07-03 Summary — Haiku 20+ fields + haiku_tasks FC merge

**Phase**: 07 | **Plan**: 03 (Wave 2) | **Status**: COMPLETE | **Completed**: 2026-04-06

## What was built

### `haiku_enrichment_service.py`
- `EnrichmentResult` expanded: `field_confidence` dict + 6 JSONB enrichment dicts
- `MAX_TOKENS` raised from 512 → 2048
- 14 scalar fields with `{value, confidence, source="knowledge"}` per field
- 6 JSONB enrichments (grape_family, wine_structure, sensory_profile, practical_attributes, region_hierarchy, critic_scores stub)
- `_is_already_enriched()` updated to check `field_confidence` source="knowledge" fields
- Response parsing handles both nested `{value, confidence}` and flat-value fallback

### `haiku_tasks.py`
- Imported `merge_field_confidence`, `JSONB_ENRICHMENT_KEYS` from `field_confidence.py`
- `_enrich_async()`: reads `existing_fc` from submission, merges with `result.field_confidence`
- Vision data preserved when confidence >= Haiku confidence (D-08)
- Writes merged `field_confidence` + 6 JSONB enrichment columns to submission row
- Old flat columns (`region`, `country`, `grape_variety`, `producer_bio`) removed from update

## Requirements covered
- FCONF-02: Haiku 20+ fields with per-field confidence ✓
