## Staff still read the house's money through the other analytics routes — OPEN — 2026-10-31

`fix/analytics-money-routes-need-a-manager` closes only what the founder
picked on 2026-10-30 ("Fix staff money leak now", ranked item 1 of
`decisions/evidence/0345-floor-checker-research.md` on
`docs/floor-checker-is-a-mudavym-software`): GET `table-performance`,
`waiters` and `hot-tables`, and POST `tables`, now name owner and manager
(claim `A-TABLE-AND-SERVER-TAKINGS-NEED-A-MANAGER`). The rulings, the rejected
twelve-route build, the follow-up's shape and the executor's calls on the writes
below are recorded in
[ADR 0348](../decisions/0348-staff-are-refused-the-table-and-server-takings-and-the-rest-is-withheld-after-617.md);
this entry tracks what stays open until that follow-up merges. The workflow that built it
first gated twelve routes. Two reviewers blocked that: it went past the pick,
and it refused whole routes where open PR #617 (ADR 0298 decision 9) withholds
the figures inside them and keeps the route.

**The founder's ruling, 2026-10-31** (AskUserQuestion, verbatim option):
*"Your pick now, rest after #617 (Recommended)"*. Its text: a follow-up PR
after #617 merges closes the rest the way #617 already does (staff keep the
page, the figures are withheld), and **that PR must land before any waiter is
invited to the floor phone** (the ADR 0345 build plan's staff-invite step).

What a staff login of the house can still read, at `9914f5cbf`
(`apps/api-gateway/src/analytics/analytics.controller.ts`, class
`JwtAuthGuard` only, no `@Roles`):

- **One person's figures.** GET `insights` (:409) can return
  `waiter.avg_check.peer_rank`, which names a server and an amount; its
  `?candidateKey=` forces a compute, and the mobile app reads the feed
  (`apps/mobile/src/api/queries.ts:319`). GET `recommendations` (:1178)
  carries the `staff_spread` rule (`recommendations.service.ts:758`).
- **Amounts.** GET `recommendations` (dead-stock value, purchase spend, price
  advice), POST `goals` (:852, a baseline revenue, spend or average check),
  `financial` (:160), `inventory-science` (:190, unit cost beside the reorder
  point staff do need), `risk` (:225), `consult` (:1021), `menu-engineering`
  (:1053), `vendor-scorecard` (:1063), `cashflow` (:1083), `wine` (:1093),
  `pos-revenue` (:1110) and `overview` (:1168). #617 withholds only the
  figures ADR 0298 moves onto the till; its open claim
  `A-POS-MONEY-ANALYTICS-ROUTES-ARE-A-HOLDERS` names `pos-revenue`, `basket`
  and `insights` among the rest.
- **Writes with no role.** PUT `insight-prefs` (:535), PUT `venue` (:594),
  PUT `consultants/:id/toggle` (:1006), PUT `recommendations/:id/digest`
  (:1525), and GET `/toast/sales` (`toast/toast.controller.ts:271`, class
  `JwtAuthGuard` only). Not ruled by the founder; ADR 0348 §Decision 5 records
  the executor's call on each (owner and manager on the four writes, staff
  withheld from the till read), built in the follow-up.

The staff readings above come from the 2026-10-31 security review of the wide
version (a staff token answered 200 on `recommendations`); this entry did not
re-run them. No static claim is filed for the follow-up: #617 puts
`salesGateFor(` into some of these bodies, so a grep for the gate would read
HOLDS while `staff_spread` and `peer_rank` still reach staff. The follow-up
should pin it with a spec on a staff token, as this branch's
`analytics-money-needs-a-manager.spec.ts` does.

Fixed on this branch after the 2026-10-31 CI audit: the two comments that said
a role guard admits `admin`, which `RolesGuard` no longer does
(`roles.guard.ts:48`, ADR 0164), at `analytics.controller.ts:388` and
`apps/web/src/pages/reports/next/useReportExports.ts:117`. /reports no longer
asks for the table and server registers for a role the gateway refuses; they
say they are held back (ADR 0348 §Decision 2).
