# 0348 — Staff are refused the table and server takings now; the rest is withheld after #617

- **Status:** Locked. The founder ruled the scope (2026-10-30 and 2026-10-31, both quoted verbatim below). Each part marked *executor's call, not the founder's* was decided by PR #701's executor without asking, under the brief's "Do not ask me anything"; the founder can overrule any of them.
- **Date:** 2026-10-31
- **Decider:** Aldemir (founder) for the scope. PR #701's executor for the calls marked as its own.
- **Keywords:** RolesGuard, @Roles, owner, manager, staff, admin, table-performance, waiters, hot-tables, POST tables, takings, peer rank, salesGateFor, withheld, held back, readers, AnalysisSpec, activeRole, insight-prefs, venue, consultants toggle, recommendation digest, toast sales, staff_spread, peer_rank, floor phone, PR15
- **Links:** [[0162-managers-grant-manager-or-staff-on-both-doors]] (the house role is the access row's); [[0164-sessions-follow-membership-and-several-houses-choose]] (`RolesGuard` admits exactly what a route lists); [[0303-tables-learned-from-the-pos]] residual 12 (POST tables carried no role); [[0317-only-an-owner-or-manager-rules-a-day-out]] (owner and manager on an analytics write, the precedent for a delegated call); ADR 0298 decision 9, `0298-cost-of-goods-is-what-sold-and-concentration-reads-the-till.md:70` on PR #617's branch `fix/cost-and-revenue-from-the-pos` (`2c554ed5a`, not on `main`); ADR 0345 and `.planning/08-softwares/floor-checker.md` PR15 on branch `docs/floor-checker-is-a-mudavym-software` (uncommitted there on 2026-10-31); `.planning/tech-debt.d/2026-10-31-fix-analytics-money-routes-need-a-manager.md`; claim `A-TABLE-AND-SERVER-TAKINGS-NEED-A-MANAGER`; PR #701

## Context

Code cites are on PR #701's branch, `fix/analytics-money-routes-need-a-manager`, at the commit that adds this file.

At `9914f5cbf` four routes in `apps/api-gateway/src/analytics/analytics.controller.ts` carried only the class `JwtAuthGuard`, so any staff login of the house could call them:

- GET `table-performance/:restaurantId` (now `:700`): each table's revenue, average check and tip %.
- GET `waiters/:restaurantId` (now `:724`): every server's revenue, average check, tip % and peer rank, by name.
- GET `hot-tables/:restaurantId` (now `:757`): each open check's spend so far and its pace, with its table and its server's name.
- POST `tables/:restaurantId` (now `:572`): the one writer of a table (ADR 0303 residual 12).

On 2026-10-30 the founder picked, among the floor-checker features: *"Fix staff money leak now"* (`floor-checker.md:47` on the docs branch).

The first build gated 12 routes. Two reviewers blocked it. It went past the pick, and it refused whole routes where open PR #617 keeps the route and withholds the figures inside it (ADR 0298 decision 9, `salesGateFor`).

The founder then ruled on the scope, 2026-10-31: *"Your pick now, rest after #617 (Recommended)"*. The option's full text was: *"This PR closes exactly what you picked to staff: the three waiter/table reports (sales, tips, live spend) and adding a table. Staff still see the rest: cost, margin, vendor spend, the till total, and the waiter ranking inside insights and recommendations. A follow-up PR after #617 merges closes those the way #617 already does: staff keep the page but the figures are hidden. That PR must land before any waiter is invited to the floor phone."*

The CI audit of PR #701 at `ad8454425` blocked again, for three reasons:

- no ADR recorded the rulings;
- the web page still asked for the two registers and drew the gateway's 403 as a refusal;
- the claim's extractor could borrow a neighbouring route's decorators.

## Options considered

1. **Gate all 12 routes now (the first build).** It closes every staff-readable amount at once. Rejected for four reasons:
   - it went past the pick;
   - it refuses whole routes staff use for figures that are not money (the reorder point on `inventory-science`);
   - it uses a second shape for one rule (refuse the route, where #617 withholds the figure);
   - it edits the same handlers #617 edits.
2. **Gate the four picked routes now, and withhold the rest the #617 way after #617 merges** (chosen, the founder's pick). It closes the per-name and per-table takings today, and leaves one shape for the remainder.
3. **Wait for #617, then do all of it in one PR.** Rejected by the ruling's "now": every server's takings stay readable by name until #617 lands, and #617's merge date is not known.
4. **Do nothing.** A staff login reads every colleague's revenue, tips and rank by name, and the live spend at every table.

## Decision

Staff keep every page. The four routes they were reading takings through name owner and manager now. Everything else they can still read is withheld, not refused, by a follow-up after #617. That follow-up must merge before any waiter is invited to the floor phone.

1. **Four routes name owner and manager.** GET `table-performance`, `waiters` and `hot-tables`, and POST `tables`, each carry `@UseGuards(RolesGuard)` and `@Roles("owner", "manager")` on their own handler.
   - `RolesGuard` is exact (`auth/guards/roles.guard.ts:48`), so `admin` is not admitted (ADR 0164).
   - The role it reads is the access row's (ADR 0162). A token that still says manager after the house made its holder staff is refused (`analytics-money-needs-a-manager.spec.ts`, the `demoted` rows).
   - `route-access.expected.json` records the four rows.
   - Pinned end to end by that spec, and statically by the claim.
2. **Staff keep /reports, and the page does not ask for what the gateway will refuse.**
   - `AnalysisSpec.readers` (`apps/web/src/pages/reports/next/rp-spec.ts`) names the roles an endpoint's `@Roles` admits. The table register (`seats`) and the server register (`service`) set it to owner and manager (`rp-registers-house.tsx`).
   - `useReportsNextData.ts` does not run that query (`enabled: false`) for any other `activeRole`. It hands the sheet a held-back register instead, not a loading state, an error or an empty one.
   - That register says *"The table register is written for owners and managers. Nothing below is claimed."* It offers no retry and draws no chart (`rp-format.ts` `failureLine`). The export shelf already tells staff the same thing in the same words.
   - "Read it again" and the page-wide re-read do not ask for it either: TanStack skips a disabled query.
   - *Executor's call, not the founder's:* when the house role is not known yet (`activeRole` null), the register is held back too. It says the role is not known yet, rather than that it is refused. This fails closed, as `useReportExports` and `useGoalsDesk` do, and the gateway refuses an access row that names no role anyway.
   - Callers, grepped 2026-10-31 over `apps/` and `services/`:
     - `table-performance` is fetched only by `rp-registers-house.tsx`.
     - `waiters` is fetched by `rp-registers-house.tsx`, and is named as a forward target by `recommendations/next/rec-forward.ts:373`, which links to `/reports?cutting=service` and lands on the held-back register.
     - `hot-tables` and POST `tables` have no caller.
     - Mobile reads none of the four.
3. **The rest is withheld after #617, the #617 way.** The follow-up passes the caller's gate into each body that carries an amount. Staff keep the route and get the figures withheld, as `salesGateFor` does in ADR 0298 decision 9. What a staff login can still read until then (routes in `analytics.controller.ts` on this branch):
   - **One person's figures.** GET `insights` (`:410`) can return `waiter.avg_check.peer_rank`, a named server and an amount. Mobile reads the feed (`apps/mobile/src/api/queries.ts:319`). GET `recommendations` (`:1208`) carries the `staff_spread` rule (`recommendations.service.ts:758`).
   - **Amounts.** Spread across these routes:
     - GET `recommendations` (dead-stock value, purchase spend, price advice);
     - POST `goals` (`:882`, a baseline revenue, spend or average check);
     - `financial` (`:160`) and `inventory-science` (`:190`, unit cost beside the reorder point staff need);
     - `risk` (`:225`), `consult` (`:1051`) and `menu-engineering` (`:1083`);
     - `vendor-scorecard` (`:1093`), `cashflow` (`:1113`) and `wine` (`:1123`);
     - `pos-revenue` (`:1140`) and `overview` (`:1198`).

     #617 withholds only the figures ADR 0298 moved onto the till. Its open claim `A-POS-MONEY-ANALYTICS-ROUTES-ARE-A-HOLDERS` also names `basket`.
   - The follow-up pins this with a spec on a staff token, not with a grep. Once #617 puts `salesGateFor(` into these bodies, a grep would read HOLDS while `staff_spread` and `peer_rank` still reach staff.
4. **Binding precondition: the follow-up merges before any waiter is invited to the floor phone.**
   - The floor-checker build plan carries it as PR15's dependency: *"No waiter is invited to /floor/me until both have merged"* (`.planning/08-softwares/floor-checker.md:387` on `docs/floor-checker-is-a-mudavym-software`; also `:199`). "Both" means #701 and this follow-up.
   - The plan asks for a staff-token spec on each, showing that no per-name figure reaches staff.
   - Nothing in CI enforces it yet: no invite step exists to pin a claim on. The step that first lets a real house's staff reach `/floor/me` must check it.
5. **Four writes that name no role, and one read** (*executor's call, not the founder's*, built in the follow-up rather than here, because the ruling scoped this PR to the four routes in item 1):
   - PUT `insight-prefs/:restaurantId/:category` (`:536`) becomes owner and manager. It upserts `analytics_insight_prefs` on `(restaurant_id, category)` (`insights/insight-scheduler.service.ts:213`). That is a house-wide cadence, hour and on/off switch, so a staff login can switch off the house's insight categories.
   - PUT `venue/:restaurantId` (`:602`) becomes owner and manager. It upserts `restaurant_venue_profiles` (`table-analytics.service.ts:185`), house configuration the table models read.
   - PUT `consultants/:restaurantId/toggle` (`:1036`) becomes owner and manager. It turns the house's LLM consultant layer on or off (`consultants.service.ts:84`). That layer is off by default, and it costs tokens when on.
   - PUT `recommendations/:restaurantId/digest` (`:1555`) becomes owner and manager.
     - It upserts `recommendation_digest_prefs` on `restaurant_id` (`recommendation-actions.service.ts:1749`), including `recipient_email`. A staff login can send the house's digest, which carries amounts, to any address.
     - The per-person subscription (`digest/recommendation-digest.controller.ts:48`, `:59`, `:72`) stays open to every member, because it is the reader's own.
     - The follow-up also holds back the web writers of the house digest: `recommendations/next/useRecommendationsNextData.ts:693` and `settings/next/useSettingsNextData.ts:981`, which reads it at `:737`.
   - GET `/toast/sales` (`toast/toast.controller.ts:271`) is a raw till-sales read with only the class `JwtAuthGuard`. Its query `restaurantId` is tenant-matched (`common/tenant/assert-tenant-match.ts:96`), so this is a staff read inside the house, not across houses. It is withheld from staff in the follow-up, by the same gate as the other till figures. No web or mobile code calls it today.

   Why these are not refused in this PR: the ruling's text names exactly what this PR closes. Widening it was the first build's fault.
6. **`hot-tables` and the floor phone** (*executor's call, not the founder's*). It stays owner and manager.
   - The floor plan puts a live floor on the waiter's phone, and the founder's answer for what a waiter sees there is *"Nothing for now"* (`floor-checker.md:44`).
   - If a later ruling gives waiters a live watch, it gets a route that carries no amount, or a new ruling on this one. It is not reopened quietly.

## Consequences

- Staff stop reading each table's and each named server's takings, and the live spend at every table, today, without losing any page. /reports keeps every register open to them and says plainly which two are written for owners and managers.
- Until the follow-up merges, staff still read the amounts in item 3, including `peer_rank` and `staff_spread`, which name a person. Under item 4, no waiter is invited to the floor phone before then.
- Two shapes stand side by side until the follow-up: four refused routes and the rest withheld. That is the ruling's order, not a design.
- `analytics.controller.ts` reads as partly gated in `route-access.expected.json`: 8 of its 53 routes name roles. A reader of that register must not assume the four writes in item 5 were audited and left open on purpose. They are open until the follow-up.
- **Revisit when:**
  - #617 merges: start the follow-up;
  - any step proposes inviting staff to `/floor/me`: check item 4;
  - a ruling gives waiters a live floor watch: item 6;
  - a spec shows the follow-up's gate admits staff to a figure in item 3.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-10-30 | Founder | *"Fix staff money leak now"* |
| 2026-10-31 | Two reviewers of the 12-route build | BLOCK: past the pick; refused routes #617 withholds inside |
| 2026-10-31 | Founder | *"Your pick now, rest after #617 (Recommended)"*; PR #701 narrowed to the four routes |
| 2026-10-31 | ADR 0090 CI audit of PR #701 at `ad8454425` | BLOCK: no ADR; the page asked for the two registers; the claim could bind a neighbour's decorators. Security APPROVE WITH NOTES: the manager-claim/staff-row case, the test env restore, two stale `admin` comments |
| 2026-10-31 | PR #701's executor | Created Locked; client gate, demoted-token spec rows, extractor rebuilt with mutations, comments fixed |
