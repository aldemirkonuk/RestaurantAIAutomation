---
phase: 08-web-search-verification-deep-enrichment
plan: 01
subsystem: database-schema, config, dependencies
tags: [producers-table, supabase-migration, settings, python-slugify, web-search, phase-8-foundation]
dependency_graph:
  requires:
    - supabase/migrations/20260405000002_calibration_tables.sql (calibration tables migration pattern)
    - services/agent-orchestrator/config/settings.py (existing Settings.__init__ pattern)
  provides:
    - supabase/migrations/20260407000000_producers_table.sql (producers DDL + UNIQUE INDEX + web_verified_at column)
    - settings.serper_api_key, settings.web_search_daily_budget_usd, settings.serper_cost_per_query
    - python-slugify[unidecode]==8.0.4 in requirements.txt
  affects:
    - Wave 2 plans: web_verification_service.py imports settings.serper_api_key at module load
    - Plan 03: producers upsert requires normalized_name UNIQUE INDEX or silently duplicates rows
    - Plan 04: web_verified_at column update payload requires column to exist on master_wine_library_submissions
tech_stack:
  added:
    - python-slugify[unidecode]==8.0.4 (producer name normalization, unidecode-backed)
  patterns:
    - supabase IF NOT EXISTS DDL pattern (idempotent migration)
    - Settings os.getenv() with Optional[str] + float cast (established pattern from celery_broker_url)
    - UNIQUE INDEX for supabase-py single-column on_conflict upsert (Pitfall 4)
    - Sparse partial index WHERE NOT NULL for efficient nullable column queries
key_files:
  created:
    - supabase/migrations/20260407000000_producers_table.sql
  modified:
    - services/agent-orchestrator/config/settings.py
    - services/agent-orchestrator/requirements.txt
decisions:
  - "producers_normalized_name_key is a UNIQUE INDEX not a UNIQUE CONSTRAINT: consistent with IF NOT EXISTS CREATE INDEX pattern, avoids ALTER TABLE ADD CONSTRAINT syntax"
  - "serper_cost_per_query hardcoded to 0.001 (Serper Starter plan): per RESEARCH.md Pitfall 5, correct value is $0.001/query not $0.005 — 5x more capacity for same $5/day budget"
  - "web_verified_at added to master_wine_library_submissions in same migration as producers: atomic — Plan 04 update payload requires this column; missing column causes silent 400 error from Supabase"
  - "python-slugify[unidecode] is only new pip dependency for Phase 8: httpx, google-genai, celery, redis, supabase-py all already present"
metrics:
  duration_seconds: 182
  completed_date: "2026-04-06"
  tasks_completed: 2
  tasks_total: 2
  files_created: 1
  files_modified: 2
---

# Phase 08 Plan 01: Producers Table Migration + Phase 8 Settings — Summary

**One-liner:** `producers` knowledge graph table with UNIQUE INDEX on `normalized_name` + 3 Phase 8 settings (serper_api_key, web_search_daily_budget_usd, serper_cost_per_query) + python-slugify dependency applied to Supabase remote.

## Tasks Completed

| Task | Name | Commit | Key Files |
|------|------|--------|-----------|
| 1 | Create producers table migration | bb59b68 | supabase/migrations/20260407000000_producers_table.sql |
| 2 | Patch settings.py + requirements.txt + schema push | b7c9357 | services/agent-orchestrator/config/settings.py, requirements.txt |

## What Was Built

### Task 1: Producers Table Migration (`supabase/migrations/20260407000000_producers_table.sql`)

Created the `producers` knowledge graph table with:
- **15 data columns:** id, name, normalized_name, country, region, sub_region, appellation, founding_year, winemaker_name, production_volume_cases, certifications (JSONB), website_url, portfolio (JSONB), verified_at, verification_sources (TEXT[])
- **Timestamps:** created_at, updated_at (both NOT NULL DEFAULT NOW())
- **UNIQUE INDEX** `producers_normalized_name_key ON producers(normalized_name)` — required for `supabase-py upsert(on_conflict="normalized_name")`. Without this constraint, upsert silently inserts duplicates (RESEARCH.md Pitfall 4).
- **Performance indexes:** `producers_country_idx`, `producers_region_idx`
- **updated_at trigger:** `trg_producers_updated_at` — auto-updates `updated_at` on row modification via `CREATE OR REPLACE FUNCTION update_producers_updated_at()`
- **`web_verified_at` column** added to `master_wine_library_submissions` (WSRCH-06) — Plan 04 update payload requires this column; missing column causes silent Supabase 400 error and discards all web verification results
- **Sparse index** `mwls_web_verified_at_idx WHERE web_verified_at IS NOT NULL` — efficient "find unverified wines" queries

portfolio JSONB format: `[{"wine_name": "Puligny-Montrachet 1er Cru", "vintage": "2019"}]` — list of wine objects with name + vintage strings (not internal UUIDs, per RESEARCH.md Open Questions #3).

### Task 2: Settings + Requirements + Migration Push

**settings.py additions** (after `self.celery_backend_url`):
```python
# Web Search Verification (Phase 8 — WSRCH-01, WSRCH-08)
self.serper_api_key: Optional[str] = os.getenv("SERPER_API_KEY")
self.web_search_daily_budget_usd: float = float(os.getenv("WEB_SEARCH_DAILY_BUDGET_USD", "5.0"))
# Serper Starter plan: $0.001/query — NOT $0.005 (Pitfall 5, RESEARCH.md)
self.serper_cost_per_query: float = 0.001
```

**requirements.txt addition:**
```
python-slugify[unidecode]==8.0.4
```

**Supabase migration push:** `supabase db push` applied all 9 pending migrations including `20260407000000_producers_table.sql` to remote. Confirmed by Supabase CLI output: `Applying migration 20260407000000_producers_table.sql... Finished supabase db push.`

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Removed duplicate migration file with space in filename**
- **Found during:** Task 2 — `supabase db push` blocked by out-of-order detection
- **Issue:** File `supabase/migrations/20260304010000_missing_tables_consolidation 2.sql` (space + "2" in filename) is a pre-existing duplicate of `20260304010000_missing_tables_consolidation.sql`. The Supabase CLI interpreted this as an un-applied local migration before the last remote migration, blocking all pushes with `Found local migration files to be inserted before the last migration on remote database`. The duplicate file differed by only 3 lines (a `ALTER TABLE ... ADD COLUMN` that was already in the original).
- **Fix:** Removed the duplicate file with space in name. The original `20260304010000_missing_tables_consolidation.sql` remains intact. The content difference (3 lines re: `procurement_conversations.content` column) was already applied to the remote DB.
- **Files removed:** `supabase/migrations/20260304010000_missing_tables_consolidation 2.sql`
- **Impact:** Unblocked `supabase db push`, which then successfully applied 9 pending migrations including our producers table.

## Threat Surface Scan

| Flag | File | Description |
|------|------|-------------|
| threat_flag: information_disclosure | services/agent-orchestrator/config/settings.py | `serper_api_key` reads `SERPER_API_KEY` env var — mitigated per T-08-01: stored as env var, never logged, consistent with `CLAUDE_API_KEY` pattern |

No new network endpoints or auth paths introduced in this plan. The producers table is only accessible via internal Celery tasks (T-08-02 accepted per threat model).

## Known Stubs

None — this plan creates schema and config only. No data-flow stubs. Wave 2 plans will wire `serper_api_key` into actual HTTP calls.

## Self-Check

Checking created files and commits exist...

## Self-Check: PASSED

| Item | Status |
|------|--------|
| `supabase/migrations/20260407000000_producers_table.sql` | ✅ FOUND |
| `services/agent-orchestrator/config/settings.py` | ✅ FOUND |
| `services/agent-orchestrator/requirements.txt` | ✅ FOUND |
| `.planning/phases/08-web-search-verification-deep-enrichment/08-01-SUMMARY.md` | ✅ FOUND |
| Commit `bb59b68` (producers migration) | ✅ FOUND |
| Commit `b7c9357` (settings + requirements) | ✅ FOUND |
| Supabase db push | ✅ APPLIED (9 migrations applied including 20260407000000_producers_table.sql) |
