---
type: page
route: /orders
slug: orders
softwares: [orders, recurring-orders]
component: apps/web/src/pages/Orders.tsx
audience: owner
tier: core
archetype: command # proposed 2026-08-26 (OD-106)
signals_today: none
rebrand_strings: 4
maturity: partial
status: documented
updated: 2026-08-26
links: ["[[PAGE-CONTRACT]]", "[[receiving-door]]", "[[providers]]"]
---

# /orders — Orders

> **Part of** [[08-softwares/orders|Orders]] · [[08-softwares/recurring-orders|Recurring Orders]] — the small software this screen belongs to. Index: [[SOFTWARE-MAP]].

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
- Approve behind a PROVEN seal: the hold mints a one-time, 120-second challenge bound to this manager, this order, and this order's own total and vendor; the approval carries it back and it is redeemed exactly once (2026-09-04, ADR 0116 addendum)
- Bulk approve mints one seal per selected order at gesture start and approves nothing at all if any of them fails to mint

## 1b. Motions used — Mudavym redesign (flag `mudavym_design_orders`)

> **Chrome (2026-09-04).** With the flag on, this page is framed by the house
> header — `apps/web/src/components/mudavym/HouseHeader.tsx`, mounted by
> `PageGate` above every `next` tree: the A+M mark, this page's name, the ⌘K
> "Search or act" trigger, the house (or the branch switcher when there is more
> than one), the bell, the theme menu and the account menu. Chrome is excluded
> from §Surface by PAGE-CONTRACT, so it is named here and nowhere else in this
> note; its motions live in `components/mudavym/MOTIONS.md`, not the table
> below.

Canonical source with curves: `apps/web/src/pages/orders/next/MOTIONS.md` —
this list is the note-side index (ADR 0044 §2).

| id | name | fires |
|---|---|---|
| `orders.spine.tally` | Station counts arrive | a stage count / month figure changes while open — never first paint, never from an em dash |
| `orders.spine.select` | Station select | stage press: background, count colour, 2px underline |
| `orders.row.settle` | Row expand | 0fr→1fr with the chevron on the same token; body carries "the working" |
| `orders.approve.pour` / `.tuck` / `.stamp` | Hold-to-approve → seal | pending rows, drafts, and the bulk bar's hold — real mutations; early release states what did not happen; the stamp is the only overshoot in the system |
| `orders.bulk.emboss` | The dry emboss | after a bulk run: ONE ink impression, no wax — fourteen approvals, one impression |
| `orders.draft.turn` | The draft turns in | drafted letter + thread reveal, slower than settle on purpose |
| `orders.draft.drain` | Auto-send countdown | scheduled sends drain linear over the exact remaining ms, cancel live |
| `orders.micro.ink` | Micro-states | hovers, chips, deliver button; ≤2px travel |

Not used, on purpose: no shake, no bouncing checkmarks, no skeleton shimmer for
unknowns.

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
| POST | `/procurement/orders/:id/approve` | `pages/Orders.tsx:514,3275`; `pages/orders/next/LedgerRow.tsx`, `BulkApproveBar.tsx`, `pages/dashboard/next/WaitingOnYou.tsx` — all via `services/api/orders.ts`. **Can answer 403** since ADR 0116 |
| GET | `/procurement/order-approval-gate` | `pages/orders/next/useOrdersNextData.ts` — one call per house, not per row |
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

**The confirmation mail states the order's own unit, 2026-09-04 — ADR 0119
phase 0 (the mail half).** `confirmDeal` used to mail the vendor
*"N bottles … at $X per bottle"* for every order, while `procurement_orders.quantity`
is a count in the order's `unit_type` and no price column names a unit at all —
so a five-case order of a twelve-pack told the vendor **five bottles** for a
sixty-bottle delivery and quoted a case price as a bottle price. The sentence is
now built by `describeConfirmedOrderTerms`
(`apps/api-gateway/src/procurement/procurement.service.ts:186-216`, used at
`:5005`): the quantity in the order's own unit word, the price as
`per <unit_type>`, the pack named only when `resolveOrderMatchUnits` resolved
one — *"5 cases (12 bottles each) … at $120.00 per case"* — and where it did
not, the mail says the pack is not on record and asks, rather than assuming one
bottle per unit. Pinned in
`apps/api-gateway/src/procurement/confirm-deal-states-its-unit.spec.ts` (11
cases: case/known pack, case/unknown pack, bottle, keg, each also run against
the pre-fix builder). **Still open:** this page does not yet print the unit
beside the price it shows (phase 0's `/orders` half), and the price register
still refuses a case-priced agreement — no schema change was made, so nothing
can yet tell a case price from a bottle price. That is ADR 0119 phase 1.

**The awaiting state, added 2026-09-04 — ADR 0116.** Until now
`POST /procurement/orders/:id/approve` read neither a role nor an amount, so
anyone who could reach it could seal any figure, and this page rendered
`HoldToApprove` on every pending row. It now enforces the house's thresholds
(`/settings` `?tab=thresholds`). What this page does about it:

- **The ceremony is DISABLED, never hidden**, for a row the signed-in person's
  role cannot seal, with the rule, the number and who may sign printed beneath
  it. A control that disappears teaches nothing; a control that is visibly shut
  with the reason beside it teaches who to ask. The column label becomes
  *"Waiting on an owner"*.
- **The refusal is printed verbatim.** `services/api/orders.ts` promotes the
  403 body onto `error.message` — an axios error otherwise carries only
  "Request failed with status code 403" there, and all four call sites read
  `.message`. A 403 prints as itself; anything else keeps the old *"The gateway
  refused (…)"* framing, because a dropped connection is not an explanation.
- **A gate that has not answered leaves the ceremony ARMED.** An unread gate is
  not a permissive one and not a restrictive one; the page renders as it did
  before and lets the gateway decide. A gate that FAILED says so in words.
- **Rules that could not be tested are stated**, separately from rules that did
  not fire — "we could not tell whether this was a first order" is a different
  outcome from "it was not".
- **The bulk bar prints the distinct reasons**, not just a count: "3 refused"
  reads as a bug, and a bulk run over one house usually hits the same rule.

Pinned in `pages/orders/next/ApprovalGate.test.tsx` (9 cases). The gateway side
is `procurement/order-approval-gate.spec.ts` (21 cases) — the page is a
courtesy, the gateway is the gate, and both are tested as such.

**The legacy desk too.** `pages/Orders.tsx:549,3346` post to the same route
through `apiClient` directly rather than through `services/api/orders.ts`, so
they do not get that module's message promotion. Both used to
`alert('Failed to approve order')` on any failure — which would have replaced a
written explanation with a shrug. They now call `approvalRefusalText`
(`Orders.tsx:525`), which reads `response.data.message` on a 403 and keeps the
generic line for anything else.

- `v3.0-TECH-DEBT.md:495` — UX-catalog claim that `ActiveConversationsPanel` is
  unreachable is **stale**; `Orders.tsx:1512` sets its open state.
- The delivered-order booking path posts to `/inventory/add-from-order` with raw
  axios instead of `apiClient` (`Orders.tsx:684`) — skips the client's auth/refresh
  interceptors; works only because a token header is attached manually.
- 3,614 lines in one file; the co-located `pages/orders/` split is partial.

**The seal is redeemed, not asserted — added 2026-09-04 (ADR 0116 addendum).**
The gate above answers *may this role seal this figure*; it had no way to answer
*did a person do this*, because the hold lived entirely in the browser. Anything
holding a manager's session could seal an order by calling the endpoint. Now:

- `POST /procurement/orders/:id/seal-challenge` mints the proof when the hold
  BEGINS (`services/api/orders.ts:mintOrderSeal`, wired through
  `HoldToApprove`'s `onChallenge` in `LedgerRow.tsx` and `BulkApproveBar.tsx`);
  the approval carries it in `X-Seal-Challenge` and it is spent exactly once.
- The order's own total is hashed into the seal, so one minted at 2,000 cannot
  be spent after the order became 20,000.
- A mint that fails or returns null approves NOTHING and says so on the control
  ("The seal could not be issued — nothing sent."). That is the one failure the
  whole mechanism exists to prevent, and it must not arrive through the UI.

**STILL OPEN, and user-visible: two approval call sites send no seal.** The
legacy `pages/Orders.tsx` (via `hooks/useOrdersData.ts`) and
`pages/dashboard/next/WaitingOnYou.tsx` were outside the pass that built this and
still call approve with an id alone. `mudavym_design_orders` is OFF in
production, so the legacy page is what a house sees today — approval from it is
now REFUSED, in words, until it mints. Why not yet: changing either was fenced
off by the brief that built the seal, and doing it unasked would have edited a
page and a dashboard nobody had reviewed. The change is one line at each call
site (mint, then pass `{ orderId, challenge }`).

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

### An agreed price has no unit — research, 2026-09-04 (ADR 0119, Proposed)

The founder asked for the full graph behind ADR 0117's Q6 (*"a case-priced agreement has
no unit to state its price in"*). The research is
[[0119-an-agreed-price-states-its-unit]]; this page is where it lands, because `/orders`
is the surface that both creates the ambiguity and hides it. Nothing was built.

**What this page shows today that is not true.** Measured at `HEAD` = `e8a7d6f5`:

- `procurement_orders` holds four price columns — `quoted_price`, `negotiated_price`,
  `final_price`, `invoice_unit_price` (`20260805000000_baseline_from_production.sql:4523-4525,
  :4559`) — and **not one of them names a unit**, while the row beside them states the
  unit of its *quantity* (`unit_type`, `:4521`). The invoice line one table over states
  both (`uom :4387`, `pack_size :4388`, `unit_price :4391`, plus `allowance :4393` and
  `deposit :4394` for the money that sits outside the unit price).
- The per-bottle reading is enforced by arithmetic, not by the schema:
  `totalCost = finalPrice × bottlesTotal` (`procurement.service.ts:469`) and
  `line_total = finalPrice × units.bottlesTotal` (`:819-821`) — the latter written onto a
  row whose column is called `final_unit_price` and whose `unit_type` may say `case`
  (`:842-843`). A person reading that row reads a case price; the code means a bottle
  price.
- **It leaves the building.** `confirmDeal` emails the vendor
  `` `${quantity} bottles of ${wineName}` `` (`:4810`) with `` ` at $X per bottle` ``
  (`:4804-4806`), where `quantity` is the order's count *in the order's own unit*
  (`:4701`). On an order of 5 cases of 12 that sentence says *"5 bottles"* for 60
  bottles, and asserts a price unit nothing has checked.
- Because of that, the price register refuses every case-priced agreement:
  `packSize: bottlesPerConfirmedUnit === 1 ? 1 : null` (`:4778`) into
  `decideOwnPaperSighting`'s pack-size refusal (`own-paper-sighting.ts:235-246`). **The
  refusal is a gateway `logger.warn` (`:1097`) — this page never says it happened.** A
  house that buys only by the case gets a permanently empty `quote` tier and no screen
  anywhere explains why. That is absence reported as health, one layer up from the
  register.

**Where the research came out.** Six options mapped; the recommendation is that the
agreed *price* carries its own `(uom, pack)` pair on `procurement_order_items`, exactly
as the *quantity* already does — the shape xtraCHEF, Restaurant365, Odoo and NetSuite all
converge on, and the shape the house already shipped for public postings the same day
(`price_index_postings.price_unit NOT NULL`,
`20260904200000_a_posted_price_names_its_state.sql:96`). The tempting no-migration option
— derive the bottle price from the case price and the pack — was killed on evidence, not
taste: Connecticut *defines* the posted bottle price as case ÷ pack **plus 2–8¢ by
bottle size** (<https://www.cga.ct.gov/2004/rpt/2004-R-0593.htm>), split-case fees break
linearity in the warehouse, and back-deriving pack size at this exact table is the
documented cause of the receiving door's pack-size defect
(`procurement.service.ts:1259-1268`).

**What this page would owe if the founder takes it.** Three items, in order of
independence:

7. **Print the unit beside the price.** Every price this page renders — the order card,
   the approval ceremony, the negotiation panel — shows a bare number today. Whatever
   the schema decides, the page should never show a price without the unit it is in.
   *Blocker: none for the display of the current per-bottle convention; the stated-unit
   version waits on ADR 0119.*
8. **Say the refusal out loud.** A case-priced order that could not enter the price
   register should say so on the row, in the words the gateway already logs, with the
   one thing that would fix it. A silent refusal is the same failure as a silent
   default. *Blocker: ADR 0119 Q1 — whether the column ships before the desk can set
   it.*
9. **Fix the confirmation email before anything else.** *"5 bottles … at $X per bottle"*
   on a five-case order is wrong now and reaches a vendor now; it needs no migration and
   no decision beyond "state the real unit and the real count, or state neither". This
   is ADR 0119's phase 0 and its Q5. *Blocker: none.*

**Deliberately not proposed.** A unit control on the order form. Until the founder rules
on ADR 0119 Q1–Q2 (does the column ship ahead of the UI; is header `final_price` demoted
to an echo of the line), adding a picker would let the desk state a unit the schema
cannot store, which is worse than the current refusal.
