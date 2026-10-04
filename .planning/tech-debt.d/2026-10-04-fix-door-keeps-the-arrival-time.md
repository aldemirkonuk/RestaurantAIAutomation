## A door receipt that synced late was dated the day it was entered — CLOSED — 2026-10-04

Filed and closed by `fix/door-keeps-the-arrival-time` ([ADR 0286](../decisions/0286-a-sent-time-is-the-facts-time-for-72-hours-older-needs-a-manager.md)). Owner-quarter sim findings A-008, A-010 and A-011. Line numbers are as this branch leaves the files.

**What it was.** On main at 8c673db4b, `recordDoorReceipt` never wrote the receipt event's `occurred_at`, so it took `DEFAULT now()`, the moment the request reached the server. The order's `delivered_at` took the gateway's `new Date()` (`apps/api-gateway/src/procurement/receiving.service.ts:566` at 8c673db4b). The phone's tap time, `clientCapturedAt`, was stored in `client_captured_at` and read by nothing. In the sim, the 100 newest of 549 door deliveries read 2 October, 31-44 days after their tap times (that all 549 do is inferred). The vendor scorecard read 0 of 548 on time.

**Fixed (forward only).** `resolveFactTime` (`apps/api-gateway/src/common/fact-time.ts:84`) applies the founder's ruling at `receiving.service.ts:264`. The event writes `occurred_at` and `occurred_at_basis` (`:373-374`). `delivered_at` follows the event's time and only moves forward (`:689-692`). A retry reads the stored time back rather than deciding again (`:433`). The bell's window is on entry, so a late-synced receipt is still announced (`apps/api-gateway/src/notifications/producers/delivery-recorded.producer.ts:114`). Migration `a_door_receipt_says_which_clock_dated_it` adds the basis column and its two CHECKs. Pinned by `apps/api-gateway/src/procurement/receiving.spec.ts` (the `ADR 0286` describes), `delivery-recorded.producer.spec.ts` and `apps/web/src/pages/receiving/next/DoorNext.test.tsx`, and by the resolved rows in `claims.d/fix-door-keeps-the-arrival-time.jsonl`. Rows written before this branch are not re-dated; see the backfill entry below.

## The door-count route keeps any countedAt from any role — OPEN — 2026-10-04

Filed by `fix/door-keeps-the-arrival-time` (ADR 0286, follow-up 1). It did not fit this branch's 15 files.

**What.** `POST /procurement/documents/door-count` passes `body.countedAt` straight through, both as the document's count time (`apps/api-gateway/src/procurement/documents/documents.controller.ts:862`) and as the delivery's `deliveredAt` (`:916`). The DTO checks it only as a string of at most 40 characters (`apps/api-gateway/src/procurement/dto/deliveries.dto.ts:163-169`), not as an instant. Any role can therefore date a counted delivery at any time, past or future. The founder's ruling (C02, 2026-10-04) covers counts: a sent time older than 72 hours stands only from an owner or a manager, and is marked back-dated.

**The same sink, a second route** (added at the lane's last call). `POST /procurement/deliveries` takes `deliveredAt` under the same string-only check (`apps/api-gateway/src/procurement/dto/deliveries.dto.ts:69-73`) from any signed-in role, and passes it on (`apps/api-gateway/src/procurement/deliveries.controller.ts:102`) to the same `deliveries.delivered_at` (`apps/api-gateway/src/procurement/canonical/delivery.service.ts:296`). No web or mobile client sends `countedAt` or `deliveredAt` today; the web only reads `/procurement/deliveries`.

**Fix.** Pass `countedAt`, and the create route's `deliveredAt`, through `resolveFactTime` with the token's role, before each use. Validate both as ISO 8601, and record which clock dated each. Pinned by the open rows `ADR-0286-DOOR-COUNT-ROUTE-USES-THE-RULE` and `ADR-0286-DELIVERY-CREATE-USES-THE-RULE` in `claims.d/fix-door-keeps-the-arrival-time.jsonl`, each of which flips to resolved when its fix lands.

## The door's stock movement is dated at entry — OPEN — 2026-10-04

Filed by `fix/door-keeps-the-arrival-time` (ADR 0286, follow-up 2).

**What.** The door books stock with `apply_stock_movement` (`apps/api-gateway/src/procurement/receiving.service.ts:570`, key `door-receipt:{eventId}` at `:591`). The function takes no date and stamps `transaction_date = now()`. A late-synced receipt therefore lands on its real day in the order and the event, but on its entry day in the stock ledger.

**Waits on.** The `postime` lane, which adds the date parameter to `apply_stock_movement`. Only one lane may change that function's signature, or two migrations would leave two overloads. After it lands, the door passes the event's `occurred_at`. Pinned by the open row `ADR-0286-DOOR-STOCK-MOVEMENT-IS-DATED` in `claims.d/fix-door-keeps-the-arrival-time.jsonl`.

## Door receipts recorded before ADR 0286 keep their entry date — OPEN (fork) — 2026-10-04

Filed by `fix/door-keeps-the-arrival-time` (ADR 0286, follow-up 3). This is a founder fork; it was not asked on this branch.

**What.** Existing `procurement_receipt_events` rows keep `occurred_at` = entry and `occurred_at_basis` = NULL. Existing `procurement_orders.delivered_at` values keep the moment the last receipt synced. The sim house's vendor scorecard (0 of 548 on time), `/reports` pacing and sales chart stay wrong until it is re-run or a backfill is chosen.

**Paths.**
- (a) Forward-only. This is what the branch does, and it is the recommended path.
- (b) A data migration that re-dates `delivered_at` from the latest door event's `client_captured_at`, where that time is within 72 hours of the event's `occurred_at`. It fits the ruling and needs no role. It fixes none of the sim house's rows, whose captures were 31-44 days old.
- (c) Option (b), plus re-dating older rows where the receiver is an owner or a manager today. That guesses the role at the time. The event rows also cannot be marked `back_dated`, because the append-only trigger (ADR 0227) refuses the update. Not recommended.
