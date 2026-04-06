---
phase: 11-temporal-menu-intelligence-analytics
plan: "01"
subsystem: database
tags: [migration, schema, temporal, analytics, celery]
dependency_graph:
  requires:
    - supabase/migrations/20260225000000_restaurant_directory.sql
    - supabase/migrations/20260208024921_new-migration.sql
  provides:
    - crawl_schedule table (TEMP-01)
    - restaurant_wine_roster table (TEMP-03 baseline)
    - menu_changes table (TEMP-04)
    - wine_popularity table (TEMP-05)
    - trending_wines table (TEMP-06)
    - recrawl_max_concurrent setting
  affects:
    - All subsequent Phase 11 plans (tables now live)
tech_stack:
  added: []
  patterns:
    - CREATE TABLE IF NOT EXISTS (idempotent migration)
    - ON CONFLICT DO NOTHING (idempotent backfill)
    - RANDOM() * INTERVAL jitter (thundering-herd prevention)
key_files:
  created:
    - supabase/migrations/20260411000000_phase11_temporal.sql
  modified:
    - services/agent-orchestrator/config/settings.py
decisions:
  - "recrawl_max_concurrent uses plain int(os.getenv()) pattern (not pydantic Field) to match existing Settings class style"
  - "RANDOM() * INTERVAL '7 days' jitter on backfill next_crawl_at prevents thundering herd on first beat run"
  - "ON CONFLICT (restaurant_id) DO NOTHING on backfill INSERT ensures migration is idempotent on re-run"
metrics:
  duration_minutes: 1
  completed_date: "2026-04-06"
  tasks_completed: 2
  tasks_total: 2
  files_created: 1
  files_modified: 1
---

# Phase 11 Plan 01: Temporal Schema Foundation Summary

**One-liner:** Five Phase 11 tables (crawl_schedule, restaurant_wine_roster, menu_changes, wine_popularity, trending_wines) with indexes, UNIQUE constraints, and jittered backfill INSERT pushed live to Supabase.

---

## What Was Built

Created `supabase/migrations/20260411000000_phase11_temporal.sql` — the complete DDL foundation for Phase 11 temporal intelligence. Pushed to live Supabase instance successfully.

### Tables Created

| Table | Unique Constraint | Indexes | Purpose |
|-------|-------------------|---------|---------|
| `crawl_schedule` | `uq_crawl_schedule_restaurant` (restaurant_id) | `idx_cs_next_crawl` (next_crawl_at, status) | Per-restaurant re-crawl scheduling |
| `restaurant_wine_roster` | `uq_roster_restaurant_hash` (restaurant_id, signature_hash) | `idx_rwr_restaurant`, `idx_rwr_hash` | Current-state diff baseline |
| `menu_changes` | — | `idx_mc_restaurant`, `idx_mc_hash`, `idx_mc_change_type` | Full menu event audit trail |
| `wine_popularity` | `uq_wine_popularity` (wine_id) | `idx_wp_count` (restaurant_count DESC) | Nightly materialized popularity |
| `trending_wines` | `uq_trending_wines` (wine_id, window_days) | `idx_tw_score` (partial, window_days=30) | Velocity-scored trend windows |

### Backfill
All existing `restaurant_directory` entries seeded into `crawl_schedule` with:
- `crawl_frequency = 'weekly'`
- `next_crawl_at = NOW() + RANDOM() * INTERVAL '7 days'` (0–7 day jitter per D-04)
- `status = 'active'`
- `ON CONFLICT DO NOTHING` for idempotency

### Settings Patch
Added `recrawl_max_concurrent: int` (default 10, env `RECRAWL_MAX_CONCURRENT`) to `settings.py` following existing `int(os.getenv(..., default))` pattern.

---

## Verification

- Automated check script from plan: **PASSED** (all 19 pattern checks green)
- `supabase db push`: **SUCCESS** — "Finished supabase db push." (migration 20260411000000_phase11_temporal.sql applied)
- `grep recrawl_max_concurrent services/agent-orchestrator/config/settings.py`: **MATCH**

---

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| Task 1 | `787f2af` | feat(11-01): add Phase 11 temporal schema migration |
| Task 2 | `e9d9716` | feat(11-01): add recrawl_max_concurrent to settings + push migration live |

---

## Deviations from Plan

None — plan executed exactly as written.

---

## Known Stubs

None — this plan is DDL-only (migration + settings constant). No data-rendering code was introduced.

---

## Threat Flags

None. Migration introduces internal tables with FK constraints to existing trusted tables. No new network endpoints, auth paths, or trust boundary crossings.

---

## Self-Check: PASSED

- `supabase/migrations/20260411000000_phase11_temporal.sql` — FOUND ✓
- `services/agent-orchestrator/config/settings.py` contains `recrawl_max_concurrent` — FOUND ✓
- Commit `787f2af` — FOUND ✓
- Commit `e9d9716` — FOUND ✓
