## A door receipt kept its order's reservation forever — FIXED at the door, nine leftovers OPEN — 2026-10-08

Filed by `fix/door-releases-reservation` (F-143, [ADR 0267](../decisions/0267-a-door-receipt-lets-go-of-the-accepted-share-of-its-reservation.md)). Claims: `../decisions/claims.d/fix-door-releases-reservation.jsonl:1-4`. Cites `../06-pages/receiving.md` P11.

**Fixed on this branch.** `recordDoorReceipt` (`apps/api-gateway/src/procurement/receiving.service.ts`) lets go of the accepted share of the order's shadow reservation through `releaseAcceptedShare` (`order-reservation.ts`), after the status and `delivered_at` writes and only when the status write landed.

**Open, each on a later branch (ADR 0267 §Consequences):**

1. **`markDelivered` over-releases.** It lets go of `min(received, item shadow)`, which can take another order's reservation on the same item. Move it onto `releaseAcceptedShare`.
2. **`approveOrder` reserves in the order's unit and without `p_order_id`.** Reservations written before that change are matched to their order by a time window (`approved_at` −2 s / +10 s). Reserve in bottles and pass the order id.
3. **`cancelOrder` does not use the helper**, and cancelling a `PARTIALLY_RECEIVED` order (the status the door leaves) lets go of nothing.
4. **W58: closing an order lets go of what is still reserved** (COMPLETED with no backorder, or FAILED). Claim `RCPT-2026-10-02-W58-CLOSE-LETS-GO-OF-BACKORDER` is `open`.
5. **The delivery-model door path** (`DeliveryStockService.bookAtTheDoor`) does not let go. Deferred with 3 so the two cannot let go twice. Claim `RCPT-2026-10-02-F143-DELIVERY-PATH-OWED` is `open`.
6. **A door receipt on a CANCELLED order still books its stock.** Since #612 the status trigger refuses the flip, so the order stays CANCELLED and nothing is let go, but the stock movement stands.
7. **A downward correction or a reversal does not re-reserve.**
8. **Editing an order's quantity after approval does not move its reservation.**
9. **Rows leaked before this ships stay leaked.** Tuzlu: 1,899 bottles reserved by door-received orders (2026-10-03 read-only measure). A repair is a production write: a dry run first, and the run itself only on the founder's yes.
