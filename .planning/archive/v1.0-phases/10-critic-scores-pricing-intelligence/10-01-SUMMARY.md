---
phase: 10-critic-scores-pricing-intelligence
plan: 01
subsystem: database
tags: [migration, schema, pricing, supabase]
dependency_graph:
  requires: []
  provides: [wine_menu_prices table, quality_signals column, retail_price_avg column, scores_last_updated_at column, menu_price_current column, markup_ratio column, markup_classification column, pricing_anomaly constraint]
  affects: [master_wine_library, restaurant_inventory, field_review_queue]
tech_stack:
  added: []
  patterns: [idempotent DDL with IF NOT EXISTS, composite index on price history]
key_files:
  created:
    - supabase/migrations/20260410000000_phase10_pricing.sql
  modified: []
decisions:
  - "Used ADD COLUMN IF NOT EXISTS throughout for idempotent safe re-run"
  - "Dropped and re-added valid_source constraint with expanded check list (idempotent pattern from T-09-03)"
  - "wine_menu_prices uses ON DELETE CASCADE on both FKs to prevent orphan rows (T-10-01 mitigation)"
  - "Composite index idx_wine_menu_prices_restaurant on (restaurant_id, wine_id, scanned_at DESC) for time-ordered price history queries"
metrics:
  duration: 33s
  completed_date: "2026-04-06T16:05:51Z"
  tasks_completed: 1
  tasks_total: 2
  files_created: 1
  files_modified: 0
---

# Phase 10 Plan 01: Phase 10 Pricing Schema Migration Summary

**One-liner:** Idempotent Supabase migration adding wine_menu_prices price-history table, quality_signals + retail_price_avg + scores_last_updated_at to master_wine_library, menu_price_current + markup_ratio + markup_classification to restaurant_inventory, and pricing_anomaly to field_review_queue source constraint.

## What Was Built

`supabase/migrations/20260410000000_phase10_pricing.sql` — 64 lines of additive DDL creating all schema objects required by Phase 10 pricing intelligence features.

### Schema Objects Created

| Object | Type | Details |
|--------|------|---------|
| `master_wine_library.quality_signals` | Column | `JSONB DEFAULT '{}'` — dataset ingestion pipeline target |
| `master_wine_library.retail_price_avg` | Column | `DECIMAL(10,2)` nullable — Wine-Searcher retail price via Serper |
| `master_wine_library.scores_last_updated_at` | Column | `TIMESTAMPTZ` nullable — nightly beat staleness check |
| `restaurant_inventory.menu_price_current` | Column | `DECIMAL(10,2)` nullable — cached denormalized latest menu price |
| `restaurant_inventory.markup_ratio` | Column | `DECIMAL(10,4)` nullable — `menu_price_current / retail_price_avg` |
| `restaurant_inventory.markup_classification` | Column | `VARCHAR(20)` nullable — value/standard/premium/luxury_markup tiers |
| `wine_menu_prices` | Table | Full price history, UUID PK, restaurant_id + wine_id FKs with CASCADE |
| `idx_wine_menu_prices_wine` | Index | `(wine_id)` — score task lookup |
| `idx_wine_menu_prices_restaurant` | Index | `(restaurant_id, wine_id, scanned_at DESC)` — time-ordered history |
| `valid_source` constraint | Constraint | Extended to include `'pricing_anomaly'` (drop + re-add pattern) |

## Deviations from Plan

None — plan executed exactly as written. DDL in the migration matches the exact SQL specified in Task 1's `<action>` block verbatim.

## Known Stubs

None. This is a pure schema migration with no application code stubs.

## Threat Flags

None. All schema changes are additive (ADD COLUMN IF NOT EXISTS / CREATE TABLE IF NOT EXISTS). The `DROP CONSTRAINT IF EXISTS` + re-add pattern is the established idempotency approach from Phase 9 (T-10-02 mitigated). ON DELETE CASCADE on both wine_menu_prices FKs enforces T-10-01.

## Checkpoint Status

**Task 2 (Push migration) is awaiting human action.** The `supabase db push` command must be run manually to apply this migration to the live database. See the checkpoint message returned to the orchestrator for exact instructions.

## Self-Check: PASSED

- ✅ `supabase/migrations/20260410000000_phase10_pricing.sql` exists
- ✅ Commit `c197692` exists in git log
- ✅ 6 `ADD COLUMN IF NOT EXISTS` statements verified
- ✅ `wine_menu_prices` table present (9 occurrences)
- ✅ `pricing_anomaly` in constraint (3 occurrences)
- ✅ `critic_scores` NOT added (correctly absent)
