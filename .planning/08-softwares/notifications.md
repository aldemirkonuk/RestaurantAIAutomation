---
type: software
slug: notifications
name: Notifications
division: restaurant
status: partial
tier: core
routes: ["/notifications"]
pages: [notifications]
api_modules: [notifications, push]
agents: [notification_agent]
owner_unit: messaging-delivery
updated: 2026-09-01
links: ["[[notifications]]", "[[dashboard-home]]", "[[calendar]]", "[[messaging-delivery-charter]]", "[[SOFTWARE-MAP]]"]
---

# Notifications

## §0 What it is

The inbox for everything the system wants a person to know about — a wine dropped below
its reorder point, an order is waiting on your approval, a shift was published, a vendor
replied. It keeps a durable record rather than a toast that vanishes, so an alert raised
overnight is still there in the morning, and it can push to a phone. The one-tap approval
cards you see here are the same ones on [[dashboard-home]].

## §1 Features today

- Read the inbox with unread counts and a badge in the sidebar
- Mark one read, mark several read, mark all read; unread again
- Archive or delete one, several, or all read
- Open a notification into a detail panel, deep-linked from the header bell
- Watch it live-update while open (10-second poll) with the detail panel resyncing
- Set delivery preferences per channel and category
- Get the same alerts pushed to the mobile app
- Approve pending orders and low-stock reorders from the embedded action centre
- Create a custom one-tap action — *broken* (held in React state only; gone on refresh)
- Enable browser web-push — *dark* (endpoint, client and hook exist; nothing calls the hook)

## §2 Screens

- [[notifications]] — the whole software; route `/notifications` at
  `apps/web/src/App.tsx:316`, **not** behind `PageGate`, so there is one surface and no
  flag to check. `apps/web/src/pages/Notifications.tsx` (1,810 lines).

Entry is the sidebar (with unread badge) and the header bell, which can carry a
`selectedNotificationId` straight into the detail panel. The page mounts the shared
`components/notifications/OneTapActionCenter.tsx`.

## §3 Backend

Two modules, one of which is a shared transport.

**`apps/api-gateway/src/notifications/`** — `@Controller("notifications")` at
`notifications.controller.ts:46`, **24 endpoints**, all behind class-level
`JwtAuthGuard`.

| Group | Endpoints | Lines |
|---|---|---|
| Read | `GET /`, `/unread`, `/unread/count`, `/history`, `/preferences` | `:84,103,117,131,144` |
| Mutate | `PATCH /preferences`, `/read/bulk`, `/read/all`, `/:id/read`, `/:id/unread`, `/:id/archive` | `:154,178,189,203,216,229` |
| Delete | `DELETE /bulk`, `/read/all`, `/:id` | `:241,252,263` |
| Push | `POST /push/subscribe`, `/push/unsubscribe` | `:278,291` |
| Producers | `POST /`, `/test`, `/order-approval`, `/low-stock`, `/delivery`, `/price-negotiation`, `/system-alert`, `/send-email` | `:61,307,321,337,352,367,383,397` |

**`apps/api-gateway/src/push/`** — no controller; a service module only
(`expo-push.service.ts`, `push.module.ts`). It is a **shared seam**, injected into four
places: `notifications.service.ts:48` (optional), `team/team.controller.ts:60`,
`team/schedule.service.ts:44`, `mobile/mobile.controller.ts:31`. Notifications fans out to
it at `notifications.service.ts:103-104` and `:717-718`, skipping `priority: "low"`.

## §4 Automation

**Two producers of the same alert, in two runtimes.**

- **NestJS, live.** `notifications/low-stock-alerts.service.ts` runs
  `@Cron("*/2 * * * *")` (`:85`, edge sweep) and `@Cron("0 * * * *")` (`:110`, batched
  digest), writing rows at `:305,347`.
- **Python, orchestrator-dependent.** `services/agent-orchestrator/agents/notification_agent.py`
  (2,096 lines) subscribes to 10+ routing keys — `stock.threshold.breached`,
  `stock.critical`, `procurement.order.requires_approval`, `recurring.order.*`,
  `vendor.deadline.*` (`:285-301`). Its upstream publisher is real:
  `agents/buffer_manager.py:284,451`. But the whole chain lives inside the Python
  orchestrator over RabbitMQ, which CI cannot prove is alive
  (`ECOSYSTEM-PLAN.md:65`, §4.2 two-runtime split).

Beyond the sweeps, seven distinct gateway call sites write `notifications` rows: team
broadcast (`team/team.controller.ts:350`), schedule publish/acknowledge
(`team/schedule.service.ts:254,484`), procurement
(`procurement/procurement.service.ts:1062,1368`), the low-stock engine, and the inbound
autonomous responder (`common/orchestrator/inbound-responder.service.ts:1287`). This is
the most-produced-into surface in the product.

## §5 Data

`notifications`, `notification_preferences`, `inventory_alert_state`, `v_low_stock_items`
(read), `restaurants` (read) — all from `notifications.service.ts` and
`low-stock-alerts.service.ts`. The `push` module reads and writes `mobile_devices`
(`expo-push.service.ts`), which the mobile app populates through `/mobile/devices`
(`apps/mobile/src/lib/push.ts:55,72`) — a different module's endpoint, so device
registration is outside this software's own controller.

Owned outright: `notifications`, `notification_preferences`, `inventory_alert_state`.

## §6 Owner

[[messaging-delivery-charter]] — team `messaging-delivery`, department `engineering`,
division Platform (`01-org/platform/engineering/teams/messaging-delivery/`).

Unambiguous: the charter's boundary table names `apps/api-gateway/src/notifications` (24
routes) and `push/` outright, along with `services/agent-orchestrator/agents/buffer_manager.py`
— *"the 30-minute LIFO anti-spam window"* (`messaging-delivery-charter.md:29-45`). Its
mandate sentence is the boundary that matters here: it owns **whether a message arrives
exactly once**, and *"does not own what the message says"* (`:20-22`).

The failure mode it names is exactly this software's: *"duplication and silence — a digest
sent forty times, or a low-stock alert nobody received — which no functional test
catches"* (`:52-54`). §7's two-producer seam is that risk written in code.

One correction: the charter's table marks `notifications` **"all unguarded"**
(`:33`). Stale — class-level `JwtAuthGuard` at `notifications.controller.ts:45`
since 2026-08-25 (#60).

## §7 Maturity & seams

**partial.** The inbox is the most genuinely live surface in this cluster; three named
capabilities are absent, and each fails silently.

Real, verified: read/unread/archive/delete against guarded endpoints, seven live
producers, the 10-second poll, the detail-panel resync, and mobile push fan-out.

| Gap | Evidence |
|---|---|
| **Custom one-tap actions do not survive a refresh.** Created into `useState` (`Notifications.tsx:173`), appended `:575`, rendered `:693-700`. No storage call, no endpoint. | `pages/Notifications.tsx:173,575,693` |
| **The page cannot report a failure.** `useNotifications(...)` destructures `isLoading: _isLoading, error: _error` — both underscore-discarded. A 500 or a 401 renders as an empty inbox, forever, while the poll keeps retrying. | `pages/Notifications.tsx:157` |
| **Web push is dark.** `POST /notifications/push/subscribe` exists, `subscribeToPushNotifications` wraps it (`services/api/notifications.ts:252-259`), `useSubscribeToPushNotifications` wraps that (`hooks/queries/useNotificationQueries.ts:378`) — and no page or component calls the hook. Mobile push works; browser push has never been switched on. | grep for `useSubscribeToPushNotifications` outside `hooks/` → no hits |

Seams:

1. **Two producers, two runtimes, one alert.** The NestJS cron and the Python
   `notification_agent` both exist to raise low-stock alerts. Nothing reconciles them, and
   the owning charter's whole metric set (`messaging.duplicate_delivery_rate`,
   `messaging.drop_rate`) is about exactly this. Which one is authoritative is not written
   down anywhere.
2. **The action centre is shared, not owned.** `OneTapActionCenter.tsx` is mounted by this
   page and by [[dashboard-home]] and behaves identically on both, including the
   derived-vs-server card split described there. Neither software can change it alone.
3. **Device registration lives in a third module.** Push delivery is here; push
   *enrolment* is in `mobile`. A device that never registered is invisible from this side.

## §8 Where it's going

- ADR 0049 §3a places `notifications` under **Restaurant** and `push` under
  **Platform/Admin** (`.planning/04-specs/ECOSYSTEM-PLAN.md:54,59`) — this software spans
  the division line, which is expected under the plan's tie-break rule (`:49`) but worth
  recording.
- The duplicate-producer question is the owning team's first real decision, and it is not
  in `OPEN-DECISIONS.md` yet.
- Persisting custom one-tap actions and branching the error state are two small changes
  that would take this to `live`; both are currently silent failures, which is the harder
  kind to notice.
- Memory `notifications-batching-sync` and `inbound-email-intelligence-plan` carry the
  batching engine's design and the inbound producers' Phase 0 state.
