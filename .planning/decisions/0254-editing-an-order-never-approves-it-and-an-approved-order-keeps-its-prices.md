# 0254 — Editing an order never approves it, and an approved order keeps its prices

- **Status:** Locked 2026-10-01 — four answers from the founder, verbatim below. Rules 1–3 are built on `fix/order-patch-cannot-approve`. Rule 4 is not built yet; it is the next fix.
- **Date:** 2026-10-01
- **Decider:** Aldemir (founder), `AskUserQuestion` 2026-10-01, after he asked for the fix in the same session (*"Fix the approval hole"*).
- **Keywords:** procurement order, PATCH orders/:id, approve, APPROVED, APPROVAL_NEEDED, final_price, total_cost, price freeze, create-order merge, dedup, seal, order transitions
- **Links:** [[0175-one-tap-from-the-notification-is-staged]] (D7: approving an order needs authority, unbuilt; D10: who issues money rights); [[0253-a-job-and-the-right-to-do-it-are-given-in-one-step-and-staff-get-a-jobs-first-screen]] ("Place orders" closes only after these holes are fixed); defect entry `.planning/tech-debt.d/2026-10-01-fix-order-patch-cannot-approve.md`.

## Context

Read on `origin/main` `4bd11a00e`, 2026-10-01:

- `PATCH procurement/orders/:id` has no `@Roles` and passes no user (`procurement.controller.ts:251-263`). `updateOrder` refused only a cancel with no reason (`procurement.service.ts:3302`). PENDING, APPROVAL_NEEDED and NEGOTIATING may legally move to APPROVED (`order-transitions.ts:103-126`). So any member of a house could approve an order, and set its prices, without the seal or the house's approval rules.
- The create-order merge looked for an earlier order of the same wine and vendor, excluding seven closed states (`procurement.service.ts:1078-1109`). An APPROVED, APPROVAL_NEEDED or PARTIALLY_RECEIVED order matched, and the new request overwrote its quantity and prices (`:1123` onward).
- The same PATCH can still move an approved order on, to CONFIRMED, IN_TRANSIT, DELIVERED, PARTIALLY_RECEIVED, REJECTED, FAILED or back to NEGOTIATING, with no seal (`order-transitions.ts:130-139`). Not to CANCELLED: `updateOrder` refuses that unless `cancelOrder` passes a reason code, and the PATCH route passes none. A move to DELIVERED this way records no stock.

## Options considered

Each question offered three answers; the founder took the first each time.

- **Which orders stop taking price edits:** approved and onward, plus closed ones (cancelled, rejected, failed) even if never approved, all four prices / approved and onward only / only the final price and total.
- **An order waiting for approval:** keep its price editable, since the approver approves the new total and the rules are re-checked / owners and managers only / frozen too.
- **A new request beside an approved order for the same wine and vendor:** start a second order / refuse and point to the first / add to the approved one and send it back for approval.
- **Moving an approved order on:** an owner, a manager or someone given the right, with "delivered" only from receiving / anyone, with "delivered" only from receiving / leave it filed.

## Decision

1. **Editing an order never approves it.** A PATCH that moves an order to APPROVED is refused, for everyone, with nothing changed. Approval goes only through the sealed approve act, which checks the house's rules. *"Fix the approval hole."*
2. **An approved order keeps its prices.** The quoted, negotiated, final and total prices can be edited only while an order is PENDING, APPROVAL_NEEDED or NEGOTIATING, judged by the order's state before the edit. A closed order (cancelled, rejected, failed) is frozen too. The write repeats the check, so an order approved mid-edit is not repriced. *"Approved, plus closed (Recommended)"*. An order waiting for approval stays editable: *"Keep it open (Recommended)"*. Who may approve when no rule fires stays ADR 0175 D7.
3. **A new request never overwrites an approved order.** It folds only into a PENDING or NEGOTIATING order of the same wine and vendor; otherwise it starts a second order, which goes through approval itself. The header write repeats that condition, and the order line, written after it, is rewritten only if the order is still in those states just before. *"Start a second order (Recommended)"*.
4. **Moving an approved order on needs an owner, a manager or someone given the right, and "delivered" comes only from receiving at the door**, which records the stock. *"Owner, manager or given (Recommended)"*. Not built here; it is the next fix, with its own spec.

## Consequences

- ADR 0253's "Place orders" can close once rule 4 is built too; until then, giving "Place orders" still hands out the right to move an approved order on.
- A second order for the same wine and vendor can now sit beside an approved one. The approver may not see that it is a second one; nothing here adds a warning.
- Rules 1–3 sit in the service, not on the route, so the route-access census does not show them; the spec `order-patch-cannot-approve.spec.ts` does.
- Rule 3 is not atomic. The header and the line are separate statements, and PostgREST cannot make the line's DELETE and INSERT conditional on the order's status, so an approval landing between the line check and the line write still lands; when the check refuses, the approved header carries the merged request and the line does not. One transaction (a database function) would close both. Recorded in the defect entry.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-10-01 | Claude (Opus 5.5, builder; branch `fix/order-patch-cannot-approve`) | Rules 1–3 built; new spec 31/31, procurement suites 1919 pass [corrected in fix round 1: that 1919 is `npx jest src/procurement src/providers/retroactive-order.spec.ts`, 96 suites; and the spec was 25 of 31 red against 4bd11a00e, not the commit message's 22]; seven mutations each turned the spec red |
| 2026-10-01 | Aldemir (founder, `AskUserQuestion`) + Claude (Opus 5.5) | Four questions answered as recommended; recorded here |
| 2026-10-01 | Claude (Opus 5.5, builder, fix round 1 after a Sonnet audit) | Three test gaps pinned (approve refused before any read, a zero price refused, an unknown stored state fails closed); the merge's line write guarded by the order's state (rule 3's last sentence). New spec 37/37, 30 of 37 red against 4bd11a00e; `npx jest src/procurement` 1912 passed, 3 skipped; thirteen mutations each turned the spec red and were restored byte-identical |
