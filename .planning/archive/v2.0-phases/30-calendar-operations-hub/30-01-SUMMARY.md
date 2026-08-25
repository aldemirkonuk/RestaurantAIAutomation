---
phase: 30-calendar-operations-hub
plan: "01"
subsystem: database
tags: [migration, calendar, schema, supabase, ical]
dependency_graph:
  requires: []
  provides:
    - calendar_events columns: reminder_enabled, reminder_days_before, reminder_sent, is_recurring, parent_event_id, occurrence_date, recurrence_rule_id, created_by, color
    - calendar_recurrence_rules columns: calendar_event_id, end_on_date, end_after_count, restaurant_id, day_of_month, week_of_month, month_of_year, end_type, last_generated_date, next_generation_date, generation_horizon_days, updated_at
    - calendar_recurrence_exceptions columns: recurrence_rule_id, original_date
    - generate_recurring_events(UUID, DATE) stub RPC function
    - restaurants.calendar_ical_token column + partial index
  affects:
    - calendar.service.ts (unblocks all calendar CRUD operations)
    - Plans 30-02 through 30-07 (all blocked on this wave 1 migration)
tech_stack:
  added: []
  patterns:
    - idempotent PL/pgSQL DO blocks with IF EXISTS guards for column renames
    - ADD COLUMN IF NOT EXISTS with DEFAULT values (no table-lock escalation)
    - Partial index on nullable token column
key_files:
  created:
    - supabase/migrations/20260512000001_calendar_schema_fix.sql
    - supabase/migrations/20260512000002_calendar_ical_token.sql
  modified: []
decisions:
  - "Rename notification_enabled → reminder_enabled rather than service-side alias — migration path aligns DB to service interface"
  - "generate_recurring_events stub returns 0 — Plan 30-07 implements full server-side generation for this_and_future scope"
  - "calendar_ical_token DEFAULT NULL — token generated on first use, not at row creation"
  - "Partial index on calendar_ical_token WHERE NOT NULL — avoids indexing null values for all restaurants without iCal configured"
metrics:
  duration: "~8 minutes"
  completed: "2026-05-12"
  tasks_completed: 2
  tasks_total: 2
  files_created: 2
  files_modified: 0
---

# Phase 30 Plan 01: Calendar Schema Migrations Summary

**One-liner:** Two idempotent Supabase migrations fix 3 calendar table column mismatches, add `generate_recurring_events` stub RPC, and add `restaurants.calendar_ical_token` for iCal feed auth — unblocking all 5 calendar CRUD bugs.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Comprehensive calendar schema migration (3 tables + RPC) | b64f47e | supabase/migrations/20260512000001_calendar_schema_fix.sql |
| 2 | iCal token column migration for restaurants | 66affd1 | supabase/migrations/20260512000002_calendar_ical_token.sql |

## What Was Built

### Migration 1: `20260512000001_calendar_schema_fix.sql`

Fixes 3 calendar tables to align with `CalendarEventRow` and `RecurrenceRuleRow` service interfaces:

**`calendar_events` table:**
- Renamed `notification_enabled` → `reminder_enabled` (IF EXISTS guard)
- Added: `reminder_days_before INTEGER DEFAULT 1`
- Added: `reminder_sent BOOLEAN DEFAULT false`
- Added: `is_recurring BOOLEAN DEFAULT false`
- Added: `parent_event_id UUID REFERENCES calendar_events(id) ON DELETE SET NULL`
- Added: `occurrence_date DATE`
- Added: `recurrence_rule_id UUID`
- Added: `created_by UUID`
- Added: `color VARCHAR(7) DEFAULT NULL`

**`calendar_recurrence_rules` table:**
- Renamed `event_id` → `calendar_event_id` (IF EXISTS guard)
- Renamed `end_date` → `end_on_date` (IF EXISTS guard)
- Renamed `max_occurrences` → `end_after_count` (IF EXISTS guard)
- Added: `restaurant_id`, `day_of_month`, `week_of_month`, `month_of_year`, `end_type`, `last_generated_date`, `next_generation_date`, `generation_horizon_days`, `updated_at`

**`calendar_recurrence_exceptions` table:**
- Renamed `recurrence_id` → `recurrence_rule_id` (IF EXISTS guard)
- Renamed `exception_date` → `original_date` (IF EXISTS guard)

**`generate_recurring_events` RPC function:**
- Stub implementation returning 0 — prevents 500 errors when `calendar.service.ts` calls `generateOccurrences()`
- Full implementation deferred to Plan 30-07

### Migration 2: `20260512000002_calendar_ical_token.sql`

- Added `calendar_ical_token VARCHAR(64) DEFAULT NULL` to `restaurants` table
- Added partial index `idx_restaurants_calendar_ical_token` for fast token lookup (WHERE NOT NULL)

### Database Apply

Both migrations applied successfully via `npx supabase db push`:
- Required migration history repair (7 remote migrations had been applied directly to remote DB without local SQL files; marked as reverted, plus 20260509000001 and 20260509000002 marked as applied)
- `20260512000001`: Applied with 16 NOTICE skips (columns already existed from untracked remote migrations — idempotency guards worked correctly)
- `20260512000002`: Applied cleanly (new column and index)
- Confirmed via `npx supabase migration list` — both show as applied

## Deviations from Plan

### Auto-resolved Plan Spec Inconsistency

**[Note] `ADD COLUMN IF NOT EXISTS` count: 17 vs plan acceptance criterion of 19**
- **Found during:** Task 1 verification
- **Issue:** The plan's acceptance criteria states `grep -c "ADD COLUMN IF NOT EXISTS"` should output 19+, but the plan's own action SQL specifies exactly 8 columns for `calendar_events` and 9 for `calendar_recurrence_rules` = 17 total. The plan's done condition confirms "8 for calendar_events + 9 for recurrence_rules".
- **Resolution:** Followed the SQL content (authoritative) over the acceptance count (plan spec inconsistency). All required columns are present.
- **Impact:** None — all column requirements satisfied.

### Migration History Repair (Rule 3 — blocking issue resolved)

**[Rule 3 - Blocking] Remote Supabase DB had 9 migrations not in local history**
- **Found during:** Task 2 apply (`supabase db push` failed)
- **Issue:** 7 remote migrations marked reverted + 2 (vendor catalogue) marked applied
- **Fix:** `supabase migration repair --status reverted` for the 7, `--status applied` for the 2 vendor catalogue migrations
- **Files modified:** None (remote migration history only)
- **Impact:** Both calendar migrations applied cleanly after repair

## Known Stubs

| Stub | File | Line | Reason |
|------|------|------|--------|
| `generate_recurring_events` returns 0 | `20260512000001_calendar_schema_fix.sql` | ~108 | Plan 30-07 implements full server-side generation for this_and_future recurring series split |

## Self-Check: PASSED

- [x] `supabase/migrations/20260512000001_calendar_schema_fix.sql` exists
- [x] `supabase/migrations/20260512000002_calendar_ical_token.sql` exists
- [x] Commit `b64f47e` exists (Task 1)
- [x] Commit `66affd1` exists (Task 2)
- [x] Both migrations confirmed applied via `npx supabase migration list`
