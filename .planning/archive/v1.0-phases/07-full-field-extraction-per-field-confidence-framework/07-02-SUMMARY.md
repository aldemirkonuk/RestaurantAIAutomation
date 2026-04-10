# Plan 07-02 Summary — Vision 18-field expansion + onboarding 3-tier routing

**Phase**: 07 | **Plan**: 02 (Wave 2) | **Status**: COMPLETE | **Completed**: 2026-04-06

## What was built

### `claude_vision_extractor.py`
- `EXTRACTION_PROMPT` rewritten to request 18 fields with `{value, confidence, source}` per field
- Source values: `"visible"` (printed on menu) | `"inferred"` (Claude's best guess)
- Imported `build_field_confidence`, `compute_completeness_from_fc`, `should_auto_block`, `VISION_FIELDS` from `field_confidence.py`
- `extract_page()`: builds `wine["field_confidence"]` via `build_field_confidence(wine)` after parsing
- Completeness now computed from FC when available, falls back to legacy flat-field method
- Both `extract_page()` and `extract_pdf()` updated

### `onboarding_routes.py`
- Imported `route_fields_by_threshold`, `should_auto_block`, `compute_completeness_from_fc`
- Persist loop: calls `route_fields_by_threshold(fc)` → accepted / review_items / rejected
- `auto_blocked` uses `should_auto_block(fc)` (field-ratio logic) instead of `completeness < 0.3`
- `field_confidence` column written directly on every submission insert
- `field_review_queue` bulk-insert for mid-confidence fields after each insert

## Requirements covered
- FCONF-01: 18-field EXTRACTION_PROMPT with confidence ✓
- FCONF-04: 3-tier routing at persist time ✓
