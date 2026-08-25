---
phase: 23-gmail-integration-calendar-reminder-emails
plan: "04"
subsystem: api-gateway/communications
tags: [calendar, cron, scheduled-tasks, multi-window, email]
dependency_graph:
  requires:
    - 23-01 (GmailService.sendEventPrepReminder() method)
    - 23-03 (CALENDAR_REMINDER_DAYS env var set on Railway)
  provides:
    - Multi-window calendar reminder cron job (T-7, T-2, T-1 days)
  affects:
    - apps/api-gateway/src/communications/scheduled-tasks.service.ts
tech_stack:
  added: []
  patterns:
    - for-of loop over configurable number[] from env var
    - per-window continue on Supabase error (independent window failure isolation)
key_files:
  modified:
    - apps/api-gateway/src/communications/scheduled-tasks.service.ts
decisions:
  - "Used parseInt(d.trim(), 10) + filter(!isNaN && >0) for CALENDAR_REMINDER_DAYS parsing — matches threat model T-23-04-01 mitigation"
  - "Safety fallback to [7,2,1] if parsed array is empty after filtering"
  - "continue (not return) on per-window Supabase error — T-7 failure doesn't block T-2 or T-1 windows"
  - "resolveRecipients() called inside per-window loop (not hoisted) — ensures fresh recipient list per window; minor overhead acceptable at daily cron frequency"
metrics:
  duration: "~8 minutes"
  completed_date: "2026-04-14"
  tasks_completed: 2
  tasks_total: 3
  files_modified: 1
---

# Phase 23 Plan 04: Multi-Window Calendar Reminder Cron — Summary

**One-liner:** Extended `sendEventPrepReminders()` from hardcoded T-2 to configurable multi-window loop (T-7, T-2, T-1) via `CALENDAR_REMINDER_DAYS` env var parsed in `onModuleInit()`.

## What Was Built

The only real code change in Phase 23. `ScheduledTasksService` now reads `CALENDAR_REMINDER_DAYS=7,2,1` from env on startup and iterates all configured windows in its daily 8 AM cron, running one Supabase query per window date instead of a single hardcoded T-2 query.

## Tasks

| # | Name | Commit | Status |
|---|------|--------|--------|
| 1 | Add calendarReminderDays property and onModuleInit() read | fc0c350 | ✅ |
| 2 | Refactor sendEventPrepReminders() to loop over calendarReminderDays | f8371bb | ✅ |
| 3 | Deploy and verify multi-window calendar reminders (checkpoint) | — | ⏸ Checkpoint |

## Key Changes

### `calendarReminderDays` property (line 15)
```typescript
private calendarReminderDays: number[] = [7, 2, 1];
```

### `onModuleInit()` — env read with safe parse (lines 30-42)
- Reads `CALENDAR_REMINDER_DAYS` (defaults to `'7,2,1'`)
- Parses via `split(',').map(parseInt).filter(!isNaN && >0)`
- Safety fallback to `[7, 2, 1]` if array empty after filtering
- Logs: `Calendar reminder windows: T-7, T-2, T-1 days`

### `sendEventPrepReminders()` — multi-window loop (lines 453-515)
- `for (const daysAhead of this.calendarReminderDays)` replaces single hardcoded block
- `targetDateTime = new Date(); setDate(+daysAhead)` computed per window
- Per-window Supabase error → `continue` (not throw)
- `totalReminders` counter across all windows
- Per-window log: `T-7: sent N event prep reminder(s) for YYYY-MM-DD`

## Deviations from Plan

None — plan executed exactly as written.

## Threat Model Coverage

| Threat ID | Mitigation | Applied |
|-----------|-----------|---------|
| T-23-04-01 | `.filter(d => !isNaN(d) && d > 0)` rejects zero/negative/NaN; safety fallback to [7,2,1] | ✅ |
| T-23-04-02 | No upper bound cap (MVP — internal env var only) | accepted |
| T-23-04-03 | Email to MANAGER_EMAIL (authorized recipient) | accepted |

## Known Stubs

None. All data flows from `calendar_events` Supabase table via live query.

## Self-Check: PASSED

| Check | Result |
|-------|--------|
| `apps/api-gateway/src/communications/scheduled-tasks.service.ts` | FOUND |
| `.planning/phases/23-gmail-integration-calendar-reminder-emails/23-04-SUMMARY.md` | FOUND |
| Commit fc0c350 (Task 1) | FOUND |
| Commit f8371bb (Task 2) | FOUND |
| TypeScript `tsc --noEmit` | PASSED (exit 0) |
