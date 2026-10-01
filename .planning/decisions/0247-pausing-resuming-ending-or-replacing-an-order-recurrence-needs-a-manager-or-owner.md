# 0247 — Pausing, resuming, ending or replacing an order's recurrence needs a manager or an owner

- **Status:** Locked 2026-10-01.
- **Date:** 2026-10-01
- **Decider:** Aldemir (founder). Four answers, all 2026-10-01, each relayed to the fix lane by the lane coordinator. Each is quoted verbatim, with the option text he picked.
  1. **Pause, resume and end.** Asked "Should staff be allowed to [pause, resume or end a manager's order recurrence]?", he answered *"Managers and owners only (Recommended)"*. The option read: *"Pause, resume and end on an order's recurrence need a manager or owner, the same rule as #550. Staff could still see it, and could still set one up on their own order. A small follow-up PR: the route checks plus a role-aware RecurrenceSheet."*
  2. **Replace.** Asked "Do you agree [that replacing an existing rule needs a manager or owner]?", he answered *"Yes, replace needs a manager (Recommended)"*. The option read: *"Keep #558 as built. Only a manager or owner can replace an existing rule. A first rule on an order with none stays open to everyone. Staff can't change even a rule they set up themselves; a manager does it."*
  3. **A first rule on someone else's order.** Asked "Should a staff member be able to put a first recurrence on someone else's order?", he answered *"Only on their own order (Recommended)"*. The option read: *"Staff can set a first rule only on an order they placed; any order can take one from a manager or owner. It matches the wording of your ruling. A small follow-up PR adds the creator check."*
  4. **Restart.** Asked "Should a manager be able to restart an ended rule by replacing it?", he answered *"Yes, managers may restart (Recommended)"*. The option read: *"Keep it. An ended rule can be restarted by a manager or owner replacing it. That is a deliberate managerial act, and staff can't do it. The 'move' path stays as it is."*
- **Keywords:** order recurrence, recurrence rule, pause, resume, end, replace, restart, first rule, created_by, createdBy, staff, manager, owner, assertCanManageRestaurant, recurrence_status, recurrence_status_by, RecurrenceSheet, activeRole
- **Links:**
  - ADR 0246 (`0246-editing-or-deactivating-a-recurring-schedule-needs-a-manager-or-owner.md`, PR #550, open when this was written).
  - [[0125-an-order-changes-state-through-a-sealed-transition]] (its addendum is recurrence on the order).
  - claim `claims.d/fix-order-recurrence-needs-a-manager.jsonl:1`.
  - register `tech-debt.d/2026-10-01-fix-order-recurrence-needs-a-manager.md`.
  - specs `apps/api-gateway/src/procurement/order-recurrence-needs-a-manager.http.spec.ts` and `apps/web/src/pages/orders/next/RecurrenceSheet.role.test.tsx`.

## Context

Line numbers are at `origin/main` c4fe6a68b unless marked as this branch. None of the files cited from `apps/` changed between c4fe6a68b and 98dfcb5af, the base this branch sits on.

**The four routes had no role check.** `apps/api-gateway/src/procurement/order-recurrence.controller.ts` carries the class-level `JwtAuthGuard` (`:25`) and four routes: set (`:30`), pause (`:58`), resume (`:75`) and end (`:92`). The service, `order-recurrence.service.ts`, had no role check in `setRecurrence` (`:197`) or in `moveRecurrenceTo` (`:314`), which pause, resume and end call (`:440`, `:450`, `:460`). Any member of the house could pause, resume or end a rule a manager set.

**The set route also changes a rule that is already there.** `setRecurrence` reads the order (`:207`) and refuses only an occurrence of another rule or an unapproved order. It then writes `recurrence_status: "active"` and a next date derived from the start date it is given (`:252`). It does not look at the current `recurrence_status`. So on an order that already carries a rule:
- on a paused rule, it resumes it;
- on an ended rule, it restarts it, which `moveRecurrenceTo` refuses (`:332`);
- on an active rule, it can move the next date as far out as the caller likes, because `planRecurrence` accepts any calendar date as the start (`order-recurrence.ts:480`).

The web sheet offers this as "Replace the rule" (`apps/web/src/pages/orders/next/RecurrenceSheet.tsx:257`).

**A first rule could go on any approved order in the house.** The set route is scoped to the caller's house from the token (`order-recurrence.controller.ts:46-48`). It did not look at who placed the order. `procurement_orders.created_by` records that person: `createOrder` writes it from the caller's id (`procurement.service.ts:1278`). The orders list route selects `*`, but its mapper did not send `created_by` to the client.

**What a move does.** The 08:15 generator raises each child as `recurrence_status_by`, the person who last moved the rule (`order-recurrence.service.ts:656`), and every child is born PENDING. So a staff move does not spend money under a manager's name. It stops, restarts or moves a standing order a manager set.

**Callers.** `RecurrenceSheet.tsx` calls set (`:238`), pause (`:295`), resume (`:306`) and end (`:317`), with no role gate. A search of `apps/mobile/src` and `services/` found no caller of these routes. A search of `apps/api-gateway/src` found no caller of the four service methods other than the controller.

**ADR 0246 left this open.** PR #550's fragment, `tech-debt.d/2026-10-01-fix-recurring-schedule-edits-need-a-manager.md:1` on `fix/recurring-schedule-edits-need-a-manager`, filed "Who may set, pause, resume or end a recurrence on an order" as OPEN. That file is not on `main` at 98dfcb5af.

## Options considered

1. **Managers and owners only, for pause, resume and end.** **Taken; ruling 1.** It is the rule and the helper ADR 0246 uses, and the one order cancel uses.
2. **Staff can on their own only.** Rejected by ruling 1. The only person a rule records is `recurrence_status_by`, the last person to move it (`order-recurrence.service.ts:253`, `:370`), so "their own" would change hands with every move.
3. **Leave it open.** Rejected by ruling 1. Any member could stop or restart a standing order a manager set.
4. **Read the role strictly, so that an unreadable role answers 503 instead of 403.** Not taken, for ADR 0246's reason. `assertCanManageRestaurant` reads a failed lookup as no role (`organizations.service.ts:254-261`, `strict: false`), and one helper keeps one rule. The cost is that an outage is reported as 403, not 503. It still writes nothing.
5. **Replacing a rule that is already there needs a manager or an owner.** **Taken; ruling 2.** Replace resumes a paused rule, restarts an ended one and can move an active one's next date, so leaving it open would leave all three of ruling 1's acts reachable to staff. A first rule on an order with none is not a replace.
6. **A first rule from staff goes only on an order they placed; a manager or an owner may set one on any order.** **Taken; ruling 3.** The alternative, staff may set a first rule on any approved order in the house, was rejected by that ruling. Ruling 3's option named a small follow-up PR for the creator check. It was built in this PR instead, because it is the same route and the same check.
7. **A manager or an owner may restart an ended rule by replacing it.** **Taken; ruling 4.** The alternative, refuse a replace on an ended rule for everyone as `moveRecurrenceTo` does, was rejected by that ruling. `moveRecurrenceTo` keeps refusing an ended rule.

## Decision

**Pause, resume and end need a manager or an owner, and so does replacing a rule an order already carries.**

**A first rule on an approved order may be set by the person who placed it. A manager or an owner may set one on any order.**

The check is `OrganizationsService.assertCanManageRestaurant(userId, restaurantId, act)`, the helper order cancel uses (`assertMayCancelOrder`, `procurement.service.ts:3441`). It runs through `OrderRecurrenceService.assertMayChangeARule` (this branch, `order-recurrence.service.ts:197`).
- **A role other than owner or manager:** 403. The messages are "Only managers and owners can pause an order's recurrence" (or resume, end, replace), and "Only managers and owners can set a recurrence on an order someone else placed".
- **A role that cannot be read:** the same 403. Nothing is written in either case.
- **A helper that is not wired into the service:** 500, and nothing is written, as with `assertMayCancelOrder` (`procurement.service.ts:3434-3440`). `ProcurementModule` imports `OrganizationsModule`, so this does not happen in the running gateway.

**Each order-recurrence route, under the founder's rulings:**
- **`POST /procurement/orders/:id/recurrence/pause`:** managers and owners only. The check runs before the order is read (this branch, `order-recurrence.service.ts:414`).
- **`POST /procurement/orders/:id/recurrence/resume`:** the same.
- **`POST /procurement/orders/:id/recurrence/end`:** the same.
- **`POST /procurement/orders/:id/recurrence` (set), on an order that carries no rule** (this branch, `:280-286`):
  - The person in `created_by` may set one, and no role is asked of them.
  - Anyone else needs a manager or an owner. That includes an order with no recorded creator.
  - The order's read now selects `created_by` (`RECURRENCE_SELECT`, this branch, `:88`).
  - Whether the order is the caller's own is a case-insensitive comparison of `created_by` with the caller's id (`placedBy`, this branch, `:966`).
  - The write lands only if the order still carries no rule (this branch, `:340`). A rule set between the read and the write gets 409 `rule_set_meanwhile`, and nothing is written.
- **The same route, on an order that already carries a rule (active, paused or ended):** managers and owners only (this branch, `:274-279`).
  - The check runs after the order is read, because the read shows whether there is a rule, and before anything is written.
  - On an ended rule this restarts it, as ruling 4 keeps.
- **The 08:15 generator and its writes:** unchanged. It is not an HTTP route.
- **Reads:** unchanged. Staff still see the rule on the order.
- **`/recurring-orders` schedules:** ADR 0246, not changed here.

**The order wire carries who placed the order.** `OrderResponseDto.createdBy` is new. `mapOrderRow` (this branch, `procurement.service.ts:7235`) sends it by the key test: `null` when nobody is recorded, absent when a route did not read the column. The web `Order` type and `OrderRowVM.createdBy` carry it to the sheet.

**The web sheet.** `RecurrenceSheet` reads `useAuth().activeRole` and `useAuth().user.userId`.
- An owner or a manager sees pause, resume, end and "Replace the rule", and the first-rule form on any approved order.
- Anyone else sees the rule. In place of pause, resume, end and replace they see one of two sentences: `RECURRENCE_NEEDS_A_MANAGER`, or `RECURRENCE_ROLE_UNKNOWN` when the role has not been read.
- Staff see the first-rule form only on an order recorded as placed by them. On any other order they see `RECURRENCE_NOT_YOUR_ORDER`, or `RECURRENCE_FIRST_RULE_ROLE_UNKNOWN` when the role has not been read.
- A 403 from the gateway is shown as the gateway's message followed by "Nothing was changed."
- The sheet only decides what it offers. The gateway decides what happens.

**This closes ADR 0246's OPEN entry** on recurrence on an order. This branch's fragment, `tech-debt.d/2026-10-01-fix-order-recurrence-needs-a-manager.md`, records the closure and cites that entry. It also closes, with rulings 3 and 4, the two entries this branch first filed as OPEN.

**Retire-to-write (CLAUDE.md §4).** This file is a decision record, the one record per decision that §5 requires. It retires no document.

## Consequences

- **Easier.**
  - A staff member can no longer stop, restart or move a standing order a manager or an owner set, by any of the four routes.
  - A staff member can no longer start a standing order on an order someone else placed.
- **Harder.**
  - Staff who need a rule paused or ended ask a manager or an owner.
  - That holds for a rule staff set themselves too: a first rule on their own order is open, and every change after it needs a manager or an owner (ruling 2).
  - Staff who want a recurrence on an order they did not place, including one with no recorded creator, ask a manager or an owner.
- **Not closed by this decision:**
  - **Rules staff moved or set before this change** stay as they are. `system_audit_log` records each move with its actor (`order_recurrence_*` acts).
  - **The role the sheet reads can lag a role change.** The gateway's 403 is what holds, and the sheet shows it in words.
  - **The orders wire now carries `createdBy`, a `public.users` id,** to every member who can list the house's orders.
- **Revisit if** staff need to pause or end a rule without a manager (option 2), or a first rule needs a narrower or wider rule than "the person who placed the order".

## Evidence

**`order-recurrence-needs-a-manager.http.spec.ts`** runs the real `OrderRecurrenceController`, `OrderRecurrenceService` and `OrganizationsService` over an in-memory store, and the real `JwtAuthGuard` with passport stubbed. The store's select returns only the columns it names. It has 20 cases.
- **The eleven [REVERT-FAILS] cases** were run against 98dfcb5af and failed there. Ten answered 201 where 403 was expected, and one answered 201 where 409 was expected:
  - staff pause, resume and end, each with nothing written;
  - an unreadable role on all three;
  - staff replace of an active, a paused and an ended rule;
  - staff first rule on an order a manager placed, and on an order with no recorded creator;
  - an unreadable role's first rule on an order someone else placed;
  - a first rule that lands after a manager's rule arrived between the read and the write.
- **The nine pins**, which pass on 98dfcb5af and on this branch:
  - a manager and an owner may pause, resume and end;
  - a manager and an owner may replace a paused rule;
  - staff may set a first rule on an order they placed, recorded as theirs;
  - a person whose role cannot be read may set a first rule on an order they placed;
  - a manager and an owner may set a first rule on an order staff placed, and a manager on one with no recorded creator.

**`RecurrenceSheet.role.test.tsx`** has 14 cases.
- **The eight [REVERT-FAILS] cases** failed against the sheet at 98dfcb5af:
  - staff on an active, a paused and an ended rule;
  - staff offered a first rule on an order someone else placed, and on one with no recorded creator;
  - an unread role on a rule;
  - an unread role offered a first rule on an order someone else placed;
  - a 403 shown in words.
- **The six pins** pass before and after.

**The existing `order-recurrence.service.spec.ts`** builds the service directly. It passes a role stub that lets every role through, and its query mock has `is`. Who may change a rule is pinned by the HTTP spec above.

**Mutations**, each restored from a `cp -p` copy of the file taken before it:

| Mutation | Result |
|---|---|
| Remove the pause, resume and end check | 4 of 20 HTTP cases fail |
| Remove the replace check | 3 of 20 fail |
| Write a first rule with no `recurrence_status IS NULL` condition | 1 of 20 fails |
| Refuse only `staff` (an unreadable role passes) | 2 of 20 fail |
| Count only a paused rule as one to replace | 2 of 20 fail |
| Run the role check on every first rule, one's own included | 5 of 20 fail |
| Run the pause, resume and end check after the write | 4 of 20 fail |
| Remove the first-rule creator check | 3 of 20 fail |
| Count an order with no recorded creator as the caller's own | 1 of 20 fails |
| Stop selecting `created_by` in the order's read | 3 of 20 fail |
| Sheet: every role may change a rule | 7 of 14 web cases fail |
| Sheet: show pause, resume and end to every role | 4 of 14 fail |
| Sheet: drop the words on a 403 | 1 of 14 fails |
| Sheet: let a role that has not been read through | 2 of 14 fail |
| Sheet: offer the first-rule form to staff on any order | 3 of 14 fail |
| Sheet: never count the order as the caller's own | 1 of 14 fails |
| `toRow`: drop `createdBy` from the wire | 1 of 14 fails |

The claim's verify exits 0 on this branch and 1 on 98dfcb5af. It also exits 1 on each of the 17 mutations above.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-10-01 | — | Created on `fix/order-recurrence-needs-a-manager`. No independent review yet. |
| 2026-10-01 | — | Rulings 2 to 4 recorded; the first-rule creator check built on the same branch. No independent review yet. |
