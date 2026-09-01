---
type: software
slug: dashboard-home
name: Dashboard Home
division: restaurant
status: partial
tier: core
routes: ["/"]
pages: [dashboard]
api_modules: [dashboard]
agents: []
owner_unit: ""
gap_reason: "No charter claims `src/dashboard/` or `Dashboard.tsx`. Three teams own slices and each disclaims the rest; the only mentions in 100 charters are stale guard-backlog rows"
updated: 2026-09-01
links: ["[[dashboard]]", "[[notifications]]", "[[reports-analytics]]", "[[calendar]]", "[[SOFTWARE-MAP]]"]
---

# Dashboard Home

## §0 What it is

The screen you land on when you open Mudavym. It answers one question — *what should I
deal with first this morning?* — with today's numbers across the top, the alerts that
need a person, a strip of what is coming up, and a feed of what just happened. The
approve-in-one-tap cards that sit in the middle of it are the same cards that appear in
[[notifications]]; this page is where most people meet them.

## §1 Features today

- Switch between your restaurants and branches
- See today's KPI tiles — vendor spend, stock, orders, alerts
- Open a KPI tile into a detail modal, then jump to the full page behind it
- Read a recent-activity feed and a spend chart
- See a reminders list and a calendar strip of important dates; add your own
- Copy an iCal subscription URL for the calendar feed
- Approve pending orders and low-stock reorders in one tap, from the action centre
- Watch it update live while the page is open (realtime calendar and inventory events)

## §2 Screens

- [[dashboard]] — the whole software; route `/` behind `PageGate`
  (`apps/web/src/App.tsx:278`, `page="dashboard"`, `legacy={<Dashboard />}` /
  `next={<DashboardNext />}`). The flag decides which of two surfaces renders, so a
  screenshot proves nothing until you know which side of the gate you were on.

Component tree: `apps/web/src/pages/Dashboard.tsx` (1,849 lines) plus the shared
`components/notifications/OneTapActionCenter.tsx`, which this page and [[notifications]]
both mount. The Mudavym-redesign surface is `pages/dashboard/next/DashboardNext.tsx`
(lazy, `App.tsx:78`).

## §3 Backend

`apps/api-gateway/src/dashboard/` — `@Controller("dashboard")` at
`dashboard.controller.ts:52`, **8 endpoints, all GET**, all behind class-level
`JwtAuthGuard`.

| Endpoint | Controller |
|---|---|
| `GET /dashboard/summary/:restaurantId` | `dashboard.controller.ts:70` |
| `GET /dashboard/calendar-revenue/:restaurantId` | `:111` |
| `GET /dashboard/stats/:restaurantId` | `:158` |
| `GET /dashboard/activity/:restaurantId` | `:187` |
| `GET /dashboard/alerts/:restaurantId` | `:223` |
| `GET /dashboard/sales-chart/:restaurantId` | `:247` |
| `GET /dashboard/inventory-breakdown/:restaurantId` | `:286` |
| `GET /dashboard/health` | `:313` |

**The module is a read-only aggregator and owns no domain.** Every number it returns is
someone else's data re-queried; it writes nothing. The write side of the page belongs to
other modules — `one-tap-actions` (execute/cancel), `procurement` (mark delivered),
`calendar` (`GET /calendar/ical-token`, called at `pages/Dashboard.tsx:266-268`).

## §4 Automation

`none` — every action on this page is human-initiated. The page *displays* the output of
other softwares' automation (the low-stock sweep at
`notifications/low-stock-alerts.service.ts:85,110`, the hourly insight refresh at
`analytics/insights/insight-scheduler.service.ts:42`) but schedules nothing of its own.

## §5 Data

Read from `apps/api-gateway/src/dashboard/dashboard.service.ts`: `procurement_orders`,
`restaurant_inventory`, `v_low_stock_items`, `calendar_events`, `notifications`,
`generated_reports`, `wine_consumption_log`, `events`. **It owns none of them.** The
`events` rows it renders as activity are the product-telemetry stream written by
`apps/api-gateway/src/events/` — the same stream [[calendar]] uses for cross-device sync,
not a dashboard-private log.

## §6 Owner

**`unowned — gap`.** No charter in `.planning/01-org/` claims
`apps/api-gateway/src/dashboard/` or `apps/web/src/pages/Dashboard.tsx`. The only
mentions of the module anywhere in the 100 charters are guard-backlog rows —
`security-charter.md:109` (`dashboard` 8, in the 94 unguarded-by-omission count) and
`access-control-tenant-isolation-charter.md:83` — both of which are now stale, and
neither of which is an ownership claim.

Three teams own *pieces* and each explicitly disclaims the rest:

- [[client-surfaces-charter]] owns `apps/web` as an artifact — "whether the built screen
  matches the intended one, renders, performs, and can be reached" — and names *"whether
  the data on the screen is correct"* as **not ours**
  (`client-surfaces-charter.md:32,60`).
- [[surface-portfolio-charter]] owns the verdict on *whether the route should exist*, not
  what it does (`surface-portfolio-charter.md:26-28`).
- [[action-safety-the-human-gate-charter]] owns the propose→confirm→execute gate the
  action centre implements, not the page hosting it.

The landing page of the product has no product owner. That is the finding, and it belongs
in [[SOFTWARE-MAP]]'s gap table rather than being smoothed over with a plausible guess.

## §7 Maturity & seams

**partial** — and the page note's rolled-up verdict needs correcting.

[[dashboard]] §10 reads **`hollow`**, on two findings: (a) one-tap approve wrote nothing
to the server, fabricating `ORD-${Date.now()}` ids into `localStorage` behind a 300 ms
timer; (b) "Total Revenue" was actually `procurement_orders.total_cost` — money paid
*out* — rendered as income. **Both were fixed in commit `58113e26`, the same commit that
wrote the dossier.** The dossier recorded the pre-fix tree and was never revised
(`git log` on `.planning/06-pages/dashboard.md` shows only frontmatter edits since).
Verified against this working tree:

| Was | Now |
|---|---|
| Fake approve | `commitApproval` (`OneTapActionCenter.tsx:654`) calls `executeOneTapAction` for `source: 'server'` cards (`:658`) and `markOrderDelivered` for derived delivery cards. Its docblock states the rule: *"Every branch here either calls a real endpoint or throws"* (`:645-653`) |
| Server module unconsumed | `getOneTapActions` is called at `OneTapActionCenter.tsx:511`; `executeOneTapAction` at `:658,804` |
| Cost labelled revenue | The KPI is `procurementSpend` end to end — `ModalType` (`Dashboard.tsx:101`), the modal heading "Vendor Spend" (`:1125`), the tile (`:1456`); the service method is `getProcurementSpendSummary` with the mislabel written up in its docblock (`dashboard.service.ts:297-308`) |

What is genuinely still open:

1. **Derived cards cannot be recorded.** Cards rebuilt client-side from inventory and
   orders carry `source: 'derived'` and no server row, so approving one has nowhere to
   land. The code refuses rather than pretending (`OneTapActionCenter.tsx:66-73`) — an
   honest failure, not a fixed one. Two card-construction paths, one server and one
   `localStorage`, still coexist in a 900-line component.
2. **The iCal URL is still origin-relative.** The token now comes through `apiClient`
   (`Dashboard.tsx:266-268`), but the URL handed to the user is
   `${window.location.origin}/api/v1/calendar/feed/${token}.ics` (`:270`) — correct only
   where the web host proxies the gateway. Nothing has ever confirmed the feed subscribes
   in a real client (`v3.0-TECH-DEBT.md:243-245`).
3. **The module owns nothing and duplicates everything.** Eight endpoints that re-derive
   figures other modules already publish. `dashboard`, `analytics` and `reports` compute
   overlapping metrics from the same tables with no shared definition — see
   [[reports-analytics]] §7 for the same seam from the other side.
4. **A 1,849-line page component.** Not a defect, but it is why the page's own behaviour
   is hard to establish without reading it end to end.

## §8 Where it's going

- ADR 0049 §3a puts the `dashboard` module under the **Restaurant** division
  (`.planning/04-specs/ECOSYSTEM-PLAN.md:54`), with no E-phase naming it — this software
  is downstream of every phase and the subject of none.
- The `mudavym_design_dashboard` flag and `pages/dashboard/next/` are the live rebuild
  lane (ADR 0047); until the gate flips, two surfaces must both be kept true.
- Closing the derived/server split in the action centre is the one change that would move
  this to `live`: every card either has a server row or is not offered.
- The ownership gap in §6 is the first thing to resolve — it is what makes items 1–3
  nobody's queue.
