---
type: page
route: /notifications
slug: notifications
component: apps/web/src/pages/Notifications.tsx
audience: owner
tier: core
signals_today: none
rebrand_strings: 0
status: documented
updated: 2026-08-24
links: ["[[PAGE-CONTRACT]]"]
---

# /notifications — Notifications

## 1. Purpose

"Alerts that need a decision, oldest first" (`components/layout/Sidebar.tsx:146`).
The durable-notification inbox: read/unread/archive/delete, stacked digests that
live-update while the page is open (10s poll, `Notifications.tsx:157-163`), a detail
panel that stays in sync with refreshes (:192-200), the One-Tap Action Center, and a
"create custom one-tap action" modal.

## 2. Entry

- Sidebar with unread badge (`Sidebar.tsx:144,410`).
- Header bell → `navigate('/notifications')`, optionally carrying a
  `selectedNotificationId` to auto-open the detail panel
  (`components/layout/Header.tsx:191,226`; consumed `Notifications.tsx:184-189`).
- Command palette `g n` (`components/command/commands.ts:65,83`).
- [PAGE_MAP](../foundation/PAGE_MAP.md):119 lists it as no-inbound — the scan missed
  layout components; sidebar + bell are the real entries.

## 3. Files

- Route binding: `apps/web/src/App.tsx:284` (lazy import :99).
- `apps/web/src/pages/Notifications.tsx` (1,807 lines).
- Rendered: `components/notifications/OneTapActionCenter.tsx` (:731);
  digest-stacking via `lib/notificationStack.ts` (:41).

## 4. Endpoints

Atlas row: [ENDPOINTS](../foundation/ENDPOINTS.md):300 (`notifications`, 24 —
**⚠ all unguarded**), plus :389 for the action center's order reads.

| Method | Path | Call site |
|---|---|---|
| GET | `/notifications?userId=&status=` | `useNotifications` (Notifications.tsx:157) → `services/api/notifications.ts:101` |
| PATCH | `/notifications/:id/read`, `/:id/unread`, `/:id/archive` | hooks (:165-168) → `notifications.ts:133,141,163` |
| PATCH | `/notifications/read/all?userId=` | `useMarkAllNotificationsAsRead` → `notifications.ts:156` |
| DELETE | `/notifications/:id` | `useDeleteNotification` → `notifications.ts:171` |
| GET | `/procurement/orders/pending` (+ list) | OneTapActionCenter → `services/api/orders.ts:206,217` |

## 5. Signals

**None.** The page *consumes* the notification signal spine (memory:
notifications-batching-sync — edge-instant + batched digests) but emits nothing
about its own use; no `uxSignals` (dark, `lib/uxSignals.ts:15`), no `data-ux-key`.

## 6. Tier cut

**Core** — operate. The durable low-stock notification is the ✅ S10 Core row
([TIER-MAP](../03-scenarios/TIER-MAP.md):46); S02/S03 mismatch alerts also land here.

## 7. Rebrand surface

**0 user-visible strings** in the page tree. Shared: OneTapActionCenter's
`wineops_*` localStorage keys are invisible (`OneTapActionCenter.tsx:80-83`);
its QuickGmailModal shows "WineOps AI" in email previews
(`components/emails/QuickGmailModal.tsx:129,145,153,189,200`). Layout chrome per
dashboard.md §7.

## 8. State & config

- 10-second poll while mounted (`Notifications.tsx:162-163`) — the only page that
  polls notifications rather than waiting for realtime.
- Snoozes/pending one-tap actions persist in localStorage via the shared center
  (`OneTapActionCenter.tsx:80-83`).

## 9. Gaps

- **Custom one-tap actions do not persist**: created into `useState` only
  (`Notifications.tsx:173,575`), rendered at :693-700, gone on refresh. The
  UX-catalog claim "created quick actions never rendered" is therefore *partly*
  stale — rendering shipped, persistence did not (`v3.0-TECH-DEBT.md:389-390`).
- All 24 notification endpoints unguarded ([ENDPOINTS](../foundation/ENDPOINTS.md):300).
- Agent-side notification writes were silently failing until 44.1d's fix — history
  in `v3.0-TECH-DEBT.md:95-131`; worth remembering when interpreting old gaps in
  this inbox.
