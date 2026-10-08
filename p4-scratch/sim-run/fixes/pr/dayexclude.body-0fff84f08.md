TITLE: fix: only owners and managers rule a day out of the analysis

> **[2026-10-07 23:47Z, coordinator] Head `0fff84f08`.** Merged origin/main `b30ca260e`, which brought no conflict. Since `e5de5b7da`, commit `65d9bdead` fixes the verifier's should: the copy and comments said a struck day moves "every average the house reads". Only `InsightGeneratorService` counts with the exclusion store. The calendar only draws a struck day, and dashboard and report averages never read the store. The withheld-act lines now say the act "changes the usual days every recommendation is measured against", and the comments, the route summary, the spec header and the fragment name the insight generator. It also fixes the nit: ADR 0111 cites the store, which landed with it in #289. Evidence at this head:
> - Gateway `day-exclusions-need-a-manager.spec.ts`: **13 passed**.
> - Web `vitest src/pages/recommendations/next`: **18 files, 344 passed**.
> - Gateway and web `tsc --noEmit`: clean apart from the `@simplewebauthn` modules.
> - Gateway eslint: clean.
> - `lanecheck.sh`: six guards 0, files=12, ownership `[]`.
> - Decision claims: **939/939**.
>
> **Not run:** web eslint locally (`eslint-plugin-jsx-a11y` is absent from the shared `node_modules`); CI runs it. The older on-main lines elsewhere on the page ("every baseline, on this page and everywhere else", "every average below") predate this PR and were left as they are. Not audited yet.

## What was wrong for a real house

Any signed-in member of a house, staff included, could rule a business date out of every baseline the insight generator builds, or put one back. At Tuzlu that means a waiter could strike a slow Tuesday and every "below your usual" sentence the recommendations write would move. Or they could count a closure again and drag those baselines down.

- `POST /analytics/exclusions/:restaurantId` and `DELETE /analytics/exclusions/:restaurantId/:businessDate` carried only the class `JwtAuthGuard`. `route-access.expected.json` pinned both as `"open"`.
- `/recommendations` drew three controls for everyone: the strip's "Rule this day out of the analysis" with its "Count it again", the rail's "Count it again", and the dismissal sheet's "Also exclude this day".
- The write stored `created_by` from a body `createdBy`, so a struck day could name anyone as its author.

This is OPS-04, item 4 of M1 in the 2026-10-07 money-policy audit. M1 holds the leaks of rules already decided.

## What changed, and why

**Who: owners and managers of the house.** No record names who may rule a day out:

- ADR 0111 cites the store, which landed with it in #289 (`.planning/decisions/0111-the-calendar-is-the-houses-day-book.md:282`). It lists "exclude a day from the baselines" among the Ask AI's may-act-alone acts (`:398`) and names no role.
- The migration comment says "A day the MANAGER rules out" (`supabase/migrations/20260903091000_days_the_engine_must_not_count.sql:17`).

So the audience is the **coordinator's call under the founder's 2026-10-07T20:04:10Z delegation**. It is recorded with his words in `.planning/tech-debt.d/2026-10-07-fix-staff-cannot-rule-a-day-out.md` (ADR 0240). No new ADR. It rests on rulings already on `main`:

- **Sales are an owner's or a manager's.** See ADR 0145's `sales` class and `ROLE_POLICY` (`.planning/decisions/0145-mudavym-answers-out-of-a-reading.md:630-637`) and ADR 0290 §5 (`.planning/decisions/0290-the-dashboard-tells-the-houses-day-true.md:44`). A struck day changes every baseline the insight generator builds from sales.
- **House-wide acts on this page are owner/manager only.** See ADR 0191 round 2 answer 1 (`.planning/decisions/0191-the-recommendations-catalogue-is-actionable-not-a-read-only-leaf.md:226-229`). Round 4 answer 7 refuses the platform `admin` (`:645-647`).
- **`RolesGuard` is exact.** See ADR 0164 (`.planning/decisions/0164-sessions-follow-membership-and-several-houses-choose.md:47`).

**Gateway** (`apps/api-gateway/src/analytics/analytics.controller.ts`)

- Both writes carry `@UseGuards(RolesGuard)` + `@Roles("owner", "manager")`. This is the pattern the catalogue toggle and the table rename in the same controller already use. The role is the one on the caller's access row in the token's house, and admin is refused.
- `route-access.expected.json` moves both rows to `["owner","manager"]`.
- `GET` stays open, so staff still see which days are struck.
- `created_by` is now `actorOf(user).userId`, and a body `createdBy` is ignored. This is a second, smaller coordinator's call, following ADR 0191's rule that the actor is the token.

**Web** (`apps/web/src/pages/recommendations/next/`)

- The hook exposes `canRuleOutDays = mayActForTheHouse(activeRole)`. It reads the house role alone, not the `activeRole ?? user.role` fallback `canActRuleWide` uses. `activeRole` is exactly what `RolesGuard` reads, so the page fails closed while the role is unread and never offers a control the gateway would answer with a 403. Same choice as #564.
- The strip's strike and "Count it again", the rail's "Count it again" and the sheet's "Also exclude" box are all gated on it.
- Staff see the struck day and its reason, read-only, with one line: "Only an owner or manager can count it again." or "Ruling a day out of the analysis is for an owner or manager — it changes the usual days every recommendation is measured against."
- A box ticked while the page still read a manager carries no `excludeDate` once it no longer does. The sheet's own reset does not run when only this flag moves.

## Evidence

- **Gateway, new spec** `day-exclusions-need-a-manager.spec.ts`: 13 tests. They run over a real Nest app on a port with a signed JWT, and the real `JwtAuthGuard`, `JwtStrategy`, `AuthService` and `DayExclusionsService` on the stub db.
  - Staff, an access row with no role (whose `users.role` says manager), and another house's owner get 403 with nothing written.
  - Owner and manager write.
  - Staff and manager `GET` the same list.
  - A body `createdBy` is ignored.
- **Gateway, whole run** `env LC_ALL=C npx jest src/analytics src/auth/guards/route-access.spec.ts`: 58 suites, 889 tests, all pass.
- **Web, page spec** `RecommendationsNext.test.tsx`: 7 new cases, each run as staff and as a manager on one fixture.
- **Web, hook spec** `rule-a-day-out.test.tsx`: 8 cases.
  - Owner and manager may.
  - Staff, admin, an unknown role and an unread role may not.
  - An account-wide manager with no house role read may not.
  - Staff still load the list.
- **Web, whole run** `vitest run src/pages/recommendations`: 18 files, 344 tests, all pass.
- **tsc**: `apps/web` and `apps/api-gateway` (`tsconfig.spec.json`) show only the known `@simplewebauthn` module errors.
- **Mutations.** Each gate was reverted alone, the run went red, and the file was restored byte-identical from a `cp -p` snapshot (cmp):
  - Gateway:
    - Remove the POST guard: 2 red.
    - Remove the DELETE guard: 2 red.
    - Take `created_by` from the body again: 1 red.
  - Web:
    - Hook always true: 5 red.
    - Hook with the `user.role` fallback: 1 red.
    - Ribbon "Count it again" ungated: 1 red.
    - Ribbon strike ungated: 1 red.
    - Rail "Count it again" ungated: 1 red.
    - Sheet box ungated: 1 red.
    - `excludeDate` ignoring `canExclude`: 1 red.
    - `canExclude` ignoring the role: 1 red.
    - Ribbon handed `true`: 2 red.
- **CLAIMS.** Two rows are in `.planning/decisions/claims.d/fix-staff-cannot-rule-a-day-out.jsonl`: `SEC-2026-10-07-DAY-EXCLUSIONS-OWNER-MANAGER-GATEWAY` and `-WEB`. Both are status `resolved` and use static python checks. 13 mutations each gave exit 1, and both were restored byte-identical.
- **`lanecheck.sh wt-fix-dayexclude`**: exit 0, 12 files vs `origin/main`. It merges clean with `origin/main` 214779a76.

## Overlap with open PRs

- **#564 `fix/goal-writes-need-a-manager`.** It touches `analytics.controller.ts`, `route-access.expected.json`, `Entry.tsx`, `RecommendationsNext.tsx`, `RecommendationsNext.test.tsx`, `rec-scenario-picker.test.tsx` and `useRecommendationsNextData.ts`. The hunks sit in other regions, and `git merge-tree` against its head eadb562df is clean.
- **#611 `fix/recommendations-file-by-what-changes`.** It touches `Entry.tsx`, `RecommendationsNext.tsx`, `RecommendationsNext.test.tsx` and `useRecommendationsNextData.ts`. Merge-tree against 5608cb36a is clean.
- **#616 `fix/sales-belong-to-the-house-day`** and **#625 `fix/hidden-tables-leave-insights`.** Both touch `analytics.controller.ts`. Each already conflicts with `origin/main` itself: #616 in `analytics.service.ts`/`goals.service.ts`, #625 at the controller's table-rename hunk (around :626) and in planning files. This branch adds no conflict of its own; the same regions conflict with or without it.
- **#579 `fix/review-dashboard`** (paused) is not touched.

## What is not covered

- **Staff still see the day's till revenue.** The day head prints `$<revenue> through the till` to anyone (`Ribbon.tsx:211`), from `GET /analytics/pos-revenue/:restaurantId`, which is `"open"` (`route-access.expected.json:46`). That is a `sales`-class leak outside OPS-04. It is filed OPEN in the same tech-debt fragment for the audit's M2.
- **No Browser-pane run.** The page was verified by component tests only.
- **The Ask AI path was not touched.** ADR 0111 lists "exclude a day" among its may-act-alone acts. A grep across `apps`, `services` and `packages` found no other writer of `analytics_day_exclusions` than `DayExclusionsService`. `calendar/recorded-days.service.ts` only reads it, and `exclude`/`include` are called only from these two routes. When the Ask AI gains that act, it must check the same role.
- `scripts/check_decision_claims.sh` was not run (the coordinator runs it). Nothing was pushed and no PR was opened.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
