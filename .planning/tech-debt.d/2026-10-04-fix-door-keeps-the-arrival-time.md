## A door receipt that synced late was dated the day it was entered — CLOSED — 2026-10-04

Filed and closed by `fix/door-keeps-the-arrival-time` ([ADR 0286](../decisions/0286-a-sent-time-is-the-facts-time-for-72-hours-older-needs-a-manager.md)). Owner-quarter sim findings A-008, A-010 and A-011. Line numbers are as this branch leaves the files.

**What it was.** On main at 8c673db4b, `recordDoorReceipt` never wrote the receipt event's `occurred_at`, so it took `DEFAULT now()`, the moment the request reached the server. The order's `delivered_at` took the gateway's `new Date()` (`apps/api-gateway/src/procurement/receiving.service.ts:566` at 8c673db4b). The phone's tap time, `clientCapturedAt`, was stored in `client_captured_at` and read by nothing. In the sim, the 100 newest of 549 door deliveries read 2 October, 31-44 days after their tap times (that all 549 do is inferred). The vendor scorecard read 0 of 548 on time.

**Fixed (forward only).** `resolveFactTime` (`apps/api-gateway/src/common/fact-time.ts:84`) applies the founder's ruling at `receiving.service.ts:264`. The event writes `occurred_at` and `occurred_at_basis` (`:373-374`). `delivered_at` follows the event's time and only moves forward (`:692-695`). A retry reads the stored time back rather than deciding again (`:433`). The bell's window is on entry, so a late-synced receipt is still announced (`apps/api-gateway/src/notifications/producers/delivery-recorded.producer.ts:114`). Migration `a_door_receipt_says_which_clock_dated_it` adds the basis column and its two CHECKs. Pinned by `apps/api-gateway/src/procurement/receiving.spec.ts` (the `ADR 0286` describes), `delivery-recorded.producer.spec.ts` and `apps/web/src/pages/receiving/next/DoorNext.test.tsx`, and by the resolved rows in `claims.d/fix-door-keeps-the-arrival-time.jsonl`. Rows written before this branch are not re-dated; see the backfill entry below. **[Narrowed 2026-10-05: the receipt event is dated in every case, but `delivered_at` only on an order whose status accepts the receipt (see "A late sync onto an order that refuses the receipt" below), and the stock ledger is still dated at entry (see "The door's stock movement is dated at entry").]** **[2026-10-06: the stock ledger row is now dated by the event's time too (`:600`); that entry is closed. Re-dating `delivered_at` only moves it forward, so an order already dated by an earlier entry keeps that date when a receipt for it is sent again under a new idempotency key: a re-run on the same house does not correct its existing orders.]**

## The door-count route keeps any countedAt from any role — OPEN — 2026-10-04

Filed by `fix/door-keeps-the-arrival-time` (ADR 0286, follow-up 1). It did not fit this branch's 15 files.

**What.** `POST /procurement/documents/door-count` passes `body.countedAt` straight through, both as the document's count time (`apps/api-gateway/src/procurement/documents/documents.controller.ts:862`) and as the delivery's `deliveredAt` (`:916`). The DTO checks it only as a string of at most 40 characters (`apps/api-gateway/src/procurement/dto/deliveries.dto.ts:163-169`), not as an instant. Any role can therefore date a counted delivery at any time, past or future. The founder's ruling (C02, 2026-10-04) covers counts: a sent time older than 72 hours stands only from an owner or a manager, and is marked back-dated.

**The same sink, a second route** (added at the lane's last call). `POST /procurement/deliveries` takes `deliveredAt` under the same string-only check (`apps/api-gateway/src/procurement/dto/deliveries.dto.ts:69-73`) from any signed-in role, and passes it on (`apps/api-gateway/src/procurement/deliveries.controller.ts:102`) to the same `deliveries.delivered_at` (`apps/api-gateway/src/procurement/canonical/delivery.service.ts:296`). No web or mobile client sends `countedAt` or `deliveredAt` today; the web only reads `/procurement/deliveries`.

**Fix.** Pass `countedAt`, and the create route's `deliveredAt`, through `resolveFactTime` with the token's role, before each use. Validate both as ISO 8601, and record which clock dated each. Pinned by the open rows `ADR-0286-DOOR-COUNT-ROUTE-USES-THE-RULE` and `ADR-0286-DELIVERY-CREATE-USES-THE-RULE` in `claims.d/fix-door-keeps-the-arrival-time.jsonl`, each of which flips to resolved when its fix lands.

## The door's stock movement is dated at entry — ~~OPEN~~ CLOSED on 2026-10-06 — 2026-10-04

Filed by `fix/door-keeps-the-arrival-time` (ADR 0286, follow-up 2).

**What.** The door books stock with `apply_stock_movement` (`apps/api-gateway/src/procurement/receiving.service.ts:570`, key `door-receipt:{eventId}` at `:591`). The function takes no date and stamps `transaction_date = now()`. **[Corrected 2026-10-05, in place: false at this branch's head. Migration `a_pos_sale_is_dated_by_its_check` (#603, ADR 0281, on main and in this branch) gives `apply_stock_movement` the argument `p_occurred_at timestamptz DEFAULT NULL` and dates the ledger row `LEAST(COALESCE(p_occurred_at, now()), now())`. The door's call does not pass it yet, so the ledger row is still stamped at entry.]** A late-synced receipt therefore lands on its real day in the order and the event, but on its entry day in the stock ledger.

**Waits on.** The `postime` lane, which adds the date parameter to `apply_stock_movement`. Only one lane may change that function's signature, or two migrations would leave two overloads. After it lands, the door passes the event's `occurred_at`. **[Corrected 2026-10-05, in place: it waits on nothing now. The `postime` lane merged as #603 (`2b6782291`), and that migration names the door's arrival time as a caller that reuses `p_occurred_at` rather than adding a second date argument. The fix is unblocked and not done: pass `p_occurred_at: factTime.at` in the call at `apps/api-gateway/src/procurement/receiving.service.ts:570`. That dates only the ledger row's `transaction_date`. The purchase lot the function inserts keeps `inventory_lots.received_at` at its `DEFAULT now()`.]** Pinned by the open row `ADR-0286-DOOR-STOCK-MOVEMENT-IS-DATED` in `claims.d/fix-door-keeps-the-arrival-time.jsonl`.

**Closed 2026-10-06** on the same branch. The door's call passes `p_occurred_at: factTime.at` (`apps/api-gateway/src/procurement/receiving.service.ts:600`), so the ledger row's `transaction_date` is the event's stored time, never later than now; a retry passes the first attempt's stored time. The purchase lot keeps `inventory_lots.received_at` at entry, and a back-dated ledger row keeps the `quantity_before` and `quantity_after` computed at entry (as ADR 0281 records for POS sales). Pinned by `receiving.spec.ts` (four `[REVERT-FAILS]` cases assert `p_occurred_at`) and by `ADR-0286-DOOR-STOCK-MOVEMENT-IS-DATED`, now resolved.

## Door receipts recorded before ADR 0286 keep their entry date — OPEN (fork) — 2026-10-04

Filed by `fix/door-keeps-the-arrival-time` (ADR 0286, follow-up 3). This is a founder fork; it was not asked on this branch.

**What.** Existing `procurement_receipt_events` rows keep `occurred_at` = entry and `occurred_at_basis` = NULL. Existing `procurement_orders.delivered_at` values keep the moment the last receipt synced. The sim house's vendor scorecard (0 of 548 on time), `/reports` pacing and sales chart stay wrong until it is re-run or a backfill is chosen. **[Narrowed 2026-10-06: a re-run on the same house does not correct them. `delivered_at` only moves forward, so an order already dated 2 October keeps that date even when a receipt for it is sent again under a new idempotency key. Only new orders, as in a fresh or reset house, or a backfill, would be dated right.]**

**Paths.**
- (a) Forward-only. This is what the branch does, and it is the recommended path.
- (b) A data migration that re-dates `delivered_at` from the latest door event's `client_captured_at`, where that time is within 72 hours of the event's `occurred_at`. It fits the ruling and needs no role. It fixes none of the sim house's rows, whose captures were 31-44 days old.
- (c) Option (b), plus re-dating older rows where the receiver is an owner or a manager today. That guesses the role at the time. The event rows also cannot be marked `back_dated`, because the append-only trigger (ADR 0227) refuses the update. Not recommended.

## A late sync onto an order that refuses the receipt leaves the order undated — OPEN — 2026-10-05

Filed by `fix/door-keeps-the-arrival-time` (ADR 0286, follow-up 6). Found by the PR's review at `d9fd02b9f`.

**What.** `recordDoorReceipt` books the event and the stock first, then writes the order in two updates: the status (`PARTIALLY_RECEIVED`), then `delivered_at`, and only when the status write went through (`apps/api-gateway/src/procurement/receiving.service.ts:655-660`, `:687-695`). The status trigger (`BEFORE UPDATE OF status`, migration `an_order_changes_state_by_the_table`) lets only an APPROVED, CONFIRMED, IN_TRANSIT or DELIVERED order move to `PARTIALLY_RECEIVED`, and a PARTIALLY_RECEIVED one be written again. It refuses the other seven states (PENDING, APPROVAL_NEEDED, NEGOTIATING, COMPLETED, CANCELLED, REJECTED, FAILED) with 23514. On such an order the door logs the refusal at error level (`:663-669`), leaves the status and `delivered_at` as they were and answers 200 with the event's `factTime` (ADR 0286 option 9). So a receipt that syncs late onto an order already COMPLETED is dated on its event but not on the order, which the scorecard and `/reports` pacing read. Main did the same in one update, refused whole and ignored; the branch only adds the log line.

**Why it is open.** The trigger fires on `OF status` only, so a `delivered_at` write on its own would not be refused by it. The door does not make that write, and whether a closed order's `delivered_at` should move is not decided. The same gap meets a retry after a failure between the two writes, when the order was completed in between: the retry's status write is refused, and `delivered_at` stays as it was.

**Not decided here.** No claims row: nothing is built, and there is no target a check could pin until the behaviour is chosen.

## Back-dating has no lower bound — OPEN (fork) — 2026-10-05

Filed by `fix/door-keeps-the-arrival-time` (ADR 0286, follow-up 7). Found by the PR's review at `d9fd02b9f`. This is a founder fork; it is not asked on this branch.

**What.** `resolveFactTime` keeps a sent time older than 72 hours whenever the role is owner or manager, at any age, as `back_dated` (`apps/api-gateway/src/common/fact-time.ts:124-125`). Nothing compares it with the order's own dates, so a receipt can be dated before its order was placed. The door sends the phone's clock at the tap (`apps/web/src/pages/receiving/next/DoorNext.tsx:468`), not a typed date, so a manager's phone whose clock runs more than 72 hours behind is kept the same way. The founder's ruling (C02, 2026-10-04) names no floor, so this is within its wording, but no floor was decided.

**Paths.** No floor (what the branch does); not before the order was placed; or a fixed limit on how far back. The options, their costs and a recommendation are in the PR body under "Forks deferred".

## An order dated from an off-app invoice keeps any invoiceDate from any role — OPEN — 2026-10-06

Filed by `fix/door-keeps-the-arrival-time` (ADR 0286, follow-up 8). Found by the PR's review at `f534823e0`. ADR 0286's Context had said no order write accepts a sent time; that was false and is corrected there in place.

**What.** `POST /providers/:id/retroactive-order` (`apps/api-gateway/src/providers/providers.controller.ts:885`) takes `invoiceDate`, checked only as an optional string (`apps/api-gateway/src/providers/dto/retroactive-order.dto.ts:95`). `createRetroactiveOrder` passes it on as `deliveredAt` (`apps/api-gateway/src/providers/providers.service.ts:1201`), and `createOrder` opens the order DELIVERED with `requested_at` and `delivered_at` both set to it (`apps/api-gateway/src/procurement/procurement.service.ts:1236`, `:1284-1288`). The thread's `received_at` takes it too (`providers.service.ts:1226`). The route reads no role, draws no 72-hour line and marks nothing back-dated, so any signed-in member of the house can date an order at any time. The founder's ruling (C02, 2026-10-04) covers orders. No web or mobile client calls the route today.

**Fix.** Pass `invoiceDate` through `resolveFactTime` with the token's role before `createOrder` sees it, validate it as ISO 8601, and record which clock dated the order. It did not fit this branch's 15 files. Pinned by the open row `ADR-0286-RETROACTIVE-ORDER-USES-THE-RULE` in `claims.d/fix-door-keeps-the-arrival-time.jsonl`, which flips to resolved when the fix lands.
