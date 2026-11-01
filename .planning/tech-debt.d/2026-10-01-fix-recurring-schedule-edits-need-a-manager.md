## Who may set, pause, resume or end a recurrence on an order — OPEN — 2026-10-01

Filed by `fix/recurring-schedule-edits-need-a-manager` ([ADR 0246](../decisions/0246-editing-or-deactivating-a-recurring-schedule-needs-a-manager-or-owner.md)). Line numbers are at `origin/main` b9932e256.

**What.** Recurrence on an order (ADR 0125's addendum) has four routes in `apps/api-gateway/src/procurement/order-recurrence.controller.ts`:

- `POST /procurement/orders/:id/recurrence` (`:30`)
- `.../pause` (`:58`)
- `.../resume` (`:75`)
- `.../end` (`:92`)

They carry the class-level `JwtAuthGuard` and no role check. A search of the controller and of `order-recurrence.service.ts` for `@Roles`, `assertCanManageRestaurant`, `resolveRestaurantRole` and `ForbiddenException` found none. So any member of the house may pause, resume or end a rule that a manager set.

**Why it is not closed by ADR 0246.**
- The founder's ruling of 2026-10-01 names PUT and DELETE on recurring schedules, the `recurring_orders` rows.
- This is a different construct, a rule stored on the order.
- The path ADR 0246 closes does not arise here:
  - the generator raises each child as the person who last moved the rule (`recurrence_status_by`, `order-recurrence.service.ts:647-656`);
  - the child skips the merge (`procurement.service.ts:1111`).
- The web page `apps/web/src/pages/orders/next/RecurrenceSheet.tsx` calls pause, resume and end (`:295`, `:306`, `:317`).
- A search of that file found no role gate.

**Open question for the founder.** Do these four routes follow ADR 0246's rule? That would mean create for everyone, while changing an existing rule, pause, resume and end need a manager or an owner. Or do they stay open to every member?

[Corrected 2026-10-01: the founder has ruled. For order recurrence's pause, resume and end, his answer, verbatim, was *"Managers and owners only (Recommended)"*. PR #558 (ADR 0247, `fix/order-recurrence-needs-a-manager`) builds it. That PR is open, so this entry stays OPEN until it merges: the ruling is in flight, not closed.]

No claim is filed. The question is a decision not yet taken, not a defect with a fixed shape. [Corrected 2026-10-01: the decision is now taken (above). This entry still files no claim.]
