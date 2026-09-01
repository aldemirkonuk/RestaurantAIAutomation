---
type: page
route: /
slug: dashboard
component: apps/web/src/pages/Dashboard.tsx
audience: owner
tier: core
archetype: canvas # proposed 2026-08-26 (OD-106)
signals_today: none
rebrand_strings: 0
maturity: hollow
status: documented
updated: 2026-08-26
links: ["[[PAGE-CONTRACT]]", "[[reports]]", "[[inventory]]", "[[orders]]", "[[calendar]]", "[[wines]]"]
---

# / — Dashboard

## Surface — buttons → where they go

- **KPI card: Revenue** → [[reports]] `/reports` (its modal's "Full report" → `/reports?focus=revenue`)
- **KPI card: Inventory** → [[inventory]] `/inventory`
- **KPI card: Orders** → [[orders]] `/orders`
- **KPI card: Low stock** → [[inventory]] `/inventory?filter=low`
- **Reorder / Reorder selected** → [[orders]] `/orders?draft=new&…`
- **Low-stock row** → [[inventory]] `/inventory?highlight=…`
- **Calendar strip day / Add Event / important date** → [[calendar]] `/calendar?date=…` / `?openModal=true`
- **Recent order row / View all** → [[orders]] `/orders?orderId=…`
- **Top wine row** → [[wines]] `/wines?search=…` or `?wineId=…`
- **Reports View all** → [[reports]] `/reports`
- **Quick Actions panel** → user-configured shortcuts (any internal route or external URL)

## 1. Purpose

The owner/manager landing page: today's KPIs (revenue, stock, orders, alerts), a
reminders list, a calendar strip with important dates, recent activity, and the
One-Tap Action Center for approvals and low-stock reorders. Sidebar tooltip says it
plainly: "Today's KPIs, alerts, and the actions worth doing first"
(`apps/web/src/components/layout/Sidebar.tsx:63`).

## 1a. Features
- See today's KPI tiles: revenue, stock, orders, alerts
- One-Tap Action Center: approve pending orders and low-stock reorders in one tap (with email preview)
- Reminders list and a calendar strip with important dates; add your own important date
- Recent activity feed and sales chart
- Quick-actions panel; right-click context menus on cards
- Switch between restaurants/branches
- Live updates while the page is open (realtime calendar/inventory events)

## 1b. Motions used — Mudavym redesign (flag `mudavym_design_dashboard`)

Canonical source with curves: `apps/web/src/pages/dashboard/next/MOTIONS.md` —
this list is the note-side index (ADR 0044 §2).

| id | name | fires |
|---|---|---|
| `open-arrive` | Opening line entrance | the Fraunces "Good evening / before service" header, once on mount |
| `cal-arrive` | Staggered arrival | every real day cell of the sales calendar, per month paint |
| `kpi-tally` | Figures arrive | the five KPIs + "Waiting on you" count; an em dash never counts |
| `day-open` | Settle expansion | the day-detail panel; each Waiting-on-you row into its HoldToApprove |
| `day-scrub` | Scrub the day | the tape strip in day detail — un-eased on purpose, per-day samples |
| `hold-pour` / `seal-stamp` | Hold-to-approve → the seal lands | the approvals queue, wired to the real mutation |
| `ink-micro` | Micro-states | hovers/focus, nothing moves more than 2px |
| `skel-sheen` | Honest skeletons | genuinely in-flight fetches only — never for "unknown" |

Deliberate non-motions: unknowns never animate; month navigation does not slide;
scrubbed figures do not tween.

## 2. Entry

Most-linked page after `/login` — in-degree 5 ([PAGE_MAP](../foundation/PAGE_MAP.md):139):
from `/admin`, `/get-started`, `/invite/:code`, `/onboarding`, `/register`. Also:

- Sidebar "Dashboard" (`apps/web/src/components/layout/Sidebar.tsx:60-64`).
- Catch-all `*` redirects here (`apps/web/src/App.tsx:302`), so every bad URL lands on it.
- One of four eagerly-loaded pages — not lazy (`apps/web/src/App.tsx:63`).

## 3. Files

- Route binding: `apps/web/src/App.tsx:254`.
- `apps/web/src/pages/Dashboard.tsx` (1,849 lines) — view.
- `apps/web/src/pages/dashboard/useDashboardPage.ts` + `index.tsx` — page hook (data shaping, calendar revenue).
- Key co-located renders: `components/notifications/OneTapActionCenter.tsx` (Dashboard.tsx:477),
  `components/dashboard/QuickActionsPanel.tsx` (:482), `components/dashboard/AddImportantDateModal.tsx` (:1838),
  `components/ui/ContextMenu.tsx` (six mounts, :1570-1802).
- Data hooks: `hooks/useDashboardData.ts`, `hooks/useInventoryData.ts`, `hooks/useOrdersMetrics.ts`,
  `data/manualImportantDates.ts` (Dashboard.tsx:41-56).

## 4. Endpoints

All via `apiClient` (base `${VITE_API_GATEWAY_URL}/api/v1`, `services/api/client.ts:51`)
unless noted. Atlas rows: [ENDPOINTS](../foundation/ENDPOINTS.md):197 (`dashboard`, 8 —
atlas's **⚠ all unguarded** is stale; guarded at class level since 2026-08-25 (#60),
`apps/api-gateway/src/dashboard/dashboard.controller.ts:51`),
:87 (`calendar`), :249 (`inventory`), :389 (`procurement`), :663 (`wines`).

| Method | Path | Call site |
|---|---|---|
| GET | `/dashboard/stats/:id`, `/dashboard/activity/:id`, `/dashboard/alerts/:id` | `hooks/useDashboardData.ts:74-79` → `services/api/dashboard.ts:23,70,87` |
| GET | `/dashboard/sales-chart/:id` | `hooks/useDashboardData.ts:205` → `services/api/dashboard.ts:109` |
| GET | `/dashboard/calendar-revenue/:id` | `pages/dashboard/useDashboardPage.ts:227` → `services/api/dashboard.ts:227` |
| GET | `/calendar/events` | `useCalendarEvents` (useDashboardPage.ts:7) → `services/api/calendar.ts:221` |
| GET | `/wines` | `useWines` → `services/api/wines.ts:30` |
| GET | `/inventory/:id` + `/low-stock` + `/summary` | `hooks/useInventoryData.ts:15` → `services/api/inventory.ts:66,118,129` |
| GET | `/procurement/orders/pending` (+ list) | OneTapActionCenter.tsx:45 → `services/api/orders.ts:206,217` |
| GET | `/api/v1/calendar/ical-token` | **relative `fetch`**, `pages/Dashboard.tsx:267` — see §9 |

## 5. Signals

**None.** No `uxSignals` import anywhere in the tree; the client reporter ships dark
(`VITE_UX_OPTIMIZER` gate, `apps/web/src/lib/uxSignals.ts:15`) and its only consumer,
`hooks/useUxOverrides.ts`, is imported by no page. Guidance's `trackGuidance` pushes
to a `window.dataLayer` that is never bootstrapped (`guidance/analytics.ts:29-39`; no
GTM in `index.html`) — dev-console only.

## 6. Tier cut

**Core** — operate ([TIER-MAP](../03-scenarios/TIER-MAP.md):10). Scenario surface:
S10 (low-stock alerts land here as one-tap reorders) and S15 (the in-app digest panel
is the owner's landing experience). Both are ✅-Core rows in the matrix (TIER-MAP:46,51).

## 7. Rebrand surface

Page tree: **0** user-visible strings. Reachable-but-shared:

- One-tap email modal shows "WineOps AI" branding in preview/sent HTML —
  `components/emails/QuickGmailModal.tsx:129,145,153,189,200` (opened from OneTapActionCenter).
- Layout chrome on every DashboardLayout page: "WineOps AI" wordmark
  (`components/layout/Sidebar.tsx:484`), aria-label (`:469`), BrandMark alt (`components/brand/BrandMark.tsx:17`).
- Not visible: localStorage keys `wineops_*` (`OneTapActionCenter.tsx:80-83`).

## 8. State & config

- `VITE_API_GATEWAY_URL` for all API calls; `VITE_UX_OPTIMIZER` (dark, §5).
- One-tap actions, shadow stock, order history, snoozes persist in localStorage
  (`OneTapActionCenter.tsx:80-83`).
- Realtime: `useRealtimeDispatch` calendar-event payloads (`Dashboard.tsx:46`).
- Restaurant switching via `useAuthStore`/`useRestaurantSettingsStore` (`Dashboard.tsx:50`).

## 9. Gaps

- `pages/Dashboard.tsx:267` fetches `'/api/v1/calendar/ical-token'` **relative to the SPA
  origin**, bypassing `VITE_API_GATEWAY_URL` — works only where the web host proxies the
  gateway; every other page uses the absolute base (e.g. `pages/Settings.tsx:159`).
- All 8 `dashboard` endpoints are guarded since 2026-08-25 (#60) — `@UseGuards(JwtAuthGuard)`
  at class level (`apps/api-gateway/src/dashboard/dashboard.controller.ts:51`); the atlas
  row ([ENDPOINTS](../foundation/ENDPOINTS.md):197) still reads "unguarded" and is stale.
- `v3.0-TECH-DEBT.md:502` — dashboard profile card dead-click claim (L102) is *unverified,
  not confirmed*; the one-tap auth hole it fed is closed (`v3.0-TECH-DEBT.md:409`).

## 10. Maturity

**hollow.**

The read side is genuine — every KPI, alert and activity row is a live Supabase query
(`dashboard.service.ts:464-556,654-749,854+`). The *action* side is not, and the action
side is what the page claims to be for ("the actions worth doing first", Sidebar.tsx:63).

| Evidence | `path:line` |
|---|---|
| **One-Tap approve writes nothing to the server.** `handleApprove` is a `switch` over action types whose entire effect is a local event dispatch plus a `localStorage` mutation. `low_stock` fabricates an order id `ORD-${Date.now()}` and pushes it into `localStorage`; `stock_receipt` deletes a `localStorage` shadow key; `price_change`, `inequality`, `vintage_sub` are `console.log` only. Then a 300 ms `setTimeout` supplies "visual feedback" and the card is removed. | `components/notifications/OneTapActionCenter.tsx:541-662` |
| **Reject is entirely `console.log`.** Three cases, three log lines, no call. | `OneTapActionCenter.tsx:664-684` |
| **The real one-tap backend is built and unconsumed.** `one-tap-actions` is a fully guarded NestJS module with audited execution and WebSocket sync; the web client wraps it (`getOneTapActions`, `executeOneTapAction`) and **no component calls either function** — the only references are the barrel re-export. | `apps/api-gateway/src/one-tap-actions/one-tap-actions.controller.ts:36-50`; `services/api/dashboard.ts:161,183`; `services/api/index.ts:84-85` (sole importers) |
| **"Total Revenue" is purchase spend.** `totalRevenue`, `todaySales`, `weekSales`, `monthSales` and the sales chart's `revenue` all sum `procurement_orders.total_cost` of **delivered POs** — money paid *out* to distributors — and render under "Total Revenue" / "Revenue Breakdown". `pos_checks` (real sales) is never read by this service. | service `dashboard.service.ts:285-330,529-533,785-792`; labels `pages/Dashboard.tsx:1125,1155,1456` |
| Guarded, and the §9 note is correct — class-level `JwtAuthGuard` since #60. | `dashboard.controller.ts:51` |

## 11. Data flow

### Calls out

| Method · Path | Auth | Gateway controller | Returns |
|---|---|---|---|
| GET `/dashboard/stats/:rid` | JWT (class) | `dashboard.controller.ts:151` → `dashboard.service.ts:464` | wines, bottles, volume, lowStockItems, pendingOrders, today/week/month "sales" (= PO cost) |
| GET `/dashboard/activity/:rid` | JWT | `:180` → `:557` | merged feed of `procurement_orders`, `events`, `restaurant_inventory` |
| GET `/dashboard/alerts/:rid` | JWT | `:216` → `:654` | rows from `v_low_stock_items`, `procurement_orders`, `restaurant_inventory` |
| GET `/dashboard/sales-chart/:rid` | JWT | `:240` → `:751` | buckets of delivered-PO cost + `wine_consumption_log` glasses |
| GET `/dashboard/calendar-revenue/:rid` | JWT | `:107` → `:380` | per-day join of `calendar_events` × delivered POs |
| GET `/calendar/events`, `/wines`, `/inventory/:id`(+`/low-stock`,`/summary`), `/procurement/orders/pending` | JWT via `apiClient` | see [[inventory]] §11, [[orders]] §11 | overlay data |
| GET `/api/v1/calendar/ical-token` | JWT, **raw `fetch` relative to the SPA origin** | `calendar` module | `{ token }`; the copied URL is then built from `window.location.origin`, so on any host that is not the gateway the subscription URL is wrong as well as the request |

### Fed by

| Producer | Mechanism | `path:line` |
|---|---|---|
| Purchase orders (the "revenue" number) | manual entry on [[orders]] + `markDelivered` | `procurement.service.ts:903-1038` |
| `wine_consumption_log` (glasses) | **POS webhook only** — mirrored from a depleting POS sale | `pos-hub/pos-hub.service.ts:685,752` |
| `v_low_stock_items` | view over `restaurant_inventory`; alert side-effects from the 2-min edge sweep | `notifications/low-stock-alerts.service.ts:85` |
| `calendar_events` | manual entry + the calendar agent | `services/agent-orchestrator/agents/calendar_agent.py` |
| One-Tap action feed | **no producer — derived client-side** from wines/inventory/orders and cached in `localStorage` | `OneTapActionCenter.tsx:425-458` |

**Finding:** the One-Tap Action Center's data has no producer and its writes have no
sink. A restaurant with no POS also has no `wine_consumption_log` producer, so the
glasses series is structurally empty until pos-hub is connected.

### Writes

| Write | Lands in | Downstream |
|---|---|---|
| Approve / reject a one-tap action | `localStorage` (`wineops_*`, `OneTapActionCenter.tsx:80-83`) | nothing — per-browser, invisible to teammates, lost on cache clear |
| Add important date | `calendar_events` via the calendar modal | calendar strip, `/calendar` |
| Quick Gmail send | `communications` module | vendor thread on [[orders]] |

## 12. Design intent

**Should be:** the one screen an owner opens first — what happened, what is wrong, and
the two or three actions worth doing before service, each of which actually happens.

| State | Handled? | Evidence |
|---|---|---|
| loading | ✅ | `useDashboardData` loading flags |
| empty | ⚠️ partial | KPI tiles render `0`/`$0` rather than "no data yet" — indistinguishable from a real zero |
| error | ❌ | no error branch on the KPI path; a failed stats call renders zeros |
| permission-denied | ❌ | single owner-shaped layout; no role gate (contrast [[receiving]], which does this properly) |

**Where the UI misleads**

1. **"Total Revenue" is money spent, not money earned** (§10). An owner reading this
   card is reading their wine *purchasing* and being told it is revenue.
2. **One-tap success is theatrical** — the card disappears after a 300 ms delay with no
   request in flight (`OneTapActionCenter.tsx:652-655`). The user has been told an order
   was placed and a receipt was booked; neither happened.
3. **Fabricated zeros**: a stats failure and a genuinely empty restaurant render
   identically.

## 13. Roadmap

1. **Point One-Tap at the server module it already has** — swap `handleApprove`/
   `handleReject` onto `executeOneTapAction` (`services/api/dashboard.ts:183`) and the
   feed onto `getOneTapActions`. Highest value on the page: it converts the flagship
   panel from theatre to fact and deletes three `localStorage` stores. *Blocker: none —
   the controller, DTOs and WebSocket sync all exist.*
2. **Rename or re-source the Revenue KPI.** Either label it "Purchasing" (one-line,
   honest) or read `pos_checks` for actual sales. *Blocker: real revenue needs a POS
   connection; the label fix does not, and should not wait for it.*
3. Add an error state to the KPI row so a failed `/dashboard/stats` stops rendering `$0`.
4. Fix `Dashboard.tsx:267` to use `apiClient` and build the iCal URL from
   `VITE_API_GATEWAY_URL`, not `window.location.origin` (§9, §11).
5. Distinguish empty-restaurant from zero — "no orders yet" beats `$0`.
6. Turn on the uxSignals reporter for this page (§5) once the actions are real; measuring
   taps on buttons that do nothing measures nothing.
