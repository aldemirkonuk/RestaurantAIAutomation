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
- **The PATCH:** no client sends a `status`. `ordersApi.updateOrder` and `updateOrderStatus` are exported and uncalled, and the legacy desk's "Mark as Ordered" went with #494. The service method has two callers: the PATCH controller, and `cancelOrder`, which has already run the transition, the category, the role and the seal before it writes CANCELLED through it.
- **The relays:** no caller at all, the orchestrator included. What the product actually sends goes through `ScheduledTasksService`, which resolves recipients from the house's own register.

## Options considered

- **For the PATCH status:** (a) refuse only the statuses that have a sealed act; (b) route each status through its act's service method; (c) refuse every status. (a) leaves FAILED (an unsealed way to end an order), NEGOTIATING from APPROVED (un-approving without the role that approves) and APPROVAL_NEEDED (faking a rule firing) open. (b) builds doors nobody calls. **(c) taken.**
- **For the relays:** NonProductionGuard, a service-key door, owner/manager with recipients restricted to the house's register, or closing both routes. A door for no caller is still a door. **Closing taken**, the posture of ADR 0149 answer 15 and of the SMS route in ADR 0084.
- **For a price edit after approval** (the fork left open on 2026-09-29): (a) refuse price edits once approved; (b) re-check the editor's limit and send the order back for approval if the new figure exceeds it; (c) allow the edit and only record it. **(b) ruled by the founder, 2026-09-30.** The adversarial pass then found that "send the order back" can be built two ways, and that two other doors approve without the gate at all. See D3.

## Decision

- **D1. `PATCH orders/:id` moves no order.**
  - Any `status` is refused with 422 `status_through_its_act`, and the message names the act that makes that move: holding to approve, the receiving door or verifying the receipt, the cancel act, or the vendor's own confirmation.
  - The older `cancel_through_the_sealed_act` refusal stays.
  - `updateOrder` has two callers, the controller and `cancelOrder`. Only a caller that has already run the transition may write a status through it, and of the two that is `cancelOrder` alone. The controller never passes the flag that allows it.
- **D2. The order's money is a manager's or an owner's to change, and each change is filed, best-effort.**
  - `quotedPrice`, `negotiatedPrice`, `finalPrice`, `totalCost` and `priceVerified` need `OrganizationsService.assertCanManageRestaurant(actor, house, "change an order's price")`, the same helper cancel uses.
  - The check fails closed: an unwired helper is a 500, and an unnamed actor is a 403.
  - The figures are read before the write, and a failed read refuses the edit.
  - Every figure that actually moved is filed as `order_price_changed` in `system_audit_log`: who, which door, and each column from and to. The filing is best-effort. `recordOrderPriceChanged` never throws, because the change has already happened, and a failed write is logged loudly as `order_price_changed happened but the audit row failed`. This is the same contract as `order_cancelled`, so the log can miss a change it cannot write.
  - **The second door, `createOrder`'s dedup merge, is closed too** (ADR 0090 security review of #538, round 1). `POST /procurement/orders` checks no role. When an open order exists for the same house, wine and vendor, the new request is folded into it. On an APPROVAL_NEEDED, NEGOTIATING or APPROVED order, that fold rewrote the quantity, unit, bottles and every price for any member, with no paper.
    - A fold that moves any of those figures on an order past PENDING now needs the same helper and the same action words, and gets the same 403 (`merge_would_change_price`). The actor is the JWT's user, threaded from the controller.
    - Quantity is money here: the approval rules test the order's total, and the fold recomputes that total from the quantity. A body that holds the total while raising the quantity is still refused.
    - A fold into a PENDING order keeps today's re-quote for every member, because nobody has approved it and approving it tests the new figures. It now files `order_price_changed` too (door `merge`).
    - A re-post that moves no figure is neither refused nor filed.
    - **The write is conditional on what the gate read** (the audit planner's race finding at d033412f5). The header UPDATE matches only the house, the id, the status and each money column the lookup returned (`eq`, or `is null`). An order approved, or repriced by somebody else, between the lookup and the write therefore matches nothing. The fold is then refused with 409 `merge_target_changed`: nothing is changed, and no line and no audit row are written. It is 409 here, not 403, because the refusal is about state, and re-reading the order is the remedy.
    - **The paper is filed right after the header write,** before the order line is rewritten. If the line write then fails, the request errors, but the header has moved and the log already says so. The line and the header are two writes, not one transaction, so a failed line can still leave a header that disagrees with its line. That was already true before this change, and it is not fixed here.
  - The notes stay open to every member.
- **D3. A price edit on an approved order re-checks the editor's limit (founder, 2026-09-30). RULED, NOT BUILT: its design waits on four founder calls.** The approval gate runs again for the person making the edit. If the new figure is beyond their limit, the order goes back to APPROVAL_NEEDED for someone whose limit covers it.
  - **Why it is not built yet.** A separate adversarial pass on 2026-09-30 killed the literal build (park the order at APPROVAL_NEEDED, release its reservation, hold its staged mail). The builder checked its load-bearing findings:
    - An APPROVED order may already have its letter at the vendor: `approveDraft` sends it and the order stays APPROVED. Parked, it could not be received at the door, since APPROVAL_NEEDED has no edge to DELIVERED. Re-approving it would publish a second vendor inquiry, and `approveOrder` would reserve its stock again.
    - `approveOrder` is the only writer that reserves stock. `confirmDeal` and the inbound responder's autonomy accept both write APPROVED without reserving, so a release on park would release other orders' stock.
    - A one-time hold on staged mail misses a send already claimed, and the responder keeps drafting for any open order unless `ai_autonomy_paused` is set.
    - The vendor scorecard, analytics and `cancel-reason.ts` all read APPROVAL_NEEDED as "the vendor never saw it".
    - **Two existing doors approve at any price with no gate at all.** `confirmDeal` does not limit owners or managers (ADR 0175, locked) and does not filter by status, so a manager can take any order, a parked one included, to APPROVED at any price. `syncOrderState` under full autonomy writes APPROVED at the vendor's price. Each of these steps around the ceiling whatever the PATCH does.
  - **The four calls it waits on:**
    - F1: park the whole order, or hold a pending price change that waits for approval while the order keeps its state.
    - F2: whether confirm-deal runs the approval gate. This supersedes part of the locked ADR 0175.
    - F3: whether the autonomy accept is gated.
    - F4: which rules and which direction trigger the re-check (decreases; `new_vendor`; the effective total when a unit price changes).

    They are in `tech-debt.d/2026-09-29-fix-order-approval-and-alert-relays.md` item 1 and in the coordinator's report.
  - **Until then:** a manager can still reprice an approved order within the role gate. The edit is on paper (D2) but not re-checked.
- **D4. The two alert relays are closed.**
  - The handlers go, along with `resolveAlertTenant` and `DailySummaryDto`.
  - `CommunicationsService.sendLowStockAlert` and `sendDailySummary` stay, for `ScheduledTasksService`, which passes each tenant's own id as the websocket room. The in-app low-stock notice therefore still fires.
  - The NonProduction `test/low-stock-alert` scaffold stays.

## Consequences

- **Easier.** An approval, a cancellation, a delivery or a placement can no longer be asserted through an edit. A price change, through the PATCH or through a fold, now names its author when the log can be written.
- **Given up.** Nobody can set an order's status by hand. If a manual "placed with the vendor" act is wanted again, it needs its own act and its own rule. Staff can no longer correct a price; a manager or an owner does.
- **Contract change.** `PATCH` with any `status` is now a 422, and a price field from staff is a 403. No client sends either. A staff `POST /procurement/orders` that would reprice, or change the quantity of, an open order past PENDING is now a 403 naming that order, where it used to rewrite it.
- **Not covered** (`tech-debt.d/2026-09-29-fix-order-approval-and-alert-relays.md`):
  - `rejectionReason`, `discrepancyNotes` and `invoiceImageUrl` are still writable by any member.
  - The web's order-edit helpers are dead.
  - The generated design map and ENDPOINTS.md still list the closed relays.
- **Revisit when** a client needs to write something on an order that no act writes, or a house needs its staff to correct prices.

## Evidence

- **`order-patch-is-not-a-side-door.spec.ts`:** 45 cases over HTTP, through the real controller and service behind main.ts's ValidationPipe.
  - 27 were red on c47fd8a01.
  - The four `order_price_changed` cases came later: two of them are red against the D1/D2 service without the audit row.
  - The eight merge cases came in round 1: seven of them are red at e5edf9af1, 201 where 403 was expected. The eighth pins the harmless re-post.
  - The three race and ordering cases came next, all red at d033412f5. On the two races the fold answered 201 where 409 was expected; on the third, no audit row had been filed.
  - Service and controller mutations killed: 6 of 6 for D1/D2, 3 of 3 for the audit row, 7 of 7 for the merge gate, and 4 of 4 for the conditional write and the order of the paper. The house filter on the merge write is not tested on its own, because the lookup before it is already house-scoped.
- **`alert-relays-are-closed.spec.ts`:** 5 cases, 4 red against the base controller and DTO.
- **Claim `SEC-2026-09-29-ORDER-PATCH-AND-ALERT-RELAYS`:** static, red on c47fd8a01, and every one of its tripwire checks has been mutated and caught.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-09-30 | — | Created on `fix/order-approval-and-alert-relays` |
| 2026-09-30 | Adversarial pass (separate agent), with its findings re-verified by the builder | D3's literal build is unsafe (stock, vendor mail, door, readers of APPROVAL_NEEDED), and confirm-deal and the autonomy accept bypass the gate. D3 is held for four founder calls |
| 2026-09-30 | ADR 0090 audit of #538 at e5edf9af1 (security BLOCK, correctness APPROVE) | Round 1: the dedup merge was a second staff door to an open order's money and is closed (D2). D1's caller sentence and D2's paper sentence were narrowed to the code. D3 is untouched |
| 2026-09-30 | Audit planner, at d033412f5 | The merge gate read the status at lookup and wrote by id alone, a stale-status race. The write is now conditional on the status and figures it gated on (409 when they moved), and the paper is filed before the line |
