---
phase: 13-dev-onboarding-ui-with-manual-override-access
plan: "01"
subsystem: database/migrations
tags: [supabase, migrations, rls, auth, phase13, user-roles, override-events, invite-tokens]
dependency_graph:
  requires: []
  provides:
    - user_roles junction table (developer/certified_contributor/review_admin roles)
    - onboarding_sessions audit table
    - override_events full-provenance table
    - invite_tokens single-use table
    - increment_trust_counter SECURITY DEFINER function
  affects:
    - All Phase 13 backend endpoints (tables must exist before code is written)
    - Phase 13 frontend (role-gated routes depend on user_roles)
tech_stack:
  added: []
  patterns:
    - JWT app_metadata.roles claims for RLS (no self-reference recursion)
    - SECURITY DEFINER Postgres function for atomic counter increment
    - Partial indexes on filtered rows (active roles, unused tokens, pending overrides)
    - CREATE TABLE IF NOT EXISTS + CREATE INDEX IF NOT EXISTS for idempotent migrations
key_files:
  created:
    - supabase/migrations/20260413000000_user_roles.sql
    - supabase/migrations/20260413000001_onboarding_sessions.sql
    - supabase/migrations/20260413000002_override_events.sql
    - supabase/migrations/20260413000003_invite_tokens.sql
  modified: []
decisions:
  - "JWT claims (app_metadata.roles) used for all RLS policies — avoids SELECT FROM user_roles within its own policy (infinite recursion Pitfall 1 from RESEARCH.md)"
  - "increment_trust_counter is SECURITY DEFINER — prevents any direct RLS path for self-increment (T-13-06)"
  - "Partial index on invite_tokens(token) WHERE used_at IS NULL — used tokens are logically invisible after redemption"
  - "override_events coexists with field_corrections — does not replace Phase 5 QA table"
  - "Migration prefix changed from 20260412 to 20260413 — 20260412000000-20260412000004 taken by Phase 12.1 research migrations"
metrics:
  duration: "~5 minutes"
  completed_date: "2026-04-07"
  tasks_completed: 1
  tasks_total: 2
  files_created: 4
  files_modified: 0
---

# Phase 13 Plan 01: Supabase AuthZ and Audit Schema Migrations — Summary

**One-liner:** Four Supabase migrations establishing user_roles RLS junction table, onboarding_sessions audit anchor, override_events full-provenance table, and invite_tokens single-use invite system — all secured via JWT `app_metadata.roles` claims.

---

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Create all four Supabase migration files | `4b1723e` | `20260413000000_user_roles.sql`, `20260413000001_onboarding_sessions.sql`, `20260413000002_override_events.sql`, `20260413000003_invite_tokens.sql` |

## Task 2 Status: BLOCKED — Awaiting Human Action

Task 2 (`supabase db push`) is a `checkpoint:human-action` gate. The executor has stopped here. The user must run `supabase db push` from the workspace root to apply all 4 migrations to the live database.

---

## What Was Built

### `20260413000000_user_roles.sql`
- `user_roles` junction table with `user_id UUID NOT NULL`, `role` CHECK constraint (`developer`, `certified_contributor`, `review_admin`)
- Trust tracking: `consecutive_approved_overrides INT NOT NULL DEFAULT 0`, `promotion_policy TEXT DEFAULT 'queue'`, `auto_promote_earned_at`
- Partial index on `(user_id, role) WHERE revoked_at IS NULL` for active-role fast lookups
- RLS: `users_read_own_roles` (SELECT own active roles), `review_admin_manage_roles` (ALL via JWT claim)
- `increment_trust_counter(p_user_id UUID)` — SECURITY DEFINER function for atomic trust counter increments

### `20260413000001_onboarding_sessions.sql`
- `onboarding_sessions` table: `actor_id`, `source_type` CHECK (`pdf_upload`, `url_crawl`, `manual_seed`), `scan_session_id`, `status` CHECK (`active`, `completed`, `abandoned`)
- Partial index on `status WHERE status = 'active'`
- RLS: `session_read_policy` (own sessions + review_admin/developer via JWT), `session_insert_policy` (own actor_id only)

### `20260413000002_override_events.sql`
- `override_events` table: `session_id` FK → `onboarding_sessions(id) ON DELETE CASCADE`, `old_confidence DECIMAL(3,2)`, `reason`, `citation_url`, `citation_snippet`
- `promotion_status` CHECK (`pending`, `auto_promoted`, `approved`, `rejected`), `approved_by`, `approval_note`, `decided_at`
- Partial index on `(promotion_status, created_at) WHERE promotion_status = 'pending'` for queue efficiency
- RLS: `override_read_own`, `override_read_admin` (review_admin/developer via JWT), `override_insert_policy`, `override_update_admin` (review_admin only)

### `20260413000003_invite_tokens.sql`
- `invite_tokens` table: `token UUID NOT NULL UNIQUE DEFAULT gen_random_uuid()`, `expires_at DEFAULT NOW() + INTERVAL '7 days'`, `used_at`, `used_by`
- Partial index on `token WHERE used_at IS NULL` — used tokens become invisible to index
- RLS: `invite_tokens_admin_all` (review_admin manages all), `invite_tokens_read_for_redemption` (any auth user can read unused+unexpired tokens)

---

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking Issue] Migration prefix changed from 20260412 to 20260413**
- **Found during:** Task 1 setup
- **Issue:** Plan specified `20260412000000_user_roles.sql` through `20260412000003_invite_tokens.sql`, but `20260412000000` through `20260412000004` are already taken by Phase 12.1 research agent migrations (`_research_runs.sql`, `_research_run_stats.sql`, `_evidence_citations.sql`, `_research_submissions_columns.sql`, `_resolution_challenges.sql`)
- **Fix:** Used `20260413000000`–`20260413000003` prefix instead. All SQL content is identical to plan specification.
- **Files modified:** N/A (new files created with corrected names)
- **Commit:** `4b1723e`

---

## Known Stubs

None. These are pure DDL migration files — no data flow, no stub values.

---

## Threat Flags

All threats from the plan's `<threat_model>` are addressed:

| Threat | Mitigation | Status |
|--------|-----------|--------|
| T-13-01: Elevation of Privilege (user_roles RLS insert) | `review_admin_manage_roles` policy uses JWT claim — no self-grant possible | ✅ Implemented |
| T-13-02: Spoofing (RLS infinite recursion) | All policies use `auth.jwt() -> 'app_metadata' -> 'roles'` — never `SELECT FROM user_roles` | ✅ Implemented |
| T-13-03: Repudiation (override_events) | `actor_id`, `created_at`, `decided_at`, `approved_by` on every row | ✅ Implemented |
| T-13-04: Tampering (invite token replay) | `used_at` timestamp — partial index only indexes `WHERE used_at IS NULL` | ✅ Implemented |
| T-13-05: Info Disclosure (token in URL) | Schema has no server-side enforcement — path param pattern documented in comments; enforcement at API layer (Plan 02) | ✅ Schema-level done |
| T-13-06: Elevation of Privilege (trust counter) | `increment_trust_counter` is `SECURITY DEFINER` — no direct RLS path | ✅ Implemented |

---

## Self-Check

```
FOUND: supabase/migrations/20260413000000_user_roles.sql
FOUND: supabase/migrations/20260413000001_onboarding_sessions.sql
FOUND: supabase/migrations/20260413000002_override_events.sql
FOUND: supabase/migrations/20260413000003_invite_tokens.sql
FOUND: commit 4b1723e
```

## Self-Check: PASSED

---

## Next Step

**Task 2 requires human action:** Run `supabase db push` from the workspace root to apply all 4 migrations to the live Supabase database. After successful push, continuation agent will create plan COMPLETE status.

Expected output confirms:
- `Applying migration 20260413000000_user_roles.sql`
- `Applying migration 20260413000001_onboarding_sessions.sql`
- `Applying migration 20260413000002_override_events.sql`
- `Applying migration 20260413000003_invite_tokens.sql`
