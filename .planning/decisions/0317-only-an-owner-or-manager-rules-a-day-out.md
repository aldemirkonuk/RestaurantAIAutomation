# 0317 — Only an owner or manager of the house rules a day out of the analysis

- **Status:** Proposed. Decided by the coordinator under the founder's 2026-10-07T20:04:10Z delegation, quoted verbatim below. This is the coordinator's call, not the founder's pick. The founder can overrule any part of it. A lock is his.
- **Date:** 2026-10-08
- **Decider:** the coordinator, under the delegation below. Built by lane dayexclude on `fix/staff-cannot-rule-a-day-out` (PR #660).
- **Keywords:** analytics_day_exclusions, exclude a day, rule a day out, count it again, excludeDay, includeDay, DayExclusionsService, RolesGuard, owner, manager, admin, created_by, canRuleOutDays, mayActForTheHouse, activeRole, keepPairs, prediction_outcomes, OPS-04
- **Links:** [[0111-the-calendar-is-the-houses-day-book]] (the store; the Ask AI's "may act alone" list); [[0145-mudavym-answers-out-of-a-reading]] (the `sales` class); [[0164-sessions-follow-membership-and-several-houses-choose]] (`RolesGuard` is exact); [[0191-the-recommendations-catalogue-is-actionable-not-a-read-only-leaf]] (house-wide acts; admin refused); [[0290-the-dashboard-tells-the-houses-day-true]] §5; [[0306-who-takes-an-entry-is-anyone-on-this-houses-roster]] (the precedent for recording a delegated call); `.planning/tech-debt.d/2026-10-07-fix-staff-cannot-rule-a-day-out.md`; PR #660 and its `claims.d/fix-staff-cannot-rule-a-day-out.jsonl`; the ADR 0090 audit report `p4-scratch/sim-run/fixes/audits/660-332a0efea/report.md` (outside the repo)

## Context

ADR cites are at `origin/main` `b957097d6`. Code cites are on PR #660's branch unless marked.

On `main`, `POST /analytics/exclusions/:restaurantId` and `DELETE /analytics/exclusions/:restaurantId/:businessDate` carry only the class `JwtAuthGuard`, and `route-access.expected.json` pins both as `"open"` (`:56-57` on main). So any member of a house, staff included, can strike a business date out of the analysis or put one back. The write also takes `created_by` from a body `createdBy`. The 2026-10-07 money-policy audit filed this as OPS-04.

### What a struck day changes

Two readers count with a struck day. A git grep of `analytics_day_exclusions`, `DayExclusionsService`, `excludedDates` and `.excluded` outside tests finds no third.

- **(a) The insight generator's baselines.** `InsightGeneratorService` loads the store (`apps/api-gateway/src/analytics/insights/insight-generator.service.ts:738`) and leaves the struck dates out of the baselines it builds (`:877`, read at `:971`, `:1158`, `:1338`), so the "below your usual" figures it writes move.
- **(b) The calendar's forecast/actual pairing.** `keepPairs` (`apps/api-gateway/src/calendar/day-record.service.ts:519-526`, the same code at `:523` on main) does not pair a struck day on its trading. A struck day with no weather observation therefore writes no forecast/actual row to `prediction_outcomes`, a table `services/self-evolution` also writes. A struck day that has an observation is still written, with its trading in the row.

The calendar also draws the day as "Ruled out of the baselines" (`day-record.service.ts:304-307`), and `/recommendations` draws the strike. Those only display it.

### The delegation (verbatim)

The founder, 2026-10-07T20:04:10Z: *"Do not ask me questions, I allow and approve for you to decide on your own. If its a decision question then research deep, find answers. While you can change decisions, you cannot change any feature we decided unless it breaks everything then only you can, but before that you should research."*

### What is already decided

- **No record names who may rule a day out.** ADR 0111 cites the store (`0111-the-calendar-is-the-houses-day-book.md:282`) and lists "exclude a day from the baselines" among the acts the Ask AI "may act alone" on (`:404-406`). It names no role. The migration's comment says "A day the MANAGER rules out" (`supabase/migrations/20260903091000_days_the_engine_must_not_count.sql:17`). That is a comment, not a ruling.
- **Sales are an owner's or a manager's.** ADR 0145's `sales` class and `ROLE_POLICY` (`0145-mudavym-answers-out-of-a-reading.md:630-637`) and ADR 0290 §5 (`0290-the-dashboard-tells-the-houses-day-true.md:44`). A struck day changes the baselines the insight generator builds from sales.
- **House-wide acts on `/recommendations` are owner/manager only.** ADR 0191 round 2 answer 1 (`0191-the-recommendations-catalogue-is-actionable-not-a-read-only-leaf.md:226-229`).
- **The platform `admin` never acts for a house's cards** unless that person is also an owner or manager of that house. ADR 0191 round 4 answer 7 (`:645-647`).
- **`RolesGuard` is exact,** and `admin` is no longer widened to. ADR 0164 (`0164-sessions-follow-membership-and-several-houses-choose.md:47`).
- ADR 0145's *"`admin` reads the owner row"* (`:630-637`) is a rule for what a Reading shows. It does not apply to this write. ADR 0164 `:47` and ADR 0191 round 4 answer 7 (`:645-647`) govern who may act.

## Options considered

1. **Owners and managers of the house, `admin` refused (chosen).** Both writes carry `@UseGuards(RolesGuard)` + `@Roles("owner", "manager")`, the pattern the same controller already uses for the catalogue toggle and the table rename. The role is the one on the caller's `user_restaurant_access` row in the token's house. It matches the `sales` class, ADR 0191's house-wide acts and the migration's comment. Cost: a staff member who sees a closure cannot strike it. They see the struck days and a line saying the act is an owner's or manager's.
2. **Admit `admin`, as `RolesGuard` once widened `owner` to. Rejected.** ADR 0164 made `RolesGuard` exact, and ADR 0191 round 4 answer 7 refuses the platform `admin` on this page's house-wide acts. ADR 0145's "admin reads the owner row" governs what a Reading shows, not who acts.
3. **Any role in the house, as on `main`. Rejected.** A staff member could move every baseline the insight generator builds from sales, and keep a day out of the calendar's pairing, which is OPS-04 itself.
4. **Owner only. Rejected.** ADR 0191 round 2 answer 1 and the migration's comment treat house-wide analysis acts as a manager's too.
5. **A holder-of-money policy (whoever `ROLE_POLICY` lets see `sales`). Rejected for now.** Today it admits the same owner and manager, plus `admin` through the owner row, which option 2 rejects. It would also tie a write to a read policy whose job is what a Reading shows. The audit's M2 is to put one shared holder check on `main`. If that check lands, this rule can be restated through it, as long as `admin` stays refused.

Two smaller calls, under the same delegation:

- **`created_by` is the signed-in caller** (`actorOf(user).userId`, `apps/api-gateway/src/analytics/analytics.controller.ts:1425`). A body `createdBy` is ignored. That is the rule every card act on this page already follows (ADR 0191). Rejected: a body field that must match the token. It adds a 400 that nobody needs.
- **The page reads the house role alone.** `canRuleOutDays = mayActForTheHouse(activeRole)` (`apps/web/src/pages/recommendations/next/useRecommendationsNextData.ts:741`). It never falls back to the account-wide `user.role`. `activeRole` is the role `RolesGuard` checks, so the page fails closed while the house role is unread, and it does not offer a control the gateway would refuse. Rejected: reuse `canActRuleWide` (`activeRole ?? user?.role`). It would offer the strike to an account-wide manager whose role in this house is unread or staff, and the gateway answers that person 403.

## Decision

**Ruling a day out and counting it again are acts of an owner or a manager of the house. The platform `admin` is refused. The read stays open.**

What carried it:
- A struck day changes sales-derived baselines and the calendar's forecast/actual pairing, and sales are an owner's or a manager's (ADR 0145, ADR 0290 §5).
- It is a house-wide act on `/recommendations`, which ADR 0191 gives to owners and managers and refuses to `admin`.
- The guard is the one the controller already uses, so nothing new is built to enforce it.

**As built on PR #660:** both writes are guarded (`analytics.controller.ts:1403-1405`, `:1435-1437`), `route-access.expected.json` pins both as `["owner","manager"]` (`:56-63`), and `GET` stays `"open"` (`:55`).

## Consequences

- **Easier:** the page and the gateway admit the same people. The role rule sits in one place, beside the other owner/manager acts in the controller.
- **Given up:** staff cannot strike a day. They can still see which days are struck and why.
- **Owed when the Ask AI gains it:** ADR 0111 lets the Ask AI "exclude a day from the baselines" alone (`:404-406`). Today its allowlist has only `procurement.reorder` and `communications.vendor_draft` (ADR 0111 `:397-398`), so no AI path writes an exclusion yet. When the `calendar` family is built, that act must pass the same owner/manager check on the person who asked.
- **Not covered:** the day strip and `GET /analytics/pos-revenue` still show staff the day's till revenue. That is filed OPEN in the same tech-debt fragment for the audit's M2.
- **Revisit when:** M2 puts one shared money-holder check on `main` (option 5), or a role between staff and manager is added to the house.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-10-07 | The coordinator, under the delegation | Rule decided and built on PR #660; recorded only in `tech-debt.d` |
| 2026-10-08 | ADR 0090 audit of PR #660 at `332a0efea` (`p4-scratch/sim-run/fixes/audits/660-332a0efea/report.md`, outside the repo) | BLOCK: the rule needed an ADR (CLAUDE.md §0.1-0.2, with ADR 0306 as precedent), and the record understated what a struck day changes |
| 2026-10-08 | The coordinator, under the delegation | Created as Proposed; named both readers; fixed the ADR 0111 cite to `:404-406` |
