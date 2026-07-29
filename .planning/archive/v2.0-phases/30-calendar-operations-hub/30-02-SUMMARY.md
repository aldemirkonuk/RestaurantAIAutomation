---
phase: 30-calendar-operations-hub
plan: "02"
subsystem: api
tags: [calendar, service, dto, column-rename, color, end-time, bug-fix]
dependency_graph:
  requires:
    - 30-01 (calendar schema migrations — start_date/end_date/start_time columns)
  provides:
    - calendar.service.ts: correct column refs (start_date, end_date, start_time, end_time, color)
    - CalendarEventRow: end_time + color fields
    - insertPayload: end_time + color wired from DTO
    - updatePayload: end_time + color wired from DTO
    - mapCalendarEvent: eventTimeEnd + color in response
    - CreateCalendarEventDto: eventTimeEnd field
    - UpdateCalendarEventDto: eventTimeEnd field
    - CalendarEventResponseDto: eventTimeEnd field
  affects:
    - POST /calendar/events — no longer 500s from column-not-found
    - PATCH /calendar/events/:id — color and endTime now persisted
    - GET /calendar/events?startDate=X — filters on correct start_date column
tech_stack:
  added: []
  patterns:
    - NestJS DTO class-validator + ApiPropertyOptional for optional string fields
    - Supabase insert/update payload Record<string, unknown> with conditional if-blocks
key_files:
  created: []
  modified:
    - apps/api-gateway/src/calendar/calendar.service.ts
    - apps/api-gateway/src/calendar/dto/calendar.dto.ts
decisions:
  - "Fixed data.event_date reference in updateEvent event emission (Rule 1 bug — DB row returns start_date after migration)"
  - "color ApiProperty count criterion is 1 not 3 due to multi-line NestJS decorator style — plan spec inconsistency, actual color present in all 3 DTOs"
metrics:
  duration: "~7 minutes"
  completed: "2026-05-12"
  tasks_completed: 2
  tasks_total: 2
  files_created: 0
  files_modified: 2
---

# Phase 30 Plan 02: Calendar Service Column Fix Summary

**One-liner:** Fixed all `calendar.service.ts` Supabase column references from wrong names (`event_date`, `event_date_end`, `event_time`) to migration-aligned names (`start_date`, `end_date`, `start_time`), wired `end_time` and `color` through insert/update/map payloads, and added `eventTimeEnd` to all three calendar DTOs — eliminating the 500 errors on every calendar CRUD operation.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Fix CalendarEventRow + all column refs in calendar.service.ts | dd9745b | apps/api-gateway/src/calendar/calendar.service.ts |
| 2 | Add eventTimeEnd to CreateCalendarEventDto, UpdateCalendarEventDto, CalendarEventResponseDto | a43e247 | apps/api-gateway/src/calendar/dto/calendar.dto.ts |

## What Was Built

### Task 1: `calendar.service.ts` — 8 targeted edits

**CalendarEventRow interface:**
- Renamed `event_date → start_date`, `event_date_end → end_date`, `event_time → start_time`
- Added `end_time: string | null` (D-04)
- Added `color: string | null` (D-03)

**insertPayload (createEvent):**
- `event_date → start_date`, `event_date_end → end_date`, `event_time → start_time`
- Added `end_time: dto.eventTimeEnd || null`
- Added `color: dto.color || null`

**updatePayload (updateEvent):**
- `event_date → start_date`, `event_date_end → end_date`, `event_time → start_time`
- Added `if (dto.eventTimeEnd !== undefined) updatePayload.end_time = dto.eventTimeEnd`
- Added `if (dto.color !== undefined) updatePayload.color = dto.color`

**listEvents filters + order:** `event_date → start_date` (3 occurrences)

**getRecurringInstances filters + order:** `event_date → start_date` (3 occurrences)

**deleteRecurringSeries filter:** `event_date → start_date` (1 occurrence)

**mapCalendarEvent:**
- `row.event_date → row.start_date`, `row.event_date_end → row.end_date`, `row.event_time → row.start_time`
- Added `eventTimeEnd: row.end_time || undefined`
- Added `color: row.color || undefined`

### Task 2: `calendar.dto.ts` — 3 additions

Added `eventTimeEnd?: string` with `@ApiPropertyOptional({ description: 'Event end time (HH:MM)' })` + `@IsString()` + `@IsOptional()` decorators to:
- `CreateCalendarEventDto` (after `eventTime`)
- `UpdateCalendarEventDto` (after `eventTime`)
- `CalendarEventResponseDto` (after `eventTime`)

`color` was already present in all three DTOs — no changes needed.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed data.event_date in updateEvent event emission**
- **Found during:** Task 1
- **Issue:** `eventsService.createEvent` payload inside `updateEvent()` referenced `data.event_date` — but after the migration, the Supabase row returns `data.start_date`. This would log the wrong (undefined) date in the event system.
- **Fix:** Changed `date: data.event_date` → `date: data.start_date`
- **Files modified:** `apps/api-gateway/src/calendar/calendar.service.ts`
- **Commit:** dd9745b

### Plan Spec Inconsistency (non-blocking)

**[Note] `grep "color" | grep -c "ApiProperty"` returns 1 not ≥3**
- **Issue:** The acceptance criterion greps for lines containing both "color" AND "ApiProperty" — but NestJS decorator style puts `@ApiPropertyOptional()` on a separate line from `color?: string`. The count returns 1 (only `EventTypeResponseDto` puts both on one line).
- **Resolution:** Verified `color` is correctly present in all 3 DTOs (`CreateCalendarEventDto` line 205, `UpdateCalendarEventDto` line 279, `CalendarEventResponseDto` line 431). Plan spec inconsistency only.
- **Impact:** None — code is correct.

## Success Criteria Verification

| Criterion | Result |
|-----------|--------|
| `grep "event_date\|event_time\b"` returns 0 non-comment matches | ✅ 0 |
| `grep -c "start_date"` ≥ 6 | ✅ 12 |
| `grep -c "eventTimeEnd"` in dto ≥ 3 | ✅ 3 |
| `npx tsc --noEmit` exits 0 | ✅ PASSED |

## Known Stubs

None — all fields are fully wired through the service layer.

## Threat Flags

None — no new network endpoints, auth paths, or trust boundary crossings introduced. `eventTimeEnd` uses `@IsString() @IsOptional()` validation (T-30-05 mitigation present). `color` passes through `dto.color` without execution (T-30-04 accepted).

## Self-Check: PASSED

- [x] `apps/api-gateway/src/calendar/calendar.service.ts` modified — `start_date` appears 12 times
- [x] `apps/api-gateway/src/calendar/dto/calendar.dto.ts` modified — `eventTimeEnd` appears 3 times
- [x] Commit `dd9745b` exists (Task 1)
- [x] Commit `a43e247` exists (Task 2)
- [x] `npx tsc --noEmit` exits 0 — no TypeScript errors
