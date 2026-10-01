# 0247 — Pausing, resuming, ending or replacing an order's recurrence needs a manager or an owner

- **Status:** Locked 2026-10-01.
- **Date:** 2026-10-01
- **Decider:** Aldemir (founder). He was asked "Should staff be allowed to [pause, resume or end a manager's order recurrence]?". His answer, verbatim, 2026-10-01: *"Managers and owners only (Recommended)"*. The option he picked read: *"Pause, resume and end on an order's recurrence need a manager or owner, the same rule as #550. Staff could still see it, and could still set one up on their own order. A small follow-up PR: the route checks plus a role-aware RecurrenceSheet."* The lane coordinator relayed both to the fix lane.
- **Keywords:** order recurrence, recurrence rule, pause, resume, end, replace, staff, manager, owner, assertCanManageRestaurant, recurrence_status, recurrence_status_by, RecurrenceSheet, activeRole
- **Links:** ADR 0246 (`0246-editing-or-deactivating-a-recurring-schedule-needs-a-manager-or-owner.md`, PR #550, open when this was written); [[0125-an-order-changes-state-through-a-sealed-transition]] (its addendum is recurrence on the order); claim `claims.d/fix-order-recurrence-needs-a-manager.jsonl:1`; register `tech-debt.d/2026-10-01-fix-order-recurrence-needs-a-manager.md`; specs `apps/api-gateway/src/procurement/order-recurrence-needs-a-manager.http.spec.ts` and `apps/web/src/pages/orders/next/RecurrenceSheet.role.test.tsx`.

## Context

Line numbers are at `origin/main` c4fe6a68b unless marked as this branch.

**The four routes had no role check.** `apps/api-gateway/src/procurement/order-recurrence.controller.ts` carries the class-level `JwtAuthGuard` (`:25`) and four routes: set (`:30`), pause (`:58`), resume (`:75`) and end (`:92`). The service, `order-recurrence.service.ts`, had no role check in `setRecurrence` (`:197`) or in `moveRecurrenceTo` (`:314`), which pause, resume and end call (`:440`, `:450`, `:460`). Any member of the house could pause, resume or end a rule a manager set.

**The set route also changes a rule that is already there.** `setRecurrence` reads the order (`:207`) and refuses only an occurrence of another rule or an unapproved order. It then writes `recurrence_status: "active"` and a next date derived from the start date it is given (`:252`). It does not look at the current `recurrence_status`. So on an order that already carries a rule:
- on a paused rule, it resumes it;
- on an ended rule, it restarts it, which `moveRecurrenceTo` refuses (`:332`);
- on an active rule, it can move the next date as far out as the caller likes, because `planRecurrence` accepts any calendar date as the start (`order-recurrence.ts:480`).

The web sheet offers this as "Replace the rule" (`apps/web/src/pages/orders/next/RecurrenceSheet.tsx:257`).

**What a move does.** The 08:15 generator raises each child as `recurrence_status_by`, the person who last moved the rule (`order-recurrence.service.ts:656`), and every child is born PENDING. So a staff move does not spend money under a manager's name. It stops, restarts or moves a standing order a manager set.

**Callers.** `RecurrenceSheet.tsx` calls set (`:238`), pause (`:295`), resume (`:306`) and end (`:317`), with no role gate. A search of `apps/mobile/src` and `services/` found no caller of these routes. A search of `apps/api-gateway/src` found no caller of the four service methods other than the controller.

**ADR 0246 left this open.** PR #550's fragment, `tech-debt.d/2026-10-01-fix-recurring-schedule-edits-need-a-manager.md:1` on `fix/recurring-schedule-edits-need-a-manager`, filed "Who may set, pause, resume or end a recurrence on an order" as OPEN. That file is not on `main` at c4fe6a68b.

## Options considered

1. **Managers and owners only.** **Taken; the founder's pick.** It is the rule and the helper ADR 0246 uses, and the one order cancel uses.
2. **Staff can on their own only.** Rejected by the founder's pick. The only person a rule records is `recurrence_status_by`, the last person to move it (`order-recurrence.service.ts:253`, `:370`), so "their own" would change hands with every move.
3. **Leave it open.** Rejected by the founder's pick. Any member could stop or restart a standing order a manager set.
4. **Read the role strictly, so that an unreadable role answers 503 instead of 403.** Not taken, for ADR 0246's reason: `assertCanManageRestaurant` reads a failed lookup as no role (`organizations.service.ts:254-261`, `strict: false`), and one helper keeps one rule. The cost is that an outage is reported as 403, not 503. It still writes nothing.
5. **Check pause, resume and end, and leave replace open.** Not taken. Replace resumes a paused rule, restarts an ended one and can move an active one's next date, so staff could still do the three acts the ruling keeps for managers and owners. This is how the ruling is applied, not a second ruling: the founder was not asked about replace by name.

## Decision

**Pause, resume and end need a manager or an owner, and so does replacing a rule an order already carries.** Setting the first rule on an approved order stays open to every member of the house.

The check is `OrganizationsService.assertCanManageRestaurant(userId, restaurantId, act)`, the helper order cancel uses (`assertMayCancelOrder`, `procurement.service.ts:3441`). It runs through `OrderRecurrenceService.assertMayChangeARule` (this branch, `order-recurrence.service.ts:191`).
- A caller whose role at the house is not owner or manager gets 403: "Only managers and owners can pause an order's recurrence" (or resume, end, replace).
- A caller whose role cannot be read gets the same 403. Nothing is written in either case.
- If the helper is not wired into the service, the call answers 500 and writes nothing, as `assertMayCancelOrder` does (`procurement.service.ts:3434-3440`). `ProcurementModule` imports `OrganizationsModule`, so this does not happen in the running gateway.

**Each order-recurrence route, under the founder's rule:**
- **`POST /procurement/orders/:id/recurrence/pause`:** managers and owners only. The check runs before the order is read (this branch, `order-recurrence.service.ts:397`).
- **`POST /procurement/orders/:id/recurrence/resume`:** the same.
- **`POST /procurement/orders/:id/recurrence/end`:** the same.
- **`POST /procurement/orders/:id/recurrence` (set), on an order that carries no rule:** open to every member of the house, as before.
  - It is scoped to the caller's house from the token (`order-recurrence.controller.ts:46-48`). It is not scoped to the person who placed the order.
  - The write now lands only if the order still carries no rule (this branch, `order-recurrence.service.ts:323`). A rule set between the read and the write gets 409 `rule_set_meanwhile`, and nothing is written.
- **The same route, on an order that already carries a rule (active, paused or ended):** managers and owners only (this branch, `:261-269`). The check runs after the order is read, because the read is what shows there is a rule, and before anything is written.
- **The 08:15 generator and its writes:** unchanged. It is not an HTTP route.
- **Reads:** unchanged. Staff still see the rule on the order.
- **`/recurring-orders` schedules:** ADR 0246, not changed here.

**The web sheet.** `RecurrenceSheet` reads `useAuth().activeRole`.
- An owner or a manager sees pause, resume, end and "Replace the rule", as before.
- Anyone else sees the rule and a sentence in place of those controls: `RECURRENCE_NEEDS_A_MANAGER`, or `RECURRENCE_ROLE_UNKNOWN` when the role has not been read. The replace form and its button are not shown.
- The first-rule form is shown to every role.
- A 403 from the gateway is shown as the gateway's message followed by "Nothing was changed."
- The sheet only decides what it offers. The gateway decides what happens.

**This closes ADR 0246's OPEN entry** on recurrence on an order. This branch's fragment, `tech-debt.d/2026-10-01-fix-order-recurrence-needs-a-manager.md`, records the closure and cites that entry.

**Retire-to-write (CLAUDE.md §4).** This file is a decision record, the one record per decision that §5 requires. It retires no document.

## Consequences

- **Easier.** A staff member can no longer stop, restart or move a standing order a manager or an owner set, by any of the four routes.
- **Harder.**
  - Staff who need a rule paused or ended ask a manager or an owner.
  - That holds for a rule staff set themselves too: a first rule is open, and every change after it needs a manager or an owner.
- **Not closed by this decision:**
  - **Whose order a first rule may go on.** Staff may set a first rule on any approved order in the house, including one a manager placed. The ruling says staff "could still set one up on their own order"; whether "own" limits that was not asked. Filed OPEN in this branch's fragment.
  - **A manager or an owner can still restart an ended rule** by replacing it, which `moveRecurrenceTo` refuses for everyone (`:332`). Unchanged here. Filed OPEN in this branch's fragment.
  - **Rules staff moved before this change** stay as they are. `system_audit_log` records each move with its actor (`order_recurrence_*` acts).
  - **The role the sheet reads can lag a role change.** The gateway's 403 is what holds, and the sheet shows it in words.
- **Revisit if** staff need to pause or end a rule without a manager (option 2), or the founder reads "on their own order" as a limit on setting a first rule.

## Evidence

`order-recurrence-needs-a-manager.http.spec.ts` runs the real `OrderRecurrenceController`, `OrderRecurrenceService` and `OrganizationsService` over an in-memory store, and the real `JwtAuthGuard` with passport stubbed. It has 13 cases.
- **The eight [REVERT-FAILS] cases** were run against c4fe6a68b and failed there. Seven answered 201 where 403 was expected, and one answered 201 where 409 was expected:
  - staff pause, resume and end, each with nothing written;
  - an unreadable role on all three;
  - staff replace of an active, a paused and an ended rule;
  - a first rule that lands after a manager's rule arrived between the read and the write.
- **The five pins**, which pass before and after: a manager and an owner may pause, resume and end; a manager and an owner may replace a paused rule; staff may set a first rule, recorded as theirs.

`RecurrenceSheet.role.test.tsx` has 9 cases. The five [REVERT-FAILS] cases failed against the sheet at c4fe6a68b: staff on an active, a paused and an ended rule; an unread role; and a 403 shown in words. The four pins pass before and after: staff may set a first rule, a manager and an owner see pause and end and pause posts, and a manager sees resume.

The existing `order-recurrence.service.spec.ts` builds the service directly. It now passes a role stub that lets every role through, and its query mock gained `is`. Who may change a rule is pinned by the HTTP spec above.

Mutations, each restored from a `cp -p` snapshot:

| Mutation | Result |
|---|---|
| Remove the pause, resume and end check | 4 of 13 HTTP cases fail |
| Remove the replace check | 3 of 13 fail |
| Write a first rule with no `recurrence_status IS NULL` condition | 1 of 13 fails |
| Refuse only `staff` (an unreadable role passes) | 1 of 13 fails |
| Count only a paused rule as one to replace | 2 of 13 fail |
| Run the replace check on a first rule too | 2 of 13 fail |
| Run the pause, resume and end check after the write | 4 of 13 fail |
| Sheet: every role may change a rule | 4 of 9 web cases fail |
| Sheet: show pause, resume and end to every role | 4 of 9 fail |
| Sheet: drop the words on a 403 | 1 of 9 fails |
| Sheet: let a role that has not been read through | 1 of 9 fails |

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-10-01 | — | Created on `fix/order-recurrence-needs-a-manager`. No independent review yet. |
