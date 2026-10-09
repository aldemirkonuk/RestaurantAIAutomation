# 0325 — A vendor's yes approves only inside the house's rules, and an order puts its bottles on order once

- **Status:** Proposed. The ruling below is the coordinator's call, made under the founder's 2026-10-07T20:04:10Z delegation, quoted below. It is not the founder's pick, and he can overrule any part of it. Locking it is his decision.
- **Date:** 2026-10-09
- **Decider:** the coordinator, under the delegation below. Built by the sim fix lane order-reservation on `fix/sim-order-reservation`.
- **Keywords:** F-491, F-492, F-494, syncOrderState, autonomy, approveAcceptedOrderAsAgent, decideApproval, approved_by, INBOUND_RESPONDER_AGENT_ID, reserved_bottles, shadow stock, in_transit_quantity, reserveOrderOnce, takeOrderReservation
- **Links:** [ADR 0116](0116-a-threshold-stops-an-order-and-a-default-is-not-an-answer.md) (the approval gate); [ADR 0125](0125-an-order-changes-state-through-a-sealed-transition.md) Q3 (a decline returns the order to NEGOTIATING); [ADR 0054](0054-order-capture-and-unit-arithmetic.md) (unit arithmetic); migration `an_order_remembers_what_it_put_on_order`; sim reports `p4-scratch/sim-run/bulletproof/wave13sim/orders-lifecycle-edges.md` findings 1, 2 and 4 (outside the repo); F-386 (confirm-deal skips the rules; not this change)

## Context

These cites are to `origin/main` at `31152ab34`.

**F-492.** With autonomous sending on, `InboundResponderService.syncOrderState` wrote `status = APPROVED` whenever a vendor accepted our terms or quoted at or under target (`inbound-responder.service.ts:1285-1288`). It did this from PENDING, from NEGOTIATING, and from APPROVAL_NEEDED, which means an order the gate had already held for an owner. It read no threshold, wrote no `approved_by`, and put nothing on order (`:1351-1354`). The owner sees the autonomy switch as "an AI-written email reaches a vendor". Nothing told them it also approves money past their ceiling.

**F-491.** `approveOrder` reserved shadow stock and in-transit on every call (`procurement.service.ts:4170-4176`). `cancelOrder` released only when the status it left was APPROVED, CONFIRMED or IN_TRANSIT (`:3833-3847`). That created two bugs:
- A vendor's decline moves an order to NEGOTIATING. If the house then rejected it, nothing was released, and the bottles stayed "on order" for good.
- If the house approved it again instead, the bottles were reserved a second time.

**F-494.** Reserve and cancel used `order.quantity`, which is counted in the order's own unit. Two cases therefore reserved 2. Delivery released the received bottle count instead (`:5363`, `:5399`). An order in cases drained up to 22 bottles that other orders had reserved.

### The delegation (verbatim)

The founder, 2026-10-07T20:04:10Z: *"Do not ask me questions, I allow and approve for you to decide on your own. If its a decision question then research deep, find answers. While you can change decisions, you cannot change any feature we decided unless it breaks everything then only you can, but before that you should research."*

## Ruling (F-492)

1. **An AI vendor reply may never approve past the owner's rules.** When a vendor accepts under full autonomy, `syncOrderState` still writes the agreed price. The status is decided by `ProcurementService.approveAcceptedOrderAsAgent`, which runs the same `orderUnderTest` and `decideApproval` that `approveOrder` answers to.
2. The agent holds no role, so any rule that fires keeps the order for a person. So does a rule that cannot be tested, a price premium that cannot be read, or a policy that cannot be read. In each case the order is parked in APPROVAL_NEEDED, with a compare-and-set on the status it had. An order that is already APPROVAL_NEEDED stays there. In every case the owner gets a notification in plain words: "Vendor agreed — waiting for your approval".
3. If no rule fires, the order is approved with a compare-and-set on its status. `approved_by` is set to `INBOUND_RESPONDER_AGENT_ID` (`00000000-0000-4000-8000-0000000a6e17`), a fixed id that belongs to no person. Its bottles go on order through `reserveOrderOnce`, the same path the approve button uses.
4. When the approval door is not wired, the agent approves nothing and the owner is told.

## Ruling (F-491, F-494; the lane note's)

5. `procurement_orders.reserved_bottles` records what an order put on order. NULL means it never reserved. N means N bottles are held. 0 means they were released, or nothing could be reserved.
   - Reserve claims the record with a compare-and-set from NULL, so an order reserves once, however many times it is approved.
   - Cancel releases from the record whatever status the order is in. Delivery does the same. Each release is a compare-and-set to 0, so it happens once.
   - A release that does not happen gives the record back (compare-and-set from 0 to N). That covers a refused delivery booking, a failed delivery shadow release, and a failed cancel release. A retry then releases it, and a cancel after a refused delivery does not release twice. Delivery books the live stock first and releases shadow only after that booking succeeds. Pinned in `order-reservation.spec.ts`.
6. The record counts bottles. A case, pack or split case needs its pack size: the order line's `bottles_per_unit`, or else `bottles_total / quantity` when that divides exactly. Without a pack size, nothing is reserved, 0 is recorded, and the log says so.
7. The migration backfills orders that hold a reservation under the old rule. It sets `quantity` for APPROVED, CONFIRMED and IN_TRANSIT orders, and for NEGOTIATING orders with `approved_at` set. Each such order then releases exactly what it reserved.

## Rejected

- **Leave autonomy approving and add a ceiling check only.** Rejected because an order already held for the owner (APPROVAL_NEEDED) would still be approved by a vendor's yes. The hold has to win.
- **Inject `ProcurementService` into `InboundResponderService`.** Rejected because `ProcurementModule` imports `OrchestratorModule`, and Nest resolves the reverse import as `undefined`. Instead, `ProcurementService` hands itself over at construction through `useOrderApprover`.
- **Leave `approved_by` NULL for an agent approval.** Rejected because NULL reads as "unknown". Both the record and the lane note ask for the agent to be named.
- **Release from status plus NEGOTIATING.** Rejected because it still double-reserves on re-approval, and it still releases for orders that never reserved, such as confirm-deal and PATCH approvals.
- **Mark reservations in `inventory_events` by idempotency key, with no column.** Rejected because release would have to search the ledger for its own amount, and a released order could not be told apart from one that was never reserved.

## Not decided here

- The door path (`receiving.service.ts`, booked by the door) and `nameDeliveredItem` (`delivery-item-to-name.ts:503`) still release shadow without reading the record. R3 owns `/receiving`.
- Confirm-deal (`approveDraft`) approves without the rules and without reserving. That is F-386.
- Agent approvals do not write an `order_approval` audit row. The notification and the logs are the only trace.
