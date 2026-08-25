---
type: page
route: /calendar-classic
slug: calendar-classic
component: apps/web/src/pages/Calendar.tsx
audience: owner
tier: core
signals_today: none
rebrand_strings: 0
status: documented
updated: 2026-08-25
links: ["[[PAGE-CONTRACT]]"]
---

# /calendar-classic — Calendar (superseded monolith)

## Surface — buttons → where they go

- **New Event / click a day** → (create-event modal on this page)
- **Event click** → (detail/edit modal on this page)
- **New event type** → (custom-type modal on this page)
- **Save with reminder** → API `createNotification` (client-scheduled reminder)
- (no outbound navigation — dead-end page)

## 1. Purpose

The previous single-file calendar, kept routed after the modular calendar took over
`/calendar`. Month-grid CRUD with custom event types, client-scheduled reminders and
entity autocomplete — the same domain as `/calendar`, rendered the old way.

## 2. Entry

**No inbound link.** Listed as a cold entry point in
[PAGE_MAP](../foundation/PAGE_MAP.md):111; a repo grep for `calendar-classic`
matches only the route definition. Typed URL only.

## 3. Files

- Route binding: `apps/web/src/App.tsx:278` (lazy import :100).
- `apps/web/src/pages/Calendar.tsx` (2,345 lines).
- Distinct pieces the modular page does not use: `data/customEventTypes.ts`
  (localStorage event types, Calendar.tsx:32), `lib/reminder-scheduler.ts` (:35),
  `components/calendar/NewEventTypeModal.tsx` (:33),
  `components/shared/EntityAutocomplete.tsx` (:37).

## 4. Endpoints

Atlas rows: [ENDPOINTS](../foundation/ENDPOINTS.md):87 (`calendar`), :300
(`notifications`), :461 (`providers`).

| Method | Path | Call site |
|---|---|---|
| GET/POST/PATCH/DELETE | `/calendar/events` family | hooks (Calendar.tsx:29) → `services/api/calendar.ts:221-273` |
| GET | `/providers` | `useProviders` (Calendar.tsx:29) → `providers.ts:201` |
| POST | `/notifications` | reminder + event notices, `Calendar.tsx:923,1011` → `services/api/notifications.ts:222` |
| POST | `/notifications` (via reminder scheduler) | `lib/reminder-scheduler.ts:152` after a browser `Notification` attempt (:139) |

## 5. Signals

**None.** No tracking, no `data-ux-key`; reporter dark (`lib/uxSignals.ts:15`).

## 6. Tier cut

**Core** — same shared-furniture position as `/calendar` (calendar.md §6), but as
the superseded rendering.

## 7. Rebrand surface

**0 user-visible strings** (no `wineops` hits in the file). Layout chrome per
dashboard.md §7.

## 8. State & config

- Custom event types live **only in localStorage** (`data/customEventTypes.ts:14-62`)
  — per-browser, not per-restaurant; they do not sync anywhere.
- Reminders are client-side `setTimeout` + browser Notification with a server
  notification fallback (`lib/reminder-scheduler.ts:126-187`) — they fire only while
  a tab is open.
- Realtime events subscription (`Calendar.tsx:34`).

## 9. Gaps

- **Superseded but undecided**: `/calendar` ships the modular replacement
  (`CalendarModular.tsx:1-9`) and nothing links here; there is no ADR retiring this
  page — same shape as `/inventory-legacy` (inventory-legacy.md §9).
- localStorage-only custom event types and tab-bound reminders (§8) are silent data
  loss on device change; not recorded in `v3.0-TECH-DEBT.md` (checked — no entry).
