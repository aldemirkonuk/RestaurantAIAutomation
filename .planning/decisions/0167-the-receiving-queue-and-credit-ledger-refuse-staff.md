# 0167 — The receiving queue and the credit ledger refuse staff

- **Status:** Locked 2026-09-19. The founder chose this in chat from the options below, in his words: *"Refuse staff on all four"*, and *"Owner or manager on all"* for the recovery figures.
- **Date:** 2026-09-19
- **Decider:** Aldemir (founder)
- **Keywords:** receiving, queue, credits, credit ledger, transition, recovery stats, staff, owner, manager, RolesGuard, @Roles, least privilege, Sim Bistro, ReceiptsPage, ReceivingHome, ADR 0149 row 44
- **Links:** [[0162-managers-grant-manager-or-staff-on-both-doors]] (`req.user.role` is the role in the token's house, so `RolesGuard` decides per house), [[0147-the-pages-endpoints-answer-only-for-the-callers-house-and-person]], `.planning/06-pages/receiving.md` §12 (the wave-5 links lane's 2026-09-18 correction), `production-tenant-shape` memory (stale on staff rows; see Context)

**Index row:** not added to `decisions/README.md` here. That file is gate-owned, and its row for this record goes in a separate PR.

## Context

`ReceivingHome` picks a manager view or an owner view by role, and the staff view
deliberately shows no money. The gateway did not enforce that split. Both controllers
carried `JwtAuthGuard` alone:

- `ReceivingController` (`procurement/receiving.controller.ts`): `GET /procurement/receiving/queue`,
  the deliveries that need a decision, worst dollars first.
- `CreditsController` (`procurement/documents/credits.controller.ts`, not `procurement/credits.controller.ts`
  as the hand-off had it): `GET /procurement/credits` (the chase list), `GET /procurement/credits/stats`
  (the recovery figures, absent from the hand-off but under the same class guard), and
  `POST /procurement/credits/:id/transition`.

So any signed-in member of a house could read the dollars the staff view omits, and could move
a vendor claim to `rejected` or `written_off`. Production had no staff rows when that was first
judged low-risk (2026-08-26). A live read on 2026-09-18 found one, in Sim Bistro
(`12823c23-277c-5ae9-b49b-e17d33704e04`, granted 2026-09-03), and the founder called Sim Bistro
real on 2026-09-05. Re-measured read-only on 2026-09-19: 15 active `user_restaurant_access` rows
(10 owner, 4 manager, 1 staff), no member held only by a legacy `users` row, and migration
`20260918153000` applied. So the change alters behaviour for one staff access row. It also refuses any
session whose role in the token's house is null (no role there), which was allowed before: ADR 0162 measured
7 such (person, house) pairs on 2026-09-18, all simulation accounts, from `switchRestaurant`'s organisation
fallback. That is not a total measured today. For all 15 active members `users.role` equals their access
role (measured 2026-09-19), so no member's web view, chosen from the global role, disagrees with the server now.

## Options considered

1. **Refuse staff on all four (chosen).** `@Roles("owner","manager")` on the whole credits
   controller and on `queue` alone. It matches what the UI already implies, closes the write
   path, and stops the server disagreeing with the staff view about what staff may see. Cost: a
   behaviour change for a live account, and the web must stop offering the Credits tab to staff.
2. **Refuse staff on the write only.** Least disruption, but staff would still read dollars at
   risk and recovery figures the staff view hides on purpose, so the server would keep disagreeing
   with the UI on reads.
3. **Leave all four open and record it.** No code, no risk to the live account. It leaves the
   owner/manager/staff split a rendering choice, and every future staff account inherits the write path.
4. **Owner-only on the stats route** (sub-question). Matches `OwnerView` exactly but splits one
   controller into two rules, and a manager who does the vendor chase would lose the recovered figure
   they help produce. Rejected: owner or manager on all four.

## Decision

`GET /procurement/receiving/queue`, `GET /procurement/credits`, `GET /procurement/credits/stats` and
`POST /procurement/credits/:id/transition` answer `403` to anyone whose role in the token's house is
not owner, manager or admin. This is `@UseGuards(JwtAuthGuard, RolesGuard)` with
`@Roles("owner","manager")` on `CreditsController`, and `@UseGuards(RolesGuard)` with the same
`@Roles` on `ReceivingController.queue` only. The door routes (`door`, `receivedSoFar`) and
`unverified` stay open to staff: the person holding the hand truck works through them.

`RolesGuard` reads `req.user.role`, which for a token that names a house is the role in that house
(ADR 0162, answer A). A session with no role in the house is `null` and is refused too.

## Consequences

- The Sim Bistro staff account now gets `403` on those four routes. Its receiving page is the staff
  view, which calls none of them (`useStaffDeliveries` reads `/procurement/orders`; `useDoorOutbox` reads
  no credit route), so its working screens do not change. What does change: the legacy
  `ReceiptsPage` (also what `/receipts?tab=credits` renders with the Mudavym flag on, since `ReceiptsNext`
  hands that tab to the legacy page) stopped offering the Credits tab to staff and lands `?tab=credits` on
  the Receipts tab, so a staff member does not meet a ledger that can only show an error. It decides from
  `activeRole`, the role in this house, and falls back to the global `user.role` only when no house is
  active. The audit of PR #395 found the first cut read `user.role` alone, which is the global `users.role`;
  `ReceiptsPage.roles.test.tsx` now pins the difference (9 tests, 3 mutants caught).
- `GET /procurement/receiving/unverified` is left as it was. It was not in the question put to the
  founder. Filed as an open question rather than assumed either way.
- Revisit when a fourth role appears, when a per-route permission model replaces `@Roles`, or when
  a staff-visible credits view is wanted (that needs its own decision and a server route shaped for it).
- Proof: `procurement/receiving-credits-roles.spec.ts` drives real HTTP through the real controllers and the real
  `RolesGuard` (only `JwtAuthGuard` stubbed): staff and no-role get `403` with no ledger or queue read,
  owner, manager and admin pass, and the routes staff use stay open. With the gates removed 10 of its
  24 tests fail. `CLAIMS.jsonl` row `ADR-0167-RECEIVING-CREDITS-REFUSE-STAFF` pins the wiring statically.

## Open items

- **`GET /procurement/receiving/unverified` (`ReceivingController.unverified`) — undecided.** It was not
  in the question put to the founder, so it is unchanged and open to staff. Measured 2026-09-19 (PR #395
  audit, `receiving.service.ts` `UnverifiedDelivery`): its rows carry `orderId`, `orderNumber`,
  `countedQtyBottles`, `countedAt`, `ageHours` and `severity`, and the route adds a `summary` and an
  `overdue` count built from them. No money field, so leaving it open leaks no dollars. It stays here, and is
  not filed in the defect register, which retires under ADR 0166. A gate on it would be one line
  (method-level `@UseGuards(RolesGuard)` + `@Roles("owner","manager")`, as on `queue`) plus a flip of the
  "leaves the routes staff work with open" test, and it needs the founder's word.
- **Staff still see the unit prices behind a claim — undecided, and a separate question from this one.**
  A receipt discrepancy is persisted for the whole restaurant and broadcast
  (`procurement.service.ts:5361-5385`, `persistForRestaurant`, whose `broadcast` defaults to true):
  `message: match.summary` carries the billed and agreed unit prices, and the metadata carries `creditDue`
  and `effectiveUnitCost`. Whether the notification centre filters that by role was not checked.
  `POST /procurement/orders/:id/verify-receipt` (`procurement.controller.ts:529`, no `@Roles` anywhere in that
  controller) is open to staff and opens the claim. The ledger totals and the queue are now hidden from
  staff; these per-unit figures may not be. Not decided here.
- **Two pages still choose the view from the global role.** `ReceivingHome` (`:66`) and `ReceivingNext`
  (`:160`) read `useAuth().user.role`, the global `users.role`, while the gateway decides on the role in the
  house. A person whose global role differs from their role in the house would be shown the manager or owner
  view and meet a `403` on the queue and credits. Inherited, not introduced here, and not changed: `ReceivingNext`
  belongs to the receiving lane, and `ReceivingHome` is legacy under ADR 0149. Nobody is affected today (every
  active member's two roles agree).
- **Sequencing with ADR 0164.** The sessions change makes `RolesGuard` exact and relabels owner-only routes to
  owner+manager. This record's `@Roles("owner","manager")` matches it, but whichever change lands second must
  re-run `receiving-credits-roles.spec.ts` (24 tests).

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-09-19 | Aldemir | Chose "Refuse staff on all four" and "Owner or manager on all" |
| 2026-09-25 | Lane L3a (PR #395 update, merged main `059169a5`) | Re-verified on the merged tree: `receiving.controller.ts` and `credits.controller.ts` are unchanged on main since the merge base, and the r5/receiving strip (`origin/wip/2026-09-21/receiving`) differs from main's controller only in whitespace, so the four gated routes are still the only readers of the queue (`managerQueue`) and the ledger; the house counter already refuses its credits register to staff in words (`house-counter.service.ts`). Three comments that said "the receiving routes carry no role gate" narrowed to the door and unverified routes. Mutation: dropping either `@Roles` or the credits `RolesGuard` turns 2–7 of the 24 spec tests and the CLAIMS row red; a no-op stays green |
