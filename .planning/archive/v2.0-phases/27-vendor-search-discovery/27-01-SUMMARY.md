---
phase: 27-vendor-search-discovery
plan: "01"
subsystem: database
tags: [migration, rls, seed, vendor-catalogue, providers]
dependency_graph:
  requires: []
  provides: [vendor_catalogue table, providers.catalogue_vendor_id, providers.is_custom, vendor seed data]
  affects: [providers table, vendor search feature]
tech_stack:
  added: []
  patterns: [RLS policies, partial index, GIN full-text index, fixed-UUID idempotent seed]
key_files:
  created:
    - supabase/migrations/20260509000001_vendor_catalogue.sql
    - supabase/migrations/20260509000002_providers_catalogue_link.sql
    - supabase/migrations/seed/27_vendor_catalogue_seed.sql
  modified: []
decisions:
  - seed file placed at supabase/migrations/seed/ (consistent with Phase 9 seed pattern, not supabase/seed/ as plan stated)
  - fixed UUIDs used in seed (not gen_random_uuid()) to enable ON CONFLICT (id) DO NOTHING idempotency
metrics:
  duration: "8 minutes"
  completed: "2026-05-10"
  tasks_completed: 3
  tasks_total: 3
  files_created: 3
  files_modified: 0
---

# Phase 27 Plan 01: Database — vendor_catalogue + providers schema update + seed Summary

## One-liner

Global admin-curated vendor_catalogue table with RLS (read-all authenticated, write-none), providers FK link and is_custom flag, plus 20-row idempotent seed from providerData.ts.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Create vendor_catalogue migration | 549e4b7 | supabase/migrations/20260509000001_vendor_catalogue.sql |
| 2 | Update providers table | 5cd4795 | supabase/migrations/20260509000002_providers_catalogue_link.sql |
| 3 | Seed vendor_catalogue | 8180c92 | supabase/migrations/seed/27_vendor_catalogue_seed.sql |

## What Was Built

### Task 1 — vendor_catalogue table (VENDOR-01)

Migration `20260509000001_vendor_catalogue.sql` creates:
- `vendor_catalogue` table with all 15 columns as specified (id, name, type, country, state, city, address, phone, email, website, wine_specialties, notes, is_active, created_at, updated_at)
- `type` column constrained to enum: `distributor | importer | wholesaler | winery_direct | broker | other`
- GIN index on `to_tsvector('english', name)` for fast full-text vendor search
- B-tree indexes on `country` and `state` for regional filtering
- RLS enabled with single read policy: `authenticated` role can SELECT where `is_active = TRUE`
- No INSERT/UPDATE/DELETE policies — service_role bypasses RLS, so admin writes go through service role key

### Task 2 — providers table update (VENDOR-02)

Migration `20260509000002_providers_catalogue_link.sql`:
- `ALTER TABLE providers ADD COLUMN IF NOT EXISTS catalogue_vendor_id UUID REFERENCES vendor_catalogue(id) ON DELETE SET NULL`
- `ALTER TABLE providers ADD COLUMN IF NOT EXISTS is_custom BOOLEAN NOT NULL DEFAULT TRUE`
- Partial index `idx_providers_catalogue_vendor` on `catalogue_vendor_id WHERE catalogue_vendor_id IS NOT NULL` for efficient catalogue lookup joins
- Backfill UPDATE: existing providers rows get `is_custom = TRUE` (they all predate the catalogue)

### Task 3 — vendor_catalogue seed (VENDOR-03)

Seed file `supabase/migrations/seed/27_vendor_catalogue_seed.sql`:
- 20 rows — all 20 entries from `apps/web/src/data/providerData.ts`
- `primaryBusinessType` mapped to lowercase `type` (Wholesaler → wholesaler, Importer → importer, Distributor → distributor)
- `physicalAddress` parsed into `city` and `state` fields
- `winePortfolio` condensed into `wine_specialties` (key producers and regions)
- "N/A" phone/email/address values → SQL NULL
- All entries: `is_active = TRUE`, `country = 'US'`
- Fixed UUIDs (`a1000001-0000-4000-8000-00000000000{n}`) ensure `ON CONFLICT (id) DO NOTHING` provides true idempotency across repeated runs

## Deviations from Plan

### Auto-adjusted — Seed file location

**Found during:** Task 3

**Issue:** The plan specified `supabase/seed/vendor_catalogue_seed.sql`, but no `supabase/seed/` directory exists. The established project pattern (Phase 9) places seed files at `supabase/migrations/seed/`.

**Fix:** Placed seed at `supabase/migrations/seed/27_vendor_catalogue_seed.sql` following existing convention.

**Files modified:** supabase/migrations/seed/27_vendor_catalogue_seed.sql

---

### Auto-adjusted — Fixed UUIDs in seed (not gen_random_uuid())

**Found during:** Task 3

**Issue:** The plan example showed `gen_random_uuid()` in seed VALUES, but `ON CONFLICT (id) DO NOTHING` requires stable IDs — each run would generate new UUIDs, making the conflict clause useless and causing duplicate rows on repeated seed runs.

**Fix:** Used fixed deterministic UUIDs (format: `a1000001-0000-4000-8000-00000000000{n}`) so ON CONFLICT correctly deduplicates idempotently.

**Files modified:** supabase/migrations/seed/27_vendor_catalogue_seed.sql

## Verification Checklist

- [x] `supabase/migrations/20260509000001_vendor_catalogue.sql` — exists, contains `CREATE TABLE IF NOT EXISTS vendor_catalogue`
- [x] `supabase/migrations/20260509000002_providers_catalogue_link.sql` — exists, contains `ALTER TABLE providers ADD COLUMN IF NOT EXISTS catalogue_vendor_id`
- [x] `supabase/migrations/seed/27_vendor_catalogue_seed.sql` — exists, contains 20 `INSERT INTO vendor_catalogue` rows
- [x] RLS policy `vendor_catalogue_read` — SELECT for `authenticated` where `is_active = TRUE`
- [x] No INSERT/UPDATE/DELETE policies — service_role writes only
- [x] `catalogue_vendor_id` FK references `vendor_catalogue(id) ON DELETE SET NULL`
- [x] `is_custom BOOLEAN NOT NULL DEFAULT TRUE`
- [x] Seed has exactly 20 rows (PROV_001 through PROV_020), all `is_active = TRUE`

**Pending (requires live DB):**
- [ ] `supabase db push` with no errors
- [ ] `SELECT COUNT(*) FROM vendor_catalogue;` returns 20
- [ ] `SELECT COUNT(*) FROM information_schema.columns WHERE table_name='providers' AND column_name='catalogue_vendor_id';` returns 1
- [ ] Authenticated JWT can SELECT from vendor_catalogue
- [ ] Authenticated JWT cannot INSERT into vendor_catalogue

## Known Stubs

None — this plan is pure schema and seed data with no UI stubs.

## Self-Check: PASSED

- supabase/migrations/20260509000001_vendor_catalogue.sql: FOUND
- supabase/migrations/20260509000002_providers_catalogue_link.sql: FOUND
- supabase/migrations/seed/27_vendor_catalogue_seed.sql: FOUND
- Commit 549e4b7: FOUND (feat(27-01): create vendor_catalogue table with RLS policies)
- Commit 5cd4795: FOUND (feat(27-01): add catalogue_vendor_id FK and is_custom flag to providers)
- Commit 8180c92: FOUND (feat(27-01): seed vendor_catalogue with 20 US wine distributors/importers)
