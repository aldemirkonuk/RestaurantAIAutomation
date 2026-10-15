# 0254 — Editing an order never approves it, and an approved order keeps its prices

- **Status:** Locked 2026-10-01 — five answers from the founder, verbatim below (four before the build, a fifth after the round-1 re-verify). Rules 1–3 are built on `fix/order-patch-cannot-approve`. Rule 4 is not built yet; it is the next fix.
- **Date:** 2026-10-01
- **Decider:** Aldemir (founder), `AskUserQuestion` 2026-10-01, after he asked for the fix in the same session (*"Fix the approval hole"*).
- **Keywords:** procurement order, PATCH orders/:id, approve, APPROVED, APPROVAL_NEEDED, final_price, total_cost, price freeze, create-order merge, dedup, seal, order transitions
- **Links:** [[0175-one-tap-from-the-notification-is-staged]] (D7: approving an order needs authority, unbuilt; D10: who issues money rights); [[0253-a-job-and-the-right-to-do-it-are-given-in-one-step-and-staff-get-a-jobs-first-screen]] ("Place orders" closes only after these holes are fixed; 0253 is carried by PR #566, `docs/houses-decisions-0251-0253`, open on 2026-10-01, so this link resolves on `main` only once #566 merges); defect entry `.planning/tech-debt.d/2026-10-01-fix-order-patch-cannot-approve.md`.

## Context

Read on `origin/main` `4bd11a00e`, 2026-10-01:

- `PATCH procurement/orders/:id` has no `@Roles` and passes no user (`procurement.controller.ts:251-263`). `updateOrder` refused only a cancel with no reason (`procurement.service.ts:3302`). PENDING, APPROVAL_NEEDED and NEGOTIATING may legally move to APPROVED (`order-transitions.ts:103-126`). So any member of a house could approve an order, and set its prices, without the seal or the house's approval rules.
- The create-order merge looked for an earlier order of the same wine and vendor, excluding seven closed states (`procurement.service.ts:1078-1109`). An APPROVED, APPROVAL_NEEDED or PARTIALLY_RECEIVED order matched, and the new request overwrote its quantity and prices (`:1123` onward).
- The same PATCH can still move an approved order on, to CONFIRMED, IN_TRANSIT, DELIVERED, PARTIALLY_RECEIVED, REJECTED, FAILED or back to NEGOTIATING, with no seal (`order-transitions.ts:130-139`). Not to CANCELLED: `updateOrder` refuses that unless `cancelOrder` passes a reason code, and the PATCH route passes none. A move to DELIVERED this way records no stock.

## Options considered

The first four questions each offered three answers; the founder took the first each time.

- **Which orders stop taking price edits:** approved and onward, plus closed ones (cancelled, rejected, failed) even if never approved, all four prices / approved and onward only / only the final price and total.
- **An order waiting for approval:** keep its price editable, since the approver approves the new total and the rules are re-checked / owners and managers only / frozen too.
- **A new request beside an approved order for the same wine and vendor:** start a second order / refuse and point to the first / add to the approved one and send it back for approval.
- **Moving an approved order on:** an owner, a manager or someone given the right, with "delivered" only from receiving / anyone, with "delivered" only from receiving / leave it filed.
- **A new request beside an order still waiting for approval (APPROVAL_NEEDED), same wine and vendor** — asked separately on 2026-10-01, after the build, because the third question covered only an approved order and the build had also stopped folding into waiting and half-received orders. The founder answered *"Second order, as built (Recommended)"*; the other answers offered were not relayed into this record. The question stated as settled that an order already being received (PARTIALLY_RECEIVED) never takes a new request.

## Decision

1. **Editing an order never approves it.** A PATCH that moves an order to APPROVED is refused, for everyone, with nothing changed. Approval goes only through the sealed approve act, which checks the house's rules. *"Fix the approval hole."*
2. **An approved order keeps its prices while it stays approved.** The quoted, negotiated, final and total prices can be edited only while an order is PENDING, APPROVAL_NEEDED or NEGOTIATING, judged by the order's state before the edit. A closed order (cancelled, rejected, failed) is frozen too. The write repeats the check, so an order approved mid-edit is not repriced. *"Approved, plus closed (Recommended)"*. An order waiting for approval stays editable: *"Keep it open (Recommended)"*. Who may approve when no rule fires stays ADR 0175 D7. **Until rule 4 is built, an approved order can be stepped back to negotiating and then repriced in two edits:** `PATCH {status: "NEGOTIATING"}` is a legal edge from APPROVED (`order-transitions.ts:130-139`) and NEGOTIATING is price-open, so a second PATCH sets the price. The order must then be approved again through the sealed act, so this un-approves and reprices; it does not approve. Rule 2 is enforced on `PATCH orders/:id` only; the vendor-reply responder still writes an approved order's negotiated price (pre-existing, OPEN in the defect entry).
3. **A new request never overwrites an approved order, one waiting for approval, or one being received.** It folds only into a PENDING or NEGOTIATING order of the same wine and vendor; otherwise it starts a second order, which goes through approval itself. The header write repeats that condition, and the order line, written after it, is rewritten only if the order is still in those states just before. Beside an approved order: *"Start a second order (Recommended)"*. Beside an order waiting for approval (APPROVAL_NEEDED), asked separately after the build: *"Second order, as built (Recommended)"*. An order already being received (PARTIALLY_RECEIVED) never takes a new request, which that second question stated as settled. Neither extension comes from the third question's answer.
4. **Moving an approved order on needs an owner, a manager or someone given the right, and "delivered" comes only from receiving at the door**, which records the stock. *"Owner, manager or given (Recommended)"*. Not built here; it is the next fix, with its own spec.

## Consequences

- ADR 0253's "Place orders" can close once rule 4 is built too; until then, giving "Place orders" still hands out the right to move an approved order on.
- Until rule 4 is built, rule 2 holds for one edit, not two: any member can step an approved order back to NEGOTIATING and reprice it in a second PATCH. It then needs approval again through the sealed act. Rule 4 closes it by putting the move off APPROVED behind an owner, a manager or someone given the right.
- A second order for the same wine and vendor can now sit beside an approved one. The approver may not see that it is a second one; nothing here adds a warning.
- Rules 1–3 sit in the service, not on the route, so the route-access census does not show them; the spec `order-patch-cannot-approve.spec.ts` does.
- Rule 3 is not atomic. The header and the line are separate statements, and PostgREST cannot make the line's DELETE and INSERT conditional on the order's status, so an approval landing between the line check and the line write still lands; when the check refuses, the approved header carries the merged request and the line does not. One transaction (a database function) would close both. Recorded in the defect entry.
- A re-quote at a new price into a PENDING or NEGOTIATING order that already has a line fails at the price-echo trigger (23514), because the merge writes the header's `final_price` before the line. This is **pre-existing**: the round-1 re-verify ran the triggers of `20260905072000_the_header_price_echoes_the_line.sql` in PGlite and a base-shaped UPDATE (as at `4bd11a00e`) fails identically. This branch only narrows which orders reach it, from every state outside the old seven-state denylist to PENDING and NEGOTIATING. OPEN in the defect entry; the builder did not re-run the PGlite check.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-10-01 | Claude (Opus 5.5, builder; branch `fix/order-patch-cannot-approve`) | Rules 1–3 built; new spec 31/31, procurement suites 1919 pass [corrected in fix round 1: that 1919 is `npx jest src/procurement src/providers/retroactive-order.spec.ts`, 96 suites; and the spec was 25 of 31 red against 4bd11a00e, not the commit message's 22]; seven mutations each turned the spec red |
| 2026-10-01 | Aldemir (founder, `AskUserQuestion`) + Claude (Opus 5.5) | Four questions answered as recommended; recorded here |
| 2026-10-01 | Claude (Opus 5.5, builder, fix round 1 after a Sonnet audit) | Three test gaps pinned (approve refused before any read, a zero price refused, an unknown stored state fails closed); the merge's line write guarded by the order's state (rule 3's last sentence). New spec 37/37, 30 of 37 red against 4bd11a00e; `npx jest src/procurement` 1912 passed, 3 skipped; thirteen mutations each turned the spec red and were restored byte-identical |
| 2026-10-01 | Aldemir (founder, `AskUserQuestion`) | Fifth question answered: a new request beside an order waiting for approval starts a second order, *"Second order, as built (Recommended)"*; recorded in rule 3 |
| 2026-10-01 | Claude (Opus 5.5, builder, fix round 2 after a Sonnet re-verify of `425561b93`, records only) | Rule 2 qualified (two edits still reprice an approved order until rule 4); rule 3 attributes its APPROVAL_NEEDED and PARTIALLY_RECEIVED reach to the fifth question; the responder's negotiated-price write filed OPEN; the re-quote 23514 failure marked pre-existing; the 0253 link noted as unresolved until #566 merges |
