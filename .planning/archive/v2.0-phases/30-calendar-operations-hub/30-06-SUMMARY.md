---
phase: 30-calendar-operations-hub
plan: "06"
subsystem: api
tags: [calendar, recurring, this_and_future, series-split, recurrence-rule]
dependency_graph:
  requires:
    - 30-02 (calendar service column fixes — start_date, end_date, calendar_event_id)
    - 30-03 (iCal feed — same service file, no conflicts)
  provides:
    - calendar.service.ts: this_and_future scope in updateEvent()
    - updateEvent(): series split — truncate existing rule + create new parent + new rule
  affects:
    - PATCH /calendar/events/:id with updateScope:'this_and_future' — no longer returns TODO warning, now returns 200 + new parent event
tech_stack:
  added: []
  patterns:
    - Series split via end_on_date truncation + new parent event insert + cloned recurrence rule
    - Early return from updateEvent() when this_and_future scope creates new parent event
key_files:
  created: []
  modified:
    - apps/api-gateway/src/calendar/calendar.service.ts
decisions:
  - "Fixed plan pseudocode field names: existing.type → existing.eventType, existing.startTime → existing.eventTime (matched CalendarEventResponseDto mapper output)"
  - "Early return from within this_and_future block so the downstream regular update does not also run on the original event"
metrics:
  duration: "~8 minutes"
  completed: "2026-05-12"
  tasks_completed: 1
  tasks_total: 1
  files_created: 0
  files_modified: 1
---

# Phase 30 Plan 06: this_and_future Recurring Event Split Summary

**One-liner:** Implemented the `this_and_future` recurring event update scope in `updateEvent()` — splits a series at the selected occurrence by truncating the existing recurrence rule's `end_on_date` to one day before the occurrence, then creating a new parent event + new cloned recurrence rule starting from the occurrence date onward.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Implement this_and_future scope in calendar.service.ts updateEvent() | b0089c5 | apps/api-gateway/src/calendar/calendar.service.ts |

## What Was Built

### Task 1: `calendar.service.ts` — three-step series split

**Step 1 — Truncate existing rule:**
- Computes `splitDate = occurrence_date - 1 day` using `Date.setDate()`
- Updates `calendar_recurrence_rules` row with `end_on_date = splitDate` and `end_type = 'on_date'`
- Scoped by `existing.recurrenceRule.id` — only runs if the event has a rule

**Step 2 — Create new parent event:**
- Builds `newParentPayload` matching `createEvent`'s `insertPayload` shape
- All user-editable fields are sourced from `dto` (if provided) or fall back to `existing.*`
- `restaurant_id` comes from JWT-sourced `restaurantId` arg (T-30-18 mitigation)
- `start_date = occurrenceDate` — the new series starts at the split point
- `is_recurring: true` preserved

**Step 3 — Clone recurrence rule for new parent:**
- Clones all recurrence fields from `existing.recurrenceRule` onto a new `calendar_recurrence_rules` row
- `calendar_event_id` points to `newParentData.id`
- `generation_horizon_days: 90` (matches project convention)
- Calls `generateOccurrences(restaurantId, newRuleData.id)` — returns 0 in Phase 30 stub

**Early return:** `return this.mapCalendarEvent(newParentData)` exits before the downstream regular `update()` call, so the original occurrence is not also patched.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Plan pseudocode used wrong DTO field names**
- **Found during:** Task 1 — pre-implementation read of `mapCalendarEvent()`
- **Issue:** Plan used `existing.type` and `existing.startTime`, but `CalendarEventResponseDto` exposes `existing.eventType` and `existing.eventTime` (mapped from `row.event_type` and `row.start_time`)
- **Fix:** Used correct field names `existing.eventType` and `existing.eventTime` in `newParentPayload`
- **Files modified:** `apps/api-gateway/src/calendar/calendar.service.ts`
- **Commit:** b0089c5

## Success Criteria Verification

| Criterion | Result |
|-----------|--------|
| `grep -c "this_and_future"` ≥ 2 | ✅ 3 |
| `grep -c "TODO.*this_and_future\|not implemented"` = 0 | ✅ 0 |
| `grep -c "end_on_date.*truncateEndDate"` = 1 | ✅ 1 |
| `grep -c "calendar_event_id.*newParentData.id"` = 1 | ✅ 1 |
| `grep -c "generateOccurrences.*newRuleData"` = 1 | ✅ 1 |
| `npx tsc --noEmit` exits 0 | ✅ PASSED |

## Known Stubs

- `generateOccurrences()` calls the `generate_recurring_events` Postgres RPC which returns `0` in Phase 30 (documented in Plan 30-03). The new rule is inserted correctly; occurrence rows will be generated when the RPC is implemented in a future phase.

## Threat Flags

None — no new network endpoints introduced. Mitigations confirmed:
- **T-30-17:** `occurrenceDate` derived from `existing.occurrenceDate || existing.eventDate` (DB-sourced, not from user input)
- **T-30-18:** `restaurant_id: restaurantId` sourced from JWT token parameter, not request body
- **T-30-19:** `generateOccurrences` calls the stub RPC returning 0 — no unbounded loop

## Self-Check: PASSED

- [x] `apps/api-gateway/src/calendar/calendar.service.ts` modified — `this_and_future` implementation present (3 grep hits)
- [x] Commit `b0089c5` exists
- [x] `npx tsc --noEmit` exits 0 — no TypeScript errors
- [x] TODO/not-implemented string: 0 hits
