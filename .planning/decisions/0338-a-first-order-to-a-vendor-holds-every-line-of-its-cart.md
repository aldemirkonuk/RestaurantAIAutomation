# 0338 — A first order to a vendor holds every order in its cart, and each order is approved on its own

- **Status:** Locked
- **Date:** 2026-10-11
- **Decider:** coordinator under founder delegation 2026-10-11 (industry standard)
- **Keywords:** F-731, F-732, new_vendor, first order to a vendor, isFirstOrderToVendorAmong, firstOrderToVendorById, approval gate, cart, purchase order, per-PO approval
- **Links:** [ADR 0116](0116-a-threshold-stops-an-order-and-a-default-is-not-an-answer.md) (the approval gate); [ADR 0325](0325-a-vendors-yes-approves-only-inside-the-houses-rules.md) (a vendor's yes approves only inside the house's rules); `apps/api-gateway/src/settings/approval-thresholds.ts:185-225` and `:402-414` (the rule and its test); `apps/web/src/pages/orders/next/NewOrderSheet.tsx` (one order per cart line); sim ledger F-731, `fix/sim-approval-gate` 7cffbece0, S195

## Context

The house's `new_vendor` approval rule holds the first order it places with a vendor, because there is no price history to judge it against (`approval-thresholds.ts:402-414`).

`/orders` places one order per cart line. A cart of five wines from a vendor the house has never used becomes five orders. Since `fix/sim-approval-gate`, the rule is "earliest only" (`isFirstOrderToVendorAmong`, `firstOrderToVendorById`): only the first of the five is held, and the other four pass as if the vendor were known.

The lane left the cart-wide hold as a fork.

### The delegation (verbatim)

The founder, 2026-10-11: *"If your decision is high industry standard, just do it. Do not ask me. If there is architecture decision to be made, then ask me in simple list form ever."* (in full in [ADR 0335](0335-a-house-brings-its-vendors-and-opening-stock-in-from-a-spreadsheet.md))

## Options considered

1. **Earliest order only (as built).** One hold. But four orders to an untried vendor skip the check the house asked for.
2. **Merge the cart into one order per vendor.** One approval per vendor. But it changes how orders are stored and numbered, which is an architecture change (to be asked, not taken here).
3. **Every order placed with a vendor before any order to that vendor has been approved is a first order, so the whole cart is held. Each order is still approved on its own.** Procurement systems apply the new-supplier check to every PO raised before the supplier's first PO is approved, and approval is per PO. **Chosen.**

## Decision

**An order is a first order to its vendor while the house has no approved (or later) order with that vendor. So every order in a cart to a new vendor is held by `new_vendor`, and each one is approved, or refused, on its own.**

1. **The test is "no earlier order with this vendor has been approved"**, not "no earlier order exists". An order that was never placed (`countsAsPlacedWithVendor` false) still does not count. A refused or cancelled first order does not make the vendor known.
2. **Approval stays per order.** Approving one order does not approve its siblings. Once one is approved, an order placed afterwards to that vendor is no longer a first order. Siblings already held stay held until a person decides them.
3. **The same test everywhere:** the gate, `/orders` and the order register read one shared function, as `fix/sim-approval-gate` made them.
4. **An agent never clears it** (ADR 0325). A vendor's yes on a held first order leaves it held for a person.

## Consequences

- A cart to an untried vendor is checked as a whole, which is what the house's rule promised.
- A large first cart means several approvals. The approval list should group held orders by vendor so they can be read together. That is page work, not a new rule.
- Merging a cart into one order per vendor is not decided here. If it is wanted, it goes to the founder as an architecture question.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-10-11 | — | Created under the founder's delegation (sim S195) |
