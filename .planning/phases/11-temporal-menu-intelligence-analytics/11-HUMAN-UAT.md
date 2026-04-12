---
status: partial
phase: 11-temporal-menu-intelligence-analytics
source: [11-VERIFICATION.md]
started: 2026-04-06
updated: 2026-04-06
---

## Current Test

[awaiting human testing]

## Tests

### 1. Live Supabase tables exist
expected: All 5 Phase 11 tables (`crawl_schedule`, `restaurant_wine_roster`, `menu_changes`, `wine_popularity`, `trending_wines`) exist in Supabase dashboard; `supabase db push` applied via commit `e9d9716`
result: [pending]

### 2. crawl_schedule backfill row count
expected: `crawl_schedule` row count equals `restaurant_directory` row count; all rows have `status='active'`, `crawl_frequency='weekly'`, and randomized `next_crawl_at` within 7 days of creation
result: [pending]

### 3. End-to-end recrawl cycle
expected: Calling `crawl_and_diff_task.delay(restaurant_id)` for one restaurant causes `CrawlResult.wines` to populate, `MenuDiffService.run_diff()` to run, `menu_changes` rows to be written (if diffs detected), `restaurant_wine_roster` to be upserted, and `crawl_schedule.last_crawled_at` to be updated
result: [pending]

### 4. First nightly trend run
expected: After the 5:00 AM UTC Celery beat fires `compute_trend_metrics_task`, `wine_popularity` rows appear with correct `restaurant_count` values and `trending_wines` rows appear with `trend_score` and `window_days` (30/60/90)
result: [pending]

## Summary

total: 4
passed: 0
issues: 0
pending: 4
skipped: 0
blocked: 0

## Gaps
