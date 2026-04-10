# Plan 07-04 Summary — quality_routes.py field-level review queue

**Phase**: 07 | **Plan**: 04 (Wave 2) | **Status**: COMPLETE | **Completed**: 2026-04-06

## What was built

### `quality_routes.py` — fully rewritten

**GET /review-queue**
- Queries `field_review_queue` table (not `master_wine_library_submissions`)
- Returns pending fields grouped by `submission_id`
- Fields sorted by confidence ascending (most uncertain first)
- Each group enriched with `wine_name`, `vintage`, `restaurant_id`, `auto_blocked`

**PATCH /review-queue/{submission_id}**
- New request model: `corrections: Dict[str, Any]`, `approvals: List[str]`
- Corrections: updates `field_confidence` entry to `{value, confidence=1.0, source="human_corrected"}`, logs to `field_corrections`, marks `field_review_queue` row as "corrected"
- Approvals: boosts confidence to 1.0, marks `field_review_queue` row as "approved"
- Promotion maps `field_confidence` values to all ~31 master_wine_library columns + 6 JSONB
- `auto_blocked` recomputed via `should_auto_block(fc)`

**GET /calibration** (stub for Plan 05)
- Returns `confidence_thresholds` table + `field_calibration` stats

## Requirements covered
- FCONF-06: field-level GET review queue ✓
- FCONF-07: per-field corrections PATCH ✓
