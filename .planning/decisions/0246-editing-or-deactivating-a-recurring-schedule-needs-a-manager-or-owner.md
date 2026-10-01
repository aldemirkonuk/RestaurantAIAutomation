# 0246 — Editing or deactivating a recurring-order schedule needs a manager or an owner

- **Status:** Locked 2026-10-01.
- **Date:** 2026-10-01
- **Decider:** Aldemir (founder). He was asked "who may edit or delete a recurring-order schedule?". His answer, verbatim, 2026-10-01: *"Managers and owners only (Recommended)"*. The option he picked read: *"PUT and DELETE on recurring schedules need manager or owner, the same rule as the order-money checks. Staff can still create a schedule; theirs is refused at the merge anyway. This is the simplest rule and matches how order money is guarded elsewhere."* The lane coordinator relayed both to the fix lane.
- **Keywords:** recurring orders, recurring_orders, schedule, PUT, DELETE, staff, manager, owner, assertCanManageRestaurant, created_by, 08:00 cron, executeRecurringOrder, auto_approve, order recurrence
- **Links:** Audit of PR #538 at 46c74b08f (finding 1); [[0243-a-house-is-named-by-one-string-and-cross-house-runs-are-operators-only]] (`execute-check`); [[0125-an-order-changes-state-through-a-sealed-transition]] (its addendum is recurrence on the order); claim `claims.d/fix-recurring-schedule-edits-need-a-manager.jsonl:1`; spec `apps/api-gateway/src/procurement/recurring-schedule-edits-need-a-manager.http.spec.ts`.

## Context

All line numbers are at `origin/main` b9932e256. `apps/api-gateway/src/procurement/` and `src/organizations/` are unchanged from e88593bf8.

**The two routes had no role check.** `PUT /recurring-orders/:restaurantId/:id` and `DELETE /recurring-orders/:restaurantId/:id` carried only the class-level `JwtAuthGuard` (`recurring-orders.controller.ts:39`). Neither route had a role check, and neither recorded an actor.
- `updateRecurringOrder` writes any of the fields in `UPDATABLE` (`recurring-orders.service.ts:525-538`): `inventory_id`, `provider_id`, `quantity`, `unit_type`, `bottles_per_unit`, `target_price`, `frequency`, `frequency_day`, `auto_approve`, `next_order_date`, `active` and `notes`.
- `created_by` is not among them.

**The 08:00 cron raises the order as the schedule's creator.** The cron (`@Cron("0 8 * * *")`, `:640`) raises each due schedule's order through `createOrder` with the actor `recurringOrder.created_by || "system"` (`:849`, `:861`). When `auto_approve` is set, it then calls `approveOrder` as the same actor (`:887-891`).

**What the Audit of PR #538 at 46c74b08f reproduced** (finding 1), with the real controller and service:
- A staff member's PUT on a schedule a manager created answered 200.
- The cron then rewrote an APPROVED order from quantity 6, price 300, total 1800 to quantity 60, price 1, total 60.
- The merge's role check was asked about the manager, and the audit row named the manager.
- Control: on a schedule staff created, the same edit was refused at the merge (403 `merge_would_change_price`).

**Callers.** `apps/web/src/pages/RecurringOrders.tsx` calls PUT and DELETE, but a search of `apps/web/src` found no route or import that mounts that page. A search of `apps/mobile` found no caller.

## Options considered

1. **Managers and owners only, on PUT and DELETE.** **Taken; the founder's pick.** It is the same rule and the same helper as the order-money checks, and staff can still create a schedule.
2. **Staff may edit only the schedules they created.** Rejected by the founder's pick. It is a second rule beside the order-money one, which does not look at who created an order.
3. **The job runs as the last editor.** Rejected by the founder's pick.
   - It would need a record of the last editor, which `recurring_orders` does not have.
   - It changes whose name the cron raises the order under, not who may make the change.
4. **Read the role strictly, so that an unreadable role answers 503 instead of 403.** Not taken.
   - The order-money checks use `assertCanManageRestaurant`, which reads a failed lookup as no role (`organizations.service.ts:254-261`, `strict: false`).
   - Using the same helper keeps one rule. The cost is that an outage is reported as 403, not 503. It still writes nothing.
5. **Do nothing.** A staff edit to a manager's schedule would still be raised under the manager's name at 08:00.

## Decision

**PUT and DELETE now need a manager or an owner.** `PUT` and `DELETE /recurring-orders/:restaurantId/:id` call `OrganizationsService.assertCanManageRestaurant(user.userId, restaurantId, action)` before the service is called, so before anything is read or written.
- That is the helper that order cancel (`assertMayCancelOrder`, `procurement.service.ts:3441-3445`) and the settings registers use.
- A caller whose role at the house is not owner or manager gets 403: "Only managers and owners can edit a recurring order schedule", or "… deactivate a recurring order schedule".
- A caller whose role cannot be read gets the same 403. Nothing is written in either case.

**Each recurring-schedule mutation route, as decided under the founder's rule:**
- **`PUT /recurring-orders/:restaurantId/:id`:** managers and owners only. It is the only HTTP route that changes `active`, `next_order_date` or `auto_approve` on a schedule. `recurring_orders` has no separate pause, resume, toggle or next-date route.
- **`DELETE /recurring-orders/:restaurantId/:id`:** managers and owners only. It sets `active` to false.
- **`POST /recurring-orders/:restaurantId` (create):** unchanged. Staff may create a schedule, and it is recorded as theirs (`created_by` comes from the token, `recurring-orders.service.ts:415`).
- **`GET` list and get-one:** unchanged; they are reads.
- **`POST /recurring-orders/:restaurantId/execute-check`:** unchanged (ADR 0243: non-production, platform operators).
- **The cron's own write after a run** (`next_order_date`, `last_order_date`, `execution_count`, `recurring-orders.service.ts:1050-1058`): unchanged. It is not an HTTP route.
- **Recurrence on an order** (`POST /procurement/orders/:id/recurrence`, `…/pause`, `…/resume`, `…/end`, `order-recurrence.controller.ts`): not changed by this decision.
  - It is a different construct, a rule stored on an order (ADR 0125's addendum), not a row in `recurring_orders`.
  - The ruling names PUT and DELETE on recurring schedules.
  - Its generator raises each child as the person who last moved the rule (`recurrence_status_by`, `order-recurrence.service.ts:647-656`), and the child skips the merge (`procurement.service.ts:1111`). So the path found above does not arise there.
  - These routes have no role check today. Whether staff may pause, resume or end a rule a manager set is not decided here; it is filed as OPEN in `tech-debt.d/2026-10-01-fix-recurring-schedule-edits-need-a-manager.md`.

**Retire-to-write (CLAUDE.md §4).** This file is a decision record, the one record per decision that §5 requires. It retires no document.

## Consequences

- **Easier.** A staff member can no longer change a schedule that the 08:00 cron will raise under a manager's name, because they cannot change any schedule. That includes `auto_approve`, `quantity`, `target_price` and the vendor.
- **Harder.** Staff who used to correct a schedule now ask a manager. No mounted web page calls these routes today (see Context).
- **Not closed by this decision:**
  - **The fold's line race.** PR #538's record covers the window after the header write, its cases (i) to (iii). This decision changes nothing there.
  - **The approve step's window (iv)** in PR #538's record: a fold landing between `approveOrder`'s reads and its UPDATE. Unchanged.
  - **A schedule staff edited before this change.** It still runs at its next 08:00 under its `created_by`. This change does not revert or flag earlier edits, and `recurring_orders` records no editor.
  - **Staff can still create a schedule with `auto_approve` set.** The cron then calls `approveOrder` as that staff member (`recurring-orders.service.ts:887-891`). What `approveOrder` allows a staff actor is governed elsewhere (PR #538's record), not here.
  - **Recurrence on an order** (above), filed OPEN.
- **Revisit if** staff need to correct schedules without a manager. That would be option 2 or 3, and it needs the founder's word.

## Evidence

`recurring-schedule-edits-need-a-manager.http.spec.ts` runs the real `RecurringOrdersController`, `RecurringOrdersService` and `OrganizationsService` over an in-memory store, and the real `JwtAuthGuard` with passport stubbed. It has 10 cases.
- **The five [REVERT-FAILS] cases**, each answered 200 where 403 was expected on the controller at e88593bf8:
  - staff PUT on a manager's schedule;
  - staff PUT on their own schedule;
  - staff DELETE on a manager's schedule;
  - staff DELETE on their own schedule;
  - an unreadable role (PUT and DELETE).
- **The five pins**, which pass before and after: a manager and an owner may PUT, a manager and an owner may DELETE, and staff may create.

Mutations, each restored from a `cp -p` snapshot of the fixed controller:

| Mutation | Result |
|---|---|
| Remove the PUT check | 3 of 10 fail |
| Remove the DELETE check | 3 of 10 fail |
| Run the PUT check after the update | 3 of 10 fail |
| Refuse only a caller with no role (staff passes) | 2 of 10 fail |
| Refuse only `staff` (an unreadable role passes) | 1 of 10 fails |
| Add the check to create as well | 1 of 10 fails |

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-10-01 | — | Created on `fix/recurring-schedule-edits-need-a-manager`. No independent review yet. |
