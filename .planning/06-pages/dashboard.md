---
type: page
route: /
slug: dashboard
softwares: [dashboard-home]
component: apps/web/src/pages/Dashboard.tsx
audience: owner
tier: core
archetype: canvas # proposed 2026-08-26 (OD-106)
signals_today: none
rebrand_strings: 0
maturity: hollow
status: documented
updated: 2026-09-03
links: ["[[PAGE-CONTRACT]]", "[[reports]]", "[[inventory]]", "[[orders]]", "[[calendar]]", "[[wines]]"]
---

# / — Dashboard

> **Part of** [[08-softwares/dashboard-home|Dashboard Home]] — the small software this screen belongs to. Index: [[SOFTWARE-MAP]].

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

**Mudavym redesign** (flag `mudavym_design_dashboard`; legacy renders unchanged
while the flag is off — `apps/web/src/pages/dashboard/next/`):

- **Waiting-on-you approves behind a PROVEN seal** (added 2026-09-04, founder's
  call in the ADR 0116 addendum) — the hold mints a one-time challenge bound to
  this manager, this order and that order's own total and vendor, and the write
  carries it back; a mint that fails approves nothing and says so on the
  control. The card renders the same `components/orders/SealedApproveDie.tsx`
  the legacy `/orders` desk does, so there is one mint path, and a 403 from the
  gateway is printed as itself rather than as a claim about the network
- **One-tap actions live on the rail, under *Waiting on you*** (added 2026-09-03 by
  the founder's decision; they were built inside `/notifications` in the p4 first
  pass and moved here). `apps/web/src/pages/dashboard/next/OneTapPanel.tsx` reads
  `GET /one-tap-actions` tenant-keyed, writes through
  `POST /one-tap-actions{,/:id/execute,/:id/cancel}` — all on the class-guarded
  `OneTapActionsController` — and is self-contained: its own types, its own read,
  its own honesty states, nothing imported from another page.
  - An action **the house raised for itself** is told apart from one a person wrote
    *structurally*, not by tone: `createSystemAction` inserts no `user_id`
    (`one-tap-actions.service.ts:366-382`) while `POST /one-tap-actions` stamps the
    caller (`:150-152`), so an absent author is the proof. A house-raised card
    carries the `--calm` dashed edge and can never look carried-out.
  - Committing gets the wax — `HoldToApprove` completing into the seal — because it
    is a durable server write stamped with your identity. Cancelling and navigating
    are plain controls.
  - **The first real action landed 2026-09-05, sealed** (founder: *"extend the seal
    to it when the first real action lands, but RUN the ecosystem to run the first
    real action"*). `triggerWorkflow` — three `// TODO` branches and a default log,
    called AFTER the row was stamped `completed` — is replaced by a census with
    three outcomes (`apps/api-gateway/src/one-tap-actions/one-tap-workflow.ts`,
    mirrored for the browser in `pages/dashboard/next/one-tap-acts.ts`):
    - **`delivery_confirm` is real and is the only control here that carries the
      seal.** The hold mints a one-time challenge bound to this manager, the ORDER
      the card names, the act `deliver` and the stock about to move
      (`POST /one-tap-actions/:id/seal-challenge`); the gateway redeems it BEFORE
      calling `ProcurementService.markDelivered`, and the card then says how many
      bottles were booked, from what the gateway recorded. Proven, then done, then
      recorded — in that order.
    - **A written action is a record and gets a plain button.** The wax is rationed
      to the act that moves the house's stock (§13.10's question, answered): a die
      meaning "recorded" beside a die meaning "done" is how the seal stops meaning
      anything.
    - **Every other act is disabled and says what is not built** — the reorder in
      particular, because placing the order needs a vendor and an agreed price the
      card does not carry and would open a priced negotiation with the vendor. The
      gateway refuses them too and leaves the row `pending`: ADR 0083, a control
      may not claim a write it never makes.
  - **The house half is permanently empty today** — `createSystemAction` has no
    production caller, so the panel truthfully shows "Nothing standing" rather than
    implying the house is idle. See §9. *Measured 2026-09-03 against the local
    gateway:* `GET /one-tap-actions?restaurantId=…` returns
    `{ actions: [], total: 0, pending: 0, completed: 0 }` — a real empty register,
    which is exactly the case the panel must not draw as health.
  - Writing a standing action **persists** on the server against the restaurant, so
    it survives a refresh and every member sees it. (The legacy
    `OneTapActionCenter` rebuilt actions client-side into `localStorage`.)
  - All four states, each real: loading (skeletons), empty (said in words), broken
    read (the failure quoted), refused read (403 told apart from a 500, no pointless
    retry). The pending count is an em dash, never a zero, while the register is
    unread.
  - **A tenant switch never leaves the previous house's actions on screen.** The
    reset effect blanks the register the moment `restaurantId` changes
    (`OneTapPanel.tsx:135-139`), and a response that arrives after the switch is
    discarded rather than rendered (`:148,151`). Both halves are pinned by
    `OneTapPanel.test.tsx` ("discards a response that lands after the restaurant was
    switched" and "shows nothing from the previous house while the new one is still
    loading"); with either guard removed, both fail.

## 1b. Motions used — Mudavym redesign (flag `mudavym_design_dashboard`)

> **Chrome (2026-09-04).** With the flag on, this page is framed by the house
> header — `apps/web/src/components/mudavym/HouseHeader.tsx`, mounted by
> `PageGate` above every `next` tree: the A+M mark, this page's name, the ⌘K
> "Search or act" trigger, the house (or the branch switcher when there is more
> than one), the bell, the theme menu and the account menu. Chrome is excluded
> from §Surface by PAGE-CONTRACT, so it is named here and nowhere else in this
> note; its motions live in `components/mudavym/MOTIONS.md`, not the table
> below.

Canonical source with curves: `apps/web/src/pages/dashboard/next/MOTIONS.md` —
this list is the note-side index (ADR 0044 §2).

| id | name | fires |
|---|---|---|
| `open-arrive` | Opening line entrance | the Fraunces "Good evening / before service" header, once on mount |
| `cal-arrive` | Staggered arrival | every real day cell of the sales calendar, per month paint |
| `kpi-tally` | Figures arrive | the five KPIs + "Waiting on you" count; an em dash never counts |
| `day-open` | Settle expansion | the day-detail panel; each Waiting-on-you row into its HoldToApprove; the "write a new one-tap action" form on the rail |
| `day-scrub` | Scrub the day | the tape strip in day detail — un-eased on purpose, per-day samples |
| `hold-pour` / `seal-stamp` | Hold-to-approve → the seal lands | the approvals queue **and** (2026-09-05) the ONE one-tap card whose act is real — a delivery confirmation, whose hold mints the seal the write carries back. The rail's written-note card lost the die that day: it is a record, and the wax is rationed to the act that moves stock. The seal only stays if the server said yes |
| `ink-micro` | Micro-states | hovers/focus, nothing moves more than 2px |
| `skel-sheen` | Honest skeletons | genuinely in-flight fetches only — never for "unknown" |

Deliberate non-motions: unknowns never animate; month navigation does not slide;
scrubbed figures do not tween; the one-tap panel's dashed cards never pulse — an
action the house raised and did not carry out must look inert. A card whose act is
not built has no motion at all: its control is disabled, and a disabled control that
animates is a control that looks pressable.

### Why the one-tap desk is here and not on `/notifications` (2026-09-03)

The founder's call, after the p4 first pass built it into the day-book. The full
three-way argument — here, `/notifications`, or a command-palette-only surface, and
what each costs — is written once in [[notifications]] §1b "Second pass"; the short
version is that `/notifications` is a **record** worked downwards until an account
is ruled off, while a standing action is **work** whose natural end is to go away,
and two opposite lifecycles in one column is what made the first pass need a rail to
hide the contradiction in. On this page the adjacency is right: an order waiting to
be sealed and an action the house raised for itself are the same kind of object.

The cost, stated: this page now carries a **second** `HoldToApprove`. The rationing
rule exists so the seal does not become routine, and two dies on one screen is the
closest this design has come to spending it. It is defensible only because both are
durable, identity-stamped server writes — the moment a third appears for something
reversible, the ceremony should be taken off one of them.

**Resolved 2026-09-05.** The rail's die was on a card that RECORDED a decision while
the queue's die APPROVED an order, and the two looked identical. The wax now sits
only where a write leaves the page: approving an order, and confirming a delivery
that books stock through the ledger. A written note is marked done with a plain
button. The page still carries two dies, and both are now sealed writes proven by
redemption rather than asserted — which is the condition §13.10 asked for.

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
- Mudavym redesign (flag-gated): `apps/web/src/pages/dashboard/next/` —
  `DashboardNext.tsx`, `SalesCalendar.tsx`, `DayDetail.tsx`, `KpiRow.tsx`,
  `WaitingOnYou.tsx`, `RailPanels.tsx`, `CountUp.tsx`, `useDashboardNextData.ts`,
  `format.ts`, `fonts.ts`, `dashboard-next.css`, `MOTIONS.md`, and — added
  2026-09-03 — `OneTapPanel.tsx` with `OneTapPanel.test.tsx` (12 tests,
  `apiClient` mocked). The panel is mounted at `DashboardNext.tsx:141`, directly
  under `<WaitingOnYou/>`.

## 4. Endpoints

All via `apiClient` (base `${VITE_API_GATEWAY_URL}/api/v1`, `services/api/client.ts:51`)
unless noted. Atlas rows: [ENDPOINTS](../foundation/ENDPOINTS.md):197 (`dashboard`, 8 —
atlas's **"all unguarded"** row is stale; guarded at class level since 2026-08-25 (#60),
`apps/api-gateway/src/dashboard/dashboard.controller.ts:51`),
:87 (`calendar`), :249 (`inventory`), :389 (`procurement`), :663 (`wines`).

| Method | Path | Call site |
|---|---|---|
| GET | `/dashboard/stats/:id`, `/dashboard/activity/:id`, `/dashboard/alerts/:id` | `hooks/useDashboardData.ts:74-79` → `services/api/dashboard.ts:23,70,87` |
| GET | `/dashboard/sales-chart/:id` | `hooks/useDashboardData.ts:205` → `services/api/dashboard.ts:109` |
| GET | `/one-tap-actions?restaurantId=` | **Mudavym only** — `pages/dashboard/next/OneTapPanel.tsx` `useOneTapActions` (moved here from `/notifications` on 2026-09-03) |
| POST | `/one-tap-actions`, `/one-tap-actions/:id/execute`, `/one-tap-actions/:id/cancel` | **Mudavym only** — same file; `OneTapActionsController` is `@UseGuards(JwtAuthGuard)` at class level (`one-tap-actions.controller.ts:64`) |
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
is the owner's landing experience). Both are Core rows in the matrix (TIER-MAP:46,51).

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

**Found while moving the one-tap desk here (2026-09-03).** Both are outside this
page's paths; neither was built here, and the rail panel states both in words.

- **`createSystemAction` has no production caller.** *(Re-measured 2026-09-05 and
  still true: `grep -rn createSystemAction apps/api-gateway/src apps/web/src services`
  returns the definition, two references in
  `src/__tests__/one-tap-actions.service.spec.ts:279,305`, and one comment.)*
  `apps/api-gateway/src/one-tap-actions/one-tap-actions.service.ts:351` is the only
  way an action is written *without* a human author, and its only references in the
  repo are in `src/__tests__/one-tap-actions.service.spec.ts:279,305`. So the "raised
  by the house" half of the rail panel is structurally correct and permanently empty:
  the producers that should raise one (the low-stock sweep, procurement) write
  notification rows only. **Owner: `notifications/low-stock-alerts.service.ts` and
  `procurement/`** — one `createSystemAction` call per producer.
- **CLOSED 2026-09-05 — executing a one-tap action used to do nothing but record it.**
  `triggerWorkflow` was three `// TODO` branches and a default log, called AFTER the
  row had been stamped `completed`, so the die reported success for a reorder that
  had not happened. Measured against a `git show HEAD:` copy of the service on
  2026-09-05: **22 of 22** cases in
  `apps/api-gateway/src/one-tap-actions/one-tap-execute.spec.ts` fail there, and the
  pre-fix service *resolves* `{"status":"completed","executionResult":{}}` for a
  `low_stock` card rather than refusing it. See §1a for what replaced it.
- **Lens run 2026-09-03 (`v3.0-TECH-DEBT.md`, POS lens; `03-scenarios/S04` §9.1):** when `getSalesChartData` rejects, the hook renders `Math.floor(Math.random()*5000)+1000` per day as sales (`hooks/useDashboardData.ts:205-230`; absence 1 — a failed read becomes a healthy business). "Vendor Spend (30d) $0 ↗ +0.0%" draws a green trend over a base with no purchase orders.

- **Intelligence lens 2026-09-03 (`v3.0-TECH-DEBT.md`, customer + intelligence lens):** the Low Stock Alerts card reads camelCase (`Dashboard.tsx:998,1004,971`, modal `:1315-1320`) from a snake_case payload (`GET /inventory/:id/low-stock` → `v_low_stock_items`, `database.service.ts:57-62`), so all 7 real wines render as "Unknown wine" with blank counts (defect 1). "Top Performing Wines / This month's best sellers" never reads sales — `topPerformingWines` (`:327-345`) aggregates procurement orders and calendar entries — so it says "no sales performance data" over $2,236 of real sales.

**Closed 2026-09-04 — Waiting-on-you approves behind a proven seal.** ADR 0116's
addendum made an order approval a redeemed seal and left this card calling
`ordersApi.approveOrder(order.id)` with an id alone (`WaitingOnYou.tsx:33`), so
every approval from the dashboard would have been refused the moment that
merged — and the card would have said "the approval didn't reach the server",
a claim about the network that a refusal makes false. The founder chose the
hold gesture over a one-click mint-and-approve. The card now renders
`components/orders/SealedApproveDie.tsx` — the SAME control and the same mint
as the legacy `/orders` desk, so there is one implementation of "exactly once"
outside `pages/orders/next` — which mints when the gesture BEGINS, approves
nothing if the mint fails, prints a 403 as itself and keeps the generic line
only for a failure carrying no decision. Proven by `WaitingOnYou.seal.test.tsx`
(9 cases; 6 of 8 render cases fail against the `git show HEAD:` copy). Not
proven live: the tenant reachable from the local gateway has zero orders
(`GET /procurement/orders` → `total: 0`) and that gateway points at production,
so nothing was approved from here.

**Found and fixed 2026-09-05 — the recording write itself could not succeed.**
`one_tap_actions.executed_by` carried a foreign key to `auth.users(id)`
(`supabase/migrations/20260805000000_baseline_from_production.sql:12814`), and the
value written into it is `user.userId` from the JWT strategy, which is a
`public.users.user_id` (`apps/api-gateway/src/auth/strategies/jwt.strategy.ts:56`).
Those two tables are DISJOINT — measured in production on 2026-09-01 and recorded in
`supabase/migrations/20260901150000_order_line_capture_and_units.sql:220-225`: 5 rows
in `auth.users`, 7 in `public.users`, **zero** shared ids. So every
`POST /one-tap-actions/:id/execute` raised 23503 on the key, and CI could not see it,
because a database migrated from empty has no rows for a foreign key to violate. The
panel's die has therefore never completed an action against production. Repointed at
`public.users(user_id) ON DELETE SET NULL` by
`supabase/migrations/20260905060000_a_one_tap_execution_names_a_real_person.sql`,
which is the same repair `20260901150000` made for `procurement_orders.created_by`.
The author column `one_tap_actions.user_id` is deliberately left with no key at all —
an absent author is the structural proof the house raised the row — and the migration
asserts that it stays that way.

**Still open after 2026-09-05 (outside this pass's paths).**

- **Nothing raises a `delivery_confirm` card.** The sealed path is built and proven by
  spec, and it is reachable — `CreateOneTapActionDto` accepts `actionType` and
  `relatedOrderId`, so `POST /one-tap-actions` can write one — but no producer does.
  The natural owner is procurement, where an order becomes due:
  `apps/api-gateway/src/procurement/procurement.service.ts` (one
  `createSystemAction` call when an approved order reaches its expected delivery
  date). Same owner as §13.7, and it is what turns this from a built path into a
  used one.
- **The happy path has still never been redeemed against a real database.** The local
  gateway points at production and the tenant it reaches holds zero one-tap actions
  (`GET /one-tap-actions` returned `{"actions":[],"total":0,"pending":0,"completed":0}`
  on 2026-09-05, curl), so creating one to exercise it would be a production write.
  What WAS exercised live, read-only, on 2026-09-05: `POST
  /one-tap-actions/<uuid>/seal-challenge` answers 401 unauthenticated and 404 for an
  action this house does not own, and `POST /one-tap-actions/<uuid>/execute` answers
  404 the same way — so the routes exist, are class-guarded, and refuse before any
  write. The 400 refusals and the 403 seal refusals are proven by spec only.
- **`GET /procurement/orders` was answering 500 on this deployment** at 07:31 on
  2026-09-05 (`column procurement_order_items_1.price_uom does not exist`) — another
  builder's in-flight ADR 0119 column, not yet applied to the database the local
  gateway reads. Named here because it is the read a delivery card's order would come
  from.

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

- **Lens run 2026-09-03 (`v3.0-TECH-DEBT.md`, POS lens; `03-scenarios/S04` §9.1):** with 53 items / 274 bottles / 205.5 L on the tenant, the inventory tiles matched the rows exactly; Low Stock 7 matched the API. The sales figures were not exercised past the failure path cited above.

- **Intelligence lens 2026-09-03 (`v3.0-TECH-DEBT.md`, customer + intelligence lens):** Active Inventory 53, Low Stock 7, Vendor Spend $0, Pending Orders 0 all matched the rows (honest zeros); One-Tap Actions names the 7 wines correctly. The morning-after owner cannot see *which* wines are low from the card that exists for it.

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
| loading | yes | `useDashboardData` loading flags |
| empty | partial | KPI tiles render `0`/`$0` rather than "no data yet" — indistinguishable from a real zero |
| error | no | no error branch on the KPI path; a failed stats call renders zeros |
| permission-denied | no | single owner-shaped layout; no role gate (contrast [[receiving]], which does this properly) |

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

**Added 2026-09-03 — the one-tap desk arrived on the rail.**

7. **Let a producer raise a one-tap action** — call
   `OneTapActionsService.createSystemAction` from the low-stock sweep
   (`notifications/low-stock-alerts.service.ts:312,354`) and/or procurement
   (`procurement/procurement.service.ts:1744,2362`). Until then the rail panel's
   house half is correct and empty (§9). This is the single highest-value item for
   the panel: without it the "autonomy you can see" half of the page is a shape.
8. ~~**Implement `triggerWorkflow`**~~ **DONE 2026-09-05, for one act.** Confirming
   a delivery is real and sealed; a written note is a record and says so; every
   other act is refused in words and the row stays `pending`. The census of what
   each act would have needed is `one-tap-workflow.ts`'s header. The reorder is
   deliberately NOT next: `CreateOrderDto` requires a `providerId` and `createOrder`
   fires `triggerDraftHttp`, which the orchestrator may AUTO_SEND to the vendor
   (`services/agent-orchestrator/agents/provider_communication_agent.py:669-714`) —
   the first real action should not be one that spends money and posts a letter.
9. **Give the command palette an appendable registry** so *One-tap actions* can be
   reached from it — the founder named the palette as a second way in.
   `components/CommandPalette.tsx` builds its items inside the component from route
   and permission context, so no page can contribute one today. Mirrored in
   [[notifications]] §13.14.
10. ~~**Decide whether two `HoldToApprove` dies on one screen is one too many**~~
   **ANSWERED 2026-09-05** (§1b): the wax now sits only where a write leaves the
   page. The rail's die moved off the written note — which is a record — and onto
   the delivery confirmation, which books stock. Both dies on this page are now
   redeemed seals rather than asserted ones.

**Added 2026-09-04 — the seal reached this card.**

11. **Prove a redemption against a database that has the seal table.** Nothing
   anywhere has yet exercised a SUCCESSFUL redeem: the local gateway points at
   production (so no order may be approved from it) and the tenant it reaches
   has zero orders. Every claim about the happy path is a spec, on this page and
   on [[orders]]. *Blocker: a scratch database with `mcp_seal_challenges`
   applied, or a staging tenant with a disposable order.*
12. ~~**Give the one-tap die the same mint.**~~ **DONE 2026-09-05.** It needed no
   new subject kind after all, and that is the design decision worth recording: the
   thing being sealed is the **order**, not the card. A card is a piece of paper
   pointing at an order, and two cards pointing at one order must not be two
   independent permissions to book its stock — so the seal is
   `subject_kind: "procurement_order"`, `subject_id` the order, and the act is
   `deliver`. An order seal minted for `approve` therefore cannot be spent here:
   `SealChallengeService` compares the act and answers *"That seal was issued for a
   different act on this order."* `common/seal/**` was not edited (another builder
   holds it this session); only its service is imported.

**Added 2026-09-05 — after the first real action.**

13. **Raise a `delivery_confirm` card from procurement** so the sealed path is used
   and not merely built (§9). One `createSystemAction` call in
   `apps/api-gateway/src/procurement/procurement.service.ts` when an approved order
   reaches its expected delivery date. This is now the single highest-value item for
   the panel — item 7's general form, narrowed to the one act that works.
14. **Make the reorder real behind a vendor and a price**, when there is a card that
   carries both and a decision about the auto-send gate. Until then it is disabled
   and says why, which is the honest state, not a placeholder.
15. **Decide whether `markDelivered` should refuse an already-delivered order itself.**
   The refusal lives in `one-tap-actions.service.ts` today (both on the mint and on
   the write), because that is the caller this pass owns — but
   `procurement.service.ts:2868-2878` books `quantity_received` and moves stock every
   time it is called, so the same double-booking is available to every other caller
   of it. *Owner: `procurement/`.*
