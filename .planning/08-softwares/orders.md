---
type: software
slug: orders
name: Orders
division: restaurant
status: partial
tier: core
routes: ["/orders"]
pages: [orders]
api_modules: [procurement]
agents: [procurement_agent, rfq_agent]
owner_unit: procurement-vendor-network
updated: 2026-09-01
links: ["[[orders]]", "[[receiving]]", "[[inventory-command]]", "[[recurring-orders]]", "[[receipts-invoice-match]]", "[[procurement-vendor-network-charter]]", "[[SOFTWARE-MAP]]"]
---

# Orders

## §0 What it is

The order pad. You pick a vendor, build a list of what you need, send it, and watch it
move from draft to approved to delivered. When the vendor writes back, their reply lands
here too — with a drafted answer waiting for you to approve, edit, or throw away, and any
deal they offered pulled out of the email so you can accept or dismiss it in one tap. When
the delivery arrives you book it into stock from this screen. It is the money path
outward: everything a restaurant spends starts as a row on this page.

## §1 Features today

- See the purchase-order list, filtered, with each order's status through delivery
- Create an order — pick a vendor, build the item list, submit
- Approve, edit, or cancel an order you have already raised
- Book a delivered order into inventory in one step
- See active vendor conversation threads and open the message drawer per conversation
- View attachments a vendor sent — invoices, price lists
- One-tap approve an AI-drafted reply to a vendor; write a manual reply instead; pause the
  AI on one thread; cancel a send that is already scheduled
- Deal proposals extracted from vendor mail — confirm or dismiss
- Table export, a pending-order count badge in the sidebar, live updates while open
- Contextual insights rail — **broken**: it calls the analytics API with raw `fetch` and no
  `Authorization` header against a class-guarded controller, and swallows the 401
  (`components/insights/ContextualInsights.tsx:118,121,176`; guard `analytics.controller.ts:51`)
- Recurring orders — **dark here**. The list can *filter* to them, but the create path is a
  hard stop: `alert('Recurring orders are not supported yet…')` at `pages/Orders.tsx:879-880`.
  See [[recurring-orders]] for the backend that exists behind that alert.

## §2 Screens

- [[orders]] — the whole software, one route. `/orders` is behind `PageGate`
  (`apps/web/src/App.tsx:286`): `legacy={<Orders />}` renders `apps/web/src/pages/Orders.tsx`,
  `next={<OrdersNext />}` renders `pages/orders/next/OrdersNext.tsx` behind
  `mudavym_design_orders`. Check the flag before trusting a screenshot.

The page also hosts a second software — [[recurring-orders]] — which is why the page note
carries `softwares: [orders, recurring-orders]`.

## §3 Backend

`apps/api-gateway/src/procurement/` — **26 endpoints**, `@Controller("procurement")` at
`procurement.controller.ts:32`, `@UseGuards(JwtAuthGuard)` at class level `:33`.

| Cluster | Endpoints | Lines |
|---|---|---|
| Order CRUD + lifecycle | 11 | `:37, :66, :83, :102, :118, :135, :152, :175, :198, :219, :245` |
| AI draft / vendor-reply layer | 11 | `:280, :306, :349, :379, :403, :428, :452, :488, :512, :534, :618` |
| Conversations & attachments | 4 | `:570, :594, :648, :671` |

**The module is shared, and that is the seam.** The same `procurement` module also holds
[[receiving]] (`receiving.controller.ts`), [[recurring-orders]]
(`recurring-orders.controller.ts`) and half of [[receipts-invoice-match]]
(`documents/`). `procurement.service.ts` is 3,035 lines serving all four.

## §4 Automation

- `procurement_agent.py` (1,142 LOC) — tier **CORE**, depends on `inventory_engine` +
  `notification_agent` (`core/agent_registry.py:78-80`). Real, not a stub.
- `rfq_agent.py` (816 LOC) — tier **ON_DEMAND**, depends on `procurement_agent`
  (`agent_registry.py:162-164`). Real; runs only when asked.

Note the wiring caveat recorded in [[ECOSYSTEM-PLAN]]: `buffer_manager → procurement_agent`
feeds off the **dormant Python** `pos_integration_agent`, while live depletion runs through
the NestJS `toast`/`pos-hub` path — so the automated leg of this software is wired to the
wrong pipeline. That is the E1 seam, not a defect in this module.

## §5 Data

Read from `procurement.service.ts`: `procurement_orders`, `procurement_conversations`,
`procurement_credits`, `conversation_attachments`, `providers`, `restaurant_inventory`,
`inventory_events`, `calendar_events`, `notifications`, `communication_templates`,
`restaurants`, `restaurant_branding`. All verified present in
`supabase/migrations/20260805000000_baseline_from_production.sql`.

It **owns** `procurement_orders` and `procurement_conversations`. It *writes into*
`restaurant_inventory` and `inventory_events`, which [[inventory-command]] owns — the
delivery hand-off crosses a team boundary.

## §6 Owner

[[procurement-vendor-network-charter]] — team `procurement-vendor-network`, department
`engineering`, division Platform
(`01-org/platform/engineering/teams/procurement-vendor-network/`). The charter claims this
scope explicitly: *"Own the money path outward: orders, RFQs, receiving, credits, recurring
orders, vendor…"* (`procurement-vendor-network-charter.md:20`), and books
`apps/api-gateway/src/procurement/procurement` at **26** endpoints (`:30`) — the count this
note independently reproduced.

Its primary metric is `procurement.order_to_delivery_reconciliation_rate`: ordered lines
that resolve to a received lot at the agreed price **without human repair** (`:68-72`).

## §7 Maturity & seams

**partial**, inherited from [[orders]] §10. The procurement lifecycle genuinely persists end
to end; two writes are theatre and one panel is dead.

What is real: `markDelivered` releases shadow and receives live through two idempotent
`apply_stock_movement` RPCs plus an `inventory_events` row keyed
`order-delivered:{orderId}` — replay-safe ledger writes (`procurement.service.ts:903-1038`).
The draft-email layer is server-guarded, with guardrails and a 2-minute undo window living
in `InboundResponderService`, not the client (`procurement.controller.ts:279-635`).

Seams:
1. **`Orders.tsx` is 3,616 lines** and fuses five concerns: order CRUD, the AI vendor-email
   layer, provider records, inventory lookups, and wine mapping. The co-located
   `pages/orders/` split is partial ([[orders]] §9). Nothing here extracts cleanly.
2. **`POST /inventory/add-from-order` does not exist and never has.** The delivered-order
   handler fires it with raw `axios`, then swallows the failure
   (`pages/Orders.tsx:686-696`); the inventory controller's full route list
   (`inventory.controller.ts:35-429`) contains no such route. Harmless — the stock movement
   is already done server-side by `/deliver` — but the code, its comment and its optimistic
   UI all imply otherwise.
3. **Silent skip inside `markDelivered`.** If the inventory row has no `master_wine_id` no
   stock movement runs, but the `order_delivered` event row is still inserted and the API
   returns success (`procurement.service.ts:974,1026-1038`). A delivery of an unmapped wine
   reports as booked and moves nothing.
4. **The insights rail 401s** (§1).
5. **One module, four softwares** (§3).

## §8 Where it's going

- [ADR 0049](../decisions/0049-ecosystem-division-layer.md) §3a puts this in the
  **Restaurant** division, phases **E1** (the hop-4 bridge) and **E4** (hop-10 write-back).
- **E1** is the live one: unify the POS pipeline so `procurement_agent` feeds the live NestJS
  path instead of the dormant Python one ([[ECOSYSTEM-PLAN]] §7.1, locked 2026-08-28).
- The god-file split and the phantom `add-from-order` call are **unscheduled** — neither has
  an OD row nor an agenda item; they are recorded in [[orders]] §9 only.

