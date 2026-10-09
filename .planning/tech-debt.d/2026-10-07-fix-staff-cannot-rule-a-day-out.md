## Staff could rule a day out of the insight baselines, and name anyone as its author — CLOSED on `fix/staff-cannot-rule-a-day-out` — 2026-10-07

Item 4 of M1 in the money-policy audit of 2026-10-07 (OPS-04). The audit lives in the coordinator's scratch, not in the repo. At `a323cc80b`, `POST /analytics/exclusions/:restaurantId` and `DELETE /analytics/exclusions/:restaurantId/:businessDate` carried only the class `JwtAuthGuard` (`route-access.expected.json` had both as `"open"`). So any member of the house could do either of these:

- Strike a business date out of every baseline the insight generator builds.
- Put a struck date back.

Two readers count with a struck day. (a) Every baseline the insight generator builds (`InsightGeneratorService`) leaves it out, and so every "below your usual" figure it writes moves. (b) The calendar's forecast/actual pairing (`keepPairs`, `apps/api-gateway/src/calendar/day-record.service.ts:519-526`) does not pair a struck day on its trading, so a struck day with no weather observation writes no forecast/actual row to `prediction_outcomes`. A struck day that has an observation is still written, with its trading in the row. That pairing gate was already on `main` before this fix. `/recommendations` drew the strike, "Count it again" (on the strip and the rail) and the dismissal sheet's "Also exclude" box for everyone. The write also stored `created_by` from a body `createdBy`, so a struck day could name anyone as its author.

**Who may do it. This was the coordinator's call under the founder's 2026-10-07T20:04:10Z delegation, recorded as [ADR 0317](../decisions/0317-only-an-owner-or-manager-rules-a-day-out.md) (Proposed).** His delegation, verbatim:

> "Do not ask me questions, I allow and approve for you to decide on your own. If its a decision question then research deep, find answers. While you can change decisions, you cannot change any feature we decided unless it breaks everything …" (cut; the full text is in [ADR 0317](../decisions/0317-only-an-owner-or-manager-rules-a-day-out.md))

No record names who may rule a day out:

- [ADR 0111](../decisions/0111-the-calendar-is-the-houses-day-book.md) cites the store (`:282`), which landed with it in #289 (`941d9cb40`). It lists "exclude a day from the baselines" among the acts the Ask AI "may act alone" on (`:404-406`). It names no role.
- The migration's own comment says "A day the MANAGER rules out" (`supabase/migrations/20260903091000_days_the_engine_must_not_count.sql:17`). That is a comment, not a ruling.

Three rulings on `main` bear on it:

- **Sales.** Sales are an owner's or a manager's. See the `sales` class and `ROLE_POLICY` in [ADR 0145](../decisions/0145-mudavym-answers-out-of-a-reading.md) (`:630-637`), and [ADR 0290](../decisions/0290-the-dashboard-tells-the-houses-day-true.md) §5 (`:44`), where an unknown role is a non-holder. A struck day changes every baseline the insight generator builds from sales.
- **House-wide acts.** On this page they are owner/manager only, with the platform `admin` refused. See [ADR 0191](../decisions/0191-the-recommendations-catalogue-is-actionable-not-a-read-only-leaf.md), round 2 answer 1 (`:226-229`) and round 4 answer 7 (`:645-647`).
- **Admin.** `RolesGuard` is exact, so `admin` is not admitted. See [ADR 0164](../decisions/0164-sessions-follow-membership-and-several-houses-choose.md) (`:47`).

So the audience is **owners and managers of the house**. It is enforced the way the controller already guards the catalogue toggle and the table rename: `@UseGuards(RolesGuard)` + `@Roles("owner", "manager")`. The role is the one on the caller's `user_restaurant_access` row in the token's house.

Alternatives considered and rejected:

- **Everyone, as it was.** Rejected: a staff member could move every sales figure.
- **Owner only.** Rejected: ADR 0191 and the migration both treat house-wide analysis acts as a manager's too.
- **Admit `admin`.** Rejected by ADR 0164 and ADR 0191 round 4 answer 7.

The read (`GET`) stays open. Staff still see which days are struck and why. The marker is read-only, not hidden.

**Two smaller calls, under the same delegation:**

1. **`created_by` is the signed-in caller** (`actorOf(user).userId`). It is never taken from the body. That is the rule every card act on this page already follows (ADR 0191). A body `createdBy` is now ignored. Rejected alternative: a body field that must match the token. That adds a 400 nobody needs.
2. **The page reads the house role alone.** `canRuleOutDays` reads `mayActForTheHouse(activeRole)`, never the account-wide `user.role` fallback the page's other gates use. `activeRole` is exactly the role `RolesGuard` checks, so the page fails closed while the house role is unread and never offers a control the gateway would refuse. Rejected alternative: reuse `canActRuleWide` (`activeRole ?? user?.role`). It would offer the strike to an account-wide manager whose role in this house is unread or staff, and the gateway answers that person 403.

**Fixed:**

- `apps/api-gateway/src/analytics/analytics.controller.ts`: both writes are guarded, and `created_by` comes from the token.
- `route-access.expected.json`: both rows are `["owner","manager"]`.
- `/recommendations` gates the strip's strike and "Count it again", the rail's "Count it again" and the sheet's "Also exclude" on `canRuleOutDays`. Staff see the struck day, its reason, and a line saying the act is an owner's or manager's.
- A box ticked while the page still read a manager carries no `excludeDate` once it no longer does.

**Pinned:**

- `apps/api-gateway/src/analytics/day-exclusions-need-a-manager.spec.ts`: 13 tests over the real `JwtAuthGuard`, `JwtStrategy`, `AuthService` and `DayExclusionsService` on the stub database.
- `RecommendationsNext.test.tsx`: 7 cases, each run with staff and with a manager on the same fixture.
- `rule-a-day-out.test.tsx`: 8 cases.
- CLAIMS rows `SEC-2026-10-07-DAY-EXCLUSIONS-OWNER-MANAGER-GATEWAY` and `-WEB` in `claims.d/fix-staff-cannot-rule-a-day-out.jsonl`.

## The day strip and `GET /analytics/pos-revenue` show staff the day's till revenue — OPEN — 2026-10-07

Found while closing OPS-04 above, and left alone because it is outside OPS-04's scope. The day head on `/recommendations` prints `$<revenue> through the till` for whoever opens a day (`apps/web/src/pages/recommendations/next/Ribbon.tsx:211`). The figure comes from `GET /analytics/pos-revenue/:restaurantId` (`apps/api-gateway/src/analytics/analytics.controller.ts:1058`), which is `"open"` in `route-access.expected.json:46`. Revenue is ADR 0145's `sales` class, and ADR 0290 §5 withholds it from anyone but an owner or manager. So staff read a figure the money rule withholds from them.

**Fix (belongs to the money-policy audit's M2, which puts the rule on `main` with one shared holder check):**

- The gateway omits the revenue keys for a non-holder and marks the payload `amountsWithheld: true`.
- The strip draws no revenue line for them.

