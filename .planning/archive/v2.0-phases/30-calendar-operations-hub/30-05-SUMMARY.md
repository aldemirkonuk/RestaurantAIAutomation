---
phase: 30-calendar-operations-hub
plan: "05"
subsystem: frontend
tags: [calendar, ical, settings, dashboard, clipboard]
dependency_graph:
  requires: [30-03, 30-04]
  provides: [settings-calendar-section, dashboard-ical-subscribe-button]
  affects: [apps/web/src/pages/Settings.tsx, apps/web/src/pages/Dashboard.tsx]
tech_stack:
  added: []
  patterns: [direct-fetch-with-accessToken, navigator.clipboard, sonner-toast, lucide-react-icons]
key_files:
  modified:
    - apps/web/src/pages/Settings.tsx
    - apps/web/src/pages/Dashboard.tsx
decisions:
  - Use direct fetch with localStorage.getItem('accessToken') matching Settings.tsx pattern (no apiClient imported in this file)
  - Calendar section card matches existing section visual style (rounded-2xl, border-gray-100, shadow-sm)
  - Subscribe button placed alongside Full Calendar NavLink in header right-side flex row
metrics:
  duration: "~12 minutes"
  completed: "2026-05-12"
  tasks: 2
  files_modified: 2
---

# Phase 30 Plan 05: Settings Calendar Section + Dashboard Subscribe Button Summary

**One-liner:** iCal subscription URL accessible from Settings Calendar section (copy + regenerate) and Dashboard calendar header icon button (quick clipboard copy).

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Add Calendar section to Settings.tsx | 5cd16e6 | apps/web/src/pages/Settings.tsx |
| 2 | Add subscribe shortcut button to Dashboard calendar widget header | 904fe91 | apps/web/src/pages/Dashboard.tsx |

## What Was Built

### Task 1 — Settings Calendar Section (D-10)

- Added `'calendar'` to `SECTION_IDS` array → "Calendar" tab appears in the sticky scrollspy nav
- Added `SECTION_LABELS.calendar = 'Calendar'` to type the new entry correctly
- Added `Copy` to lucide-react imports
- Defined `CalendarSubscriptionSection` component above `MeasurementVolumeSection`:
  - Fetches `GET /api/v1/calendar/ical-token` on mount with `Authorization: Bearer <token>`
  - Constructs full feed URL as `window.location.origin + /api/v1/calendar/feed/<token>.ics`
  - Shows URL in read-only mono box + Copy button (writes to clipboard, toast on success/error)
  - Instructions for Outlook / Apple Calendar / Google Calendar
  - Regenerate Token button: `confirm()` guard → `POST /api/v1/calendar/ical-token/regenerate` → updates displayed URL + success toast
  - Loading state while fetching; silently shows empty state on fetch failure
- Added `<div id="calendar" className="scroll-mt-32 bg-white rounded-2xl ...">` section after Features, before the info note

### Task 2 — Dashboard Subscribe Button (D-11)

- Added `import { toast } from 'sonner'` to Dashboard.tsx
- Added `Link2` to lucide-react imports
- Added `handleCopyICalUrl` async function:
  - Fetches `GET /api/v1/calendar/ical-token` using `localStorage.getItem('accessToken')`
  - Constructs full URL and writes to `navigator.clipboard`
  - `toast.success('Calendar subscription URL copied!')` or error toast
- Added `<button onClick={handleCopyICalUrl}>` with `<Link2 />` icon in the Sales Calendar header flex row, after the Full Calendar NavLink

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Pre-existing unused variable `currentLocation` in Settings.tsx**
- **Found during:** Task 1 TypeScript compile check
- **Issue:** `currentLocation` was declared but never read (TS6133), causing `grep -c "Settings"` acceptance check to fail with 1 error
- **Fix:** Removed the unused variable declaration
- **Files modified:** `apps/web/src/pages/Settings.tsx`
- **Commit:** 5cd16e6

**2. [Rule 2 - Pattern adaptation] Used direct fetch instead of apiClient**
- **Found during:** Task 1 implementation
- **Issue:** Plan's action spec referenced `apiClient.get('/calendar/ical-token')` but Settings.tsx has no `apiClient` import — the file uses direct `fetch()` with `localStorage.getItem('accessToken')` and `API_URL` constant
- **Fix:** Used the existing Settings.tsx auth pattern: `fetch(${API_URL}/api/v1/..., { headers: { Authorization: Bearer ${accessToken} } })`
- **No impact:** Auth mechanism is identical; only the call style differs

## Known Stubs

None — both components fetch live data from `GET /api/v1/calendar/ical-token`. The feed URL box will show an empty state (loading skeleton then nothing) if the API call fails, which is correct behavior documented in code.

## Threat Surface Scan

No new network endpoints, auth paths, or schema changes introduced. Both components consume the existing `GET /api/v1/calendar/ical-token` endpoint (Plan 30-03) with authenticated reads. The `POST /api/v1/calendar/ical-token/regenerate` button has the `confirm()` guard per T-30-15 mitigation.

## Self-Check

### Created files exist:
- `.planning/phases/30-calendar-operations-hub/30-05-SUMMARY.md` — this file

### Commits exist:
- `5cd16e6` feat(30-05): add Calendar subscription section to Settings page ✓
- `904fe91` feat(30-05): add iCal subscribe button to Dashboard calendar widget header ✓

### Acceptance criteria verified:

**Task 1 — Settings.tsx:**
- `grep -c "CalendarSubscriptionSection"` → 2 ✓ (definition + usage)
- `grep -c "ical-token"` → 2 ✓ (GET fetch + POST regenerate)
- `grep -c "Regenerate Token"` → 1 ✓
- `grep -c "navigator.clipboard"` → 1 ✓
- TypeScript: no Settings.tsx errors ✓

**Task 2 — Dashboard.tsx:**
- `grep -c "handleCopyICalUrl|ical-token"` → 3 ✓ (definition + fetch call + title attr)
- `grep -c "Link2"` → 2 ✓ (import + usage)
- `grep -c "Calendar subscription URL copied"` → 1 ✓
- `grep -c "navigator.clipboard"` → 1 ✓
- TypeScript: no Dashboard.tsx errors ✓

## Self-Check: PASSED
