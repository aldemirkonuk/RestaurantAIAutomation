# 0244 — An order edit is not a side door, and uncalled relays are closed

- **Status:** Locked. D1, D2 and D4 are the founder's ruling of 2026-09-29, *"fix these verified live holes now"*. D3 is his ruling of 2026-09-30, verbatim pick *"Re-check the limit (Recommended)"*. The builder's own choices under those rulings are marked as such below.
- **Date:** 2026-09-30
- **Decider:** Aldemir (founder). The rulings were relayed in chat by the coordinating session.
- **Keywords:** PATCH /procurement/orders/:id, updateOrder, status_through_its_act, order_price_changed, price edit, approval limit, re-check, APPROVAL_NEEDED, assertCanManageRestaurant, alerts/low-stock, alerts/daily-summary, relay, Plivo, shared mailbox
- **Links:** [[0125-an-order-changes-state-through-a-sealed-transition]] (the transition table and the sealed cancel), [[0116-a-threshold-stops-an-order-and-a-default-is-not-an-answer]] (the approval gate), [[0149-mudavym-is-the-only-design-finish-every-page-then-delete-legacy-once]] answer 15 (close uncalled senders), [[0084-the-communications-gateway-says-what-it-did]] (the SMS route deleted for having no caller); branch `fix/order-approval-and-alert-relays`; claim `SEC-2026-09-29-ORDER-PATCH-AND-ALERT-RELAYS`

## Context

An 817-route audit at 5a20d774b found two live holes. Both were re-verified at c47fd8a01.

1. **`PATCH /procurement/orders/:id` was a side door.** It checked no role. `updateOrder` asked only `order-transitions.ts` whether a move was legal, so any member of a house could move a PENDING, APPROVAL_NEEDED or NEGOTIATING order to APPROVED. That approval carried no seal, no approval rule, no `approved_by`/`approved_at` and no stock reservation, which is everything `POST orders/:id/approve` exists to require. REJECTED, FAILED, DELIVERED, CONFIRMED and COMPLETED were reachable the same way. Any member could also rewrite `total_cost`, `negotiated_price`, `quoted_price`, `final_price` and `price_verified`. `final_price` is DB-guarded only while a priced line exists. These are the figures the approval rules test and the approval seal is taken over (`order-seal.ts`), and `price_verified` is the verification's recorded verdict, which the vendor scorecard reads.
2. **`POST /communications/alerts/low-stock` and `/alerts/daily-summary` were relays.** Any signed-in member could make the platform's Plivo number text any phone, and the shared Gmail mailbox mail any address, with words of their choosing (`wineName`, `restaurantName`). There was no role check, no recipient allow-list and no record.

**Callers, measured 2026-09-29 with `git grep` over apps/web/src, apps/mobile, packages, services, supabase, scripts and apps/web/e2e:**
- **The PATCH:** no client sends a `status`. `ordersApi.updateOrder` and `updateOrderStatus` are exported and uncalled, and the legacy desk's "Mark as Ordered" went with #494. The one caller of the service method is `cancelOrder`, which has already run the transition, the category, the role and the seal.
- **The relays:** no caller at all, the orchestrator included. What the product actually sends goes through `ScheduledTasksService`, which resolves recipients from the house's own register.

## Options considered

- **For the PATCH status:** (a) refuse only the statuses that have a sealed act; (b) route each status through its act's service method; (c) refuse every status. (a) leaves FAILED (an unsealed way to end an order), NEGOTIATING from APPROVED (un-approving without the role that approves) and APPROVAL_NEEDED (faking a rule firing) open. (b) builds doors nobody calls. **(c) taken.**
- **For the relays:** NonProductionGuard, a service-key door, owner/manager with recipients restricted to the house's register, or closing both routes. A door for no caller is still a door. **Closing taken**, the posture of ADR 0149 answer 15 and of the SMS route in ADR 0084.
- **For a price edit after approval** (the fork left open on 2026-09-29): (a) refuse price edits once approved; (b) re-check the editor's limit and send the order back for approval if the new figure exceeds it; (c) allow the edit and only record it. **(b) ruled by the founder, 2026-09-30.**

## Decision

- **D1. `PATCH orders/:id` moves no order.**
  - Any `status` is refused with 422 `status_through_its_act`, and the message names the act that makes that move: holding to approve, the receiving door or verifying the receipt, the cancel act, or the vendor's own confirmation.
  - The older `cancel_through_the_sealed_act` refusal stays.
  - A status is written through `updateOrder` only by a caller that has already run the transition, which today is `cancelOrder` alone.
- **D2. The order's money is a manager's or an owner's to change, and every change leaves paper.**
  - `quotedPrice`, `negotiatedPrice`, `finalPrice`, `totalCost` and `priceVerified` need `OrganizationsService.assertCanManageRestaurant(actor, house, "change an order's price")`, the same helper cancel uses.
  - The check fails closed: an unwired helper is a 500, and an unnamed actor is a 403.
  - The figures are read before the write, and a failed read refuses the edit.
  - Every figure that actually moved is filed as `order_price_changed` in `system_audit_log` (who, and each column from and to).
  - The notes stay open to every member.
- **D3. A price edit on an approved order re-checks the editor's limit (founder, 2026-09-30).** The approval gate runs again for the person making the edit. If the new figure is beyond their limit, the order goes back to APPROVAL_NEEDED for someone whose limit covers it.
  - This needs a new transition edge, and so a migration that regenerates the trigger. With it, the change is more than one PR can carry under the 15-file cap, so D3 is built in the follow-up PR `fix/order-price-recheck`.
  - That PR amends this ADR with its design choices: which states it covers, what happens to the stock reservation and to staged vendor mail, the adversarial pass and the evidence.
  - Until it lands, a manager can still reprice an approved order within the role gate. The edit is on paper (D2) but not re-checked.
- **D4. The two alert relays are closed.**
  - The handlers go, along with `resolveAlertTenant` and `DailySummaryDto`.
  - `CommunicationsService.sendLowStockAlert` and `sendDailySummary` stay, for `ScheduledTasksService`, which passes each tenant's own id as the websocket room. The in-app low-stock notice therefore still fires.
  - The NonProduction `test/low-stock-alert` scaffold stays.

## Consequences

- **Easier.** An approval, a cancellation, a delivery or a placement can no longer be asserted through an edit. A price change now names its author.
- **Given up.** Nobody can set an order's status by hand. If a manual "placed with the vendor" act is wanted again, it needs its own act and its own rule. Staff can no longer correct a price; a manager or an owner does.
- **Contract change.** `PATCH` with any `status` is now a 422, and a price field from staff is a 403. No client sends either.
- **Not covered** (`tech-debt.d/2026-09-29-fix-order-approval-and-alert-relays.md`):
  - `rejectionReason`, `discrepancyNotes` and `invoiceImageUrl` are still writable by any member.
  - The web's order-edit helpers are dead.
  - The generated design map and ENDPOINTS.md still list the closed relays.
- **Revisit when** a client needs to write something on an order that no act writes, or a house needs its staff to correct prices.

## Evidence

- **`order-patch-is-not-a-side-door.spec.ts`:** 34 cases over HTTP, through the real controller and service behind main.ts's ValidationPipe.
  - 27 were red on c47fd8a01. The four `order_price_changed` cases came later: two of them are red against the D1/D2 service without the audit row.
  - Service and controller mutations killed: 6 of 6 for D1/D2, 3 of 3 for the audit row.
- **`alert-relays-are-closed.spec.ts`:** 5 cases, 4 red against the base controller and DTO.
- **Claim `SEC-2026-09-29-ORDER-PATCH-AND-ALERT-RELAYS`:** static, red on c47fd8a01, and every one of its tripwire checks has been mutated and caught.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-09-30 | — | Created on `fix/order-approval-and-alert-relays` |
