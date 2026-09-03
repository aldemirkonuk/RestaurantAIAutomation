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
- 🔒 **The job is OFF by default and says so.** It sends nothing until
  `CALENDAR_REMINDERS_ENABLED=true` is set on the gateway, and the page renders "The reminder
  job is built but not switched on" with the flag name rather than implying it is sending.
  Not gated on the Mudavym design flag: a design flag decides what a page looks like, not
  whether a house gets woken up. **Arming it is the founder's call**
- ✅ **Reminders are sent by the server** (2026-09-03, [ADR 0109](../decisions/0109-a-reminder-is-the-houses-job-not-the-browsers.md)).
  A 15-minute per-tenant cron reads `reminder_enabled` / `reminder_days_before`, writes through
  `persistForRestaurant` (inbox row + socket + mobile push) and stamps `reminder_sent` —
  the column that had no writer anywhere in the repo until this build
- ✅ **The reminder rows show the job's own account of itself**: last actual run with its
  counts (`4 due, 3 sent, 1 held for quiet hours`), the next scheduled tick, how many entries
  are still waiting, and — the load-bearing one — **whether the scheduler serves this
  restaurant at all** (it enumerates opted-in tenants, ADR 0022), so a house it does not serve
  is told "No reminder will be sent" instead of being shown a next-run time
- ✅ **Quiet hours are honoured per person**, on the *restaurant's* clock: a member inside
  their window is held until it closes, not dropped, and holding one member never delays or
  duplicates another's — the claim is per (entry, person)
- 🔒 **Offsets are whole days only** — `reminder_days_before` is an INTEGER of days, so the
  sheet offers *On the day / 1 day / 2 days / 1 week* and says why, rather than offering
  minutes and rounding them into a value nobody chose (§13)
- 🔒 **The email channel is still rendered disabled** with the reason — the job writes the
  inbox row and the push; mail needs a recipient policy of its own
- 🔒 **A client-expanded recurring occurrence gets no reminder** — it is not a row, so there
  is nothing to key a dispatch on; materialised occurrences are reminded normally (§13)
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

### Third pass, 2026-09-03 — the reminder becomes the house's job

**What the founder asked.** "Server-side calendar reminders" as one of the four large builds:
a cron under the existing per-tenant scheduler that reads `reminder_enabled` /
`reminder_days_before`, writes through `persistForRestaurant`, stamps `reminder_sent`, honours
quiet hours and never sends twice; the page's reminder rows to stop saying "on this browser"
and show last/next run; the localStorage scheduler retired or demoted with a stated fallback.

**What was built.** [ADR 0109](../decisions/0109-a-reminder-is-the-houses-job-not-the-browsers.md).

| Piece | Where |
|---|---|
| The cron | `apps/api-gateway/src/calendar/calendar-reminders.service.ts` — `@Cron("*/15 * * * *")` → `ScheduledTenantsService.runPerTenant("calendar-reminders", …)` |
| The arithmetic | `apps/api-gateway/src/calendar/reminder-window.ts` — due time and quiet hours in the *restaurant's* zone, DST-correct, pure and separately tested |
| The status read | `GET /calendar/reminders/status` (`calendar.controller.ts`, route `reminders/status`) → `statusFor` |
| The ledger | `supabase/migrations/20260903101500_calendar_reminders_have_a_ledger.sql` — `calendar_reminder_dispatches` + `calendar_reminder_runs`, RLS on, service-role only, in-file assertions |
| The register | `apps/web/src/pages/calendar/next/ReminderRegister.tsx`, rendered by `EventSheet.tsx` |
| The standing line | `CalendarNext.tsx` `reminderLine` — the footer sentence is now drawn from the job's status, not asserted |

**The one structural idea.** *Idempotency is a database index, not a boolean.* Every send is
preceded by an INSERT into `calendar_reminder_dispatches`, whose UNIQUE `(calendar_event_id,
user_id)` index is the key. Two gateway instances cannot both win the insert, so they cannot
both send — and because the claim is per **person**, quiet hours stop being a coordination
problem: a member inside their window simply is not claimed this tick, and the next sweep after
the window closes serves exactly them. `reminder_sent` becomes the roll-up it was named for
(written for the first time in this repo's history) and is never the thing preventing a second
send. The spec proves this the hard way: it unsets `reminder_sent` and sweeps again, and
nothing goes out.

**Honesty applied.** Four sentences the page is now able to say, none computed in the browser:

1. *Whether the job serves this house at all.* The cron enumerates opted-in tenants (ADR 0022),
   so for a restaurant it does not serve there is no next run to promise — `served: false`
   carries the reason (the one INSERT that opts it in), and the sheet says "No reminder will be
   sent."
2. *When it last actually ran*, beside the next scheduled tick. A schedule is not evidence that
   a process is alive.
3. *"Never run" is separated from "the ledger could not be read"* (`ledgerReadable`). Both are
   an empty `lastRun`; only one of them means the job has nothing to report. Measured live: the
   local gateway points at production, where the two new tables do not exist yet, and the
   endpoint correctly returned `ledgerReadable: false` rather than "this job has never run".
4. *A claim that was never confirmed is not a send.* A crash between claim and notification
   leaves `sent_at` NULL, and the status endpoint reports those rows as exactly that. A funnel
   that wrote nothing is a failure, and the claim is released so the next sweep retries.

**The fork the founder has to settle: arming it.** The job is written, tested and wired, and
it is **off**. `CALENDAR_REMINDERS_ENABLED` is an env allow-list (only `true`/`1`), copied from
`RECURRING_ORDER_REMINDERS_ENABLED` (`communications/recurring-order-reminder.ts:20`) for the
same reason: a typo should produce silence, not a live sender. It is deliberately NOT the
Mudavym design flag — turning a page's new look on must not start writing to every member's
phone. What arming it does, measured: `GET /calendar/reminders/status` against production on
2026-09-03 returned `served: true, armed: false, pending: 0`, so flipping it today sends
nothing retroactively and starts sending for entries created from then on.

**The two alternative directions not built** — the founder decides after seeing the page:

- **Sub-day reminders.** The obvious ask is "15 minutes before", and it is not representable:
  `reminder_days_before` is an INTEGER of days. The alternative was a
  `reminder_minutes_before` column plus DTO, service, mapper and UI changes, which is a second
  build. What shipped offers whole days and says why; §13 carries the column.
- **Email as a real channel.** The job could mail as well as write the inbox row, but "who gets
  it" is a decision: `RecipientResolverService` still falls back to a global env address for
  the legacy tenant (`communications/scheduled-tasks.service.ts:120-146`), and mailing the
  wrong house is the defect ADR 0022 spent its length preventing. The tick stays disabled with
  that reason.

**Substituted or left out.** The browser scheduler is **demoted, not deleted**: `main.tsx:20`
still boots it, because `main.tsx` is shared and the shipping page must render byte-for-byte
with the flag off. Nothing in `pages/calendar/next/**` enqueues into it any more, and the sheet
cancels an entry's browser-queued copies whenever it saves that entry
(`EventSheet.tsx` `clearBrowserQueue`), so anything the redesign touches has exactly one
sender. The residue is named in §9: an entry created on the legacy page and never opened here
can still fire twice.


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
| GET | `/calendar/reminders/status` | `useCalendarNextData` (`pages/calendar/next/useCalendarNextData.ts` `reminderQ`) → `calendar.controller.ts` route `reminders/status`; built by `calendar-reminders.service.ts` `statusFor` |
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
- **Server-side reminders have their own switch, and it is not the design flag.**
  `CALENDAR_REMINDERS_ENABLED` (env, allow-list: only `true`/`1` arm it) — off by default,
  so the cron returns before it reads a row. The Mudavym flag gates only the *rendering* of
  the job's status. Once armed, which restaurants it serves is ADR 0022's question: one row
  in `restaurant_feature_flags` (`flag_name = 'scheduled_communications'`, `enabled = true`)
  or being `DEFAULT_RESTAURANT_ID`. **Measured against production on 2026-09-03:**
  `served: true, armed: false, pending: 0` — Meyhouse would be served, nothing is armed, and
  no entry currently qualifies, so arming it today sends nothing retroactively.
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

### Found while building the server-side reminder job, 2026-09-03

1. 🟠 **The legacy browser scheduler is still booted for everyone.**
   `apps/web/src/main.tsx:20` calls `startReminderScheduler()`
   unconditionally, so the localStorage poller runs whether or not the Mudavym
   flag is on. It is demoted rather than removed because `main.tsx` is shared and
   the shipping page must render byte-for-byte with the flag off (ADR 0109).
   **The residue:** an entry created on the *legacy* page, never opened in the
   rebuilt sheet, whose reminder is due, can fire twice — once from that browser
   and once from the cron. Every path the redesign touches is closed: nothing in
   `pages/calendar/next/**` enqueues, and `EventSheet.tsx` `clearBrowserQueue`
   cancels an entry's browser-queued copies on save. **Why not yet:** deleting the
   boot is one line, but it belongs to whoever retires the legacy calendar — doing
   it here would change the shipping page's behaviour from inside a flagged build.
2. 🟠 **Quiet hours mean two different things in the two runtimes.** The
   orchestrator's `_is_quiet_hours` compares the window against `datetime.now()`
   — the *process's* local time
   (`services/agent-orchestrator/agents/notification_agent.py:1487-1512`), so a
   22:00–08:00 window means 22:00 wherever the container runs. The new gateway
   job evaluates the same three columns on the *restaurant's* clock
   (`calendar/reminder-window.ts`). The gateway's reading is the correct one for a
   house in Istanbul; the two should be reconciled, and the orchestrator is
   outside this page's paths. **Why not yet:** it is a Python change in a service
   this build does not own.
3. 🟡 **`notification_preferences` has no per-user timezone**, so "the reader's
   quiet hours" are necessarily read on the restaurant's clock, not the reader's.
   For a single-site house those are the same; for a manager travelling they are
   not. Stated on the row (the window is shown with the zone beside it) rather
   than silently assumed.
4. 🟡 **`generation_horizon_days: 90` is a gateway-written measurement.**
   `calendar.service.ts:484` writes a literal horizon onto every
   `calendar_recurrence_rules` row that no caller supplied. Measured by running
   `scripts/check_no_seeded_defaults.py` with `apps/api-gateway/src/calendar`
   added to `SERVER_SCAN_ROOTS`: 1 violation, exactly this line. Pre-existing and
   unrelated to reminders. **Why not yet:** changing it changes how far ahead
   recurring occurrences are generated, which is a behaviour decision, not a
   cleanup.
5. 🟡 **`apps/api-gateway/src/calendar` is not in `SERVER_SCAN_ROOTS`**
   (`scripts/check_no_seeded_defaults.py:220-223`), so CI's ADR 0051 guard is
   green over this module without reading it. Verified by hand with the root
   substituted (finding 4 is what it says); the line still needs adding, and
   `scripts/` is outside this build's paths.
6. ✅ **`apps/web/src/pages/calendar/next` IS now in `SCAN_ROOTS`**
   (`check_no_seeded_defaults.py:202`) — the §9.9 gap filed on 2026-09-02 is
   closed, and the guard passes over this directory having actually read it.


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

**Reminders are sent by the server as of 2026-09-03** ([ADR 0109](../decisions/0109-a-reminder-is-the-houses-job-not-the-browsers.md)).
`CalendarRemindersService` (`apps/api-gateway/src/calendar/calendar-reminders.service.ts`)
runs every 15 minutes under `ScheduledTenantsService.runPerTenant`, reads
`reminder_enabled` / `reminder_days_before`, claims one row per (entry, person) in
`calendar_reminder_dispatches` — whose UNIQUE `(calendar_event_id, user_id)` index is
what makes a double send impossible — writes the durable notification through
`NotificationsService.persistForRestaurant`
(`apps/api-gateway/src/notifications/notifications.service.ts:608-728`), and then stamps
`calendar_events.reminder_sent` / `.reminder_sent_at`. **That column had no writer anywhere
in `apps/` or `services/` until this build**; it was read once, at
`calendar/calendar.service.ts:1118`, and written nowhere.

What the previous paragraph said is still true of the *legacy* page: `syncEventReminders`
(`apps/web/src/pages/calendar/CalendarPage.tsx:64-84`) pushes into the `localStorage` queue
(`lib/reminder-scheduler.ts:9,82`) drained by the poller booted at `main.tsx:20`. That
scheduler is **demoted, not deleted** — see §9 finding 1 for the exact residue and why the
boot was left alone.

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
| POST | `/notifications` | JWT (class, `notifications.controller.ts:45`) | `:61-82` | Durable row — the *legacy* browser scheduler's write path (`reminder-scheduler.ts:193`). The server job does not use it; it writes through `persistForRestaurant` directly |
| GET | `/calendar/reminders/status` | JWT (class) | `calendar.controller.ts`, route `reminders/status` | The reminder job's last run, next scheduled tick, whether this restaurant is served, and the reader's quiet window |
| GET | `/calendar/feed/:token.ics` | **`@Public()`** — bearer is the 64-char token in the path (`:586-587`) | `:596-606` | iCal text |

### Fed by

| Data | Producer | Live? |
|---|---|---|
| Manually created events | This page and the command palette (`commands.ts:93`) | Yes |
| Provider/order-linked events | `calendar_agent` (`AgentTier.CORE`, `services/agent-orchestrator/core/agent_registry.py:83-87`); its LLM date extraction was repaired under ADR 0010 / OD-63 | Agent yes — but its output table `provider_important_dates` **does not exist in production** (OD-63 resolution, now **OD-68**), so the extracted dates have nowhere to land |
| Reminder firing | `calendar/calendar-reminders.service.ts` — `@Cron("*/15 * * * *")` under `runPerTenant` (ADR 0109) | **Yes, server-side.** Writes the inbox row via `persistForRestaurant`, stamps `reminder_sent` / `reminder_sent_at`, logs a `calendar_reminder_runs` row per tenant per sweep. `lib/reminder-scheduler.ts` is demoted to draining what the legacy page queued (§9.1) |
| Meeting memos | **none** | No |
| iCal subscribers | External calendar clients | **Never observed to work** (`v3.0-TECH-DEBT.md:243-245`) — see settings.md §10 for the concrete suspect |

### Writes

| Write | Downstream reaction |
|---|---|
| Event create/update/delete | `/team`'s ManagerShiftDesk overlays the same events (`ManagerShiftDesk.tsx:17`); `/documents-reports` subscribes to calendar realtime and toasts (`DocumentsPage.tsx:157-170`) |
| Reminder fire (server) | A durable `notifications` row for every intended member + socket emit + Expo push (`persistForRestaurant`), a `calendar_reminder_dispatches` claim row per (entry, person), and `calendar_events.reminder_sent` / `.reminder_sent_at` stamped |
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

1. ~~Reminders read as a property of the event; they are a property of the browser.~~
   **Fixed 2026-09-03** on the rebuilt page (ADR 0109): a reminder is now a property of the
   event, sent by a server cron, and the sheet shows the job's last run, next run and whether
   this restaurant is served. Still true of the legacy page.
2. The `email` channel toggle has no effect and does not survive a reopen
   (`CalendarPage.tsx:335`).
3. The meeting-memo prompt asks for notes it discards.
4. Editing a multi-day or recurring event quietly loses those properties.
5. The iCal copy in Settings promises Outlook/Apple/Google (`Settings.tsx:207`) for a
   feed nobody has seen subscribe.

## 13. Roadmap

1. ~~**Move reminders server-side.**~~ — **done 2026-09-03**
   ([ADR 0109](../decisions/0109-a-reminder-is-the-houses-job-not-the-browsers.md)); see §1b
   third pass and §10. What remains of it is items 14-16 below.
2. **Honour or remove the `email` channel** (`EventModal.tsx:376`, `CalendarPage.tsx:335`).
   Now unblocked on the honour path — the cron exists — but it needs a recipient policy:
   `RecipientResolverService` still falls back to a global env address for the legacy tenant
   (`communications/scheduled-tasks.service.ts:120-146`), and mailing the wrong house is what
   ADR 0022 exists to prevent. The rebuilt sheet renders the tick disabled with that reason.
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
14. **Add `reminder_minutes_before` to `calendar_events`** so "15 minutes before" is
    representable. `reminder_days_before` is an INTEGER of days
    (`20260805000000_baseline_from_production.sql:2358`), so the rebuilt sheet offers whole
    days only and says why. Needs the column, `Create`/`Update` DTO fields, the mapper, and one
    branch in `reminder-window.ts` `reminderDueAt`.
15. **Remind materialised recurring occurrences only, or materialise on write.** A series
    expanded client-side (`lib/calendar/recurrence.ts`) is one row, so its occurrences carry no
    id to key a dispatch on and get no reminder. Either generate occurrences server-side at
    create time, or add an occurrence key to `calendar_reminder_dispatches` — the second is
    cheaper and the first is more honest.
16. **Delete `startReminderScheduler()` from `apps/web/src/main.tsx:20`** when the legacy
    calendar is retired (§9.1). Until then an entry created on the legacy page and never opened
    in the rebuilt sheet can be reminded twice.
17. **Add `apps/api-gateway/src/calendar` to `SERVER_SCAN_ROOTS`** in
    `scripts/check_no_seeded_defaults.py:220` (§9.5), and fix the one thing it finds
    (`generation_horizon_days: 90`, §9.4).
18. **Reconcile quiet hours between the two runtimes** (§9.2) — the orchestrator reads them on
    the process's clock, the gateway on the restaurant's.
19. **Arm the job.** `CALENDAR_REMINDERS_ENABLED=true` on the gateway. Everything else is
    built and tested; this is the founder's switch. Before flipping it, check
    `GET /calendar/reminders/status` on the target deployment: `served` says whether ADR 0022
    enumerates that restaurant, and `pending` says how many entries would come due.
