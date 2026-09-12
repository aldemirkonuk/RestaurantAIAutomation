---
type: page
route: /calendar
slug: calendar
softwares: [calendar]
component: apps/web/src/pages/CalendarModular.tsx
audience: owner
tier: core
archetype: calendar # proposed 2026-08-26 (OD-106)
signals_today: none
rebrand_strings: 0
maturity: partial
status: documented
updated: 2026-08-26
links: ["[[PAGE-CONTRACT]]"]
---

# /calendar — Calendar (modular)

> **Part of** [[08-softwares/calendar|Calendar]] — the small software this screen belongs to. Index: [[SOFTWARE-MAP]].

## Surface — buttons → where they go

- **Click slot / New event** → (EventModal on this page)
- **Drag-move / resize event** → event mutation via `useCalendarEvents`
- **Meeting end** → (MeetingMemoPrompt capture on this page)
- (no outbound navigation — dead-end page)

## 1. Purpose

"Routes the fully-built modular calendar (`pages/calendar/*`) that ships Week/Day
views, drag-move/resize, click-slot-to-create, true event editing, RRULE recurrence,
multi-channel reminders, and meeting-memo capture … Previously built but unrouted"
(`CalendarModular.tsx:1-9`). Deliveries, tastings and vendor meetings for the
operator (`Sidebar.tsx:110`).

## 1a. Features
- See deliveries, tastings and vendor meetings in Month / Week / Day / Agenda views
- Drag to move or resize an event; click an empty slot to create one
- Full event editing with recurring events (RRULE)
- Create and manage custom event types (server-backed)
- Multi-channel reminders per event
- Capture a meeting memo after a meeting
- Link events to vendors
- "Add calendar event" from the command palette deep-links straight into the create modal

## 2. Entry

- Sidebar "Calendar" (`components/layout/Sidebar.tsx:108`).
- From `/` ([PAGE_MAP](../foundation/PAGE_MAP.md):61; in-degree 1, :147).
- Command palette `g c` plus "Add calendar event" which deep-links
  `/calendar?openModal=true` (`components/command/commands.ts:63,79,93`).

## 3. Files

- Route binding: `apps/web/src/App.tsx:274` (lazy import :99).
- `apps/web/src/pages/CalendarModular.tsx` (26-line wrapper: Header + bounded-height
  flex column, :11-12).
- Tree: `pages/calendar/{CalendarPage.tsx, useCalendarPage.ts, CalendarMonth/Week/Day/Agenda.tsx, CalendarSidebar.tsx, EventCard.tsx, EventModal.tsx, MeetingMemoPrompt.tsx, DragDropProvider.tsx, index.tsx}`.

## 4. Endpoints

Atlas row: [ENDPOINTS](../foundation/ENDPOINTS.md):87 (`calendar`, 19); providers
via :461.

| Method | Path | Call site |
|---|---|---|
| GET | `/calendar/events` | `useCalendarEvents` (`pages/calendar/useCalendarPage.ts:68`) → `services/api/calendar.ts:221` |
| POST | `/calendar/events` | `useCreateCalendarEvent` (`CalendarPage.tsx:114`) → `calendar.ts:237` |
| PATCH | `/calendar/events/:id` (+ `/status`, `/recurring`) | `CalendarPage.tsx:115` → `calendar.ts:265,338,381` |
| DELETE | `/calendar/events/:id` (+ `/recurring?fromDate=`) | `CalendarPage.tsx:116` → `calendar.ts:273,398` |
| GET/POST/PATCH/DELETE | `/calendar/event-types` | `useEventTypes` (`useCalendarPage.ts:2`) → `calendar.ts:293-328` |
| GET | `/providers` | `useProviders` (`useCalendarPage.ts:2`) → `services/api/providers.ts:201` |

## 5. Signals

**None.** No tracking or `data-ux-key` in the tree; reporter dark
(`lib/uxSignals.ts:15`).

## 6. Tier cut

**Core** — operate. Delivery scheduling is S02 adjacent
([TIER-MAP](../03-scenarios/TIER-MAP.md):38); no scenario names the calendar as its
spine — it is shared operating furniture.

## 7. Rebrand surface

**0 user-visible strings.** The only `wineops` hit is the sidebar-collapse
localStorage key `'wineops-calendar-sidebar'` (`pages/calendar/CalendarPage.tsx:46`)
— invisible. Layout chrome per dashboard.md §7.

## 8. State & config

- Sidebar collapse persists in localStorage (`CalendarPage.tsx:46`).
- `?openModal=true` deep link opens the create modal (`commands.ts:93`).
- Recurrence expanded client-side (`lib/calendar/recurrence.ts`, `useCalendarPage.ts:4`).

## 9. Gaps

- ~~**Two calendars are routed**~~ — **closed 2026-08-26.** `/calendar-classic` is
  retired (route, `pages/Calendar.tsx`, `NewEventTypeModal`, `EntityAutocomplete`
  deleted); this is the only calendar. Its one blocking exclusive — reminders that
  actually fire — was ported here first (§10). ADR 0019 §B-parity records the check.
- Phase 30 iCal feed "code scored 10/10 but no external calendar client has ever
  confirmed the feed subscribes" (`v3.0-TECH-DEBT.md:243-245`); the subscribe UI
  lives in Settings and Dashboard, but the untested feed serves this page's data.

## 10. Maturity

**partial.**

> *Verified against the working tree on 2026-08-26. A concurrent session on this
> branch changed `CalendarPage.tsx`/`EventModal.tsx` and added
> `lib/reminder-scheduler.ts` while this dossier was being written — the reminder
> findings below describe the **current** code, not the pre-change state.*

The event spine is real: create, read, update, delete, drag-move, resize, RRULE
recurrence and event types all reach JWT-guarded endpoints
(`apps/api-gateway/src/calendar/calendar.controller.ts:44-45`, routes :55-539) and
persist.

**Reminders now fire, but only in one browser.** `syncEventReminders`
(`apps/web/src/pages/calendar/CalendarPage.tsx:64-84`) pushes each reminder into a
`localStorage` queue (`lib/reminder-scheduler.ts:9,82`) which a poller booted in
`main.tsx:20` drains; on fire it raises a browser `Notification` **and** writes a
durable row via `POST /notifications` (`reminder-scheduler.ts:176-200`). The module's
own header states the constraint plainly: *"This is the only reminder mechanism that
fires anything: the calendar API only stores a `reminderEnabled` flag plus
`reminderDaysBefore`, and nothing server-side reads either column — there is no
reminder cron and the iCal feed emits no VALARM"* (`CalendarPage.tsx:55-63`).
Independently confirmed: `reminder_sent` is read at `calendar/calendar.service.ts:1118`
and has **no writer** anywhere in `apps/` or `services/`. So a reminder set on the
office laptop does not exist on the phone, and none fires with the app closed.

Still collected and discarded:

| Collected by | Dropped at | Consequence |
|---|---|---|
| Meeting memo — doc type, notes, labels (`MeetingMemoPrompt.tsx:94`) | `handleMemoSave = useCallback((_memo) => { /* Future: persist to documents API */ setMemoPromptOpen(false) }, [])` (`CalendarPage.tsx:307-310`) | The prompt fires *because* the event was labelled a vendor meeting, asks for notes, and closes. Nothing is stored. **The one remaining hollow surface on this page** |
| `email` reminder channel | The create-mode default is `channels: ['in_app','email']` (`EventModal.tsx:376`), the scheduler sends in-app + browser only (`reminder-scheduler.ts:176-200`), and reading an existing reminder back **hardcodes** `channels: ['in_app']` (`CalendarPage.tsx:335`) | Ticking "email" changes nothing, and the tick disappears on reopen |
| `labels` (`EventModal.tsx:522`) | Not forwarded to `createEvent`/`updateEvent` (`CalendarPage.tsx:252-292`); `buildCreatePayload` has no such field (`services/api/calendar.ts:105-121`) | Labels exist only long enough to trigger the memo prompt |
| `multiDay` / `eventDateEnd`, and `recurring` on **edit** | Absent from the update branch (`CalendarPage.tsx:253-270`); present on create (`:284`) | Editing a multi-day or recurring event silently flattens it |

The `custom_reminders` table that `@Cron("*/15 * * * *")` does fire
(`communications/scheduled-tasks.service.ts`) is a **different** table with
no UI anywhere in the web app — grep finds zero references outside the gateway and
its tests. It is **no longer gated on `DEFAULT_RESTAURANT_ID`**: as of 2026-08-26
(OD-87 / [ADR 0022](../decisions/0022-scheduled-jobs-serve-opted-in-tenants.md)) it
runs per opted-in tenant and queries `custom_reminders` scoped to that tenant.
That fixed a real cross-tenant defect in passing — the query used to run once,
unfiltered, and then gate every row it found on the *default* restaurant's
inventory and mail the *default* restaurant's manager. The table is empty in
production (verified 2026-08-26), so nothing was ever misdelivered.

## 11. Data flow

### Calls out

| Method | Path | Auth | Gateway controller | Returns |
|---|---|---|---|---|
| GET | `/calendar/events?startDate=&endDate=` | JWT (class, `calendar.controller.ts:45`) | `:94-119` | Events for the window |
| POST | `/calendar/events` | JWT | `:55-92` | Created event — **without** reminders/labels/location/attendees (never sent) |
| PATCH | `/calendar/events/:id` (+`/status`, `/recurring`) | JWT | `:152-187`, `:418-455`, `:457-499` | Updated event |
| DELETE | `/calendar/events/:id` (+`/recurring?fromDate=`) | JWT | `:189-229`, `:501-537` | 204 |
| GET/POST/PATCH/DELETE | `/calendar/event-types` | JWT | `:306-416` | Custom types |
| GET | `/providers` | JWT | `providers` module | Vendor picker |
| POST | `/notifications` | JWT (class, `notifications.controller.ts:45`) | `:61-82` | Durable row, written by the reminder scheduler on fire (`reminder-scheduler.ts:193`) |
| GET | `/calendar/feed/:token.ics` | **`@Public()`** — bearer is the 64-char token in the path (`:586-587`) | `:596-606` | iCal text |

### Fed by

| Data | Producer | Live? |
|---|---|---|
| Manually created events | This page and the command palette (`commands.ts:93`) | Yes |
| Provider/order-linked events | `calendar_agent` (`AgentTier.CORE`, `services/agent-orchestrator/core/agent_registry.py:83-87`); its LLM date extraction was repaired under ADR 0010 / OD-63 | Agent yes — but its output table `provider_important_dates` **does not exist in production** (OD-63 resolution, now **OD-68**), so the extracted dates have nowhere to land |
| Reminder firing | `lib/reminder-scheduler.ts`, booted `main.tsx:20` | **Browser-local only.** No server producer; `reminder_sent` has no writer |
| Meeting memos | **none** | No |
| iCal subscribers | External calendar clients | **Never observed to work** (`v3.0-TECH-DEBT.md:243-245`) — see settings.md §10 for the concrete suspect |

### Writes

| Write | Downstream reaction |
|---|---|
| Event create/update/delete | `/team`'s ManagerShiftDesk overlays the same events (`ManagerShiftDesk.tsx:17`); `/documents-reports` subscribes to calendar realtime and toasts (`DocumentsPage.tsx:157-170`) |
| Reminder fire | Browser notification + a durable row in `/notifications` (`reminder-scheduler.ts:176-200`) |
| Event delete | Pending reminders for that event are cancelled first (`CalendarPage.tsx:313-315`) — correct, and easy to have missed |
| Sidebar collapse | `localStorage` `'wineops-calendar-sidebar'` (`CalendarPage.tsx:53`) |
| Labels / memo / email channel | **none** |

## 12. Design intent

**Should be:** the operating week — deliveries, tastings and vendor meetings — with
enough memory attached that the next conversation starts where the last one ended.

| State | Handled? | Evidence |
|---|---|---|
| Loading | Yes | `useCalendarEvents` query state consumed in `useCalendarPage.ts:68` |
| Empty | Yes | Grid renders with no events; a legitimately quiet week |
| Error | **No** | No `isError` branch in the tree |
| Permission-denied | **No** | No 403 branch |

**Where the UI misleads**

1. Reminders read as a property of the event; they are a property of the browser.
   Nothing on screen says a reminder set here will not follow the user to their phone.
2. The `email` channel toggle has no effect and does not survive a reopen
   (`CalendarPage.tsx:335`).
3. The meeting-memo prompt asks for notes it discards.
4. Editing a multi-day or recurring event quietly loses those properties.
5. The iCal copy in Settings promises Outlook/Apple/Google (`Settings.tsx:207`) for a
   feed nobody has seen subscribe.

## 13. Roadmap

1. **Move reminders server-side.** A cron over `reminder_enabled`/`reminder_days_before`
   that writes through `persistForRestaurant` and stamps `reminder_sent`
   (`calendar.service.ts:1118`, currently unwritten). The localStorage scheduler is a
   good stopgap and should stay until this lands — but a reminder that only exists in
   one browser is not a product promise you can make.
2. **Honour or remove the `email` channel** (`EventModal.tsx:376`, `CalendarPage.tsx:335`).
   Blocked on (1) for the honour path; removal is available today.
3. **Persist meeting memos** to the documents surface the handler names
   (`CalendarPage.tsx:308`). Blocked: `/documents-reports` has no upload path at all
   (documents-reports.md §10). Until then, remove the prompt rather than keep
   collecting.
4. **Stop dropping `recurring`, `eventDateEnd` and `labels` on edit**
   (`CalendarPage.tsx:253-270`) — mechanical, and it is a data-loss path today.
5. ~~**Retire `/calendar-classic`**~~ — **done 2026-08-26** (§9).
6. Add an `isError` branch.
7. Diagnose the iCal feed against a real client — settings.md §13 item 3 names the
   first thing to try. Blocked on `v3.0-TECH-DEBT.md:243-245`.
8. `provider_important_dates` missing in production — **OD-68**.
