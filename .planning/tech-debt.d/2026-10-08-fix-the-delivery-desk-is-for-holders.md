## A delivery's desk acts went to any signed-in person; now to owners and managers — FIXED — 2026-10-08

Branch `fix/the-delivery-desk-is-for-holders` (ADR 0312). This closes the OPEN entry *"A delivery's agree, accept-as-billed and verify are open to every member"* in `2026-10-07-fix-document-money-writes-for-holders.md`. That entry is left as written, because it belongs to #659's branch.

`DeliveriesController` carried `JwtAuthGuard` only. A staff token could post a priced proposal, accept it, agree the delivery and verify it. Verify posts an accepted proposal's price as the lot's final cost (`finaliseAtVerified`, `agreedPrices`).

Six handlers now call `assertDeliveryDesk` (`apps/api-gateway/src/procurement/canonical/delivery-desk-gate.ts`) as their first statement:

- propose
- counter
- accept
- accept-as-billed
- agree
- verify

The gate reads #659's `holdsHouseMoney`.

D9's 50 % rung now goes to the house's money holders when the delivery's owner is not one. A door-created delivery is owned by whoever counted it, and ownership is left unchanged. See `DeliveryClockService.halfRungAudience`.

Proof:

- `deliveries.desk-gate.spec.ts`
- the half-rung describe in `delivery-clock.service.spec.ts`
- three resolved rows in `claims.d/fix-the-delivery-desk-is-for-holders.jsonl`

The web and the remaining prose land on `fix/the-delivery-desk-says-what-verify-posts`.

## A member who is not a money holder can still set a lot's final cost outside the delivery desk — OPEN — 2026-10-08

ADR 0312's census lists two paths. Each has an OPEN CLAIMS row in `claims.d/fix-the-delivery-desk-is-for-holders.jsonl`. M1 priority.

1. **`POST /procurement/orders/:id/verify-receipt`**
   - The route carries only `JwtAuthGuard` (`procurement.controller.ts:119`, `:661`).
   - `applyReceiptAdjustment` revalues the lot with `'invoice'` provenance.
   - The live web and mobile receiving screens call it, so gating it changes the door flow. It needs its own lane and its own read of ADR 0167.
   - Row: `COST-WRITER-VERIFY-RECEIPT-REFUSES-A-NON-HOLDER`.
2. **`POST /inventory/:restaurantId/items` and `/items/bulk` with `costPerBottle` and no menu price**
   - `assertMayPrice` runs only for a menu price (`inventory.controller.ts:183`, `:223`).
   - `resolveLotCost` files the cost as `'manual'`, and a priced `'manual'` lot is final.
   - The comment that said otherwise is bracket-corrected at `inventory.service.ts:874-879`.
   - Row: `COST-WRITER-INVENTORY-COST-PER-BOTTLE-IS-A-HOLDER-ACT`.

## Follow-ups owed by ADR 0312 — OPEN — 2026-10-08

None of these is built.

1. **A cost that failed to post cannot be posted again.**
   - When `finalise_delivery_cost` errors, the delivery stays VERIFIED and the costNote says posting "is safe to retry" (`canonical/delivery-stock.service.ts:427`, `canonical/delivery.service.ts:960-981`).
   - A re-verify returns early and posts nothing (`:911-919`).
   - OD-223 path B would cover both.
2. **A door count onto a VERIFIED delivery books an uncosted lot.** This is OD-223.
3. **`cancelFor` runs on agree and verify.** Check this against ADR 0103 A3's "timers stop at agreement" before changing either.
4. **Accept on a settled delivery.** `accept` checks the proposal's status and not the delivery's state (`canonical/delivery.service.ts:661-702`), so a proposal can be accepted after VERIFIED. It no longer moves cost, because a re-verify posts nothing. It still changes the record.
5. **Money reads (M2).**
   - The proposal thread shows `money_at_risk`.
   - The delivery read returns the proposals' prices to every member.
   - The reads were left open in this lane on purpose: the decision gates writes.
6. **The lapse sentences.** `DeliveryGates.tsx`'s lapse line still says what a manager does at a lapse. It was not re-read against the new gate.
7. **`finalise_delivery_cost` grant.** The grant is to `anon` and `authenticated` (migration `20260906233000`, `:399`). It is SECURITY INVOKER over RLS-enabled `inventory_lots`, with no policy. That is likely harmless, but not proven.
8. **The admin divergence.** `holdsHouseMoney` admits `admin` (`reading-data-classes.ts:241`). The web check and `RolesGuard` refuse it.
9. **No per-item price preview before verify.**
   - Link and link-item stay open to staff (ADR 0312, "#659's fork 4, restated").
   - A holder verifies with no list of which price each item will take.
10. **Door facts.**
    - `DoorCountDto` has no damage or refusal field, only a free-text `note`.
    - The legacy receipt's damage and photo do not reach the canonical delivery.
    - On a canonical delivery, damage or refusal reaches the record only through a proposal, now a holder's act.
