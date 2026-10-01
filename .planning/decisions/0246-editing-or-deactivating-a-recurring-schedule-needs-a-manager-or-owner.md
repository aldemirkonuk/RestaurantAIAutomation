# 0246 — Editing or deactivating a recurring-order schedule needs a manager or an owner

- **Status:** Locked 2026-10-01.
- **Date:** 2026-10-01
- **Decider:** Aldemir (founder). He was asked "who may edit or delete a recurring-order schedule?". His answer, verbatim, 2026-10-01: *"Managers and owners only (Recommended)"*. The option he picked read: *"PUT and DELETE on recurring schedules need manager or owner, the same rule as the order-money checks. Staff can still create a schedule; theirs is refused at the merge anyway. This is the simplest rule and matches how order money is guarded elsewhere."* The lane coordinator relayed both to the fix lane.
- **Keywords:** recurring orders, recurring_orders, schedule, PUT, DELETE, staff, manager, owner, assertCanManageRestaurant, created_by, 08:00 cron, executeRecurringOrder, auto_approve, order recurrence
- **Links:** Audit of PR #538 at 46c74b08f (finding 1); [[0243-a-house-is-named-by-one-string-and-cross-house-runs-are-operators-only]] (`execute-check`); [[0125-an-order-changes-state-through-a-sealed-transition]] (its addendum is recurrence on the order); claim `claims.d/fix-recurring-schedule-edits-need-a-manager.jsonl:1`; spec `apps/api-gateway/src/procurement/recurring-schedule-edits-need-a-manager.http.spec.ts`.

## Context

All line numbers are at `origin/main` b9932e256. The cited files under `apps/api-gateway/src/procurement/`, `src/organizations/` and `src/common/seal/`, and `recurring_order_agent.py`, are unchanged from e88593bf8 through 98dfcb5af.

**The two routes had no role check.** `PUT /recurring-orders/:restaurantId/:id` and `DELETE /recurring-orders/:restaurantId/:id` carried only the class-level `JwtAuthGuard` (`recurring-orders.controller.ts:39`). Neither route had a role check, and neither recorded an actor.
- `updateRecurringOrder` writes any of the fields in `UPDATABLE` (`recurring-orders.service.ts:525-538`): `inventory_id`, `provider_id`, `quantity`, `unit_type`, `bottles_per_unit`, `target_price`, `frequency`, `frequency_day`, `auto_approve`, `next_order_date`, `active` and `notes`.
- `created_by` is not among them.

**The 08:00 cron raises the order as the schedule's creator.** The cron (`@Cron("0 8 * * *")`, `:640`) raises each due schedule's order through `createOrder` with the actor `recurringOrder.created_by || "system"` (`:849`, `:861`). When `auto_approve` is set, it then calls `approveOrder` as the same actor (`:887-891`).

**What the Audit of PR #538 at 46c74b08f reproduced** (finding 1), with the real controller and service at that PR's head:
- A staff member's PUT on a schedule a manager created answered 200.
- The cron then rewrote an APPROVED order from quantity 6, price 300, total 1800 to quantity 60, price 1, total 60.
- That head's merge role check was asked about the manager, and the audit row named the manager.
- Control, at that head: on a schedule staff created, the same edit was refused at the merge (403 `merge_would_change_price`).
- That merge role check is PR #538's code, which is open. Main's `createOrder` merge (`procurement.service.ts:1110-1133`) has no role check, so on main the staff-created control would fold as well (see Consequences).

**Callers.** `apps/web/src/pages/RecurringOrders.tsx` calls PUT and DELETE, but a search of `apps/web/src` found no route or import that mounts that page. A search of `apps/mobile` found no caller.

## Options considered

1. **Managers and owners only, on PUT and DELETE.** **Taken; the founder's pick.** It is the same rule and the same helper as the order-money checks, and staff can still create a schedule.
2. **Staff may edit only the schedules they created.** Rejected by the founder's pick. It is a second rule beside the order-money one, which does not look at who created an order.
3. **The job runs as the last editor.** Rejected by the founder's pick.
   - It would need a record of the last editor, which `recurring_orders` does not have.
   - It changes whose name the cron raises the order under, not who may make the change.
4. **Read the role strictly, so that a failed read answers 503.** Not taken.
   - The order-money checks use `assertCanManageRestaurant`, which reads the role with `strict: false` (`organizations.service.ts:254-261`). It does not throw on a failed read; it uses whatever role the lookup still finds (see Decision).
   - Using the same helper keeps one rule. The cost is that a caller refused during an outage is told 403, not 503. Nothing is written.
5. **Do nothing.** A staff edit to a manager's schedule would still be raised under the manager's name at 08:00.

## Decision

**PUT and DELETE now need a manager or an owner.** `PUT` and `DELETE /recurring-orders/:restaurantId/:id` call `OrganizationsService.assertCanManageRestaurant(user.userId, restaurantId, action)` before the service is called, so before the schedule row is read or written. The check itself reads the caller's role.
- That is the helper that order cancel (`assertMayCancelOrder`, `procurement.service.ts:3441-3445`) and the settings registers use.
- A caller whose role at the house is not owner or manager gets 403: "Only managers and owners can edit a recurring order schedule", or "… deactivate a recurring order schedule".
- **What the check reads** (`lookupRestaurantRole`, `organizations.service.ts:40-64`). It reads the caller's active `user_restaurant_access` row for this house first. When that read fails or finds no active row, it falls back to the legacy `users` row: that row's `role`, when its `restaurant_id` is this house. So:
  - a caller with neither an active owner/manager access row nor a legacy owner/manager role on this house gets 403;
  - that includes a caller for whom both reads fail;
  - a caller whose access read fails but whose legacy row names owner or manager for this house is admitted.

  Nothing is written when the check refuses.

**Each recurring-schedule mutation route, as decided under the founder's rule:**
- **`PUT /recurring-orders/:restaurantId/:id`:** managers and owners only. In the gateway it is the only HTTP route that changes `next_order_date` or `auto_approve` on an existing schedule, and one of the two that change `active`. The gateway has no separate pause, resume, toggle or next-date route for `recurring_orders`.
- **`DELETE /recurring-orders/:restaurantId/:id`:** managers and owners only. It sets `active` to false.
- **`POST /recurring-orders/:restaurantId` (create):** unchanged. Staff may create a schedule, and it is recorded as theirs (`created_by` comes from the token, `recurring-orders.service.ts:415`).
- **`GET` list and get-one:** unchanged; they are reads.
- **`POST /recurring-orders/:restaurantId/execute-check`:** unchanged (ADR 0243: non-production, platform operators).
- **The cron's own write after a run** (`next_order_date`, `last_order_date`, `execution_count`, `recurring-orders.service.ts:1050-1058`): unchanged. It is not an HTTP route.
- **The Python agent's write** (`services/agent-orchestrator/agents/recurring_order_agent.py:503`, `_update_next_order_date`): unchanged, and this gate does not cover it.
  - It is not an HTTP route.
  - It sets `next_order_date` to a value computed from the row's own `next_order_date`, `frequency` and `frequency_day` (`:497-507`), not to a value a caller supplies.
- **`services/api-gateway/routes/advanced_features.ts`** declares PUT and DELETE `/recurring-orders/:id`. The folder holds only `routes/`, with no package or deploy configuration, and those handlers make no database call: the calls are commented out (`:85-86`, `:102-103`). They write nothing.
- **Recurrence on an order** (`POST /procurement/orders/:id/recurrence`, `…/pause`, `…/resume`, `…/end`, `order-recurrence.controller.ts`): not changed by this decision.
  - It is a different construct, a rule stored on an order (ADR 0125's addendum), not a row in `recurring_orders`.
  - The ruling names PUT and DELETE on recurring schedules.
  - Its generator raises each child as the person who last moved the rule (`recurrence_status_by`, `order-recurrence.service.ts:647-656`), and the child skips the merge (`procurement.service.ts:1111`). So the path found above does not arise there.
  - These routes have no role check today. Whether staff may pause, resume or end a rule a manager set is not decided here; it is filed as OPEN in `tech-debt.d/2026-10-01-fix-recurring-schedule-edits-need-a-manager.md`. [Corrected 2026-10-01: the founder has since ruled on order recurrence's pause, resume and end, verbatim: *"Managers and owners only (Recommended)"*. PR #558 (ADR 0247, `fix/order-recurrence-needs-a-manager`) builds it and is open, so it is in flight, not closed.]

**Retire-to-write (CLAUDE.md §4).** This file is a decision record, the one record per decision that §5 requires. It retires no document.

## Consequences

- **Easier.** A caller the role check does not admit (above) can no longer change, through these two routes, a schedule that the 08:00 cron will raise under a manager's name. That covers `auto_approve`, `quantity`, `target_price` and the vendor.
- **Harder.** Staff who used to correct a schedule now ask a manager. No mounted web page calls these routes today (see Context).
- **Not closed by this decision:**
  - **The fold's line race.** PR #538's record covers the window after the header write, its cases (i) to (iii). This decision changes nothing there.
  - **The approve step's window (iv)** in PR #538's record: a fold landing between `approveOrder`'s reads and its UPDATE. Unchanged.
  - **A schedule staff edited before this change.** It still runs at its next 08:00 under its `created_by`. This change does not revert or flag earlier edits, and `recurring_orders` records no editor.
  - **`auto_approve`.** Staff may still set it at create, and after this change a manager or owner may set it by PUT.
    - The cron's `approveOrder` call carries no seal challenge (`recurring-orders.service.ts:887-891`).
    - On main, `approveOrder` runs the approval rules and then redeems the seal with `challenge ?? null` (`procurement.service.ts:4162-4163`, `:4334`), and the seal service refuses an empty challenge as absent and files the refusal (`seal-challenge.service.ts:159-166`).
    - The Audit of PR #538 at f66ec0d53 measured that path with the real seal service, in four cases: a 403, `approved_by` stayed null, `seal_refused` was filed, and no order was approved. This lane read the main lines above but did not run that measurement on main.
    - A pre-existing side effect: the order the cron raised, or the fold into an open order, is written before the refused approve (`:861` runs before `:887`).
  - **Main's merge has no role check until PR #538 merges.** `createOrder`'s merge (`procurement.service.ts:1110-1133`) folds into the newest open order for the same wine and vendor that is not in a terminal status. So, until #538 merges, two paths can still fold quantity and price into an order past PENDING with no role check: a schedule a staff member created, when the cron runs it, and a staff member's direct `POST /procurement/orders`.
  - **Recurrence on an order** (above), filed OPEN. [Corrected 2026-10-01: ruled by the founder for pause, resume and end; in flight in PR #558 (ADR 0247), not closed.]
- **Revisit if** staff need to correct schedules without a manager. That would be option 2 or 3, and it needs the founder's word.

## Evidence

`recurring-schedule-edits-need-a-manager.http.spec.ts` has 13 cases. It runs the real `RecurringOrdersController`, `RecurringOrdersService` and `OrganizationsService` over an in-memory store, and the real `JwtAuthGuard` with passport stubbed.

**The seven [REVERT-FAILS] cases.** Each answered 200 where 403 was expected on main's controller (98dfcb5af, unchanged since e88593bf8):
- staff PUT on a manager's schedule;
- staff PUT on their own schedule;
- staff DELETE on a manager's schedule;
- staff DELETE on their own schedule;
- both role reads failing (PUT and DELETE);
- the access read failing, with a legacy `users` row naming staff for this house;
- the access read failing, with no legacy row.

**The six pins**, which pass before and after:
- a legacy manager of this house whose access read fails may PUT and DELETE;
- a manager and an owner may PUT;
- a manager and an owner may DELETE;
- staff may create.

**Mutations.** Each was restored from a `cp -p` snapshot of the fixed controller. The claim column is the static claim in `claims.d/fix-recurring-schedule-edits-need-a-manager.jsonl`.

| Mutation | Spec | Claim |
|---|---|---|
| Remove the PUT check | 5 of 13 fail | exit 1 |
| Remove the DELETE check | 5 of 13 fail | exit 1 |
| Run the PUT check after the update | 5 of 13 fail | exit 1 |
| Refuse only a caller with no role (staff passes) | 3 of 13 fail | not run |
| Refuse only `staff` (no role passes) | 2 of 13 fail | not run |
| Add the check to create as well | 1 of 13 fails | exit 1 |
| Move DELETE's check inside its `try` (its catch turns the 403 into a 500) | 5 of 13 fail | exit 1 |
| Swap the two action strings | 4 of 13 fail | exit 1 |
| Check `user.restaurantId` instead of the path's `restaurantId` | 0 of 13 fail | not run |

The last row is equivalent. `JwtAuthGuard` refuses a path `:restaurantId` that differs from the session's house before the handler runs (`assertTenantMatch`), so the two values are equal on every request that reaches the check.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-10-01 | — | Created on `fix/recurring-schedule-edits-need-a-manager`. No independent review yet. |
| 2026-10-01 | Audit of PR #550 at b068bc984 (plan) | The plan asked for these corrections before review: (F1) a failed access read falls back to the legacy `users` row, so "a caller whose role cannot be read gets 403" was too broad; it is now stated as the helper reads, with three new cases; (F2) the merge role check in Context is PR #538's code, which is open; that is now scoped, and main's ungated merge is listed under Not closed; (F3) the order-recurrence OPEN entry is bracket-corrected: the founder ruled, and PR #558 is in flight; (minor) the Python agent's `next_order_date` writer is named. Also, from the Audit of PR #538 at f66ec0d53, the `auto_approve` item is now stated as measured: the seal refuses the cron's challenge-less approve. |
