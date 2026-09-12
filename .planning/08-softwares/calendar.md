---
type: software
slug: calendar
name: Calendar
division: restaurant
status: partial
tier: core
routes: ["/calendar", "/calendar-classic"]
pages: [calendar]
api_modules: [calendar, events]
agents: [calendar_agent]
owner_unit: messaging-delivery
updated: 2026-09-01
links: ["[[calendar]]", "[[notifications]]", "[[dashboard-home]]", "[[messaging-delivery-charter]]", "[[SOFTWARE-MAP]]"]
---

# Calendar

## §0 What it is

The operating calendar for a restaurant: deliveries arriving, tastings, vendor meetings,
whatever else has a date on it. You can see it as a month, a week, a day or a list, drag
an event to move it, click an empty slot to make a new one, and set something to repeat.
You can subscribe to it from your phone's own calendar app. Anything it needs to nudge you
about lands in [[notifications]].

## §1 Features today

- See events as Month, Week, Day or Agenda
- Click an empty slot to create an event; drag to move or resize one
- Full event editing, including recurring events (RRULE) and per-occurrence exceptions
- Create and manage your own event types, saved on the server
- Link an event to a vendor
- Mark an event's status (done, cancelled, and so on)
- Subscribe from an external calendar app via an iCal feed URL, with a regenerable token
- Set reminders per event — *partial* (fires only in the browser that set it)
- Choose an email reminder channel — *dark* (the tick is accepted, nothing sends)
- Label an event — *dark* (labels trigger the memo prompt, then are dropped)
- Capture a meeting memo after a vendor meeting — *broken* (the save handler stores nothing)

## §2 Screens

- [[calendar]] — the whole software; route `/calendar` at `apps/web/src/App.tsx:306`,
  **not** behind `PageGate`. `apps/web/src/pages/CalendarModular.tsx` is a 26-line wrapper
  around `pages/calendar/` (13 files: `CalendarPage`, `CalendarMonth/Week/Day/Agenda`,
  `EventModal`, `EventCard`, `CalendarSidebar`, `DragDropProvider`, `MeetingMemoPrompt`,
  `useCalendarPage.ts`).
- `/calendar-classic` is a redirect to `/calendar` (`App.tsx:310`); the second calendar it
  used to serve was deleted 2026-08-26 after its one blocking exclusive — reminders that
  actually fire — was ported across (ADR 0019 §B-parity).

## §3 Backend

**`apps/api-gateway/src/calendar/`** — `@Controller("calendar")` at
`calendar.controller.ts:44`, **19 endpoints**, class-level `JwtAuthGuard`.

| Group | Endpoints | Lines |
|---|---|---|
| Events CRUD | `POST/GET /events`, `GET/PATCH/DELETE /events/:eventId` | `:55,94,121,152,189` |
| Recurrence | `POST /recurrence/:ruleId/generate`, `GET /recurrence/:ruleId`, `GET/DELETE /events/:eventId/recurring` | `:231,268,457,501` |
| Event types | `GET /event-types/:restaurantId`, `POST /event-types`, `PATCH/DELETE /event-types/:id` | `:306,331,360,392` |
| Status & views | `PATCH /events/:eventId/status`, `GET /upcoming`, `GET /today` | `:418,539,562` |
| iCal | `GET /feed/:token.ics`, `GET /ical-token`, `POST /ical-token/regenerate` | `:586,609,624` |

**`apps/api-gateway/src/events/`** — `@Controller("events")` at `events.controller.ts:25`,
**3 endpoints** (`POST /`, `GET /`, `GET /metrics`). This is **not** the calendar's
storage. It is the product-telemetry stream — `event_type`, `source_page` (a Postgres
enum), `idempotency_key`, `trace_id`, `correlation_id` (`events.service.ts:12-24`;
`source_page` enum at
`supabase/migrations/20260805000000_baseline_from_production.sql:240-253`). The calendar
uses it as a **cross-device sync channel**: `dispatchCalendarEvent` broadcasts a window
event and then `persistEvent('calendar_event', 'calendar', …)`
(`apps/web/src/contexts/RealtimeContext.tsx:429-444`). Shared with [[dashboard-home]],
which reads the same table for its activity feed.

## §4 Automation

`calendar_agent` — **dormant**. `services/agent-orchestrator/agents/calendar_agent.py`
(405 lines) is registered in the orchestrator (`core/orchestrator.py:187`) and subscribes
to exactly two routing keys: `procurement.conversation.completed` and
`system.schedule.daily_check` (`:75-79`). **Neither has a publisher anywhere in `apps/` or
`services/`** — grep across both trees returns only the agent's own subscription line and
its dispatch branch. Its LLM date-extraction and upcoming-event check have never been
reachable in the running system.

**No server-side reminder cron exists.** `reminder_sent` is read at
`calendar/calendar.service.ts:1118` and has **no writer** anywhere in `apps/` or
`services/`. The `@Cron("*/15 * * * *")` in `communications/scheduled-tasks.service.ts`
sweeps `custom_reminders`, a **different** table with no UI in the web app; since
2026-08-26 (OD-87 / ADR 0022) it runs per opted-in tenant rather than once against the
default restaurant, and the table is empty in production.

## §5 Data

From `calendar/calendar.service.ts`: `calendar_events`, `calendar_event_types`,
`calendar_recurrence_rules`, `calendar_recurrence_exceptions`, and `restaurants` (read,
for the iCal token). `events/events.service.ts` writes `events` — **shared, not owned**.

Owned outright: the four `calendar_*` tables.

## §6 Owner

[[messaging-delivery-charter]] — team `messaging-delivery`, department `engineering`,
division Platform.

The charter's boundary table names both modules by path and route count —
`apps/api-gateway/src/calendar` (19) and `events` (3) — and its mandate sentence lists
*"calendar invites"* among the transport surfaces it owns
(`messaging-delivery-charter.md:20,40-41`). The route counts match this file exactly, so
the claim is current, not inherited.

The seam the charter draws is the useful one here: it owns *whether a message arrives
exactly once*, **not** what the message says (`:20-22`). That places the reminder-delivery
defect in §7 squarely inside its mandate, and the meeting-memo drop outside it — nobody
owns that.

## §7 Maturity & seams

**partial.** The event spine is genuinely complete; everything layered on top of it leaks.

Real: create, read, update, delete, drag-move, resize, RRULE recurrence, per-occurrence
exceptions and custom event types all reach guarded endpoints
(`calendar.controller.ts:44-45`, routes `:55-539`) and persist.

**Reminders fire, but only in one browser.** `syncEventReminders`
(`pages/calendar/CalendarPage.tsx:64-84`) pushes each reminder into a `localStorage` queue
(`lib/reminder-scheduler.ts:9,82`) drained by a poller booted in `main.tsx:20`; on fire it
raises a browser `Notification` and writes a durable row via `POST /notifications`
(`reminder-scheduler.ts:176-200`). The module states the constraint in its own header:
*"the calendar API only stores a `reminderEnabled` flag plus `reminderDaysBefore`, and
nothing server-side reads either column"* (`CalendarPage.tsx:55-63`). A reminder set on
the office laptop does not exist on the phone, and none fires with the app closed.

Still collected and discarded:

| Collected | Dropped at | Consequence |
|---|---|---|
| Meeting memo — doc type, notes, labels (`MeetingMemoPrompt.tsx:94`) | `handleMemoSave = useCallback((_memo) => { /* Future: persist to documents API */ setMemoPromptOpen(false) }, [])` (`CalendarPage.tsx:325-328`, still current) | The prompt fires *because* the event was labelled a vendor meeting, asks for notes, and closes. Nothing is stored. The one outright hollow surface here |
| `email` reminder channel | Create defaults to `['in_app','email']` (`EventModal.tsx:376`); the scheduler sends in-app + browser only; reading back **hardcodes** `['in_app']` (`CalendarPage.tsx:335`) | Ticking "email" changes nothing, and the tick vanishes on reopen |
| `labels` (`EventModal.tsx:522`) | Not forwarded to create/update; `buildCreatePayload` has no such field (`services/api/calendar.ts:105-121`) | Labels live only long enough to trigger the memo prompt |
| `multiDay` / `eventDateEnd`, and `recurring` on **edit** | Absent from the update branch (`CalendarPage.tsx:253-270`); present on create (`:284`) | Editing a multi-day or recurring event silently flattens it |

Seams:

1. **A dormant agent shadowing a live surface.** `calendar_agent` exists, is registered,
   and can never run. It is not a stub — 405 lines of real logic behind two dead routing
   keys.
2. **`events` is borrowed.** The calendar's cross-device sync rides a telemetry stream
   owned by the same team but shaped for a different purpose. A change to the
   `source_page` enum or the dedup rule is a calendar change nobody would label as one.
3. **The iCal feed is unproven.** Phase 30 scored the code 10/10 but *"no external calendar
   client has ever confirmed the feed subscribes"* (`v3.0-TECH-DEBT.md:243-245`), and the
   subscribe UI lives on [[dashboard-home]] and Settings, not here.
4. **No server-side reminder path at all.** Until one exists, "reminders" is a
   single-browser feature described as a product feature.

## §8 Where it's going

- ADR 0049 §3a places `calendar` under **Restaurant** and `events` under
  **Platform/Admin** (`.planning/04-specs/ECOSYSTEM-PLAN.md:54,59`); no E-phase names
  either.
- A server-side reminder writer is the single change that would make reminders true
  cross-device — it needs a writer for `reminder_sent` and a cron, both absent.
- Either wire `handleMemoSave` to the documents API or stop asking for the memo; the
  current state collects input and discards it, which is worse than not asking.
- `calendar_agent`'s two dead routing keys are a decision, not a bug: publish them, or
  retire the agent. Nothing records which.
