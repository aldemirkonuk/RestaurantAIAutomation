# 0244 — An order edit is not a side door, and uncalled relays are closed

- **Status:** Locked. D1, D2 and D4 are the founder's ruling of 2026-09-29, *"fix these verified live holes now"*. D3 is his ruling of 2026-09-30, verbatim pick *"Re-check the limit (Recommended)"*. The builder's own choices under those rulings are marked as such below. **[2026-09-30, later: D3's four calls were answered by the founder the same day, verbatim picks F1 *"Pending price change (Recommended)"*, F2 *"Yes, gate it (Recommended)"*, F3 *"Yes, wait (Recommended)"*, F4 *"Any price change"*; D3 is built on `fix/order-price-recheck`, stacked on #538. See the D3 amendment.]**
- **Date:** 2026-09-30
- **Decider:** Aldemir (founder). The rulings were relayed in chat by the coordinating session.
- **Keywords:** PATCH /procurement/orders/:id, updateOrder, status_through_its_act, order_price_changed, price edit, approval limit, re-check, APPROVAL_NEEDED, assertCanManageRestaurant, alerts/low-stock, alerts/daily-summary, relay, Plivo, shared mailbox, pending price change, procurement_order_price_changes, approve_price_change, confirm-deal gate, autonomy accept, effective total, dedup merge
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
- **D3. A price edit on an approved order re-checks the editor's limit (founder, 2026-09-30). RULED, NOT BUILT: its design waits on four founder calls.** **[2026-09-30, later: the four calls are answered and D3 is built, as a pending price change rather than a return to APPROVAL_NEEDED — see the amendment at the end of D3.]** The approval gate runs again for the person making the edit. If the new figure is beyond their limit, the order goes back to APPROVAL_NEEDED for someone whose limit covers it.
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
  - **Until then:** a manager can still reprice an approved order within the role gate. The edit is on paper (D2) but not re-checked. **[Superseded 2026-09-30 by the amendment below: the re-check is built.]**
  - **[Amendment, 2026-09-30 — the founder's four calls, verbatim picks, and the build on `fix/order-price-recheck`.]**
    - **F1, *"Pending price change (Recommended)"*.** An order that is APPROVED, CONFIRMED or IN_TRANSIT (sealed, not yet delivered) keeps its state. When a price figure (`quoted_price`, `negotiated_price`, `final_price`, `total_cost`) moves by `PATCH orders/:id`, every approval rule re-runs for the editor against the figures as they would stand (`priceRecheck`: the same `decideApproval`, `roleSatisfies` and fail-closed reads as the approve act). If the editor's rules do not cover the change, no figure is written. The change is held as a row of `procurement_order_price_changes` (migration `a_price_change_waits_for_a_signature`): from, to, who raised it, which rules fired, and who may sign. The answer is 202 with `pendingPriceChange`; `order_price_change_waiting` is filed, and the people who may approve are told on the web bell. Notes in the same edit still apply. No stock is released, no mail is held, and the state does not change. One change waits per order; a newer proposal, or a change that applies directly, supersedes it.
    - **The sealed act.** `POST orders/:id/price-change-seal-challenge`, then `POST orders/:id/price-change/approve` with the seal (act `approve_price_change`, taken over the change's id, source, figures from and to, and whatever it replays). `GET orders/:id/price-change` reads it. Refusals: nothing waits (404); the change is stale, because a figure it touches moved or the order left the state its act lands in (409, and the change is closed as stale); the approver's rules do not cover it (403, before any seal is minted); a seal that is absent, spent, someone else's or over another change (403). The row is claimed conditionally, the change is applied by the act it came from as the approver, and a failure after the claim puts it back to waiting.
    - **F2, *"Yes, gate it (Recommended)"*.** Confirm-deal runs the same rules for the confirming person, owners and managers included. This supersedes ADR 0175's "owners and managers are not limited here" for the deal's money; the send authority still decides who may send at all. The rules are read before the seal is spent. Over them, the exact terms are held as a `confirm_deal` change: nothing is committed, nothing is mailed, and the seal is spent as proof of the hold. Approving it confirms the deal on the held terms as the approver, through the one commit `confirmDeal` uses (`commitConfirmedDeal`). Dismissing the deal closes a held one.
    - **F3, *"Yes, wait (Recommended)"*.** The autonomy's accept approves only within the house's rules. The rules are reached through `ModuleRef`, so `OrchestratorModule` gains no edge to `SettingsModule`, and a missing lookup fails closed. Otherwise the order stays in negotiation (PENDING or APPROVAL_NEEDED become NEGOTIATING). The vendor's price is recorded as the negotiated one, no agreed price reaches the line, a manager is told, and the offer waits on its deal proposal for a person's sealed, now gated, confirm-deal. **Builder's choice between the two options offered (pending change, or APPROVAL_NEEDED only if no letter has left): neither, and here is why.** The autonomy is not a person and cannot raise a proposal. A letter has always left by then, because the vendor is replying to it, so APPROVAL_NEEDED would tell its readers the vendor never saw the order. The deal proposal is already the object that waits for a signature, and confirm-deal is the sealed door that gives it.
    - **F4, *"Any price change"* (chosen over the recommended increases-only).** Every move re-runs every rule, down as well as up, `new_vendor` and `price_jump` included. It covers three more writers:
      - **The dedup merge in `POST orders`** (found by #538's audit, relayed by the coordinator). A re-quote folded into an APPROVED order is re-checked for the requester. The re-check runs after D2's role gate on the fold, so staff are refused as before and never hold a change. Over their rules the fold is held as an `order_merge` change that keeps the request. Approving it replays the request into that order and no other; if that order has closed, nothing is merged and no new order is made.
      - **The vendor's word on an APPROVED order** (`syncOrderState` wrote the vendor's price over the negotiated one with no gate). It is now written only within the rules. A decline is exempt, because it takes the order out of approval.
      - **Confirm-deal**, above.
    - **Builder's readings, each an open question for the founder (not decided by the builder, only built one way):**
      - (a) The ceiling on a re-check tests the **effective total**, `max(total_cost, unit price × quantity)`. Confirm-deal never writes `total_cost`, and a PATCH may move the unit price alone, so `total_cost` alone would leave both around the ceiling. The product is unit-naive, as confirm-deal's grant limit already is: an over-statement can only make a change wait, never let one through. The approve act still tests `total_cost` alone.
      - (b) `price_verified` is a verdict, not a figure. Flipping it alone re-runs nothing.
      - (c) The autonomy is not "within" a rule it cannot test. A person's approval passes an untestable rule; the autonomy's does not.
      - (d) "Pre-delivery" is APPROVED, CONFIRMED and IN_TRANSIT. After delivery (PARTIALLY_RECEIVED, DELIVERED, COMPLETED), a manager's price edit still applies directly, with D2's paper only.
    - **Rejected alternatives:**
      - Columns on `procurement_orders`: every spend, scorecard and seal reader would sit next to a figure nobody approved.
      - Reusing `vendor_send_requests` for a held deal: that is the send authority's "ask a manager". It refuses managers with a 409 and tells the wrong people.
      - Refusing an over-limit confirm-deal with a 403 and leaving the proposal open: the confirmer's terms would be lost.
      - Parking at APPROVAL_NEEDED: ruled out by F1, and unsafe per the adversarial findings above.
    - **Does any rule make a legitimate flow impossible (the F4 instruction)?** Not while the house has an owner: an owner satisfies every rule, so every held change can be approved. Three cases are hard but possible, and they are reported rather than softened:
      - With `new_vendor` set to owner, every price correction to a first order with that vendor, a decrease included, waits for an owner.
      - With the effective total, a stale `total_cost` above a manager's ceiling makes even a cheaper deal on that order wait for an owner.
      - A house whose rule requires an owner and which has no active owner can never approve the held change. It cannot approve such an order today either.
    - **Found and fixed on the way:** the responder's order read never selected `restaurant_id`, so its "vendor declined" notice went to restaurant `""` and reached nobody. The read now selects it (with `total_cost`, `provider_id` and `inventory_id`, which the F3 gate needs).
- **D4. The two alert relays are closed.**
  - The handlers go, along with `resolveAlertTenant` and `DailySummaryDto`.
  - `CommunicationsService.sendLowStockAlert` and `sendDailySummary` stay, for `ScheduledTasksService`, which passes each tenant's own id as the websocket room. The in-app low-stock notice therefore still fires.
  - The NonProduction `test/low-stock-alert` scaffold stays.

## Consequences

- **Easier.** An approval, a cancellation, a delivery or a placement can no longer be asserted through an edit. A price change, through the PATCH or through a fold, now names its author when the log can be written.
- **Given up.** Nobody can set an order's status by hand. If a manual "placed with the vendor" act is wanted again, it needs its own act and its own rule. Staff can no longer correct a price; a manager or an owner does.
- **Contract change.** `PATCH` with any `status` is now a 422, and a price field from staff is a 403. No client sends either. A staff `POST /procurement/orders` that would reprice, or change the quantity of, an open order past PENDING is now a 403 naming that order, where it used to rewrite it.
- **[D3 amendment, 2026-09-30] Contract change.** A price edit on an approved order that the editor's rules do not cover answers **202** with `pendingPriceChange`, and no figure moves. Confirm-deal over the confirmer's rules answers 202 with `confirmed: false`. `POST orders` answers 202 when its merge into an approved order is held. Three routes are new: `GET orders/:id/price-change`, `POST orders/:id/price-change-seal-challenge` and `POST orders/:id/price-change/approve`. **No web surface shows or approves a held change yet.** No web client sends a price PATCH or calls confirm-deal (`git grep`, 2026-09-30), so no web flow creates one. The order sheet's "see and approve" is a follow-up PR.
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

- **[D3 amendment, 2026-09-30] The build:**
  - `order-price-recheck.spec.ts`: 39 cases over the real thresholds, organizations, seal, send-authority and requests services, on an in-memory store. 29 are marked `[REVERT-FAILS]`, and all 29 fail on e9c6ffe89 (#538's head after its audit fixes). One unmarked case also fails there, only because that head's `readOrderMoneyBefore` returned the row object the store aliases.
  - `inbound-responder.service.spec.ts`: 9 new F3/F4 cases; the 6 marked `[REVERT-FAILS]` fail on e9c6ffe89 and the 3 unmarked pass there.
  - `order-patch-is-not-a-side-door.spec.ts` (#538's) now supplies an empty, readable policy: its fold into an APPROVED order re-runs the rules, which refuse when unreadable.
  - 22 of 22 mutations killed: every gate, the stale check, the seal's change id, the supersede, the un-claim, the merge and its place after the D2 role gate, the autonomy's four refusals, and the 202.
  - PGlite: the full corpus applies (282 files); a control build without the migration has no table; the table is locked down; every CHECK, the one-waiting index and both `public.users` keys bite; the file re-runs cleanly.
  - `check_gateway_boots.sh` passes (with `@simplewebauthn/server` supplied on `NODE_PATH`, since it is not installed in the worktree), and in the booted app the responder's `ModuleRef` resolves the same `ApprovalThresholdsService` singleton.
  - Claim `SEC-2026-09-30-ORDER-PRICE-RECHECK` (`claims.d/fix-order-price-recheck.jsonl`) is static. It gives 31 reasons on e9c6ffe89, and 23 of 23 tripwire mutations were caught.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-09-30 | — | Created on `fix/order-approval-and-alert-relays` |
| 2026-09-30 | Adversarial pass (separate agent), with its findings re-verified by the builder | D3's literal build is unsafe (stock, vendor mail, door, readers of APPROVAL_NEEDED), and confirm-deal and the autonomy accept bypass the gate. D3 is held for four founder calls |
| 2026-09-30 | ADR 0090 audit of #538 at e5edf9af1 (security BLOCK, correctness APPROVE) | Round 1: the dedup merge was a second staff door to an open order's money and is closed (D2). D1's caller sentence and D2's paper sentence were narrowed to the code. D3 is untouched |
| 2026-09-30 | Audit planner, at d033412f5 | The merge gate read the status at lookup and wrote by id alone, a stale-status race. The write is now conditional on the status and figures it gated on (409 when they moved), and the paper is filed before the line |
| 2026-09-30 | Aldemir (founder), relayed by the coordinating session | F1 "Pending price change (Recommended)", F2 "Yes, gate it (Recommended)", F3 "Yes, wait (Recommended)", F4 "Any price change" |
| 2026-09-30 | Claude (Opus 5.5), lane C builder, `fix/order-price-recheck` | D3 built as amended above; the POST orders merge added to F4 on the coordinator's relay of #538's audit; builder's readings (a)–(d) and F3's option filed as open questions |
