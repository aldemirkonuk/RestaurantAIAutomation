# Phase 30: Calendar Operations Hub — Context

**Gathered:** 2026-05-12
**Status:** Ready for planning
**Source:** User discussion + codebase audit

<domain>
## Phase Boundary

Fix 5 confirmed bugs in the calendar system that prevent basic CRUD from working. Fix the dashboard "Add Event" UX so it opens a modal in-place instead of redirecting to /calendar. Add an iCal subscription feed endpoint so operators can subscribe WineOps events into Outlook/Apple Calendar/Google Calendar with one URL (no OAuth, no third-party services). This phase makes the calendar production-ready and operationally connected to the tools operators already live in.

**Out of scope:**
- Event-driven procurement signals (Phase 31)
- Google/Microsoft OAuth calendar sync (iCal subscription covers the use case without OAuth)
- Sales calendar visualization changes beyond bug fixes
- Push notifications
</domain>

<decisions>
## Implementation Decisions

### Bug Fixes (highest priority — calendar is broken without these)

- **D-01 (LOCKED)** Column name alignment: the Supabase migration defines `start_date`, `start_time`, `end_date`, `end_time` but the service code and `CalendarEventRow` interface uses `event_date`, `event_date_end`, `event_time`. Write a Supabase migration to rename columns in the live DB OR update the service interface + all service queries to match what the migration actually created (`start_date`, `start_time`, `end_date`, `end_time`). Preferred: update service code to match migration (safer, no data migration needed). Column mapping target: `event_date → start_date`, `event_date_end → end_date`, `event_time → start_time`.

- **D-02 (LOCKED)** Status enum alignment: the frontend `useCalendarPage.ts` and `useCalendarQueries.ts` use `'confirmed'` but the backend DTO enum only has `pending | approved | dismissed | completed | cancelled`. Fix: remove `'confirmed'` from frontend; use `'approved'` semantically as confirmed state. Map user-facing label "Confirmed" to the enum value `'approved'`. Update the frontend status dropdown to show: Pending, Approved/Confirmed, Dismissed, Completed, Cancelled.

- **D-03 (LOCKED)** Color persistence: add `color VARCHAR(7)` column to `calendar_events` table via Supabase migration. Wire `color` through `insertPayload`, `updatePayload`, and `mapCalendarEvent()` in `calendar.service.ts`. Also update `CalendarEventRow` interface.

- **D-04 (LOCKED)** End time persistence: map `endTime` to the correct DB column (`end_time`) in `buildCreatePayload` in `apps/web/src/services/api/calendar.ts` and add `eventTimeEnd` (mapped from `end_time`) to `updateCalendarEvent` payload in the same file. Update `UpdateCalendarEventDto` in `calendar.dto.ts` to accept `eventTimeEnd`.

- **D-05 (LOCKED)** Recurring "this_and_future" scope: implement the TODO in `calendar.service.ts` around line 388. When `updateScope === 'this_and_future'`: (a) set `end_on_date` of the existing recurrence rule to `occurrence_date - 1 day`, (b) create a new recurrence rule starting at `occurrence_date` with modified fields, (c) create a new parent event for the new rule. This splits the recurring series at the selected occurrence.

### Dashboard UX Fix

- **D-06 (LOCKED)** Dashboard "Add Event" button: change from `<NavLink to="/calendar">` to a button that triggers a modal. The dashboard page doesn't import the calendar EventModal. Two approaches:
  - Option A (simpler): navigate to `/calendar?openModal=true` and detect the query param in CalendarPage to auto-open the modal. No new component needed.
  - Option B: lift EventModal to a global modal store (Zustand). 
  - **Decision: Option A** — navigate to `/calendar?openModal=true&date={selectedDate}`. CalendarPage reads the param in `useEffect` and calls `openCreateModal(date)`. Clean, no global state needed.

### iCal Subscription Feed (Gem #1 — free, zero OAuth)

- **D-07 (LOCKED)** New endpoint: `GET /api/v1/calendar/feed/:restaurantToken.ics` — no auth header required (the token IS the auth). Returns `Content-Type: text/calendar` with RFC 5545 compliant iCal document containing all calendar events for the restaurant.
- **D-08 (LOCKED)** Token generation: add `calendar_ical_token VARCHAR(64)` column to `restaurants` table. On first request (or Settings page load), generate token as `crypto.randomBytes(32).toString('hex')` and store it. Token is restaurant-scoped; regenerating it invalidates all existing subscriptions.
- **D-09 (LOCKED)** iCal format: each `calendar_events` row maps to a VEVENT. Fields: DTSTART (start_date + start_time or DATE for all-day), DTEND (end_date + end_time or next day for all-day), SUMMARY (title), DESCRIPTION, STATUS (TENTATIVE/CONFIRMED/CANCELLED mapped from our enum), UID (event id + restaurant domain). PRODID: `-//WineOps//Restaurant Calendar//EN`. Use Node.js `ical-generator` library (MIT, no extra services).
- **D-10 (LOCKED)** Settings UI: add a "Calendar Subscription" section in Settings → Calendar tab. Shows the full subscription URL, a "Copy URL" button, and instructions: "Paste this URL into Outlook → Add Calendar → From Internet" / "iPhone: Settings → Calendar → Add CalDAV Account (use as iCal subscription)". Show a "Regenerate Token" button with a warning that all subscribers will lose sync.
- **D-11 (LOCKED)** Dashboard "Subscribe" shortcut: add a small calendar icon button in the dashboard calendar widget header that copies the iCal URL to clipboard with a toast notification.

### Sales Calendar in /dashboard

- **D-12 (LOCKED)** Review and fix the dashboard calendar widget (`useDashboardPage.ts` + Dashboard.tsx calendar section): ensure `useCalendarEvents` is passing correct date range params, events overlay correctly on the sales heatmap. No redesign — just fix broken queries caused by column name mismatch from D-01.

### Claude Sketch — Modal Design

- **D-13 (LOCKED)** After planning, generate 2 UI sketches: (1) the improved EventModal with all fields visible (including color swatch, status dropdown with correct values, end time), (2) the Settings calendar subscription UI. Use the existing sketch system (HTML-based throwaway mockups in `.planning/sketches/`).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Calendar Implementation
- `apps/web/src/pages/calendar/EventModal.tsx` — modal component (create/edit)
- `apps/web/src/pages/calendar/CalendarPage.tsx` — page with modal state management
- `apps/web/src/pages/calendar/useCalendarPage.ts` — calendar state hook
- `apps/web/src/hooks/queries/useCalendarQueries.ts` — all React Query hooks
- `apps/web/src/services/api/calendar.ts` — HTTP client + payload builders (buildCreatePayload, updateCalendarEvent)
- `apps/api-gateway/src/calendar/calendar.service.ts` — Supabase queries (insertPayload, updatePayload, mapCalendarEvent)
- `apps/api-gateway/src/calendar/calendar.controller.ts` — REST endpoints
- `apps/api-gateway/src/calendar/dto/calendar.dto.ts` — DTO enums (CalendarEventStatus)

### Dashboard
- `apps/web/src/pages/Dashboard.tsx` — contains "Add Event" NavLink (~line 697) and calendar widget

### DB Schema
- `supabase/migrations/20260208024921_new-migration.sql` — `calendar_events` table (start_date/start_time/end_date/end_time columns)
- `supabase/migrations/005_calendar_recurrence*.sql` — recurrence tables + status enum

### Settings
- `apps/web/src/pages/Settings.tsx` or `apps/web/src/pages/settings/` — location to add Calendar Subscription section

### Existing patterns
- `apps/api-gateway/src/communications/gmail.service.ts` — pattern for token-based auth and service structure
- `apps/web/src/stores/` — Zustand stores (for reference only — D-06 uses query param approach, not store)

</canonical_refs>

<specifics>
## Specific Implementation Details

### Bug #2 — Column Name Fix Strategy
Service currently queries using: `event_date`, `event_date_end`, `event_time`
Migration actually created: `start_date`, `end_date`, `start_time`, `end_time`

Fix in `calendar.service.ts`:
- In `mapCalendarEvent()`: change `.event_date` → `.start_date`, `.event_date_end` → `.end_date`, `.event_time` → `.start_time`
- In `createEvent()` insertPayload: change key names to `start_date`, `start_time`, `end_date`, `end_time`
- In `updateEvent()` updatePayload: same rename
- In `getEvents()` select query: update column references
- Update `CalendarEventRow` interface field names

### Bug #1 — Status Fix
Frontend display labels:
```
pending → "Pending" (badge: gray)
approved → "Confirmed" (badge: green)  ← display as "Confirmed", store as "approved"
dismissed → "Declined" (badge: red)
completed → "Completed" (badge: purple)
cancelled → "Cancelled" (badge: gray-dark)
```

### iCal Library
Use `ical-generator` npm package (MIT license):
```bash
pnpm add ical-generator --filter api-gateway
```
Creates RFC 5545 compliant iCal. No extra services or API keys.

### RFC 5545 Event Mapping
```
calendar_events.title → SUMMARY
calendar_events.description → DESCRIPTION
calendar_events.start_date + start_time → DTSTART (TZID=America/Los_Angeles or UTC)
calendar_events.end_date + end_time → DTEND
calendar_events.all_day = true → DTSTART;VALUE=DATE / DTEND;VALUE=DATE
calendar_events.status → VEVENT STATUS (pending→TENTATIVE, approved/completed→CONFIRMED, cancelled/dismissed→CANCELLED)
calendar_events.id → UID (format: {id}@wineops.app)
```

### Dashboard "Add Event" — Option A implementation
In `Dashboard.tsx`, replace:
```tsx
<NavLink to="/calendar">Add Event</NavLink>
```
With:
```tsx
<button onClick={() => navigate('/calendar?openModal=true')}>Add Event</button>
```

In `CalendarPage.tsx` / `useCalendarPage.ts`, add:
```tsx
const [searchParams] = useSearchParams();
useEffect(() => {
  if (searchParams.get('openModal') === 'true') {
    openCreateModal();
  }
}, []);
```

### Premortem — Failure Modes to Guard Against
1. **Migration safety**: renaming columns with existing data must use `ALTER TABLE RENAME COLUMN`, not drop+add. Include `IF EXISTS` guards.
2. **iCal feed security**: the token in the URL is the only auth — it must not be logged by standard NestJS request logging middleware (add exclusion or redact).
3. **iCal timezone handling**: restaurant's timezone must be stored or defaulted (use `America/Los_Angeles` as default for the Turkish SF restaurant). All DTSTART/DTEND must include TZID or be in UTC.
4. **Status `dismissed` in frontend**: currently the frontend `useUpdateEventStatus` doesn't list `dismissed` — add it.
5. **"this_and_future" recurrence split**: when splitting, the NEW parent event must not duplicate the original event (the occurrence being edited becomes the new parent's first instance).
6. **Color migration**: use `DEFAULT NULL` so existing rows aren't broken.
7. **Dashboard `openModal` param**: after opening, clear the query param from URL (avoid re-opening on back-navigation).
</specifics>

<deferred>
## Deferred

- Microsoft OAuth / Google Calendar two-way sync (iCal subscription covers the use case without OAuth complexity)
- Event-driven procurement signals (Phase 31)
- Sales calendar redesign (Phase 30 only fixes data correctness; redesign is future)
- CalDAV server (iCal subscription read-only is sufficient for Phase 30)
</deferred>

---

*Phase: 30-calendar-operations-hub*
*Context gathered: 2026-05-12 via user discussion + codebase audit*
