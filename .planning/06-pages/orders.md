---
type: page
route: /orders
slug: orders
component: apps/web/src/pages/Orders.tsx
audience: owner
tier: core
archetype: command # proposed 2026-08-26 (OD-79)
signals_today: none
rebrand_strings: 4
maturity: partial
status: documented
updated: 2026-08-26
links: ["[[PAGE-CONTRACT]]", "[[receiving-door]]", "[[providers]]"]
---

# /orders — Orders

## Surface — buttons → where they go

- **Create Order** → (modal on this page) → API `POST /api/v1/procurement/orders`
- **Approve** → API `POST /api/v1/procurement/orders/:id/approve`
- **Mark as delivered** → API `POST /api/v1/procurement/orders/:id/deliver`
- **Receive at the door** (row menu) → [[receiving-door]] `/receiving/:orderId/door`
- **Go to Providers** (no-vendor guard modal) → [[providers]] `/providers`
- **Export** → (in-page download via ExportMenu)
- **Draft email approval panel** → (panel on this page — approve/send vendor email)

## 1. Purpose

The procurement cockpit: draft, approve, cancel and track purchase orders through
delivery, plus the AI vendor-email layer — one-tap approval of AI-drafted replies,
active conversation threads, deal proposals, and delivered-order booking into
inventory. Sidebar tooltip: "Draft, approve, and track purchase orders through
delivery" (`apps/web/src/components/layout/Sidebar.tsx:75`).

## 1a. Features
- See the purchase-order list with filters and per-order status through delivery (draft → approved → delivered)
- Create an order: pick a vendor, build the item list, submit — then approve, edit, or cancel it
- Book a delivered order into inventory in one step
- AI vendor-email layer: one-tap approve an AI-drafted reply, write a manual reply, pause the AI, cancel a scheduled send
- See active vendor conversation threads and open the chat/message thread drawer per conversation
- Deal proposals extracted from vendor mail: confirm or dismiss
- View conversation attachments (invoices, price lists)
- Contextual insights rail; table export; pending-order count badge in the sidebar
- Live updates while the page is open (realtime order events)

## 2. Entry

In-degree 4 ([PAGE_MAP](../foundation/PAGE_MAP.md):140): from `/`, `/inventory`,
`/providers`, `/receiving`. Sidebar item (`Sidebar.tsx:73`); pending-order count
badge (`Sidebar.tsx:409`). Eagerly loaded (`apps/web/src/App.tsx:73`).

## 3. Files

- Route binding: `apps/web/src/App.tsx:257`.
- `apps/web/src/pages/Orders.tsx` (3,614 lines — largest page in the app).
- Co-located: `pages/orders/{useOrdersPage.ts, OrderSummary.tsx, OrderFilters.tsx, CreateOrderModal.tsx, index.tsx}`.
- Rendered components: `components/orders/{OrderApprovalModal, OrderGuardModal, DraftEmailApprovalPanel, ActiveConversationsPanel, CommsThreadDrawer}.tsx`, `components/insights/ContextualInsights.tsx` (Orders.tsx:5-10).

## 4. Endpoints

Atlas rows: [ENDPOINTS](../foundation/ENDPOINTS.md):389 (`procurement`, 26), :249
(`inventory`), :461 (`providers`), :663 (`wines`), :10 (`analytics` — atlas's ⚠ unguarded
is stale; guarded at class level since 2026-08-24 (#31),
`apps/api-gateway/src/analytics/analytics.controller.ts:51`).

| Method | Path | Call site |
|---|---|---|
| GET | `/procurement/orders` (list) | `useOrders` → `services/api/orders.ts:53` |
| POST | `/procurement/orders` | `pages/Orders.tsx:966` |
| PATCH / DELETE | `/procurement/orders/:id` | `pages/Orders.tsx:583` / `:532,3323` |
| POST | `/procurement/orders/:id/approve` | `pages/Orders.tsx:514,3275` |
| POST | `/procurement/orders/:id/deliver` | `pages/Orders.tsx:651` |
| POST | `/inventory/add-from-order` | raw axios, `pages/Orders.tsx:684` |
| GET/PATCH | `/procurement/orders/:id/draft` | `pages/Orders.tsx:417,1021`; `hooks/queries/useDraftEmailQueries.ts:57,404` |
| POST | `…/approve-draft`, `…/generate-ai-reply`, `…/discard-draft`, `…/manual-reply`, `…/ai-pause`, `…/cancel-scheduled-send` | `useDraftEmailQueries.ts:78,103,128,225,241,255` |
| GET | `…/conversations`, `…/attachments` | `useDraftEmailQueries.ts:186,212` |
| GET/POST | `…/deal-proposal`, `…/confirm-deal`, `…/dismiss-deal` | `useDraftEmailQueries.ts:352,367,388` |
| GET | `/providers` | `useProviders` → `services/api/providers.ts:201` |
| GET/POST | `/analytics/insights/:rid`, `/analytics/recommendations/:rid/action(s)` | `components/insights/ContextualInsights.tsx:118-192` |

## 5. Signals

**None.** No tracking, no `uxSignals` (reporter dark per `lib/uxSignals.ts:15`, zero
page importers), no `data-ux-key` markers in this tree. Guidance tips render here via
`useGuidanceOptional` (Orders.tsx:58) but `trackGuidance` has no sink
(`guidance/analytics.ts:29-39`).

## 6. Tier cut

**Core** — operate. Scenarios: S02 (PO-prefilled delivery flow starts from orders),
S03 (credit chase drafts), S08 (price context via insights), S13 (vendor add → first
order). S02/S03 Core are ✅ ships-today ([TIER-MAP](../03-scenarios/TIER-MAP.md):38-39).

## 7. Rebrand surface

**4 user-visible strings** — the AI-draft disclaimer "Sent via WineOps AI — This
message was generated with AI assistance." shown in email previews and appended to
outbound mail: `pages/Orders.tsx:430,1039,3457,3535`. Plus shared layout chrome
(see dashboard.md §7).

## 8. State & config

- `VITE_API_GATEWAY_URL` (`Orders.tsx:60`) — one call uses raw axios against it (:684).
- Realtime order updates via `useRealtimeDispatch` (`Orders.tsx:49`).
- Table export via `ExportMenu`/`exportTable` (`Orders.tsx:56-57`).
- Draft-email guardrails are server-side; the page only stages one-tap approvals
  (memory: autonomous-email-replies — never auto-send).

## 9. Gaps

- `v3.0-TECH-DEBT.md:495` — UX-catalog claim that `ActiveConversationsPanel` is
  unreachable is **stale**; `Orders.tsx:1512` sets its open state.
- The delivered-order booking path posts to `/inventory/add-from-order` with raw
  axios instead of `apiClient` (`Orders.tsx:684`) — skips the client's auth/refresh
  interceptors; works only because a token header is attached manually.
- 3,614 lines in one file; the co-located `pages/orders/` split is partial.

## 10. Maturity

**partial.** The procurement lifecycle genuinely persists end to end; one write posts to
a route that does not exist, and the insights rail is unauthenticated.

| Evidence | `path:line` |
|---|---|
| **Delivery books stock properly.** `markDelivered` releases shadow and receives live through two idempotent `apply_stock_movement` RPCs plus an `inventory_events` row keyed `order-delivered:{orderId}`. Real ledger writes, replay-safe. | `procurement.service.ts:903-1038` |
| **`POST /inventory/add-from-order` does not exist.** The delivered-order handler fires it with raw `axios`, then swallows the failure: `.catch(err => console.log('Inventory API endpoint not ready yet: …'))`. A repo-wide grep finds **one** occurrence of the string — this call site. It has always 404'd. | call `pages/Orders.tsx:686-696`; the inventory controller's full route list `inventory.controller.ts:35-429` contains no such route |
| The above is *harmless but dishonest*: the stock movement it appears to perform is already done server-side by `/deliver`. The code, its comment ("Also try API call for persistence") and its optimistic UI all imply otherwise. | `Orders.tsx:660-684` |
| **Silent skip inside `markDelivered`.** If the inventory row has no `master_wine_id`, no stock movement runs — but the `inventory_events` `order_delivered` row is still inserted and the API returns success. A delivery of an unmapped wine reports as booked and moves nothing. | `procurement.service.ts:974,1026-1038` (the `if (masterWineId)` guard sits inside, the event insert outside) |
| **Draft-email layer is real and server-guarded.** Every draft route carries `JwtAuthGuard`; guardrails, commitment-pattern checks and a 2-minute undo window live in `InboundResponderService`, not the client. | `procurement.controller.ts:279-635`; `common/orchestrator/inbound-responder.service.ts:129-146,30` |
| **The insights rail 401s** — `ContextualInsights` uses raw `fetch` with no `Authorization` against the analytics controller, which is class-guarded since #31; the JWT strategy accepts a bearer header only. Fails into `catch { /* fail quiet */ }`. | `components/insights/ContextualInsights.tsx:118,121,176`; `analytics.controller.ts:51`; `auth/strategies/jwt.strategy.ts:11` |

## 11. Data flow

### Calls out

| Method · Path | Auth | Gateway controller | Returns |
|---|---|---|---|
| GET `/procurement/orders` | JWT (class) | `procurement.controller.ts:65` → `procurement.service.ts:454` | `{ orders, total, page, limit, hasMore }` — client unwraps `.orders` (`services/api/orders.ts:56`) |
| POST `/procurement/orders` | JWT | `:36` | created PO; reserves shadow stock (`procurement.service.ts:855`) |
| PATCH · DELETE `/procurement/orders/:id` | JWT | `:151`, `:174` | updated / cancelled; cancel also kills the linked calendar delivery event (`:689-699`) |
| POST `…/:id/approve` | JWT | `:197` | approved; publishes a conversation intent to RabbitMQ (`:880-897`) |
| POST `…/:id/deliver` | JWT | `:218` → `:903` | delivered + two ledger movements |
| POST `…/:id/verify-receipt` | JWT | `:244` | match verdict; opens `procurement_credits` claims (`:1104-1130`) |
| GET/PATCH `…/:id/draft`, POST `…/approve-draft`, `…/generate-ai-reply`, `…/manual-reply`, `…/discard-draft`, `…/ai-pause`, `…/cancel-scheduled-send` | JWT (per-route) | `:279-556,605` | draft lifecycle |
| GET `…/:id/conversations`, `…/attachments`, `…/deal-proposal`; POST `…/confirm-deal`, `…/dismiss-deal` | JWT | `:427-604` | thread + deal state |
| POST `/inventory/add-from-order` | raw axios, token attached by hand | **no controller — 404** | nothing |
| GET `/providers` | JWT via `apiClient` | `providers.controller.ts:215` | roster for the create-order picker |
| `/analytics/insights/:rid`, `…/recommendations/:rid/action(s)` | **JWT required, none sent** → 401 | `analytics.controller.ts:243,654,757` | nothing (§10) |

### Fed by

| Producer | Mechanism | `path:line` |
|---|---|---|
| The orders themselves | manual entry on this page; recurring-order generator | `Orders.tsx:966`; `procurement/recurring-orders.service.ts:225,271` (`@Cron` 08:00 and 06:00) |
| Vendor replies + AI drafts | Postmark inbound → RabbitMQ bridge → `InboundResponderService` (Claude Haiku 4.5) | `common/orchestrator/rabbitmq-bridge.service.ts`; `inbound-responder.service.ts:24,129` |
| Attachments on a thread | bridge persists bytes to Storage (`persistAttachments`, best-effort) | `rabbitmq-bridge.service.ts:781-788` |
| Deal proposals | commercial-terms parser over the same inbound lane | `common/orchestrator/commercial-terms.ts` |
| Auto-send undo queue | `AUTO_SEND_UNDO_MS` staging + ProcurementService cron | `inbound-responder.service.ts:30` |
| Delivered-order stock | this page's `/deliver` call → ledger | `procurement.service.ts:989-1011` |

All four producers exist and run. No orphan data on this page.

### Writes

| Write | Lands in | Downstream reacts |
|---|---|---|
| Create PO | `procurement_orders` + shadow reservation | [[inventory]] shadow column, dashboard pending count, Sidebar badge (`Sidebar.tsx:409`) |
| Approve | status + RabbitMQ conversation intent | the vendor-email agent starts a thread |
| Deliver | two ledger movements + `inventory_events` | [[inventory]] live stock, dashboard "revenue" (see [[dashboard]] §10) |
| Approve draft / manual reply | `procurement_conversations`, outbound mail | vendor thread, `sender_reputation` |
| Cancel | status + calendar event deletion | [[calendar]] |

## 12. Design intent

**Should be:** one place where a PO is drafted, approved, chased and closed — and where
the AI's proposed vendor reply is a one-tap yes, never an autonomous send.

| State | Handled? | Evidence |
|---|---|---|
| loading | ✅ | react-query flags throughout |
| empty | ✅ | `OrderGuardModal` catches "no vendors yet" and routes to [[providers]] (§0) — a genuinely good empty state |
| error | ⚠️ partial | order mutations toast failures; the `add-from-order` call and the insights rail both fail silently |
| permission-denied | ❌ | no client-side role split; approval authority is server-side only |

**Where the UI misleads**

1. **The delivered-order flow claims a persistence step it never performs** (§10) — and
   the swallow comment says "not ready yet", which has been true since it was written.
2. **Unmapped wines deliver successfully and move no stock** (§10) — no warning surfaces
   to the user; the skip is a server log line.
3. **Contextual insights render empty rather than "signed out"** — a 401 and a quiet
   restaurant look the same.

## 13. Roadmap

1. **Delete the `add-from-order` call** (`Orders.tsx:686`) — or, if a separate booking
   step is genuinely wanted, build the endpoint. Leaving a permanently-404ing write with
   a "not ready yet" catch is exactly the pattern `v3.0-TECH-DEBT.md` §44.2 names.
2. **Surface the unmapped-wine skip.** `markDelivered` should return a flag when
   `master_wine_id` is null so the page can say "delivered, but stock not booked — this
   wine is not mapped". *Blocker: none.*
3. **Move `ContextualInsights` to `apiClient`** — same fix as [[inventory]] §13.1, fixes
   both pages at once.
4. Split `Orders.tsx` (3,614 lines) further into `pages/orders/`; the split started and
   stopped.
5. Rebrand the 4 "Sent via WineOps AI" disclaimer strings (§7) — user-visible, in
   outbound mail, so this one leaves the building.
6. Add a role gate for approval controls so staff do not see buttons the server will
   reject.
