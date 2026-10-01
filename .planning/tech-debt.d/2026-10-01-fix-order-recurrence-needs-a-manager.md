## Who may set, pause, resume or end a recurrence on an order — CLOSED on `fix/order-recurrence-needs-a-manager` — 2026-10-01

This closes the OPEN entry `tech-debt.d/2026-10-01-fix-recurring-schedule-edits-need-a-manager.md:1`, filed by `fix/recurring-schedule-edits-need-a-manager` (PR #550, ADR 0246). That file is not on `main` at 98dfcb5af, so it is cited here rather than struck in place.

The founder answered its question on 2026-10-01, and [ADR 0247](../decisions/0247-pausing-resuming-ending-or-replacing-an-order-recurrence-needs-a-manager-or-owner.md) records it with the rulings below:
- *"Managers and owners only (Recommended)"*: pause, resume and end need a manager or an owner.
- *"Yes, replace needs a manager (Recommended)"*: so does a set on an order that already carries a rule, because that write resumes, restarts or moves the rule.
- *"Only on their own order (Recommended)"*: a first rule may be set by the person who placed the order, or by a manager or an owner on any order.
- `RecurrenceSheet` offers each act only to someone the gateway would allow, and shows a gateway 403 in words.

It is pinned by `apps/api-gateway/src/procurement/order-recurrence-needs-a-manager.http.spec.ts` and `apps/web/src/pages/orders/next/RecurrenceSheet.role.test.tsx`, and by the claim `claims.d/fix-order-recurrence-needs-a-manager.jsonl:1`.

## A first recurrence may go on any approved order in the house, not only the caller's own — ~~OPEN~~ CLOSED on `fix/order-recurrence-needs-a-manager` — 2026-10-01

Filed by `fix/order-recurrence-needs-a-manager` (ADR 0247), and closed on the same branch.

**What it was.** `POST /procurement/orders/:id/recurrence` on an order with no rule was open to every member. It was scoped to the caller's house from the token (`order-recurrence.controller.ts:46-48` at c4fe6a68b), and it did not look at who placed the order.

**The ruling.** On 2026-10-01 the founder answered *"Only on their own order (Recommended)"*. The option read: *"Staff can set a first rule only on an order they placed; any order can take one from a manager or owner. It matches the wording of your ruling. A small follow-up PR adds the creator check."*

**How it is closed.** The check was built on this branch, in the same route, not in a follow-up PR.
- A first rule on an order whose `procurement_orders.created_by` is not the caller now needs a manager or an owner. That includes an order with no recorded creator. Anyone else gets 403, and nothing is written.
- The orders wire now carries `createdBy`.
- `RecurrenceSheet` shows the first-rule form to staff only on an order recorded as theirs.

ADR 0247's Decision section names the lines.

## Replacing an ended order recurrence restarts it — ~~OPEN~~ CLOSED on `fix/order-recurrence-needs-a-manager` — 2026-10-01

Filed by `fix/order-recurrence-needs-a-manager` (ADR 0247), and closed on the same branch.

**What it was.** `moveRecurrenceTo` refuses to move an ended rule (`order-recurrence.service.ts:332` at c4fe6a68b). `setRecurrence` writes `recurrence_status: "active"` over an ended rule, so a replace restarts it.

**The ruling.** On 2026-10-01 the founder answered *"Yes, managers may restart (Recommended)"*. The option read: *"Keep it. An ended rule can be restarted by a manager or owner replacing it. That is a deliberate managerial act, and staff can't do it. The 'move' path stays as it is."*

**How it is closed.** There is no code change. A replace already needs a manager or an owner under ADR 0247, so only they can restart an ended rule, and `moveRecurrenceTo` keeps refusing one.
