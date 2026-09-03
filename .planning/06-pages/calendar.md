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
updated: 2026-09-02
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

**Added by the Mudavym rebuild** (behind `mudavym_design_calendar`; the shipping page is
unchanged with the flag off):

- **The day is the unit of record.** Clicking a day in the month opens that day's ledger
  underneath — deliveries first, then everything else, each line carrying its vendor and
  order link
- **Deliveries are the spine, and an arrived delivery is *ruled off*** with the house double
  rule; a day whose whole delivery account is settled is ruled off as a day, under a
  dry-pressed seal. Ruled off means one of exactly two things: the entry's own status is
  `completed`, or its linked order is one the orders book says arrived
- **Search and type filter over the loaded period**, with a line saying how many entries the
  filter is holding back (they are in the book, just not on this screen)
- **Four honest states**: loading names the window it is reading; a failed read says which
  register could not be read and offers a retry; a 403 is named as a permission answer, not
  an empty schedule; an empty period says so in words
- **The gateway's paging is surfaced** — when `hasMore` comes back true the page says the
  month it drew is not the whole month, instead of quietly showing the first 100
- **Hold-to-delete**: deleting is the one irreversible act on the page, so it is the one
  place that spends the seal ceremony; deleting a repeating entry says it takes the series
- 🔒 **Reminders are labelled per-browser** and the **email channel is rendered disabled**
  with the reason — nothing sends it
- 🔒 **Vendor link and repeat rule are create-time only**, each with one line saying why (the
  update DTO carries neither field, §9)
- 🔒 **A recurring occurrence is not draggable** and its sheet says an edit changes the whole
  series — the gateway has no per-occurrence route
- ⚫ **The meeting-memo prompt is not built** (it collected notes into a void, §10)
- ⚫ **`labels` are not collected** (they were never forwarded to the API, §10)
- ⚫ **The collapsible left sidebar is gone**; its two jobs (type legend, search) are a select
  and an input in the header, so `localStorage['wineops-calendar-sidebar']` is unused here

## 1b. Motions used — Mudavym redesign (flag `mudavym_design_calendar`)

Canonical copy lives beside the code in
`apps/web/src/pages/calendar/next/MOTIONS.md`; this table is the mirror.

| id | token | curve · ms | fires |
|---|---|---|---|
| `cn-open` | `settle` | HOUSE `cubic-bezier(.16,1,.3,1)` · 420ms | the opening block (wordmark, period line, standing sentence) on mount, once |
| `cn-turn` | `turn` | `cubic-bezier(.32,.72,0,1)` · 420ms | the view stage when the magnification changes — the same book, a page turned |
| `cn-day-settle` | `settle` | HOUSE · 320ms | the day ledger opening under the month grid (`grid-template-rows: 0fr → 1fr`) — the row-expand the founder singled out on board 053 |
| `cn-sheet-tuck` | `tuck` | spring 380/32 · 300ms | the event sheet arriving from the right, 28px + fade |
| `cn-drag` | **none, deliberately** | live `pointermove`, un-eased | a block dragged or resized in the Week/Day grid — easing between 15-minute snaps would draw a time the operator never chose |
| `cn-drop-tuck` | `tuck` | spring 380/32 · 300ms | the same block settling into its committed slot after the pointer lifts; suppressed while the finger is down |
| `cn-ink` | `ink` | HOUSE · 160ms | hover/focus micro-states on cells, ribbons, ledger lines, tabs, chips, buttons — nothing moves |
| `cn-hold-pour` | `pour` | `linear` · 620ms | the hold-to-delete fill; an early release retreats on `tuck` and says what did not happen |
| `cn-seal-stamp` | `stamp` | spring 500/26 (~11% overshoot) · 360ms | the seal landing when the delete hold completes — the only overshoot, and the only wax |

**Deliberate non-motions:** the grid does not stagger in (a schedule is a reference you scan,
not a set of figures arriving); nothing tallies (the counts are counts of record, and an em
dash must never animate); ruling off is *drawn*, not animated (the delivery arrived in the
orders book — the page did not do it); the sheet and the day ledger close instantly.
`prefers-reduced-motion` collapses every row above to its end state.

### Design used, and why

**The verdict.** `/calendar` — **KEEP.** *"I really prefer the new version. That's for
sure."* The one page named in the founder's opening as unreservedly liked
([[MAKEOVER-VERDICTS]]:212).

**The structure that enforces it.** A KEEP is the hardest brief: there is nothing to fix, so
the only honest way to spend the work is to make the page *mean* what the house means. One
idea does that — **the day is the unit of record, and deliveries are the spine.** Month,
Week, Day and Agenda are not four features; they are four magnifications of one book. Every
view sorts deliveries first and gives them the seal rule; everything else gets an ink rule.
And the house's own device does the rest: a delivery that arrived is **ruled off** with the
double rule, and a day whose whole delivery account is settled is ruled off as a day. That
single device replaces what a calendar normally does with colour, and it is the reason the
page can obey ADR 0042's one-chromatic-colour rule without going flat.

**The honesty rules applied.**
- The page does not reuse `useCalendarQueries`: those hooks return `[]` on failure in DEV,
  silently substitute an IndexedDB copy otherwise, and turn a real 4xx on write into a
  fabricated `{ _pending: true }` "saved offline" success. All three make *absence* look like
  *health*. This page reads through `apiClient` directly and says what failed.
- Ruled off has exactly two sources and the page names them; while the orders book is
  unknown, only the entry's own status can rule a line off, and a line says so.
- No control is offered that the gateway cannot honour: the email reminder channel, the
  vendor link on edit and the repeat rule on edit are each rendered disabled or read-only
  with one line of reason.
- A stored value outside the gateway's own enum (production carries `event_type: 'audit'` and
  `status: 'active'`, §9) is **not coerced** — the field is left untouched and the sheet says
  it is holding a value it cannot re-send. Coercing would have rewritten the tenant's record
  under a green save.
- An `all_day` row that still carries a recorded time says both, rather than hiding the time.
- Paging is reported; the first 100 of a busy month is never drawn as the whole month.

**Two directions considered and not built** — the founder decides after seeing the page:

1. **The delivery board.** Demote the grid to a locator and make the primary object a board of
   deliveries by state (expected → in transit → arrived → ruled off). It follows the spine
   argument further than this build does. Not built because a board is not a calendar: you
   cannot answer *"what is Thursday like"* on it, and §1a names the Month/Week/Day/Agenda
   quartet as the thing to keep. Worth a sketch if the founder wants procurement, not time, to
   be the page's subject.
2. **The single-column day book.** Drop the month grid entirely and make the whole page one
   scrolling ledger of days (today's Agenda, promoted), with a month mini-map in the rail.
   Purest expression of "the day is the unit of record", and the most Editorial. Not built
   because planning a week of deliveries needs the 14th and the 21st side by side, which a
   scroll cannot give.

**Substituted, and the fork inside it.** The eight event-type colours are **not** a page
colour system here. ADR 0042 makes the İznik seal the one chromatic colour, and eight hues on
the grid would break it outright. Type colour therefore survives only as a 7px swatch inside
the sheet's type picker — the operator's own record, being edited — while the grid draws
**rank** instead: seal rule for the delivery spine, ink rule for everything else, double rule
for ruled off. The alternative (honour per-type colour on the grid) is more familiar and
would read faster for a tenant with many custom types; it is a real fork and the founder
should judge it against a screenshot rather than a paragraph.

**Left out, and why.** The meeting-memo prompt (collects notes nothing stores, §10); `labels`
(never forwarded to the API, §10); the collapsible sidebar (its two jobs are a select and an
input in the header now). Custom event types are created and deleted here but an event stores
them as `custom` plus the colour — the gateway's `CalendarEventType` enum has no slot for a
custom name, and the sheet says so rather than inventing one.

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
- **Mudavym redesign gate:** feature flag `mudavym_design_calendar` (gateway
  `feature-flag-registry.ts`), with the per-browser override
  `localStorage['mudavym.design.calendar']` = `1|true|on` / `0|false|off`
  (`lib/mudavym/useMudavymDesign.ts`). Off ⇒ `CalendarModular` renders byte-for-byte.
- The rebuilt page keeps no sidebar, so `localStorage['wineops-calendar-sidebar']` is read
  only by the legacy tree.

## 9. Gaps

- ~~**Two calendars are routed**~~ — **closed 2026-08-26.** `/calendar-classic` is
  retired (route, `pages/Calendar.tsx`, `NewEventTypeModal`, `EntityAutocomplete`
  deleted); this is the only calendar. Its one blocking exclusive — reminders that
  actually fire — was ported here first (§10). ADR 0019 §B-parity records the check.
- Phase 30 iCal feed "code scored 10/10 but no external calendar client has ever
  confirmed the feed subscribes" (`v3.0-TECH-DEBT.md:243-245`); the subscribe UI
  lives in Settings and Dashboard, but the untested feed serves this page's data.

### Found while rebuilding the page, 2026-09-02 — all OUTSIDE `pages/calendar/next/**`

Measured against the local gateway running on this branch, pointed at the production
Supabase project (dev-bypass session, `demo@gmail.com`, Meyhouse Palo Alto). Each one is a
one-file change nobody on this page's paths may make:

1. ✅ **CLOSED 2026-09-03 — `?limit=` on `GET /calendar/events` no longer 400s.**
   Was: `GetCalendarEventsQueryDto.page`/`.limit` were `@IsInt()` with **no**
   `@Type(() => Number)`, and the global `ValidationPipe` runs `transform: true`
   **without** `enableImplicitConversion` (`apps/api-gateway/src/main.ts:51-57`), so a
   query string stayed a string and failed the check — every caller was stuck on the
   server's 100-row default (`calendar.service.ts:277`), and the legacy page, which never
   reads `hasMore`, truncated a busy month in silence.
   Fixed at `apps/api-gateway/src/calendar/dto/calendar.dto.ts:328-359`: `@Type(() =>
   Number)` on `page` and `limit`, plus an explicit `@Transform` on the sibling
   `includeRecurring` (`@Type(() => Boolean)` would be wrong — `Boolean("false")` is
   `true`; the transform maps only the two boolean literals and leaves anything else for
   `@IsBoolean()` to reject). Guarded by
   `apps/api-gateway/src/calendar/dto/calendar-query.dto.spec.ts` (10 cases, driving a
   `ValidationPipe` configured exactly as the global one).
   Verified live against the local gateway on :4000, 2026-09-03:
   `?limit=50` → 200 `"limit":50`, `?limit=500` → 200 `"limit":500`, `?limit=abc` → 400
   (`limit must be an integer number`), `?limit=501` → 400 (`must not be greater than
   500`).
   The rebuilt page now requests the page maximum —
   `apps/web/src/pages/calendar/next/useCalendarNextData.ts:108` (`EVENT_WINDOW_LIMIT =
   500`) and `:253` (the query string). Still honest above 500: `@Max(500)` caps the page,
   so the page keeps rendering the server's `hasMore` rather than silently paginating.
2. 🔴 **Production rows carry values the gateway's own enums do not contain** —
   `event_type: 'audit'` and `status: 'active'` were measured on live `calendar_events`
   rows, neither of which is in `CalendarEventType` / `CalendarEventStatus`
   (`calendar.dto.ts:36-59`). `PATCH` validates both with `@IsEnum`, so **any edit that
   echoes the stored value back is refused**, and any UI that coerces it into the enum
   rewrites the tenant's record. The rebuilt sheet refuses to send an untouched
   out-of-enum value; the *fix* is to widen the enums or migrate the rows.
3. 🟠 **`UpdateCalendarEventDto` has no `providerId`, `orderId` or `recurrence`**
   (`calendar.dto.ts:229-296`), and the pipe runs `forbidNonWhitelisted` — so a vendor
   link and a repeat rule can be written at create time and never changed. The legacy page
   hides this by simply dropping the fields (§10); the rebuilt sheet says it.
4. 🟠 **`mapApiEvent` drops half the row** (`services/api/calendar.ts:64-82`): no
   `eventTimeEnd`, `eventDateEnd`, `orderId`, `source`, `reminderEnabled`,
   `reminderDaysBefore`. A calendar that cannot read an end time cannot draw or resize one.
   The rebuilt page carries its own mapper; the shared one still needs fixing for every
   other caller.
5. 🟠 **`getEventTypes` reports absence as health** — when the `calendar_event_types` query
   errors it returns the eight built-ins (`calendar.service.ts:858-885`), so no client can
   tell "this tenant has no custom types" from "the table was unreachable". Exactly the
   ADR 0020 shape.
6. 🟡 **`EventTypeResponseDto` returns `isDefault`; the web type expects `isCustom`**
   (`services/api/calendar.ts:167-174`) — always `undefined`, so every type reads as
   non-custom to the legacy sidebar.
7. 🟡 **`?date=today` becomes an Invalid Date.** `quickActions.ts:81` and
   `Dashboard.tsx:778` link to `/calendar?openModal=true&date=today`;
   `CalendarPage.tsx:236` does `new Date(dateStr)` on it. The rebuilt page handles the
   literal; the legacy one still does not.
8. 🟡 **Four `services/api/calendar.ts` functions call routes that do not exist** —
   `createRecurringEvents` (`POST /calendar/events/recurring`, `:360`),
   `updateRecurringEventOccurrence` (`PATCH /calendar/events/:id/occurrence`, `:376`),
   `fetchEventsByProvider` (`GET /calendar/events/provider/:providerId`, `:347`) and
   `checkEventConflicts` (`GET /calendar/events/conflicts`, `:420` — which the router
   resolves to `events/:eventId`). Compare the controller's route list,
   `calendar.controller.ts:55-629`. Dead on arrival; the missing per-occurrence route is
   why an occurrence is not draggable in the rebuilt page.
9. 🟡 **`scripts/check_no_seeded_defaults.py` does not scan the rebuilt surface.**
   `SCAN_ROOTS` (`:187-197`) has no `apps/web/src/pages/calendar/next` entry, so CI's ADR
   0051 guard is green over this page without looking at it. Verified passing locally by
   running the guard with that root substituted (0 violations); the line still needs adding.

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
9. ~~**Fix the `limit` 400** (§9.1)~~ — **done 2026-09-03**; see §9.1 for the fix, the spec
   and the live verification. What remains is only the >500-event month, which `@Max(500)`
   caps: it would need real pagination, and the page reports `hasMore` instead.
10. **Reconcile the event-type / status enums with the rows that exist** (§9.2). Until then
    no client can safely round-trip an `audit` or `active` row.
11. **Add `providerId` / `orderId` / `recurrence` to `UpdateCalendarEventDto`** (§9.3) so the
    vendor link and the repeat rule stop being write-once.
12. **Add `apps/web/src/pages/calendar/next` to `SCAN_ROOTS`** in
    `scripts/check_no_seeded_defaults.py:187` (§9.9).
13. **Give `getEventTypes` a way to say "unreachable"** rather than returning the built-ins
    over an error (§9.5) — the page already renders the honest branch if the shape appears.
