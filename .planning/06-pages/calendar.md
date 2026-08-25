---
type: page
route: /calendar
slug: calendar
component: apps/web/src/pages/CalendarModular.tsx
audience: owner
tier: core
signals_today: none
rebrand_strings: 0
status: documented
updated: 2026-08-25
links: ["[[PAGE-CONTRACT]]"]
---

# /calendar — Calendar (modular)

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

## 2. Entry

- Sidebar "Calendar" (`components/layout/Sidebar.tsx:108`).
- From `/` ([PAGE_MAP](../foundation/PAGE_MAP.md):61; in-degree 1, :147).
- Command palette `g c` plus "Add calendar event" which deep-links
  `/calendar?openModal=true` (`components/command/commands.ts:63,79,93`).

## 3. Files

- Route binding: `apps/web/src/App.tsx:277` (lazy import :101).
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

- **Two calendars are routed**: this one and `/calendar-classic` (calendar-classic.md
  §9) — no ADR decides the classic page's retirement.
- Phase 30 iCal feed "code scored 10/10 but no external calendar client has ever
  confirmed the feed subscribes" (`v3.0-TECH-DEBT.md:243-245`); the subscribe UI
  lives in Settings and Dashboard, but the untested feed serves this page's data.
