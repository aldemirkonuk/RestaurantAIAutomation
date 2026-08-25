---
phase: 30-calendar-operations-hub
plan: "04"
subsystem: web
tags: [calendar, frontend, status-fix, endtime-payload, openModal, dashboard, url-params]
dependency_graph:
  requires:
    - 30-02 (backend column renames — start_time/end_time/start_date/end_date)
  provides:
    - apps/web/src/services/api/calendar.ts: buildCreatePayload sends eventDateEnd+eventTimeEnd; updateCalendarEvent sends endTime; no 'confirmed' status
    - apps/web/src/pages/calendar/CalendarPage.tsx: useSearchParams + useEffect opens modal on ?openModal=true
    - apps/web/src/pages/Dashboard.tsx: Add Event button navigates to /calendar?openModal=true
  affects:
    - All calendar event create/update flows — end time now sent to backend
    - Status update flows — 'approved' used consistently instead of invalid 'confirmed'
    - Dashboard → Calendar navigation — modal opens automatically
tech_stack:
  added: []
  patterns:
    - useSearchParams + useEffect (run-once on mount) for URL-param-driven modal opening
    - navigate('/calendar?openModal=true') pattern for cross-page modal trigger
    - setSearchParams with replace:true to clear params after consuming them
key_files:
  created: []
  modified:
    - apps/web/src/hooks/queries/useCalendarQueries.ts
    - apps/web/src/pages/Calendar.tsx
    - apps/web/src/pages/calendar/CalendarAgenda.tsx
    - apps/web/src/pages/calendar/EventCard.tsx
    - apps/web/src/data/FALLBACK_DATA.ts
    - apps/web/src/services/api/calendar.ts
    - apps/web/src/pages/calendar/useCalendarPage.ts
    - apps/web/src/pages/calendar/CalendarPage.tsx
    - apps/web/src/pages/Dashboard.tsx
decisions:
  - "'approved' used as stored status value; 'Confirmed' preserved as the display label in the status dropdown option"
  - "useEffect with empty deps array (run once on mount) for openModal detection — prevents re-opening on back-navigation"
  - "setSearchParams with replace:true clears ?openModal=true param from browser history stack"
  - "Dead code removed from CalendarAgenda: 'approved' styling check inside !=='approved' block was unreachable and caused TS2367"
metrics:
  duration: "~8 minutes"
  completed: "2026-05-12"
  tasks_completed: 2
  tasks_total: 2
  files_created: 0
  files_modified: 9
---

# Phase 30 Plan 04: Frontend Bug Fixes Summary

**One-liner:** Removed invalid `'confirmed'` status from all 9 frontend files replacing with `'approved'` (preserving "Confirmed" display label), wired `eventDateEnd`+`eventTimeEnd` into create/update payloads so end time actually reaches the backend, and added URL-param-driven modal (`?openModal=true`) with the Dashboard Add Event button navigating to it.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Status enum cleanup across frontend files (D-02) | f7ca44e | useCalendarQueries.ts, Calendar.tsx, CalendarAgenda.tsx, EventCard.tsx, FALLBACK_DATA.ts |
| 2 | endTime payload fix + Dashboard Add Event + CalendarPage openModal | df7d520 | calendar.ts, useCalendarPage.ts, CalendarPage.tsx, CalendarAgenda.tsx, Dashboard.tsx |

## What Was Built

### Task 1: Status `'confirmed'` → `'approved'` cleanup

**Root cause:** The frontend was using `'confirmed'` as a status value in comparisons, type unions, and fallback data, but the backend `CalendarEventStatus` enum only accepts `'approved'` (never `'confirmed'`). Every status update to "Confirmed" resulted in a 400 error.

**Files changed:**

- **`useCalendarQueries.ts`** — Fixed `useUpdateEventStatus` mutation type: `'pending' | 'confirmed' | 'completed' | 'cancelled'` → `'pending' | 'approved' | 'dismissed' | 'completed' | 'cancelled'`
- **`Calendar.tsx`** — 5 changes: status type union (line 78), `status === 'confirmed'` push-notification gate (line 1009), two badge className comparisons (lines 1326, 1624), and `<option value="confirmed">` → `<option value="approved">` (line 1631 — label "Confirmed" preserved)
- **`CalendarAgenda.tsx`** — `event.status !== 'confirmed'` → `event.status !== 'approved'`; also removed dead `=== 'approved'` check inside the `!== 'approved'` block (TS2367 fix)
- **`EventCard.tsx`** — Status badge green styling: `event.status === 'confirmed'` → `event.status === 'approved'`
- **`FALLBACK_DATA.ts`** — Fallback event status: `'confirmed'` → `'approved'`

### Task 2: endTime payload + openModal + Dashboard button

**A. `apps/web/src/services/api/calendar.ts`**

- `ApiCalendarEvent` interface: added `eventTimeEnd?: string`
- `CalendarEvent` interface: removed `'confirmed'` from status union
- `CreateEventInput` interface: removed `'confirmed'` from status union
- `updateEventStatus` function: removed `'confirmed'` from parameter type
- `buildCreatePayload`: added two missing fields:
  ```typescript
  eventDateEnd: data.allDay ? undefined : (data as any).endDate,
  eventTimeEnd: data.allDay ? undefined : data.endTime,
  ```
- `updateCalendarEvent`: added end-time block after `eventTime` mapping:
  ```typescript
  if (updateData.endTime !== undefined) {
    payload.eventDateEnd = updateData.allDay ? undefined : (updateData as any).endDate
    payload.eventTimeEnd = updateData.allDay ? undefined : updateData.endTime
  }
  ```

**B. `useCalendarPage.ts`** — Removed `'confirmed'` from `CalendarEvent.status` union

**C. `CalendarPage.tsx`** — Added `useEffect`+`useSearchParams` imports and openModal detection:
```typescript
const [searchParams, setSearchParams] = useSearchParams()

useEffect(() => {
  if (searchParams.get('openModal') === 'true') {
    const dateStr = searchParams.get('date')
    const date = dateStr ? new Date(dateStr) : new Date()
    openCreateModal(date)
    setSearchParams(prev => {
      prev.delete('openModal')
      prev.delete('date')
      return prev
    }, { replace: true })
  }
}, []) // run once on mount
```

**D. `Dashboard.tsx`** — Added `useNavigate` to imports, `const navigate = useNavigate()` in component body, and replaced the Add Event `<NavLink to="/calendar">` with:
```tsx
<button onClick={() => navigate('/calendar?openModal=true')} ...>
  <Plus className="w-3 h-3" />
  Add Event
</button>
```

**E. `useDashboardPage.ts`** — Verified `useCalendarEvents` already uses `startDate`/`endDate` param names (no change needed).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Removed dead `event.status === 'approved'` check inside `!== 'approved'` block in CalendarAgenda.tsx**
- **Found during:** Task 2 TypeScript check
- **Issue:** After changing the outer guard from `!== 'confirmed'` to `!== 'approved'`, the `${event.status === 'approved' ? 'bg-blue-100 text-blue-600' : ''}` template expression inside the block became dead code and triggered TS2367 (unintentional comparison)
- **Fix:** Removed the `=== 'approved'` line from the className template — this check is unreachable inside the `!== 'approved'` guard
- **Files modified:** `apps/web/src/pages/calendar/CalendarAgenda.tsx`
- **Commit:** df7d520

### Pre-existing TypeScript Errors (Out of Scope)

The following errors existed before this plan and were not introduced by these changes (verified via `git stash` baseline):
- `CalendarPage.tsx`: RecurringEvent/CalendarEvent type mismatch (lines 427, 439, 450, 459, 483)
- `CalendarPage.tsx`: `enabledTypes.has(e.type)` string|undefined mismatch (line 135)
- `useCalendarPage.ts`: RecurringEvent expansion type narrowing issue (line 130)
- `services/api/calendar.ts`: Duplicate `EventType` identifier (type alias + interface)
- Various test file and other component errors

## Success Criteria Verification

| Criterion | Result |
|-----------|--------|
| `grep -rn "'confirmed'" apps/web/src/pages/Calendar.tsx ...` returns 0 | ✅ CLEAN |
| `grep -c "eventTimeEnd" apps/web/src/services/api/calendar.ts` ≥ 1 | ✅ 3 occurrences |
| `grep -c "eventDateEnd" apps/web/src/services/api/calendar.ts` ≥ 2 | ✅ 3 occurrences |
| `grep -c "openModal=true" apps/web/src/pages/Dashboard.tsx` = 1 | ✅ 1 |
| `grep -c "useNavigate" apps/web/src/pages/Dashboard.tsx` = 1 | ✅ 2 (import + call) |
| `grep -c "NavLink.*to.*calendar" apps/web/src/pages/Dashboard.tsx` = 0 | ✅ 0 |
| `grep -c "useSearchParams" apps/web/src/pages/calendar/CalendarPage.tsx` = 1 | ✅ 2 (import + call) |
| `grep -c "openModal.*true" apps/web/src/pages/calendar/CalendarPage.tsx` = 1 | ✅ 1 |
| `grep -c "'confirmed'" apps/web/src/services/api/calendar.ts` = 0 | ✅ 0 |
| `grep -c "'confirmed'" apps/web/src/pages/calendar/useCalendarPage.ts` = 0 | ✅ 0 |
| `grep -c "startDate\|endDate" apps/web/src/pages/dashboard/useDashboardPage.ts` ≥ 2 | ✅ 2 |
| No new TypeScript errors introduced | ✅ Verified via git stash baseline |

## Threat Model Coverage

| Threat ID | Disposition | Implementation |
|-----------|-------------|----------------|
| T-30-11 | accept | openModal URL param only triggers modal open — no DB write; user must submit form to create data |
| T-30-12 | accept | `new Date(dateStr)` produces Invalid Date for bad input; openCreateModal handles gracefully |
| T-30-13 | mitigate | Backend enum validation rejects invalid status; frontend type unions now enforce compile-time safety (no 'confirmed' in any union) |

## Known Stubs

None — all changes wire real data and behavior.

## Threat Flags

None — all surfaces in scope were already in the plan's threat model.

## Self-Check: PASSED

- [x] `apps/web/src/hooks/queries/useCalendarQueries.ts` — `'confirmed'` removed from useUpdateEventStatus type
- [x] `apps/web/src/pages/Calendar.tsx` — 5 occurrences of `'confirmed'` replaced
- [x] `apps/web/src/pages/calendar/CalendarAgenda.tsx` — `!== 'approved'` guard; dead code removed
- [x] `apps/web/src/pages/calendar/EventCard.tsx` — badge comparison fixed
- [x] `apps/web/src/data/FALLBACK_DATA.ts` — fallback status fixed
- [x] `apps/web/src/services/api/calendar.ts` — eventDateEnd+eventTimeEnd in buildCreatePayload; updateCalendarEvent endTime block; status types cleaned
- [x] `apps/web/src/pages/calendar/useCalendarPage.ts` — status union cleaned
- [x] `apps/web/src/pages/calendar/CalendarPage.tsx` — useSearchParams + useEffect openModal
- [x] `apps/web/src/pages/Dashboard.tsx` — navigate('/calendar?openModal=true') button
- [x] Commit `f7ca44e` exists (Task 1)
- [x] Commit `df7d520` exists (Task 2)
- [x] No new TypeScript errors (pre-existing errors confirmed via git stash baseline)
