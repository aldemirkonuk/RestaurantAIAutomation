# 0062 — A quantity crossing the wire declares its unit, and the door accumulates

- **Status:** Proposed
- **Date:** 2026-09-01
- **Decider:** Aldemir (founder) — the accumulation rule (D3) and the typed-columns rule (D4) were decided by the founder before this work started; the rest is implementation under them
- **Keywords:** receiving, door, units, bottles, boxes, rejected, idempotency, split delivery, accumulate, stock movement, procurement_receipt_events, guard
- **Links:** [[0011-pos-sale-volume-contract]], [[0016-ledgers-must-express-unknown]], [[0020-no-fabricated-answers]], [[0051-rebuilt-pages-show-live-data-only]], [[0054-order-capture-and-unit-arithmetic]], PR `fix/door-receipt-arithmetic`

## Context

Five defects on the receiving door (`/receiving/:orderId/door`), found together
and sharing two roots: a number that did not say what it was, and a report that
was written whether or not the thing it reported happened.

**A refused delivery booked stock.** The door sends both quantities in BOXES
with `countedUom: 'case'` (`DoorNext.tsx:285-288`), and on a refusal sends
`rejectedQty: outcome === 'refused' ? counted : broken` under the comment *"A
refusal takes nothing in."* The server converted one of them:

```
countedBottles = toBottles(counted, uom, packSize)   // bottles
rejectedQty    = Math.max(0, input.rejectedQty ?? 0)  // still BOXES
acceptedBottles = countedBottles - rejectedQty        // bottles minus boxes
```

Three refused boxes at pack 12 booked **33 bottles into live stock for wine that
was turned away at the door and never entered the building**. One broken box out
of fourteen booked 167 instead of 156. The event row stored the mixed pair too:
`counted_qty_bottles` in bottles beside `rejected_qty` in boxes, with nothing
recording that they disagreed.

It survived review because the only gateway test covering the path used
`countedUom: "bottle"` (`receiving.spec.ts:200-207`), where the derived pack size
is 1 and `toBottles` is the identity. The converted and unconverted expressions
are the same number there. **The test did not fail because it could not fail** —
the same shape as the `?? "case"` fallback in [0054](0054-order-capture-and-unit-arithmetic.md),
and the same shape as every entry in `memory/absence-reported-as-health`.

**A failed stock movement was reported as a success.** `receiving.service.ts:222-225`
warned and fell through; `:228-241` then wrote `quantity_received`, `status` and
`delivered_at` regardless, and the response returned `stockDelta: delta` as
though the bottles were on the shelf. One branch up, `if (delta !== 0 &&
order.inventory_id)` meant an order with no shelf booked nothing and still
reported a non-zero delta.

**A second truck erased the first.** `quantity_received = acceptedBottles` was
set ABSOLUTELY (`:228-230`), so truck two with six boxes after truck one's eight
recorded six received, not fourteen — and the match line called truck two "short"
against the whole purchase order while the driver waited. Split deliveries are
normal in wine.

**The door's structured facts were prose.** `composeDoorNotes`
(`DoorModel.ts:304-316`) flattened `outcome` (a closed set of three,
`DoorModel.ts:219`), `refusal_reason` (a closed set of four, `:227`), counted,
expected, broken, signedBy, driver and a full drafted credit letter into one
blob in `procurement_receipt_events.notes`, which nothing ever read back. That
blob also carried a **blocking** bug: `notes` is `@MaxLength(500)` and
`doorOutbox.ts:64-65` treats a 4xx as PERMANENT. Measured, the short-shipped
skeleton was **344** characters and a real distributor plus a real Bordeaux
produced **546** — a receiver who could not save the delivery at all, no matter
how many times they retried.

**Two client-side statements were untrue.** Offline, the photo `File` was
discarded while the screen said *"No signal — the paper will be read later."* And
`photoTaken` was set the instant the camera returned a file, so the drafted
credit letter told a vendor the paperwork *"is attached"* on the offline branch
and on the upload-failure branch — asserting an attachment to a document the
server had never received.

## Options considered

### 1. How `rejectedQty` declares its unit

1. **A sibling `rejectedUom` that must equal `countedUom`.** Consistent with the
   `counted_qty`/`counted_uom` pair the table already uses. Costs: a second unit
   is a second thing that can disagree, and the disagreement needs its own
   refusal path. The physical act has one unit — a receiver counting boxes
   rejects boxes.
2. **A branded type (`Bottles`/`Boxes`).** Strongest inside the service. Costs:
   TypeScript brands are erased at the wire, and the wire is precisely the
   boundary this bug crossed. It would have protected the arithmetic and not the
   DTO.
3. **Rename to `rejectedQtyInCountedUom`.** The unit travels in the name, into
   the JSON, into the outbox body, into every log line. It cannot disagree with
   itself, needs no new validation branch, and is statically checkable.

### 2. What a failed `apply_stock_movement` should return

1. **Throw.** Makes the failure real. But the old 23505 branch returned "already
   recorded" immediately, so a retry after a failed movement would short-circuit
   and *certify the absence of the booking* — worse than the bug.
2. **A distinct 200 with `stockBooked: false`.** Honest, rendered in words. But
   the outbox removes a 200 from its queue, so the stock never moves unless a
   human acts.
3. **Split by cause.** A retry fixes a transient RPC fault; no retry links an
   order to a shelf.

### 3. How accumulation stays idempotent

1. **Increment `quantity_received`.** Simplest, and wrong: a retry increments
   again, and the column is the very thing the bug proved untrustworthy.
2. **Recompute one running delta and book the difference.** Needs a trustworthy
   record of what was already booked — which is the same problem.
3. **One movement per EVENT, keyed to that event; the running total summed from
   the events.** The sum is over a SET, so it converges under retry; the per-event
   key makes `apply_stock_movement` dedupe the movement itself
   (`20260805130000:71-74` returns the existing transaction id).

## Decision

**Every quantity that crosses the client/server boundary carries its unit in its
own name, or in a named sibling that shares its prefix.** `rejectedQty` becomes
`rejectedQtyInCountedUom`; `expectedQtyInCountedUom` joins it. Option 3 of fork 1:
a name survives JSON, and the pair form (option 1) invites the one disagreement
the physical act cannot have. `rejected_qty` (in `counted_uom`) and
`rejected_qty_bottles` (in bottles) now complete the pairing the counted side
already had, so the row no longer mixes units.

The old `rejectedQty` is **still read** on the way in, interpreted in
`countedUom`. Dropping it would make the fix worse than the bug: a receipt queued
in a phone's outbox by the pre-fix client would arrive with nothing rejected and
book the whole refused delivery into live stock.

**A stock movement that did not happen is never reported as one, and the answer
depends on whether a retry can fix it.** A failed RPC throws 503 — the outbox
queues a non-4xx, the screen says "saved on this phone", the receiver walks away
in one second with the driver still double-parked, and the retry converges
because both the event insert and the movement are idempotent. A missing
`inventory_id` returns 200 with `stockBooked: false` and a sentence the screen
renders, because no number of retries links an order to a shelf and a
permanently stuck outbox item is how the next real failure hides. `stockDelta` is
**null**, never 0, when nothing moved ([0016](0016-ledgers-must-express-unknown.md)).
The 23505 branch no longer returns early; it reads the existing event back and
re-attempts, which is free when the movement already applied and is the actual
repair when it did not.

**FOUNDER-DECIDED — the door accumulates.** The running total is summed from
`procurement_receipt_events`, never read from `procurement_orders.quantity_received`.
The ledger delta is *this event's* accepted bottles booked under
`door-receipt:{eventId}`, except on the first door receipt for an order, which
also reconciles against whatever the one-shot `markDelivered` path already
booked. The match line and the drafted credit compare against the running total —
`GET /procurement/receiving/orders/:id/received` supplies it — so truck two reads
"14 of 16 with the earlier 8 — two short" instead of starting a vendor claim the
paperwork disproves. The fallback idempotency key gains the rejected figure and
the capture timestamp; `door:{orderId}:{countedBottles}` alone silently swallowed
a genuine second truck of the same size.

**FOUNDER-DECIDED — the door's structured facts become typed columns.**
`20260901220000_door_facts_are_columns.sql` adds `outcome`, `refusal_reason`,
`signed_by_initials`, `driver_name`, `expected_qty_bottles` and
`rejected_qty_bottles`, with CHECK constraints copied verbatim from the client
enums and one more saying a `refusal_reason` requires `outcome = 'refused'`.
`notes` keeps only the drafted credit letter — the one thing here that is genuinely
prose — with every interpolated name clamped to a budget and the whole string
clamped after composition. Measured after: skeleton **259**, worst case with every
budget saturated **449**, the 546-character pair now **431**. The bound is
structural, not arithmetic: it holds without anyone re-doing the measurement when
a sentence changes.

**The offline photo is not queued, and the screen says so.** Queueing was the
better answer and was measured as unsafe: the door outbox is `offlineStorage`'s
pending-mutation queue, whose localStorage fallback serialises every pending
mutation into one `${store}_all` key and swallows a quota failure with a
`console.error` (`offline-storage.ts:189-210`). A multi-megabyte base64 photo
written there on the old iPads a receiving desk actually has would take the
RECEIPT down with it — losing the delivery to save the picture of it. So the
sentence becomes true instead. `hasPhoto` is now `documentId !== null`: the
credit letter may only claim an attachment that exists.

## Consequences

- A refusal books nothing, at any pack size. A broken box subtracts twelve
  bottles, not one.
- A split delivery adds up, and neither the match line nor the drafted credit
  accuses a vendor of a shortfall their own paperwork disproves.
- A receipt whose stock never moved is visible as such — as a queued retry that
  converges, or as a sentence on the screen.
- A receiver can save a delivery from a real distributor of a real Bordeaux.
- `notes` stops being a grep target: `outcome`, `refusal_reason`,
  `signed_by_initials`, `driver_name` and `expected_qty_bottles` are queryable,
  and `idx_pre_outcome` serves "show me every refusal, and why".
- **Given up:** the offline photo. It was never actually saved; what is given up
  is the sentence that said it was.
- **Given up for now:** six fields on `dto/procurement.dto.ts`
  (`quantityReceived`, `invoiceQuantity`, `shippedQuantity`,
  `freeGoodsQuantity`, `acceptedQuantity`, `rejectedQuantity`) carry the
  identical defect and are listed in the guard's shrink-only exception list
  rather than fixed, because every one is read by `procurement.service.ts`,
  which three unmerged branches own. `verifyReceipt`'s four are compared against
  each other and against `procurement_orders.quantity` — the same shape as
  `countedBottles - rejectedQty`, one conversion away from the same bug.
- **Revisit when:** the deprecated `rejectedQty` alias can be deleted (no phone
  can still hold a receipt written by the pre-fix client), or when a change that
  may touch `procurement.service.ts` can clear the six above. Both are recorded
  as shrink-only entries whose staleness is itself a guard finding.

## Guard

`scripts/check_quantity_units.py` — blocking, wired into `ci.yml`, exit 1 on
violation, 0 clean, **2 when it cannot check**, with `--self-test`. Proven exit 1
against the pre-fix declarations and 0 after.

It checks that a `*Qty*`/`*Quantity*` field on a procurement/receiving DTO
declares its unit in its name, in an `In…Uom` reference, or in a **same-prefix**
sibling — the looser "this DTO has a unit field somewhere" reading is exactly
what let `rejectedQty` look accompanied when `countedUom` described `countedQty`.
A deprecated alias is exempt only while the declared field it aliases still
stands beside it.

It does **not** verify that a declared unit is the correct one; only a test at a
real pack size does that, which is why this change ships those. It does not cover
quantities outside a DTO, or DTOs outside procurement/receiving. Both limits are
in the guard's own header, per `memory/absence-reported-as-health`.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-09-01 | Aldemir | D3 (accumulate) and D4 (typed columns) decided before implementation |
| 2026-09-01 | — | Created; pre-fix failures captured verbatim in the PR body |
