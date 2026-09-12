---
type: software
slug: recurring-orders
name: Recurring Orders
division: restaurant
status: backend-only
tier: core
routes: []
pages: []
api_modules: [procurement]
agents: [recurring_order_agent, auto_pilot_agent]
owner_unit: procurement-vendor-network
updated: 2026-09-01
links: ["[[orders]]", "[[receiving]]", "[[inventory-command]]", "[[procurement-vendor-network-charter]]", "[[SOFTWARE-MAP]]"]
---

# Recurring Orders

## §0 What it is

The standing order. You buy the same house red every Tuesday, so you should not have to
raise the same order every Tuesday — you set the schedule once and the system stages the
order for you when the day comes. It proposes; it never places. A human still approves
every order before a vendor sees it.

That is what the machinery does. **What a restaurant can actually do with it today is
nothing** — the schedule can be created and run through the API, but no screen in the
product will let a user set one up. §2 and §7 say exactly where that stops.

## §1 Features today

- Create, read, update, and delete a recurring-order template for a restaurant (API only)
- Trigger a schedule check on demand, which stages proposals for due templates (API only)
- A daily sweep over `recurring_orders` that stages purchase proposals and publishes
  reminder / approval-needed events — **gated off** behind
  `AGENT_RECURRING_ORDER_AGENT_ENABLED`
- Schedules write `calendar_events`, so a staged proposal shows up on the calendar
- A manager price override per template (`manager_override_price`)
- **Seeing** recurring orders mixed into the [[orders]] list — filter "Recurring Only"
  (`pages/Orders.tsx:1695`), a count tile (`:1750-1752`), a grouped section (`:2283-2300`)
- Creating one from the UI — **broken**. The Orders create form has a full recurring
  sub-form (frequency, auto-approve, start date: `Orders.tsx:367-370`) and submitting it
  hits `alert('Recurring orders are not supported yet. Create a one-time order instead.')`
  at `Orders.tsx:879-880`
- A standalone management page — **dark**. `apps/web/src/pages/RecurringOrders.tsx` exists,
  is fully written against all six endpoints, and is **not routed**: no `RecurringOrders`
  reference anywhere in `apps/web/src/App.tsx`, and its only importer in the repo is
  `__tests__/pages/RecurringOrders.deps.test.tsx:31`

## §2 Screens

`backend-only — no user surface.`

This software has no route of its own, which is why `pages: []`. Per the contract's
backend-only guidance, here is who consumes it and where a user touches it:

**Where users touch it today (read-only):** the [[orders]] screen. `/orders`
(`App.tsx:286`) reads `isRecurring` off each order and offers a "Recurring Only" filter, a
count, and a grouped section. That is *display of orders that are already recurring* — it
reads the flag on `procurement_orders` rows, not the `recurring_orders` templates. The
[[orders]] page note records this by carrying `softwares: [orders, recurring-orders]`.

**Where users cannot touch it:** creating, editing, pausing, or deleting a template. The
Orders create form collects the inputs and then refuses (§1). The page written to do this
job — `pages/RecurringOrders.tsx` — is orphaned code with no route.

**Other consumers:** `recurring_order_agent` (§4) sweeps the same table server-side, and the
schedules it stages surface as `calendar_events` on `/calendar`.

## §3 Backend

`apps/api-gateway/src/procurement/recurring-orders.controller.ts` — **6 endpoints**,
`@Controller("recurring-orders")` at `:36`.

| Endpoint | Line |
|---|---|
| `GET /recurring-orders/:restaurantId` | `:42` |
| `GET /recurring-orders/:restaurantId/:id` | `:59` |
| `POST /recurring-orders/:restaurantId` | `:78` |
| `PUT /recurring-orders/:restaurantId/:id` | `:102` |
| `DELETE /recurring-orders/:restaurantId/:id` | `:123` |
| `POST /recurring-orders/:restaurantId/execute-check` | `:142` |

⚠️ **The "unguarded" flag on this cluster is out of date.** `@UseGuards(JwtAuthGuard)` sits
at class level on `:35`, added under **OD-20 on 2026-08-25**. The controller carries a
14-line comment recording the original defect and how it was proven — *"Verified live before
the fix: GET /api/v1/dashboard/stats/<uuid> returned 200 with JSON to an unauthenticated
caller"* (`:22-33`) — and the reason it was not caught by `TenantGuard`: that guard fails
**open** by design. See §6 for the charter text this contradicts.

**Shared-module seam:** these 6 endpoints live inside the `procurement` module alongside
[[orders]] (26), [[receiving]] (3) and [[receipts-invoice-match]] (10).

## §4 Automation

- `recurring_order_agent.py` (634 LOC) — **real, and the most carefully gated agent in the
  fleet.** `class RecurringOrderAgent(BaseAgent)` at `:98`; registered in
  `core/orchestrator.py:223` and `core/agent_registry.py:209`. Tier **OPTIONAL**, depends on
  `notification_agent`. Autonomy tier is `propose_only` and *"this class has no
  order-placement path"* (`:108`); `RecurringOrderSafetyError` (`:90`) exists to keep the
  propose→confirm→execute gate from being edited away silently. The registry comment
  explains why OPTIONAL rather than CORE: *"a schedule sweep that starts on boot in every
  environment is exactly the kind of change that should be a decision rather than a side
  effect of a refactor"* (`agent_registry.py:195-203`). It needs
  `AGENT_RECURRING_ORDER_AGENT_ENABLED` to get a proxy at all.
- `auto_pilot_agent.py` (42 LOC) — **a stub, and says so.** *"This agent is a stub —
  process_message() logs and returns"* (`:12`), with three TODOs standing in for the whole
  job: evaluate `auto_pilot_rules`, create procurement orders when triggered, record
  `auto_pilot_executions` (`:40-42`). Tier OPTIONAL (`agent_registry.py:178-180`). It is the
  named E1 seam in [[ECOSYSTEM-PLAN]] §3a.

## §5 Data

From `recurring-orders.service.ts`: `recurring_orders` (`:77`, owned by this software) and
`calendar_events` (`:391`, owned by the calendar module). Both verified in
`supabase/migrations/20260805000000_baseline_from_production.sql`.

`auto_pilot_rules` and `auto_pilot_executions` are named only in the stub's TODOs and are
**not verified** — omitted rather than listed.

## §6 Owner

[[procurement-vendor-network-charter]] — team `procurement-vendor-network`, department
`engineering`, division Platform. The charter names recurring orders in its mandate — *"Own
the money path outward: orders, RFQs, receiving, credits, recurring orders, vendor…"*
(`procurement-vendor-network-charter.md:20`) — and lists
`services/agent-orchestrator/agents/recurring_order_agent.py` among the procurement agents
it owns (`:95`).

⚠️ **Two charter claims about this cluster are stale and should be corrected:**
- `:34` books `procurement/recurring-orders` as *"6 — **all unguarded**"*. The 6 is right;
  the "all unguarded" is not, as of the OD-20 fix (§3).
- `:76-77` tracks the secondary metric
  `procurement.unguarded_money_moving_routes` as *"currently at least 6, the
  `recurring-orders` cluster"*, and `:97` restates it as *"the named exposure, stated
  plainly"*. On the current tree that count from this cluster is **0**.

## §7 Maturity & seams

**backend-only.** Six guarded endpoints, a real table, and a genuinely well-built
propose-only agent — behind zero user surface. This is the cleanest example in the atlas of
a software that is finished on the server and absent from the product.

Seams:
1. **The create path is an `alert()`.** `Orders.tsx:879-880` collects frequency,
   auto-approve and start date, then refuses. The UI implies a capability the same file
   blocks four hundred lines earlier.
2. **A complete UI exists and is unrouted.** `pages/RecurringOrders.tsx` implements list,
   create, edit, pause, delete and price override against all six endpoints, and nothing in
   `App.tsx` renders it. Its only importer is a test. This is dead code that looks like a
   feature.
3. **That orphan page bypasses the API client.** It calls raw `axios` throughout
   (`:72, :90, :99, :182, :510, :512`) rather than `apiClient`, so it would skip the auth
   and refresh interceptors — it could not authenticate against the now-guarded controller
   without rework. Routing it as-is would not work.
4. **The agent is gated off**, and its one dependency (`notification_agent`) exists
   precisely because the events it publishes have no other consumer
   (`agent_registry.py:205-208`) — starting it without one would stage proposals nobody is
   told about.
5. **`auto_pilot_agent` is a stub** (§4) — the autonomous half of this promise is a
   42-line log-and-return.

## §8 Where it's going

- [ADR 0049](../decisions/0049-ecosystem-division-layer.md) §3a: **Restaurant** division;
  `recurring_order_agent` is named in its module list. `auto_pilot_agent` is named in the
  **Agent fleet/runtime** row as *"the `auto_pilot_agent` stub"*, phase **E1**.
- **E1 is where this software's gap is scheduled**: *"activate `AutoPilotAgent` behind the
  human gate, on the A3 action schema"* ([[ECOSYSTEM-PLAN]] §7.1) — E1 was locked to lead
  after E0 by the founder on 2026-08-28.
- [[ECOSYSTEM-PLAN]] §2 records that the `recurring_order_agent` auto-approve per-order gate
  was **closed by the A3 fix (PR #152)**.
- **OD-31** carries the live fork: *"decide whether `recurring_order_agent` becomes a real
  agent or is deleted."* ⚠️ Its supporting evidence is stale — it states the class is *"a
  plain class, not a `BaseAgent`, reachable only from its own factory and its own test"*,
  which `recurring_order_agent.py:98` and `orchestrator.py:223` contradict. The fork is
  therefore narrower than filed: the agent is already real and registered; what is undecided
  is whether to turn it on.
- **Giving this software a screen is unscheduled.** No OD row and no agenda item covers
  routing `RecurringOrders.tsx` or replacing the `Orders.tsx` alert.

