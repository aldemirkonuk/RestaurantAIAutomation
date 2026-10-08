# 0267 — A door receipt lets go of the accepted share of its order's reservation (and the R3 sim rulings W53–W58)

- **Status:** Locked
- **Date:** 2026-10-02
- **Decider:** Aldemir (founder) — decisions are locked by the founder, never by an agent
- **Keywords:** door receipt, reservation, shadow stock, backorder, order-delivered-shadow, F-143, F-152, F-103, F-157, F-158, F-159, F-160, paper owed, price as printed, price claim, vintage, refusal reason, credit memo, settle, sim findings
- **Links:** `p4-scratch/sim-findings-share-out-2026-10-02.md` (the coordinator's hand-out: "## R3" and "Founder answers, 2026-10-02"), [[0261-receipts-walk-through-r3-rulings]] (the walk-through these rulings follow), [[0119-an-agreed-price-states-its-unit]] (W56), [[0103-a-delivery-is-agreed-before-it-is-verified]] (W57b: a vintage change is a substitution, :113), [[0115-the-house-item-is-the-ledgers-key]] (the keg unit waits for its lock, PR #589; not decided here), [[0230-asking-a-vendor-for-a-credit-drafts-the-letter-and-sends-nothing]] (W55 amends it), `06-pages/receiving.md` P11, `tech-debt.d/2026-10-02-fix-door-releases-reservation.md`

## Context

The owner-quarter sim of 2026-10-01 (Tuzlu Rüzgar, on mudavym.com) filed findings that the coordinator split among the walk-through sessions. R3 received F-143, F-103, F-157, F-158, F-159 and F-160, and the founder made R3 the owner of `/receiving`. The main one, F-143, is that a door receipt never lets go of the order's reservation:

- The reservation is made at approval. approveOrder calls reserveOrderShadowStock (`apps/api-gateway/src/procurement/procurement.service.ts:4205` → `:4074-4119`), which adds `order.quantity` to the item's shadow stock. It passes no order id and no idempotency key, and it counts in the order's unit, so a case counts as 1.
- Only three places ever let go of a reservation: cancelOrder (`:3736` → `:4002-4070`), markDelivered (`:5428-5437`, key `order-delivered-shadow:${orderId}`) and delivery-item-to-name (`delivery-item-to-name.ts:504-514`, same key).
- Neither door path is among them. recordDoorReceipt (`receiving.service.ts:228`) books the counted bottles as live. DeliveryStockService.bookAtTheDoor (`canonical/delivery-stock.service.ts:179`, moves at `:501-524`) does the same.
- So on-hand counts every door-received delivery twice: once as live, once as a reservation nobody lets go of.

Measured read-only in production on 2026-10-02:

- Tuzlu has 549 orders (543 COMPLETED, 6 PARTIALLY_RECEIVED).
- It has 549 reserve rows totalling 1,899 bottles and zero release rows.
- Shadow stock equals the ledger sum on all 134 items.
- Every reserve row landed 0.06–0.59 s after its order's `approved_at`. Matching on (same item, row time near `approved_at`) pairs all 549 one to one.

The other five findings came from the same sim and are recorded here so R3's sim work has one record:

- **F-103:** the receive form takes a price with no unit.
- **F-157:** a price above the agreed one can only be refused or accepted, never claimed.
- **F-158:** every refusal is stored as "damaged".
- **F-159:** an unasked credit memo cannot settle a claim without a fake "ask".
- **F-160:** "the paper trail is caught up" while 543 checked deliveries have no invoice filed.

## Options considered

1. **Door versus verify (F-143, F-152).** The coordinator asked this once, together with the `/receiving` owner question.
   - The choice was to let go of the accepted bottles at the door, keeping a short as a backorder, or only when verify closes the order. The founder chose **at the door**.
   - Rejected: waiting for verify. It leaves on-hand double-counted for as long as the paper takes, and Tuzlu shows that can be forever.
2. **Repairing Tuzlu's leaked reservations.** Repair them with a dry run first, or leave them. The founder chose **"Yes, dry-run first"**. The repair only lets go of reservations and never deletes a row. It runs only after the founder's yes on the dry-run count and sample.
3. **W58: when a backorder's reservation stops counting.** The door keeps a short reserved, but nothing let go of it afterwards.
   - The options were: when the order closes; only when someone presses a new "The rest isn't coming" button; or both.
   - The founder chose **when the order closes**.
   - Rejected, the button: it needs a new route and a button on `/orders`, and a backorder nobody closes would count forever.
   - Rejected, both: it carries both costs.
4. **W56, F-103: the price unit on the receive form.** The options were: price as printed, with a unit pick that starts at the order line's unit (ADR 0119); label the field "per bottle"; or label it now and add the unit later.
   - The founder chose **price as printed**.
   - Rejected, the label: staff would divide a case price by hand, which ADR 0119 already turned down.
   - Rejected, label-now: it still ships the hand division.
5. **W57, F-157: billed above the agreed price.** The options were: two choices, claim the difference or accept the new price; always claim; or keep the delivery visible without a claim.
   - The founder chose **claim the difference**.
   - Rejected, always claim: a rise the house agreed by phone would become a claim someone has to write off.
   - Rejected, visible without a claim: the money is never chased.
6. **W57b: a vintage field on verify.** The options were a later branch (recommended), in the W57 PR, or note text only.
   - The founder chose **in the W57 PR**, which is not the recommended pick. It costs a migration plus the web and mobile forms.
   - Rejected: waiting for the drinks lock (ADR 0115), and leaving the vintage as note text.
7. **W53, F-160: "the paper trail is caught up".** The options were: count paper owed; drop the claim only; or drop the claim now and count later.
   - The founder chose **count paper owed**, using the rule the gateway already has: an invoice linked to the order.
   - Rejected: both "drop the claim" options, because delivered goods with no invoice would stay invisible.
8. **W54, F-158: one claim with three names.** The options were: keep the door's reason; one wording for one bucket; or words now and reasons later.
   - The founder chose **keep the door's reason** (wrong item, broken, temperature, other), with one wording on every page and in the letter. It needs a migration that widens the reason list.
   - Rejected, one bucket: wrong item and breakage would still look the same.
   - Rejected, words-now: it still loses the reason.
9. **W55, F-159: settling from an unasked memo.** The options were: settle from an open claim and let a person mark a paper as a memo; settle from open only; or keep ask-first.
   - The founder chose **settle from open plus mark memo**. The proof rule is unchanged (a memo plus an amount), and ADR 0230 is amended.
   - Rejected, settle-from-open-only: without AI no paper is ever classed as a memo.
   - Rejected, ask-first: it records an ask nobody made.

## Decision

**A signed door receipt lets go of the share of its order's reservation that the door accepted. Whatever is short stays reserved as a backorder until the order closes (W58).** How it works (`apps/api-gateway/src/procurement/order-reservation.ts`, called from `receiving.service.ts:575-601`):

1. **Target.** The bottles to let go of add up across trucks: `target = min(reserved, floor(reserved × booked ÷ bottles_total))`.
   - `booked` is the live bottles booked for this order and item. It is the larger of the two booking families: the door-receipt rows and the delivery-model rows. The larger is taken, not the sum, so one delivery seen by both paths is not counted twice.
   - A call lets go of `target − already let go`. Nothing is ever re-reserved.
2. **Which reservation.** A reservation row that carries the order's id wins.
   - Otherwise, for the rows written before that existed, the reservation is the single unlinked shadow row on the item stamped within [`approved_at` − 2 s, + 10 s].
   - That row must also fall outside every other same-item order's window. If it does not, or if more than one row matches, nothing is let go and the response names the issue.
   - No reservation found means nothing to let go. That covers the confirm-by-us path, which never reserved.
3. **Key.** The first release uses `order-delivered-shadow:${orderId}`, the same key markDelivered and delivery-item-to-name use, so whichever lands first is the only first release. Later trucks use `…:${n+1}`.
   - A racer that collides on a key, or hits "would go negative", re-reads and retries, at most 3 times.
   - The move is clamped to the item's present shadow stock. The `in_transit_quantity` display counter is clamped to shadow.
4. **Guards.** Nothing is let go on an order that is cancelled or rejected, or that carries `cancelled_at` or a cancel reason. cancelOrder already let go without an order id, and doing it again would take another order's reservation.
   - Nothing is let go for a legacy case or pack order whose bottle total is not above its quantity. Its reservation was counted in cases and is let go at close (W58).
5. **Never fails the receipt.** The release runs only after the order's status write succeeded. Since #612 (ADR 0286) a status write that fails retryably answers 503 and the outbox re-sends, so the retry reaches the release; a status the order's own rules refuse (SQLSTATE class 23) leaves the order as it was and lets go of nothing. That refusal, or a failed or ambiguous release, comes back as `reservationIssue` beside `stockBooked: true` and is logged. The release never turns a booked receipt into an error. *(Rebased onto `c4005eb09` on 2026-10-08.)*

The rulings W53–W57b are decided here and built on their own branches, one PR at a time:

| Item | Branch / PR | Note |
|---|---|---|
| W56, F-103 | `fix/receive-price-as-printed` | Optional `invoicePriceUom` + `invoicePricePackSize` on verify (ADR 0119 units, both or neither; none = per bottle); keg/litre refused until ADR 0115 |
| W53, F-160 | `fix/receipts-paper-owed` | `GET /procurement/receiving/paper-owed`, owner/manager |
| W57 + W57b | later branch, after W56 | Price-difference claim; vintage column (migration, versioned at merge) |
| W54, F-158 | later branch | Reason list widened (migration, versioned at merge) |
| W55, F-159 | later branch | Settle from open + mark memo; amends ADR 0230 |
| W58 | later `procurement.service.ts` PR, queued in O4 | Closing the order COMPLETED with no backorder, or FAILED, lets go of what is still reserved |

## Consequences

- On-hand stops counting door-received bottles twice from the moment this ships. Tuzlu's 1,899 already-leaked bottles stay until the dry-run repair gets the founder's yes.
- **Narrowed in this PR, said plainly:** the delivery-model door path (`bookAtTheDoor`) does not let go yet.
  - Doing it there before cancelOrder goes through the same helper would let go twice: once at the door with an order id, and again at cancel without one.
  - Both move to the later `procurement.service.ts` PR together.
  - Production has 3 delivery-model rows ever, so the gap is small but real.
- Owed in that later PR (O4 queue: houses' restack #538→#541→#542→#543 and the #577 rework → #558 and #561 → R7's vendors merge-up → this):
  - approveOrder reserves in bottles and passes the order id;
  - cancelOrder and markDelivered let go through this helper;
  - markDelivered stops letting go of `min(received, item shadow)`, which can take another order's reservation;
  - W58's close release;
  - the delivery-model door path.
- Not fixed and recorded in the tech-debt fragment:
  - a door receipt on a CANCELLED order still books its stock (since #612 the status trigger refuses the flip, so the order stays CANCELLED and nothing is let go);
  - a downward correction or a reversal does not re-reserve;
  - editing an order's quantity after approval does not move its reservation.
- Revisit the time-window matching once approveOrder passes the order id. After that, every new reservation carries the order's id, and the window serves only the rows written before it.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-10-02 | Founder | Door at the door; Tuzlu repair dry-run first (via the coordinator) |
| 2026-10-02 | Founder | W53–W58 picks (R3, AskUserQuestion) |
| 2026-10-02 | Adversarial design review (R3 scratch) | Three blockers: double release with cancelOrder on the delivery path (deferred, above); never fail after the live booking (fixed); the key race (retry loop) |
| 2026-10-03 | Mutation run, 14 mutations | All caught |
