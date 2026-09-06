---
type: page
route: /receiving
slug: receiving
softwares: [receiving]
component: apps/web/src/pages/receiving/ReceivingHome.tsx
audience: staff
tier: core
archetype: list+detail # proposed 2026-08-26 (OD-106)
signals_today: none
rebrand_strings: 0
maturity: broken
status: documented
updated: 2026-09-01
links: ["[[PAGE-CONTRACT]]", "[[receiving-door]]", "[[orders]]"]
---

# /receiving — Receiving home (role-split)

> **Part of** [[08-softwares/receiving|Receiving]] — the small software this screen belongs to. Index: [[SOFTWARE-MAP]].

## Surface — buttons → where they go

- **Delivery card** (staff view) → [[receiving-door]] `/receiving/:orderId/door`
- **Issue row** (manager view) → [[orders]] `/orders?order=<id>`

## 1. Purpose

"One event, three renderings, chosen by role" (`ReceivingHome.tsx:17-33`, echoed at
the route: `App.tsx:258`). Staff see *which delivery are you receiving* → the door
flow, **with no prices**; managers see *what needs a decision, worst money first*;
owners see one number — money that actually came back. Role is resolved
deterministically from auth (`ReceivingHome.tsx:66-71`); unrecognised roles fall to
the cost-free staff view on purpose.

## 1a. Features
One event, three renderings by role:
- **Staff**: pick which delivery you're receiving → the door flow; no prices shown
- **Manager**: the decision queue, worst money first
- **Owner**: one number — money that actually came back (recovered credits)
- 🚧 Nothing links here yet; the page is reachable by typed URL only (§9)

Write-path behaviour behind the page, fixed 2026-09-01 ([ADR 0057](../decisions/0057-receiving-write-path-integrity.md)):
- **A manager's verification note is saved.** It goes to `delivery_notes`, and is
  **appended** to whatever the door already wrote rather than replacing it. It
  previously went to a `notes` column that does not exist, so verifying a
  delivery *with a note* — i.e. every discrepancy — failed after the ledger
  correction and the credit claim had been written, leaving the order
  half-verified with no way to finish it.
- **An adjustment can only move this restaurant's stock.** Every `inventoryId` in
  `adjustments[]` is proven to belong to the caller before the ledger RPC, which
  otherwise takes the tenant from the target row. A foreign id is refused with a
  403 that names the item; a failed ownership *lookup* is a 422, never a pass.
- **Marking a delivery at the door cannot book it twice.** `quantity_received`
  now records what was actually booked instead of NULL, so `recordDoorReceipt`'s
  `alreadyBooked` sees it. `?quantityReceived=` is validated: a non-numeric,
  fractional or negative value is a 400 that says which, not a 200 that marks
  the order delivered with no stock booked.

Honesty features, bound by [ADR 0060](../decisions/0060-a-window-is-a-floor-and-an-unknown-is-not-a-zero.md)
and held by `scripts/check_windowed_figures.py` in CI:
- **The door's count is in bottles.** Rendered from the gateway's `bottlesTotal`
  ([ADR 0054](../decisions/0054-order-capture-and-unit-arithmetic.md)); when it
  is absent the card shows the em dash plus what was ordered **in its own unit**
  ("5 cases ordered · bottles —"). The page never multiplies a pack size.
- **`SERVER_WINDOWS`** — a register in `useReceivingNextData.ts` of every server
  cap a figure sits behind, each cited to the query that imposes it. Windowed
  figures render `≥`; where the gateway returns an exact `total`, that is used
  instead and no marker is needed.
- **Measured zero vs unknown.** `$0` is a measurement and renders as `$0`; an
  absent figure renders `—`. `openClaims` is a floor unconditionally — its cap
  is per-restaurant and unobservable from the client.
- **The uncounted strip has three states**, and the unknown one is words: a
  failed queue says so rather than rendering as "nothing uncounted".
- **403 is its own state** on all three renderings — names the permission, drops
  the retry that cannot help, prints the status and message. At the door it
  still sends the receiver to the paper record.
- **The outbox is tenant-scoped**: pins are keyed by restaurant, and pre-scoping
  pins are adopted marked `tenantUnknown` rather than discarded or re-attributed.
- **An offline non-attempt says "holding"**, never `sent 0 · failed 0`.

## 1b. Motions used — Mudavym redesign (flag `mudavym_design_receiving`)

Canonical source with curves: `apps/web/src/pages/receiving/next/MOTIONS-receiving.md` —
this list is the note-side index (ADR 0044 §2).

| id | name | fires |
|---|---|---|
| `receiving.risk.tally` | At-risk / recovered figures arrive | a figure changes while open — never first paint, never from an em dash |
| `receiving.lane.select` | Outcome lane select | accepted · short · refused lane press: colour + 2px underline |
| `receiving.row.settle` | Queue row expand | 0fr→1fr with the chevron on the same token; body carries the facts and the /orders + /receipts hand-offs |
| `receiving.credit.pour` / `.tuck` / `.stamp` | Hold-to-send → seal | the die on a drafted-unsent credit request — real open→requested transition; early release states what did not happen; the stamp is the only overshoot in the system |
| `receiving.draft.turn` | The draft's working turns in | "Show the working" on a --calm credit draft, slower than settle on purpose |
| `receiving.outbox.pin` | Nothing vanishes; the drop becomes a pin | a receipt flushDoorOutbox permanently dropped travels in on turn, lands on the stamp, and stays pinned by name until a person unpins it (inv-09) |
| `receiving.micro.ink` | Micro-states | hovers, hand-off press, retry buttons, the attempt counter; ≤2px travel |

Not used, on purpose: the queue item that stops existing gets no animation (the
absence is the defect — the motion budget goes to the pin arriving); no shake,
no bouncing checkmarks, no skeleton shimmer for unknowns.

## 2. Entry

**No inbound in-app link.** Not in the sidebar (`components/layout/Sidebar.tsx:58-184`),
not in the command palette (`components/command/commands.ts`), and a repo grep for
`'/receiving'` navigation finds nothing. Note: [PAGE_MAP](../foundation/PAGE_MAP.md):104-132
does **not** list it among entry points — that list undercounts; the map only records
this page's *outbound* edges (:86-87). Reached by typed URL today.

## 3. Files

- Route binding: `apps/web/src/App.tsx:259` (lazy import :79).
- `apps/web/src/pages/receiving/ReceivingHome.tsx` (355 lines) — all three views in one file
  (StaffView :75, ManagerView :135, OwnerView).

## 4. Endpoints

Atlas rows: [ENDPOINTS](../foundation/ENDPOINTS.md):389 (`procurement`), :420
(`procurement/receiving`), :370 (`procurement/documents/credits`).

| Method | Path | Call site |
|---|---|---|
| GET | `/procurement/orders` (deliveries to receive) | `ReceivingHome.tsx:88` |
| GET | `/procurement/receiving/queue` | `ReceivingHome.tsx:142` (manager decision queue) |
| GET | `/procurement/credits/stats` | `ReceivingHome.tsx:263` (owner recovered-money number) |

## 5. Signals

**None emitted.** Markup carries `data-ux-key="receiving:staff-order"` (:113) and
`"receiving:queue-row"` (:178), but the uxSignals reporter is dark
(`lib/uxSignals.ts:15`) with no page-level consumer — markers wait for a reporter.

## 6. Tier cut

**Core** — operate. This is the S02/S03 front door: PO-prefilled checklist and the
mismatch queue are ✅-Core rows ([TIER-MAP](../03-scenarios/TIER-MAP.md):38-39).

## 7. Rebrand surface

**0 user-visible strings** (no `wineops` hits in the file). Shared layout chrome
applies (see dashboard.md §7).

## 8. State & config

- Role gate from `useAuth` only — the file documents why the role must come from that
  source (`ReceivingHome.tsx:63-64`: "the staff view deliberately hides all money").
- No env vars, flags, or localStorage specific to this page.

## 9. Gaps

- **Unreachable by click** (§2): the S02 golden path starts at a URL nobody is linked
  to. Either a sidebar/palette entry or a dashboard hand-off is missing.
- PAGE_MAP's entry-point list omits this route (see §2) — the atlas undercounts
  orphans; worth a regeneration note there rather than a fix here.

## 10. Maturity

**broken.** The staff view — the S02 golden path and the only door into
[[receiving-door]] — cannot list a single delivery, for two independent reasons.

| Evidence | `path:line` |
|---|---|
| **1. It filters on a status that does not exist.** `StaffView` requests `/procurement/orders?status=SENT&limit=25`. `ProcurementOrderStatus` has 13 members and **`SENT` is not one of them** (PENDING, APPROVAL_NEEDED, NEGOTIATING, APPROVED, CONFIRMED, IN_TRANSIT, DELIVERED, PARTIALLY_RECEIVED, COMPLETED, CANCELLED, REJECTED, FAILED). `OrderFilterDto.status` is `@IsEnum(ProcurementOrderStatus)` and the app runs a global `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true })` → **400 Bad Request**. | call `ReceivingHome.tsx:88-90`; enum `procurement/dto/procurement.dto.ts:15-29`; DTO `:271-275`; pipe `main.ts:69-73` |
| **2. Even on success it unwraps the wrong shape.** It reads `data?.items ?? data ?? []`. `listOrders` returns `{ orders, total, page, limit, hasMore }` — there is no `items`, so `orders` would be bound to the response *object*, `orders.length === 0` is `undefined`, the empty state is skipped, and `orders.map` throws. The shared client helper does this correctly (`response.data?.orders ?? …`) — this view bypasses it. | `ReceivingHome.tsx:91`; server `procurement.service.ts:508-514`; correct unwrap `services/api/orders.ts:56` |
| **The failure is invisible.** `useQuery` is destructured as `{ data: orders = [], isLoading }` with no `isError` branch, so a 400 renders the reassuring empty state: *"Nothing is out for delivery right now."* | `ReceivingHome.tsx:85,102-106` |
| **Manager and owner views are correct.** `/procurement/receiving/queue` and `/procurement/credits/stats` both exist, are JWT-guarded, and return real aggregates. | `receiving.controller.ts:114-153`; `documents/credits.controller.ts:89-123`; `receiving.service.ts:309-370` |
| The role split itself is well built — role comes from `useAuth` (documented as load-bearing), and unknown roles fall to the cost-free view. | `ReceivingHome.tsx:61-72` |

## 11. Data flow

### Calls out

| Method · Path | Auth | Gateway controller | Returns |
|---|---|---|---|
| GET `/procurement/orders?status=SENT` | JWT (class) | `procurement.controller.ts:65` | **400** — invalid enum (§10) |
| GET `/procurement/receiving/queue` | JWT (class) | `receiving.controller.ts:153` → `receiving.service.ts:309` | `{ items, unverified, totalAtRisk }` — non-`matched` orders joined to open/requested/promised `procurement_credits`, sorted by dollars at risk then by provability |
| GET `/procurement/credits/stats` | JWT (class) | `documents/credits.controller.ts:123` | `{ recovered, outstanding, promised, rejected, openClaims, oldestOpenDays, settlementRate, selfEvidencedOpen }` |

### Fed by

| Producer | Mechanism | `path:line` |
|---|---|---|
| Open deliveries (staff list) | POs created on [[orders]] and the recurring-order cron | `procurement/recurring-orders.service.ts:225,271` |
| `match_status` / `discrepancy_notes` (manager queue) | the four-way match run from [[inventory]]'s `ReceivingWorkspace` | `ReceivingWorkspace.tsx:274` → `procurement.controller.ts:244` → `procurement/invoice-match.ts` |
| `procurement_credits` (both manager and owner numbers) | `openCreditClaim`, opened from a match verdict — never sent, only opened; dedup on `23505` | `procurement.service.ts:1104-1140` |
| `unverified` strip | door receipts with a case count and no bottle count, aged | `receiving.service.ts` `listUnverified`; door writes at `receiving.controller.ts:119` |
| Invoice documents that make the match possible | 5-minute `@Cron` sweep over `conversation_attachments` → `procurement_documents`, content-addressed | `procurement/documents/document-intake.service.ts:581-620` |

**Finding:** the manager and owner views depend entirely on a match that is only
triggerable from a *different page* ([[inventory]]). Nothing on `/receiving` starts the
process it reports on, and nothing links to `/receiving` in the first place (§2).

### Writes

**None.** This page is read-only in all three renderings — every button navigates.

## 12. Design intent

**Should be:** the delivery front door. One event, three renderings by role, with the
staff path deliberately money-free so a porter never argues with a driver.

| State | Handled? | Evidence |
|---|---|---|
| loading | ✅ all three views | `:100,165,273` |
| empty | ✅ *by text*, ❌ *by truth* — staff's "Nothing is out for delivery right now" is currently a lie (§10); manager's "Nothing to chase" and owner's "No discrepancies found yet" are honest | `:102-106,167-171,318-324` |
| error | ❌ | no `isError` branch anywhere in the file — the reason the 400 is invisible |
| permission-denied | ✅ **best in the repo** — the role split *is* the permission model, and unrecognised roles fail toward showing less | `:61-72` |

The owner view is a model of honest numbers: `recovered` counts only issued credit memos,
money asked for is shown separately and never added in, and the settlement rate supplies
the denominator (`:251-258,298-304`). Keep that discipline when touching this page.

**Where the UI misleads:** the staff empty state (§10) — it reports a healthy quiet
delivery day while the request behind it is rejected.

## 13. Roadmap

1. **Fix the staff query.** Use `getOrders({ status: … })` from `services/api/orders.ts`
   (which maps to the backend enum and unwraps `.orders`), with a real status —
   `CONFIRMED` and/or `IN_TRANSIT` are the "out for delivery" states. Two bugs, one fix.
   *Blocker: none, but it needs a decision on which statuses count as "arriving today".*
2. **Add an error branch to all three views** so a failed request never renders as an
   empty one. This is the defect that let #1 hide.
3. **Make the page reachable** — a sidebar entry, a command-palette command, or a
   dashboard hand-off. Today S02 begins at a URL nothing links to (§2, §9), which also
   orphans [[receiving-door]].
4. Link the manager queue's rows to the match workspace on [[inventory]] rather than to
   `/orders?order=` — the decision the row asks for is made there.
5. Turn on the reporter for the two `data-ux-key` markers already placed (§5).

## 14. Pipeline review — 2026-09-01

§1–13 above document the **legacy** `ReceivingHome.tsx`. This section covers the
**pipeline underneath both renderings** and the rebuilt `receiving/next` surface, from a
four-way pass (three extraction agents plus a direct read of `receiving.service.ts`).
Every entry marked ✅ was re-verified by hand against source and, where the claim is
about the database, against **production** — not against the migrations, because CI
builds from migrations onto a fresh database and cannot see a write to a column
production does not have.

### 14a. The framing fact

**The receiving pipeline has never run in production.** Measured 2026-09-01:

| table | rows |
|---|---:|
| `procurement_receipt_events` | **0** |
| `procurement_credits` | **0** |
| `procurement_documents` | **0** |
| `procurement_orders` | 2 (`APPROVED`, `PENDING` — neither delivered) |
| `procurement_order_items` | 1 |
| orders with a `match_status` | **0** |

Nothing below is a salvage job on a live corpus. Every schema decision here is being
taken at the cheapest moment it will ever be taken — the same argument ADR 0054 made for
its CHECK constraints.

### 14b. Verified defects

| # | Defect | `path:line` | Verified |
|---|---|---|---|
| **P1** | `verifyReceipt` writes `notes:` to `procurement_orders`, which **has no `notes` column** in production (it has `delivery_notes`, `manager_notes`, `discrepancy_notes`). `?? undefined` drops the key when absent, so it throws **only when a manager typed a note** — i.e. only on a discrepancy, and only *after* the ledger correction and the credit claim have already been written. Status, `match_status`, `accepted_quantity`, `invoice_*` and `price_history` never land. A retry fails identically. There is **no `verifyReceipt` test in the repo**. | `procurement.service.ts:1653` | ✅ code + prod `information_schema` |
| **P2** | `adjustments[]` can write stock into **another tenant**. `ReceiptAdjustmentDto.inventoryId` is `@IsString()` only, and `VerifyReceiptDto.adjustments` carries `@IsArray() @IsOptional() @Type(...)` with **no `@ValidateNested({each:true})`** — so the nested DTO is never validated at all. `applyReceiptAdjustment` passes the id straight to `apply_stock_movement`, which derives `restaurant_id` from the target row. | `dto/procurement.dto.ts:194-210`; `procurement.service.ts:~1510` | ✅ code |
| **P3** | `markDelivered` writes `quantity_received: quantityReceived ?? null` while booking `order.quantity` into the ledger. The web client sends no quantity. The door's anti-double-book guard reads exactly that column (`alreadyBooked = quantity_received ?? 0` → 0) and books the full count on top. | `procurement.service.ts:1262` vs `receiving.service.ts:194` | ✅ code |
| **P4** | **Nine read sites compare `procurement_orders.status` to lowercase `"delivered"`.** The write path sets the enum value `DELIVERED` (uppercase); production holds `APPROVED`/`PENDING`, both uppercase. So every vendor scorecard, lead-time statistic, on-time rate and procurement-spend figure reads **structurally zero** — not because there is no data, but because of case. Two *backfills* insert lowercase (`providers.service.ts:959`, `provider-intelligence.service.ts:626`), so any repaired history would be mixed-case. **The tests lock in the wrong case** (`dashboard.spend.spec.ts:59,68`; `order-schema-drift.spec.ts:221,234`) — they are green because the fixtures feed the code the case the code expects rather than the case the app writes. | `advanced-analytics.service.ts:290,437`; `dashboard.service.ts:322,438,569,832`; `goals.service.ts:320`; `analytics.service.ts:154`; `insight-generator.service.ts:239` | ✅ code + prod status values |
| **P5** | A door receipt whose `apply_stock_movement` fails is reported as a **success**: the RPC error is `logger.warn`ed, then `quantity_received`, `status` and `delivered_at` are written anyway and the response returns a non-zero `stockDelta`. Same hole when `inventory_id` is null — nothing is booked and a non-zero delta is still reported. | `receiving.service.ts:198-248` | ✅ code · *owned by another session* |
| **P6** | `openCreditClaim` sets **no `provider_id`, `document_id`, `document_line_id` or `claimed_qty`**. So a claim knows which *order* but not which *vendor*, *invoice* or *line*. This kills the `?providerId` filter and the `idx_pc_provider` index that already exist, and it makes the `uq_pc_line_reason` dedupe index (`WHERE document_line_id IS NOT NULL`) **unreachable** — the "23505 = already claimed" branch is dead code, and every re-verify manufactures another open claim, inflating `outstanding` and `totalAtRisk`. | `procurement.service.ts:1461-1477` | ✅ code |
| **P7** | Both door clients **hardcode `countedUom: 'case'`** and send no `packSize`. The fail-closed unit refusal shipped in #208 is therefore unreachable, and the multiplying unit is now *asserted* on every door count. `resolvePackSize` falls back to **1** when the order cannot supply a ratio — so "3 cases" books 3 bottles, an under-count presented as a measured receipt. | `DoorNext.tsx:286`, `DoorReceipt.tsx:124`; `receiving.service.ts:441-453` | ✅ code |
| **P8** | Three of four `stage` values have **no writer anywhere**. Only `case_count` is ever written; `signed_at_door`, `bottle_count` and `reconciled` exist in the CHECK and in tests only. `listUnverified` needs `bottle_count` or `reconciled` to close a delivery, so the only real exit is the order reaching `COMPLETED` — which `verifyReceipt` grants only when an invoice quantity was supplied. **A delivery counted to the bottle against a packing slip ages to `overdue` forever**, and the queue's loudest alarm fires hardest on correctly-handled deliveries. `receiving.spec.ts:449` asserts this works by mocking a row no code path can produce. | `receiving.service.ts:170,297,322-327`; `procurement.service.ts:1645-1649` | ✅ code |
| **P9** | **Two cross-tenant holes on the count path.** `getBalanceAt` accepts `restaurantId` and never uses it; `get_inventory_balance_at` takes no restaurant argument, so any authenticated user can read any inventory item's historical balance by id. `recordSpotCount` calls the stock RPC with a path-supplied `inventoryId` before any ownership check. **Still open, and the scoped write that partly masked it is gone:** [ADR 0078](../decisions/0078-a-count-is-a-record-in-its-own-right.md) replaced `set_stock_absolute` with `record_stock_count`, which likewise derives `restaurant_id` from the target row, and folded the `restaurant_id`-scoped `last_counted_at` touch into that same RPC — so the request no longer contains a single tenant-scoped statement. `reconcileInventory` has the identical shape. | `inventory-ledger.service.ts:334`, `:480`; `inventory.service.ts:363-415` | agent-reported, function signatures confirmed in prod |
| ~~**P10**~~ | ✅ **Resolved 2026-09-02 by [ADR 0079](../decisions/0079-a-price-says-what-kind-of-price-it-is.md) / #244.** Both halves. The price is no longer gated on the quantity delta: `applyReceiptAdjustment` writes the movement only when `delta !== 0` but calls the new `revalue_lot` RPC whenever `unitCost != null`, so a delivery that was counted correctly and priced wrongly — the commonest case, and the one that previously wrote nothing anywhere — now restates the lot. The correction RESTATES rather than adding a rival lot, preserving the prior price in append-only `inventory_lot_revaluations`, because a positive delta used to INSERT a second lot at invoice cost beside the estimate and `inventory_lot_rollup.wac` blended the two permanently under the label "invoiced lot WAC". And `markDelivered` now passes `cost_provenance: 'estimated'` for `final_price`, while `apply_stock_movement` RAISEs on a price with no stated provenance instead of defaulting to `'invoice'`. Found in the same pass and not in this row: `applyReceiptAdjustment` passed `p_source: "receiving"`, which is not a member of `inventory_transaction_source`, so **every** receipt-verification stock correction 422'd — the test was green because it mocks the RPC. | `procurement.service.ts:1667`, `:1928`, `:1956`; `supabase/migrations/20260902150000_lot_cost_truth.sql:134,315` | ✅ code + `scripts/check_lot_cost_provenance.py` |
| **P11** | Reservations leak on the entire new door flow. Shadow stock is released only in `markDelivered` and `releaseOrderShadowStock`; **neither `recordDoorReceipt` nor `verifyReceipt` touches shadow or `in_transit_quantity`** — and door→verify is the flow the two-stage design exists for. `cancelOrder` also releases only from `APPROVED\|CONFIRMED\|IN_TRANSIT`, so cancelling a `PARTIALLY_RECEIVED` order (the status the door always leaves) leaks too. | `procurement.service.ts:1094,1204,1336,1014-1022` | agent-reported |
| **P12** | Every windowed read is rendered as a total. `totalAtRisk` sums a 100-order slice joined to an **unordered** 200-credit slice; `/procurement/credits` returns the **oldest** 200 by `opened_at ASC`, so `creditedThisMonth` on the owner ledger silently reads `$0` past 200 lifetime settlements — and renders `$0`, not `—`, because the array arrived successfully. `recoveryStats` sums an unordered 5000-row slice. `listUnverified` caps at 500 lifetime events, so the oldest — i.e. the `overdue` ones — fall off first. ADR 0051 requires a floor marker (`≥ n`). | `receiving.service.ts:271,383,428`; `credits.controller.ts:112,137`; `useReceivingNextData.ts:308-330`; `RcOwnerLedger.tsx:90-91` | agent-reported |
| **P13** | Dashboard procurement spend returns **hard zeros on query error** — a dead gateway and an empty cellar render identically. `getVendorTrust` likewise returns `{score: 0, eligible: false}` on any exception. This is the literal defect ADR 0051 was written from. | `dashboard.service.ts:326-331`; `procurement.service.ts:2872-2874` | agent-reported |
| **P14** | The discrepancy verdict is a **mutable column set, not a record**. `verifyReceipt` overwrites `match_status`/`discrepancy_notes` on the order row with no re-verify guard, and sets `discrepancy_notes = null` when the verdict lands on `matched` — erasing the prior narrative. Meanwhile the ledger *refuses* to move on a re-verify (idempotency key `receipt-verify:{orderId}:{inventoryId}`), so a second verify changes what the system **says** happened without changing what it **did**. | `procurement.service.ts:1656-1676`, `:1518` | agent-reported |

### 14c. What is genuinely well built — do not "fix"

- The fail-closed unit refusal and its error text (`receiving.service.ts:131-145`) — ADR 0011 applied at the door, with a 400 that names the question a human can answer in two seconds.
- No `p_unit_cost` at the door, so the lot lands `cost_provenance='estimated'` rather than wearing an unverified price (`:216-218`).
- The two-stage model, and provisional-ness **derived** rather than stored as a third stock state (`:29-48`).
- `procurement_credits.evidence` — a full `MatchResult` snapshot frozen at claim time, never overwritten (`procurement.service.ts:1476`).
- The credit **settlement** chain: `credited` requires both a document and an amount, is terminal, counts `creditedAmount` not `claimedAmount`, and the database enforces it independently (`procurement_credits_credited_needs_proof`). Best-built thing in the domain.
- `price_verified` is `NULL`-not-`false` when unverifiable (`procurement.service.ts:1671`).
- Content-addressed documents (`sha256` per restaurant), original bytes retained, original parse kept in `extracted` jsonb.
- The owner view's honest numbers, and the role split as the permission model (§12).

### 14d. Receiving as a label factory

Receiving is the only place in the product where a number is produced by a person
touching an object. Six machine-proposes/human-judges pairs exist, and **four of them
destroy the machine's half at the moment it becomes a label**:

1. Confirming a suggested line match overwrites the model's score (`match_confidence → 1`, `match_method → "manual"`) — `documents.controller.ts:244-245`.
2. Suggested matches are **never persisted at all** — the rejected candidates, i.e. the entire negative class, vanish on the HTTP response (`document-intake.service.ts:497-502`).
3. The door's paper pre-fill never leaves the browser; whether the receiver accepted or overrode the machine's reading of the packing slip is not transmitted (`DoorNext.tsx:236-246`).
4. The verify form's pre-fill overwrite is untracked — a manager correcting a misread `invoiceQty` leaves no trace (`ReceivingWorkspace.tsx:202-223`).
5. `editLine` overwrites the extracted line in place and is deliberately anonymous — no actor, no timestamp, no diff (`document-intake.service.ts:653-656,772-780`).
6. The damage photograph is **never taken**: `damage_photo_path` is a write-only column with no producer and no consumer, and no client sends it, despite three docblocks promising it.

Plus: `extraction_model` has no writer; `procurement_documents` has no `event_id`, so no
extraction can ever be attributed to a model; and **no `operator` Neural Footprint event
is written anywhere in the repo**, though `subject_type` has allowed it since 2026-08-24
for exactly this purpose.

Every one of these is one instance of one missing rule: *a machine proposal shown to a
human is written before the human answers, and the answer is appended, never
substituted.* The corpus is empty today, which is the only moment adopting that rule is
free.

### 14e. Forks for the founder

Open, not decided. See `.planning/decisions/OPEN-DECISIONS.md` once filed.

1. **P4's blast radius.** Fixing the lowercase status is nine read sites, two backfills that write the wrong case, and four test files that lock it in. It is not a receiving fix — it is every procurement number in the product. Sweep now, or file and continue?
2. **How an honest delivery leaves the unverified queue** (P8) — write a `bottle_count` event from `verifyReceipt`, let a manager say "counted, no invoice yet", or both?
3. **Whether a verdict is a record or a column** (P14) — append-only match history, forbid re-verify, or accept overwriting?
4. **Whether to adopt the label-preservation rule now** (14d), while the corpus is empty.


### 14f. Label preservation — status after ADR 0059

[[0059-receiving-preserves-the-pair]] adopts §14d's rule verbatim:

> A machine proposal shown to a human is written before the human answers, and
> the answer is appended, never substituted.

Held by `scripts/check_proposal_preservation.py`, blocking in CI, proven to exit
1 against pristine `origin/main` at the two pre-fix sites and 0 after. Adopted
while production held **0 documents, 0 document lines, 0 receipt events and 0
credits** — the only moment the rule was free, since the proposal half cannot be
back-filled from the confirmed half.

Against §14d's six destruction points plus its two capture holes:

| # | §14d destruction point | Status |
|---|---|---|
| 1 | Confirming a suggested line match overwrites the model's score | **CLOSED.** `proposed_confidence` / `proposed_method` written at proposal time; confirmation adds `confirmed_by` / `confirmed_at` and never touches the match columns for a previously-proposed row. A pairing no machine proposed still gets `manual` — there is no proposal there to destroy. |
| 2 | Suggested matches are never persisted at all | **CLOSED.** New `procurement_line_match_suggestions` — one row per candidate with confidence, method, substitution and reason, `resolved_as` filled on accept/reject. Losing candidates resolve `superseded`, never `rejected`: no human judged them. |
| 3 | The door's paper pre-fill never leaves the browser | **PARTIAL — still lost.** `DoorNext.tsx` now sends `suggestedQty` / `suggestionAccepted`, `DoorReceiptDto` validates both, and `procurement_receipt_events` has the columns. The insert in `receiving.service.ts` is a marked `TODO(ADR 0059, L3)` — that file was owned by a concurrent session. **The label now reaches the gateway and is dropped there instead of in the browser: a shorter fall, not a fix.** |
| 4 | The verify form's pre-fill overwrite is untracked | **PARTIAL — still lost.** Same shape: `ReceivingWorkspace.tsx` sends four `prefilled*` values frozen at pre-fill time, `VerifyReceiptDto` validates them, `procurement_orders` has the columns; the write in `procurement.service.ts` is a marked `TODO(ADR 0059, L4)`. |
| 5 | `editLine` overwrites the extracted line in place, anonymously | **OPEN.** Not in scope here. Note the guard already covers the tie-out columns `editLine` recomputes, so a future fix inherits enforcement. |
| 6 | The damage photograph is never taken | **OPEN.** Untouched — `damage_photo_path` still has no producer and no consumer. |
| — | `extraction_model` has no writer | **CLOSED.** `ParsedDocument.extractionModel` carries it from the extractor (which always knew it) to the insert. NULL stays honest for EDI and for an unreadable document: no model ran. |
| — | `procurement_documents` has no `event_id` | **CLOSED.** Column added, `ON DELETE SET NULL` (not CASCADE — [[0037-nfb-erasure-is-crypto-shredding]] erasure must cost attribution, never the label), populated from the extractor's `NfEventRef` with a bounded 2s wait so the instrument can never hang the extraction it measures. |

Three failing-by-design `it.skip` tests in
`apps/api-gateway/src/procurement/proposal-preservation-deferred.spec.ts` name
the exact lines that finish rows 3 and 4. §14d's remark that **no `operator`
Neural Footprint event is written anywhere in the repo** is unaddressed and
remains true.


## 15. Page-honesty pass — 2026-09-01 (`fix/receiving-page-honesty`)

Ten defects measured on the rebuilt `receiving/next` surface against
[ADR 0051](../decisions/0051-rebuilt-pages-show-live-data-only.md), the day
after 0051 locked. Decision recorded as
[ADR 0060](../decisions/0060-a-window-is-a-floor-and-an-unknown-is-not-a-zero.md).
Line numbers are pre-fix, against `origin/main` at `5d3dbe7e`.

| # | Defect | Where | Status |
|---|---|---|---|
| F1 | `procurement_orders.quantity` is denominated in `unit_type`, and was rendered as bottles — a five-**case** order told the door five bottles were expected. `mapOrderRow` already emitted `bottlesTotal` (`procurement.service.ts:1913-1914`); it was unused | `useReceivingNextData.ts:111`, `RcStaffLane.tsx:135` | ✅ fixed |
| F2 | `vendor` always null — the hook reads `providerName`, which `mapOrderRow` never emits | `useReceivingNextData.ts:107` | ⚠️ client half done; **gateway TODO** |
| F3 | Outbox not tenant-scoped: one global `localStorage` key, so restaurant A's dropped receipt rendered as a `role="alert"` under restaurant B | `useReceivingNextData.ts:373` | ✅ pins fixed; ⚠️ **queue TODO** |
| F4 | An offline non-attempt stamped as a clean sync — `last sync 14:32 · sent 0 · failed 0` under a header reading "offline — holding" | `doorOutbox.ts:94` → `:491` → `RcOutboxRail.tsx:260-262` | ✅ fixed consumer-side |
| F5 | Six windowed figures rendered as totals; **not one `≥` on the page** | `RcStaffLane.tsx:181`, `RcManagerQueue.tsx:91,121,390`, `RcOwnerLedger.tsx` | ✅ fixed |
| F6 | A measured `$0` and an unknown both rendered as `—`, beside a literal `0` — one row could read `$— · 0 open claims` | `RcManagerQueue.tsx:261,313,314` | ✅ fixed |
| F7 | The uncounted strip rendered only when non-empty and the hook set `[]` on failure — a failed query read as "nothing uncounted" | `RcManagerQueue.tsx:403`, `useReceivingNextData.ts:250` | ✅ fixed |
| F8 | 403 indistinguishable from 500; two of three renderings never printed the message | `RcStaffLane.tsx:37-53`, `RcOwnerLedger.tsx:105-125` | ✅ fixed |
| F9 | The credited-list query had no error branch — honest by accident, indistinguishable from "no credited claims yet" | `useReceivingNextData.ts:349-359` | ✅ fixed |
| F10 | `/receipts` hand-off dropped the order id its sibling passed; `settlementRate` (settled ÷ all resolved) sat under "They refused" | `RcManagerQueue.tsx:342`, `RcOwnerLedger.tsx:152-165` | ✅ fixed; `?order=` inert until `ReceiptsNext.tsx` reads it |

### The server windows this page renders behind

Registered in `useReceivingNextData.ts` as `SERVER_WINDOWS`, cited to the query
that imposes each. CI (`check_windowed_figures.py`) fails when a declared cap no
longer matches its source.

| Window | Cap | Query | Observable from the client? |
|---|---|---|---|
| `QUEUE_ITEMS` | 100 | `receiving.service.ts:375` | **Yes** — a full page proves more may exist, so the floor is conditional |
| `UNVERIFIED` | 500 | `receiving.service.ts:271` (receipt events) | No — the derived list is shorter than the window |
| `LINKED_CREDITS` | 200 | `receiving.service.ts:384`, **no `.order()`**, capped per *restaurant* not per order | No — hence `openClaims` is a floor unconditionally |
| `RECOVERY_STATS` | 5000 | `credits.controller.ts:137`, **no `.order()`** | No — aggregates only, so every owner figure is a floor |
| `CREDITS_LIST` | 200 | `credits.controller.ts:113`, ordered **oldest-first** | No — and the ordering means a busy restaurant's *recent* settlements fall outside the month-on-month trend entirely |

### What was already honest and was preserved verbatim

Named here so a later pass does not "tidy" any of it away: `rc-format.ts:8-44`
(`num()` rejecting NaN/empty/non-finite); `RcStaffLane.tsx:37-53` — *"there may
well be a truck outside. Write the delivery down on paper."*, now the 5xx branch;
`useReceivingNextData.ts:465` + `RcOutboxRail.tsx:179-182` (a thrown IndexedDB
read → `null`, rendered "unknown, not zero"); `RcOutboxRail.tsx:127-132` (the pin
that audits its own inference); `RcTally.tsx:40-41` (a dash→number transition
does not animate — knowledge arriving is not a value changing);
`RcOwnerLedger.tsx:101-103` (`recovered` sums `creditedAmount`, never
`claimedAmount`); `RcCreditDrafts.tsx:34-43,179` (no optimistic state in the
approve path).

### Still open after this pass

1. **`mapOrderRow` maps no provider name** (`procurement.service.ts:1906-1928`).
   Until it does, the door cannot see which distributor is in front of it — the
   card now says so explicitly instead of showing the wine in the vendor slot.
   The client reads `providerName` and `provider.name` defensively, so the fix is
   one join and one mapped field, with no web change.
2. **The door outbox queue carries no restaurant id.** `doorOutbox.ts` writes
   every receipt under the single mutation type `receiving.door` and
   `QueuedDoorReceipt` is `{orderId, orderLabel, body}`, so a queued receipt
   cannot be attributed to a tenant from the consuming side at all. The pinned
   *drops* are scoped; the *queued* list is not. The consuming filter is written
   and inert until the write side stamps the field.
3. **`ReceiptsNext.tsx:447` reads only `?tab`**, so the order id this page now
   passes to `/receipts` does not yet select anything there.
