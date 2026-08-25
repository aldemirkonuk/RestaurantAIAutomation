---
status: complete  # added 2026-07-31: work was done, the field was missing
phase: quick-260403-dgf
plan: 01
subsystem: crawl-pipeline
tags: [schema, jsonl, supabase, dedup, web-crawler, gemini]
key-files:
  modified:
    - services/agent-orchestrator/services/web_crawler.py
    - services/agent-orchestrator/services/vlm_extraction_service.py
    - scripts/e2e_crawl_harness.py
decisions:
  - "_normalize_wine_field added as instance method to keep inside class namespace"
  - "validate_schema required keys narrowed to wine_name + signature_hash + data_enrichment + primary_type + country"
  - "source_type and source_url moved entirely inside data_enrichment JSONB (no top-level copies)"
metrics:
  duration: "~12 minutes"
  completed: "2026-04-03"
  tasks_completed: 3
  files_modified: 3
---

# Quick Task 260403-dgf: Update Crawler JSONL Output Schema to Supabase-Aligned Format

**One-liner:** 23-field Supabase-aligned JSONL schema with md5 signature_hash dedup, data_enrichment JSONB, and derived price_tier/bottle_size/is_blend — replacing ad-hoc fields in _persist_crawled_wines, CRAWL_TEXT_PROMPT, and the E2E harness.

## What Was Done

Three files updated to close the schema gap between crawler output and `master_wine_library` insert requirements.

### Task 1 — web_crawler.py: _persist_crawled_wines rewrite (commit f9331c9)

- Added `_normalize_wine_field(self, s)` instance method: strips non-alphanumeric, lowercases for dedup hashing
- Replaced flat `{**wine, source_type, source_url, ...}` body with explicit 23-field record construction
- Core fields: wine_name, producer, vintage, primary_type, country, region, grape_variety, sub_region, appellation, price_reference, price_glass — with fallback from old keys (price_reference or price; primary_type or wine_type)
- Derived: bottle_size (magnum/half/split/standard via regex), is_blend (comma count in grape_variety), vintage_age (year - vintage), price_tier (entry/mid/premium/luxury thresholds)
- Dedup: signature_hash = md5(norm_name + norm_producer + str(vintage) + norm_region), normalized_name, normalized_producer
- data_enrichment JSONB: source_url, source_type="crawled", restaurant_name, crawled_at, confidence, extraction_model
- Future stubs: color=None, sweetness_level=None, food_pairing=None (Haiku Phase 4)
- Old top-level keys price, wine_type, source_type, source_url, restaurant_name, crawled_at removed from root record

### Task 2 — vlm_extraction_service.py: prompt field names (commit 0599c11)

- CRAWL_TEXT_PROMPT: `wine_type` -> `primary_type (red|white|rose|sparkling|dessert|fortified)`
- CRAWL_TEXT_PROMPT: `price` -> `price_reference (bottle price as float or null)`
- CRAWL_TEXT_PROMPT: added sub_region and appellation to field list and example JSON object
- TEXT_FALLBACK_PROMPT: same renames — wine_type -> primary_type, price -> price_reference; removed price_currency (not needed)
- _parse_crawl_response: added comment documenting field name alignment

### Task 3 — e2e_crawl_harness.py: harness alignment (commit 891f5f8)

- SCORED_FIELDS: `price_bottle` -> `price_reference`
- score_completeness: removed `lookup_key = "price" if field == "price_bottle" else field` mapping hack; direct `wine.get(field)` lookup
- validate_schema: required_keys changed from `[wine_name, source_type, source_url, restaurant_name, crawled_at]` to `[wine_name, signature_hash, data_enrichment, primary_type, country]`
- validate_schema: added nested data_enrichment dict validation (source_url, source_type, restaurant_name, crawled_at)
- write_report: sample wines table header and data extraction updated to price_reference

## Verification Results

All three task verifications passed. Integration round-trip also passed:

- Task 1: `PASS` — 23 fields present, price_tier=premium, is_blend=True, bottle_size=magnum, signature_hash populated, data_enrichment is dict, old top-level keys absent
- Task 2: `PASS` — CRAWL_TEXT_PROMPT and TEXT_FALLBACK_PROMPT contain primary_type and price_reference, wine_type absent from CRAWL_TEXT_PROMPT
- Task 3: `PASS` — SCORED_FIELDS has price_reference, score_completeness returns 1.0 for full record, validate_schema catches missing data_enrichment
- Integration: `INTEGRATION PASS` — persist + score + validate round-trip score=1.0, violations=[]

## Commits

| Task | Commit | Message |
|------|--------|---------|
| 1 | f9331c9 | feat(quick-260403-dgf-01): rewrite _persist_crawled_wines with Supabase-aligned schema |
| 2 | 0599c11 | feat(quick-260403-dgf-01): update extraction prompts to primary_type and price_reference |
| 3 | 891f5f8 | feat(quick-260403-dgf-01): align e2e harness to new JSONL schema |

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

The following fields are intentional stubs pending Haiku Phase 4 enrichment:
- `color`: None in all records (file: web_crawler.py, _persist_crawled_wines)
- `sweetness_level`: None in all records (file: web_crawler.py, _persist_crawled_wines)
- `food_pairing`: None in all records (file: web_crawler.py, _persist_crawled_wines)

These stubs do not block the plan's goal (schema alignment for insert). Phase 4 will fill them.

## Self-Check: PASSED

- web_crawler.py modified: FOUND
- vlm_extraction_service.py modified: FOUND
- e2e_crawl_harness.py modified: FOUND
- Commit f9331c9: FOUND
- Commit 0599c11: FOUND
- Commit 891f5f8: FOUND
- Integration verification: INTEGRATION PASS
