---
type: software
slug: receiving
name: Receiving
division: restaurant
status: partial
tier: core
routes: ["/receiving", "/receiving/:orderId/door"]
pages: [receiving, receiving-door]
api_modules: [procurement]
agents: [visual_verification_agent]
owner_unit: procurement-vendor-network
updated: 2026-09-01
links: ["[[receiving]]", "[[receiving-door]]", "[[orders]]", "[[inventory-command]]", "[[receipts-invoice-match]]", "[[procurement-vendor-network-charter]]", "[[SOFTWARE-MAP]]"]
---

# Receiving

## §0 What it is

What happens when the truck shows up. Whoever is at the door opens a full-screen flow that
asks three things — a photo of the paper the driver handed over, how many boxes came, was
anything obviously broken — and nothing else. No prices, no decisions, no scrolling: the
person holding the door is not the person who argues about money. It works with no signal,
because delivery bays do not have any. Later, at a desk, a manager sees the deliveries that
need a decision, worst money first, and the owner sees one number: what actually came back.

## §1 Features today

- Pick which delivery you are receiving, from the list of orders actually out for delivery
- The door flow itself: photo of the paperwork, box count, damage flag — three questions
- Works offline: submissions queue in an outbox and sync when signal returns
- No prices anywhere in the staff view, by design
- A manager queue of deliveries needing a decision, ordered worst-money-first, with the
  money-at-risk total
- An unverified-deliveries safety net — stock booked on a case count with no paperwork yet
- An owner view showing recovered credits — money that came back
- Photo upload is **proposal-only** and says so: nothing is written to stock, cost, or the
  order (`services/api/receiving.ts:79-84`)

## §2 Screens

- [[receiving]] — the entry point. `/receiving` behind `PageGate` (`apps/web/src/App.tsx:288`),
  `legacy={<ReceivingHome />}`. One event, three renderings chosen by role from `useAuth`;
  an unknown role falls to the cost-free staff view (`ReceivingHome.tsx:61-72`).
- [[receiving-door]] — the door flow itself. `/receiving/:orderId/door` behind `PageGate`
  (`App.tsx:224-227`), **deliberately outside `DashboardLayout`** — no sidebar, no tips, no
  agent FAB, because every one of those is a tap in the way of a driver who is waiting
  (`App.tsx:217-222`).

## §3 Backend

`apps/api-gateway/src/procurement/receiving.controller.ts` — **3 endpoints**,
`@Controller("procurement/receiving")` at `:115`, `@UseGuards(JwtAuthGuard)` at `:114`.

| Endpoint | Line |
|---|---|
| `POST /procurement/receiving/orders/:id/door` | `:119` |
| `GET /procurement/receiving/queue` | `:153` |
| `GET /procurement/receiving/unverified` | `:170` |

Service: `receiving.service.ts`. The owner view's number comes from a *different*
controller — `GET /procurement/credits/stats` (`documents/credits.controller.ts:123`), owned
by [[receipts-invoice-match]].

**Shared-module seam:** this is three endpoints inside the same `procurement` module that
holds [[orders]] (26), [[recurring-orders]] (6) and [[receipts-invoice-match]] (10).

## §4 Automation

- `visual_verification_agent.py` (1,185 LOC) — tier **ON_DEMAND**, gated behind
  `FEATURE_VISUAL_VERIFICATION`, depends on `inventory_engine`
  (`core/agent_registry.py:144-146`). Real code, not a stub, but **flag-gated off**: it does
  not run unless the feature flag is set.

No `@Cron` sweep. Every receipt is initiated by a human at a door.

## §5 Data

Written and read from `receiving.service.ts`: `procurement_receipt_events` (owned by this
software), `procurement_orders` (owned by [[orders]]), `procurement_credits` (owned by
[[receipts-invoice-match]]). All three verified in
`supabase/migrations/20260805000000_baseline_from_production.sql`.

Stock movement is not a table write here — it goes through the ledger RPC, which is
[[inventory-command]]'s surface.

## §6 Owner

[[procurement-vendor-network-charter]] — team `procurement-vendor-network`, department
`engineering`, division Platform. The charter names receiving in its mandate sentence —
*"Own the money path outward: orders, RFQs, receiving, credits, recurring orders, vendor…"*
(`procurement-vendor-network-charter.md:20`) — and books `procurement/receiving` at **3**
endpoints in its owned-outright table (`:33`), matching §3.

## §7 Maturity & seams

**partial.**

⚠️ **This is an upgrade from the page notes, on evidence.** [[receiving]] §10 records
`maturity: broken` and names three defects. **All three are now fixed in the tree** and the
page note is stale:

| [[receiving]] §10 defect | Current state |
|---|---|
| Filters on `status=SENT`, which is not a member of `ProcurementOrderStatus` → 400 on every load | **Fixed.** `IN_FLIGHT_STATUSES = ['CONFIRMED', 'IN_TRANSIT']` (`ReceivingHome.tsx:96`), with a 19-line comment recording exactly why `SENT` was wrong (`:77-95`) |
| Unwraps `data?.items ?? data ?? []` against a response shaped `{ orders, … }` | **Fixed.** `(data?.orders ?? []) as OpenOrder[]` (`ReceivingHome.tsx:138`) |
| No `isError` branch — a 400 renders as "Nothing is out for delivery" | **Fixed.** `isError` is destructured (`:123`) and renders a `role="alert"` block that says the fetch failed, offers a retry, and names the paper fallback (`:164-170`) |

The reachability gap is also closed: OD-83 (resolved 2026-08-26) added the sidebar entry —
`href: '/receiving'` at `components/layout/Sidebar.tsx:86`, pinned by
`Sidebar.receiving.test.tsx:70` to sit directly after Orders.

What is genuinely strong: the door write is idempotent and self-correcting — it books only
the *difference* against `quantity_received`, so a door count following `markDelivered`
corrects rather than doubles (`receiving.service.ts:96-185`); a `23505` on the idempotency
index returns `{ alreadyRecorded: true }`, the right answer to a retry
(`:142-148`); and cost is *deliberately* omitted so the lot lands
`cost_provenance='estimated'` rather than carrying a guess (`:174-178`).

Seams:
1. **Reconcile still hinges on a manual `verifyReceipt`** ([[ECOSYSTEM-PLAN]] §2) — the
   automated close does not exist.
2. **The owner view reads another software's controller** (§3), so the credits half of this
   screen breaks when [[receipts-invoice-match]] does.
3. **The four-way match that feeds the manager queue lives on the [[inventory-command]]
   page**, not here (`ReceivingWorkspace.tsx:274` → `procurement.controller.ts:244`) — the
   verification UI and the receiving UI are different screens owned by different teams.
4. `visual_verification_agent` is built and flag-gated off (§4).

## §8 Where it's going

> **Decided 2026-09-03:** the delivery becomes its own state machine — `RECONCILING ⇄ AGREED → VERIFIED`, *agreed* = both sides recorded, clocks as data, `UNORDERED` provenance, six human gates — [ADR 0103](../decisions/0103-a-delivery-is-agreed-before-it-is-verified.md); what it renders into is [ADR 0104](../decisions/0104-every-incoming-document-renders-as-one-canonical-mudavym-document.md). Design only; the door here is the first surface the build touches.

- [ADR 0049](../decisions/0049-ecosystem-division-layer.md) §3a: **Restaurant** division,
  phases **E1** and **E4**.
- [[ECOSYSTEM-PLAN]] §2 names the live gap precisely: *"both ends SOTA … the middle doesn't
  auto-close"* — receiving→four-way-match→credit→landed-cost works; deplete→reorder does not.
- **Correcting [[receiving]] §10 from `broken` to `partial` is an outstanding docs task** —
  the page note has not been re-verified since 2026-08-26.
- Turning `FEATURE_VISUAL_VERIFICATION` on for a real tenant is **unscheduled**; no OD row
  carries it.

