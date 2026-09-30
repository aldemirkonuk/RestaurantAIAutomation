## A manager can still reprice an order after it was sealed, and some order fields are still anyone's — OPEN — 2026-09-29

Filed by `fix/order-approval-and-alert-relays` (founder ruling 2026-09-29: fix the verified live holes; recorded as [ADR 0244](../decisions/0244-an-order-edit-is-not-a-side-door-and-uncalled-relays-are-closed.md)). That branch closed three things in `PATCH /procurement/orders/:id`:
- it no longer moves an order at all: every `status` gets a 422 `status_through_its_act`;
- its price fields (`quotedPrice`, `negotiatedPrice`, `finalPrice`, `totalCost`, `priceVerified`) need a manager or an owner, through `OrganizationsService.assertCanManageRestaurant`;
- every price change files `order_price_changed`, naming who changed which column, from what and to what.

Claim `SEC-2026-09-29-ORDER-PATCH-AND-ALERT-RELAYS`. These are the gaps it knowingly left.

**1. A sealed order can be repriced without being approved again. RULED, not yet built.** The approval gate (`assertApprovalAllowed`) tests `total_cost` against the house's thresholds at the moment of approval, and the approval seal is bound to that figure (`order-seal.ts`). After approval, a manager can still `PATCH` `totalCost`, and nothing re-runs the gate. So a manager under a 5,000 ceiling can approve at 4,000 and then set 50,000. The edit is on paper, but it is not stopped. **The founder ruled on 2026-09-30:** "Re-check the limit (Recommended)" (ADR 0244 D3). A price edit on an approved order re-runs the gate for the person editing, and if the new figure is beyond their limit the order goes back to APPROVAL_NEEDED. That needs a new transition edge and a migration that regenerates the trigger (`an_order_changes_state_by_the_table`), which puts it past this branch's 15-file cap. It is built on `fix/order-price-recheck`, which closes this item.

**2. Three record fields are still writable by any member.** `rejectionReason` writes `rejection_reason`, the cancel act's own account of why the wine was not bought (ADR 0125). `discrepancyNotes` and `invoiceImageUrl` write columns that `verifyReceipt` fills. Any member can overwrite all three through the PATCH. The ruling covered status and money, so they were left open.

**3. The web's order-edit helpers are dead, and one of them is wrong.** `apps/web/src/services/api/orders.ts` `updateOrder` and `updateOrderStatus` have no caller. `updateOrderStatus` can now only be refused (the claim fails if a web or mobile file starts calling it). The web type `UpdateOrderRequest` (`notes`, `quantity`, `unitPrice`) names fields that `UpdateOrderDto` does not declare, so main.ts's `forbidNonWhitelisted` would reject it with a 400. `apps/web/src/lib/supabase.ts` `updateOrderStatus` writes `procurement_orders` directly, keyed on an `order_id` column that does not exist. It is uncalled, and since OD-72 (`od72_revoke_client_grants`) no client role holds a grant on that table.

**4. The generated docs still list the closed relays.** `.planning/00-index/DESIGN-MAP.html`, `atlas-graph.json` and `.planning/foundation/ENDPOINTS.md` still show `POST /communications/alerts/low-stock` and `/alerts/daily-summary` until the next regeneration (`scripts/generate_design_atlas.py`). Those files are never edited by hand.

**Severity:** high until (1) lands, because a manager's approval ceiling can be stepped around after the seal. (2) to (4) are low.
