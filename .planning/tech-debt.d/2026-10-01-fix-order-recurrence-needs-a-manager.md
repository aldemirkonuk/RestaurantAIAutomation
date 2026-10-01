## Who may set, pause, resume or end a recurrence on an order — CLOSED on `fix/order-recurrence-needs-a-manager` — 2026-10-01

Closes the OPEN entry `tech-debt.d/2026-10-01-fix-recurring-schedule-edits-need-a-manager.md:1`, filed by `fix/recurring-schedule-edits-need-a-manager` (PR #550, ADR 0246). That file is not on `main` at c4fe6a68b, so it is cited here rather than struck in place.

The founder answered its question on 2026-10-01: *"Managers and owners only (Recommended)"*. [ADR 0247](../decisions/0247-pausing-resuming-ending-or-replacing-an-order-recurrence-needs-a-manager-or-owner.md) records it.
- Pause, resume and end need a manager or an owner.
- So does a set on an order that already carries a rule, because that write resumes, restarts or moves the rule.
- A first rule stays open to every member of the house.
- `RecurrenceSheet` offers pause, resume, end and replace only to an owner or a manager, and shows a gateway 403 in words.

Pinned by `apps/api-gateway/src/procurement/order-recurrence-needs-a-manager.http.spec.ts` and `apps/web/src/pages/orders/next/RecurrenceSheet.role.test.tsx`; claim `claims.d/fix-order-recurrence-needs-a-manager.jsonl:1`.

## A first recurrence may go on any approved order in the house, not only the caller's own — OPEN — 2026-10-01

Filed by `fix/order-recurrence-needs-a-manager` (ADR 0247).

**What.** `POST /procurement/orders/:id/recurrence` on an order with no rule is open to every member. It is scoped to the caller's house from the token (`order-recurrence.controller.ts:52-54` on this branch). It does not look at who placed the order. So staff may set a first rule on an order a manager placed.

**Why it is open.** The founder's option text says staff "could still set one up on their own order". Whether "own" limits where staff may set a first rule was not asked. Every child the rule mints is born PENDING and is approved on its own, and from then on only a manager or an owner may pause, resume, end or replace the rule.

**Question for the founder.** Should a first rule from staff be limited to orders they placed (`procurement_orders.created_by`), or stay open across the house?

## Replacing an ended order recurrence restarts it — OPEN — 2026-10-01

Filed by `fix/order-recurrence-needs-a-manager` (ADR 0247).

**What.** `moveRecurrenceTo` refuses to move an ended rule, saying an ended series is not restarted (`order-recurrence.service.ts:332` at c4fe6a68b). `setRecurrence` on the same order writes `recurrence_status: "active"` over the ended rule, so a manager or an owner can restart it by replacing it. Before ADR 0247 any member could. The web sheet shows "Replace the rule" on an ended rule to an owner or a manager.

**Why it is open.** ADR 0247 decides who may change a rule, not whether an ended rule may be restarted. That is a separate question.
