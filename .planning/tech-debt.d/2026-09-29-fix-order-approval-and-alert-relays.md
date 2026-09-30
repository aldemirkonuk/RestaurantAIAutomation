## A manager can still reprice an order after it was sealed, and some order fields are still anyone's — OPEN — 2026-09-29

Filed by `fix/order-approval-and-alert-relays` (founder ruling 2026-09-29: fix the verified live holes; recorded as [ADR 0244](../decisions/0244-an-order-edit-is-not-a-side-door-and-uncalled-relays-are-closed.md)). That branch closed three things in `PATCH /procurement/orders/:id`:
- it no longer moves an order at all: every `status` gets a 422 `status_through_its_act`;
- its price fields (`quotedPrice`, `negotiatedPrice`, `finalPrice`, `totalCost`, `priceVerified`) need a manager or an owner, through `OrganizationsService.assertCanManageRestaurant`;
- every price change files `order_price_changed`, naming who changed which column, from what and to what.

Claim `SEC-2026-09-29-ORDER-PATCH-AND-ALERT-RELAYS`. These are the gaps it knowingly left.

**1. A sealed order can be repriced without being approved again. RULED, but the build is held for four founder calls.** The approval gate (`assertApprovalAllowed`) tests `total_cost` against the house's thresholds at the moment of approval, and the approval seal is bound to that figure (`order-seal.ts`). After approval, a manager can still `PATCH` `totalCost`, and nothing re-runs the gate. So a manager under a 5,000 ceiling can approve at 4,000 and then set 50,000. The edit is on paper, but it is not stopped. **The founder ruled on 2026-09-30:** "Re-check the limit (Recommended)" (ADR 0244 D3). An adversarial pass the same day, whose load-bearing findings the builder re-read in the code, showed the literal build (park at APPROVAL_NEEDED) is unsafe:
- `approveOrder` is the only writer that reserves stock (`reserveOrderShadowStock` has one caller). A release on park would free other orders' stock for orders approved through `confirmDeal` or the responder's autonomy accept.
- An APPROVED order may already have its letter at the vendor, because `approveDraft` sends it and leaves the order APPROVED. Once parked, the door cannot receive it, and re-approval re-reserves stock and publishes a second vendor inquiry.
- Holding staged mail once misses sends already claimed. The responder keeps drafting unless `ai_autonomy_paused` is set.
- The scorecard, analytics and `cancel-reason.ts` read APPROVAL_NEEDED as "the vendor never saw it".

Two more doors step around the ceiling today whatever the PATCH does. `confirmDeal`'s `dealTarget` has no status filter, and `requireSendAuthority` does not limit owners or managers (ADR 0175, locked), so a manager can take any order to APPROVED at any price. `syncOrderState` under full autonomy writes APPROVED at the vendor's price with no gate. **The calls it waits on:**
- **F1.** Park the order, or hold a pending price change that waits for approval while the order keeps its state? The pending change costs columns and a sealed approve-the-change act, and avoids every side effect above.
- **F2.** Should confirm-deal run the approval gate? This supersedes part of ADR 0175.
- **F3.** Should the autonomy accept be gated?
- **F4.** What triggers the re-check: increases only, or decreases too? `new_vendor` fires on any edit to a first order with a vendor. And is it the effective total, `max(total_cost, unit price × quantity)`?

The two bypasses in F2 and F3 are also defects in their own right, and they are filed here until the founder rules.

**2. Three record fields are still writable by any member.** `rejectionReason` writes `rejection_reason`, the cancel act's own account of why the wine was not bought (ADR 0125). `discrepancyNotes` and `invoiceImageUrl` write columns that `verifyReceipt` fills. Any member can overwrite all three through the PATCH. The ruling covered status and money, so they were left open.

**3. The web's order-edit helpers are dead, and one of them is wrong.** `apps/web/src/services/api/orders.ts` `updateOrder` and `updateOrderStatus` have no caller. `updateOrderStatus` can now only be refused (the claim fails if a web or mobile file starts calling it). The web type `UpdateOrderRequest` (`notes`, `quantity`, `unitPrice`) names fields that `UpdateOrderDto` does not declare, so main.ts's `forbidNonWhitelisted` would reject it with a 400. `apps/web/src/lib/supabase.ts` `updateOrderStatus` writes `procurement_orders` directly, keyed on an `order_id` column that does not exist. It is uncalled, and since OD-72 (`od72_revoke_client_grants`) no client role holds a grant on that table.

**4. The generated docs still list the closed relays.** `.planning/00-index/DESIGN-MAP.html`, `atlas-graph.json` and `.planning/foundation/ENDPOINTS.md` still show `POST /communications/alerts/low-stock` and `/alerts/daily-summary` until the next regeneration (`scripts/generate_design_atlas.py`). Those files are never edited by hand.

**Severity:** high while (1) is open. A manager's approval ceiling can be stepped around, after the seal through the PATCH and at any time through confirm-deal. (2) to (4) are low.
