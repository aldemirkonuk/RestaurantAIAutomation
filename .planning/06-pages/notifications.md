---
type: page
route: /notifications
slug: notifications
component: apps/web/src/pages/Notifications.tsx
audience: owner
tier: core
signals_today: none
rebrand_strings: 0
maturity: partial
status: documented
updated: 2026-08-25
links: ["[[PAGE-CONTRACT]]", "[[orders]]", "[[inventory]]"]
---

# /notifications — Notifications

## Surface — buttons → where they go

- **Notification row / Take Action** → route from the notification's `actionUrl` (varies by type)
- **Review & Approve Draft** (draft_ready detail) → [[orders]] `/orders?draft=<conversationId>`
- **Mark all as read** → API `PATCH /api/v1/notifications/read/all`
- **Settings** → (in-page tab, `/notifications?tab=settings`)
- **One-tap action "Open"** → [[inventory]] `/inventory` or [[orders]] `/orders` by action type; gmail actions point at `/emails` (no such route)
- **Copy link** → clipboard deep link back to this page

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

Atlas row: [ENDPOINTS](../foundation/ENDPOINTS.md):300 (`notifications`, 24 — atlas's
**⚠ all unguarded** is stale; guarded at class level since 2026-08-25 (#60),
`apps/api-gateway/src/notifications/notifications.controller.ts:45`), plus :389 for
the action center's order reads.

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
- All 24 notification endpoints are guarded since 2026-08-25 (#60) — `@UseGuards(JwtAuthGuard)`
  at class level (`apps/api-gateway/src/notifications/notifications.controller.ts:45`);
  the atlas row ([ENDPOINTS](../foundation/ENDPOINTS.md):300) still reads "unguarded" and is stale.
- Agent-side notification writes were silently failing until 44.1d's fix — history
  in `v3.0-TECH-DEBT.md:95-131`; worth remembering when interpreting old gaps in
  this inbox.

## 10. Maturity

**partial.** The inbox itself is real and has more live producers than any other page
in this cluster. Two named capabilities are absent or fake.

**Real.** `notifications` rows are written by seven distinct producers across the
gateway — team broadcast (`team/team.controller.ts:350`), schedule publish and
acknowledge (`team/schedule.service.ts:254,484`), procurement
(`procurement/procurement.service.ts:1062,1368`), the low-stock engine
(`notifications/low-stock-alerts.service.ts:305,347`), the inbound autonomous
responder (`common/orchestrator/inbound-responder.service.ts:1287`), and the
scheduled-task crons. Read/unread/archive/delete all hit real JWT-guarded endpoints
(`notifications/notifications.controller.ts:45` class-level guard, routes :84-276).
The 10-second poll and the detail-panel resync are implemented as documented.

**Not real:**

| Gap | Evidence |
|---|---|
| Custom one-tap actions do not survive a refresh | Created into `useState` at `Notifications.tsx:173`, appended `:575`, rendered `:693-710`. No storage call, no endpoint. §9's reading is confirmed: rendering shipped, persistence did not |
| The page cannot report a failure | `useNotifications(...)` destructures `isLoading: _isLoading, error: _error` (`Notifications.tsx:157`) — both underscore-discarded. A 500 or a 401 renders as an empty inbox, forever, while the 10s poll keeps retrying silently |
| The gateway's own one-tap module has no caller from this page | `one-tap-actions.controller.ts:64` is now JWT-guarded (44.1a closed) with 8 routes; the only web callers are on the dashboard (`services/api/dashboard.ts:166,191`). `OneTapActionCenter` keeps its state in `localStorage` (`OneTapActionCenter.tsx:80-83,175-180,502`) and rebuilds actions client-side from inventory + orders (`:395-460`) |

**§0 correction (stale).** "gmail actions point at `/emails` (no such route)" is fixed:
`openRouteForAction` now returns `/communications` for `gmail_send` and
`gmail_contextual`, with a comment explaining that no id can be handed over
(`OneTapActionCenter.tsx:135-141`).

## 11. Data flow

### Calls out

| Method | Path | Auth | Gateway controller | Returns |
|---|---|---|---|---|
| GET | `/notifications?userId=&status=` | JWT (class, `notifications.controller.ts:45`) | `:84-101` | Notification rows for the user |
| PATCH | `/notifications/:id/read`, `/:id/unread`, `/:id/archive` | JWT | `:203`, `:216`, `:229` | Updated row |
| PATCH | `/notifications/read/all?userId=` | JWT | `:189-201` | Count marked |
| DELETE | `/notifications/:id` | JWT | `:263-276` | 204 |
| GET | `/procurement/orders/pending`, `/procurement/orders` | JWT | `procurement.controller.ts` | Orders the action center turns into cards |
| GET | `/inventory/:rid` (low stock) | JWT | `inventory` module | Low-stock actions |

### Fed by

| Notification kind | Producer | Live? |
|---|---|---|
| Low stock | `@Cron("*/2 * * * *")` edge sweep + `@Cron("0 * * * *")` batched digest (`low-stock-alerts.service.ts:85,110`) → `persistForRestaurant` (`:305,347`) | Yes — memory: notifications-batching-sync |
| Vendor reply / draft ready | Gmail push → `email.inbound.received` → `rabbitmq-bridge.service.ts:528` → `InboundResponderService.analyzeAndDraftReply` → notification rows `inbound-responder.service.ts:1287` | Yes (live Gmail watch, OD-78) |
| Schedule published / acknowledged, broadcast | `team/schedule.service.ts:254,484`; `team/team.controller.ts:350` | Yes |
| Order approval, delivery, price | `procurement.service.ts:1062,1368` | Yes |
| Weekly report ready, delivery ETA, payment due, audit, event prep, custom reminders | Nine tenant-scoped `@Cron`s in `communications/scheduled-tasks.service.ts:184,219,275,375,451,525,599,653,703` (a ninth, `:150`, is the global tenant-isolation RPC) | **Per-tenant since 2026-08-26** (OD-87 / [ADR 0022](../decisions/0022-scheduled-jobs-serve-opted-in-tenants.md)) — each iterates `ScheduledTenantsService.runPerTenant`, isolating per-tenant failures. But enumeration is **explicit opt-in** and no restaurant has opted in, so in practice this still serves exactly the `DEFAULT_RESTAURANT_ID` restaurant, which still takes its recipients from `MANAGER_EMAIL`. Whether that stays opt-in is **OD-91** |
| Agent-side writes | Historically silent-failing until 44.1d (`v3.0-TECH-DEBT.md:95-131`) | Fixed |

### Writes

| Write | Downstream reaction |
|---|---|
| read / unread / archive / delete | Unread badge in the sidebar and header bell recompute (`Sidebar.tsx:410`, `Header.tsx:191`) |
| Custom one-tap action | **none** — lives in `useState` until refresh |
| One-tap execute (order approve) | Goes through the orders API and dispatches a realtime inventory/order update (`OneTapActionCenter.tsx` dispatchers) |
| Snooze | `localStorage` only (`OneTapActionCenter.tsx:83,97,111`) — not shared across devices |

## 12. Design intent

**Should be:** the queue of things that need a person, oldest first, each one
resolvable without leaving the row.

| State | Handled? | Evidence |
|---|---|---|
| Loading | **No** | `_isLoading` discarded (`:157`) |
| Empty | Yes | Empty-inbox render |
| Error | **No** | `_error` discarded — the single most consequential omission on the page: this is the surface that is supposed to prove the system is watching |
| Permission-denied | **No** | No 403 branch |

**Where the UI misleads**

1. "Create custom one-tap action" is a full modal with icon/colour/priority/URL
   pickers and a live preview (`:1368-1691`) for an object that is discarded on
   navigate-away.
2. An empty inbox after a failed fetch is indistinguishable from a calm restaurant.
3. Snoozes are per-browser; nothing says so.

## 13. Roadmap

1. **Branch on `error`** (`Notifications.tsx:157`). A watchdog that cannot say it is
   blind is worse than no watchdog.
2. **Persist custom one-tap actions** — the gateway module already exists and is
   guarded (`one-tap-actions.controller.ts:64`, `POST /` at :138). This is wiring,
   not new backend.
3. **Move snoozes server-side** onto the same module (`:246` cancel, `:118` pending).
4. ~~**Make the eight scheduled crons per-restaurant**~~ — **done 2026-08-26**
   (OD-87 / [ADR 0022](../decisions/0022-scheduled-jobs-serve-opted-in-tenants.md)).
   All eight now iterate `ScheduledTenantsService.runPerTenant`, with per-tenant
   failure isolation and a `SCHEDULED_JOB_SUMMARY` line per run. **Still true:
   "the rest get none, with no UI saying so"** — enumeration is explicit opt-in
   via `restaurant_feature_flags(flag_name = 'scheduled_communications')`, there
   are no flag rows, and nothing on this page surfaces which restaurants are
   opted in. That surface is unbuilt; whether it should exist at all depends on
   OD-91.
5. Loading skeleton for the first fetch.
6. Rebrand `QuickGmailModal` previews (§7).
