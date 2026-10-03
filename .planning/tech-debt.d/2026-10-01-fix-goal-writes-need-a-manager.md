## Any member of a house could create, edit, archive and "Ask the book" about its goals, and a goal's author came from the request body — CLOSED on `fix/goal-writes-need-a-manager` — 2026-10-01

Found by the review of PR #562 on 2026-10-01 and re-measured before the fix; decided by the founder the same day ([ADR 0250](../decisions/0250-goal-writes-are-an-owners-or-a-managers.md)).

**What.**
- At `1c1a676f8`, `POST /analytics/goals/:rid`, `PATCH …/:goalId`, `PUT …/:goalId/status` and `POST …/:goalId/cutting-spec` carried only the class-level `JwtAuthGuard` (`apps/api-gateway/src/analytics/analytics.controller.ts:113`). No `@Roles` was on them, and `goals.service.ts` checks no role.
- Measured with the real controller, `JwtAuthGuard`, `JwtStrategy` and `AuthService.validateJwtPayload`: a staff token got 201, 200, 200 and 201, and every call reached `GoalsService`.
- Tenant matching held: a member of another house got 403. The gap was inside one house.
- Meanwhile the `/reports` desk told staff "the controls are theirs" (owners' and managers'), and `/help` says goals are set "by an owner or manager".
- `/recommendations` offered staff "Make this a goal" and "Set a goal →" with no role check at all.
- `createGoal` stored `created_by` from the body (`goals.service.ts:260`, no foreign key), so a caller could name anyone as a goal's author.

**Fix.**
- **Gateway.** The four routes carry `@UseGuards(RolesGuard)` and `@Roles("owner", "manager")`. This is the pattern of the insight-catalog toggle in the same controller and of the report exports. The role is the one on the caller's active access row in the token's house. Staff, and an access row that names no role, get 403 before the handler.
- **Author.** `createGoal` gets `createdBy` from `@CurrentUser()`, set after the body is spread, so a body value is overwritten.
- **Pins.** `route-access.expected.json` records the four as owner/manager.
- **Web.**
  - On `/recommendations`, both goal doors are drawn as disabled `rc-dark` buttons carrying a reason. The reason comes from `goalRoleReasonFor(activeRole)`, which reads `activeRole` alone.
  - A 403 "Forbidden resource" from these routes is shown as a sentence (`goalWriteRoleRefusal`, `useGoalsDesk.ts`) on both the desk and `/recommendations`.
- **Proof.**
  - `goal-writes-need-a-manager.spec.ts`: 32 tests, 14 of them marked [REVERT-FAILS] and red against main's controller.
  - Web tests: `RecommendationsNext.test.tsx` has 4 new tests, 3 of them red against main's sources; `useRecommendationsNextData.test.tsx` has 8 new tests, 7 of them red against main's sources.
  - CLAIMS rows `GOAL-WRITES-NEED-AN-OWNER-OR-MANAGER` and `GOAL-DOORS-DISABLED-WITH-A-REASON` (static, mutation-checked).

**Not done.**
- No browser or live-gateway run.
- The desk's own use of `goalWriteRoleRefusal` has no rendering test, because the desk's hook test is added by PR #562, which is not merged. The CLAIMS row pins its two call sites statically.

## Whether authorized personnel may write goals is not decided — OPEN — 2026-10-01

The founder's answer on 2026-10-01, verbatim: "owners and managers and authorized personnel other session will work on this, you for now decide only option 1".

- **Rule in force.** Owners and managers only ([ADR 0250](../decisions/0250-goal-writes-are-an-owners-or-a-managers.md)).
- **What is already recorded and built.**
  - [ADR 0112](../decisions/0112-one-modal-policy-three-shapes-one-primitive.md) records the term in the founder's amendment words, "owner/manager or authorized personnel (owner can give access)" (`0112-one-modal-policy-three-shapes-one-primitive.md:355`). It defines authorized personnel as a grant row with grantor, grantee, scope, limit, expiry and revoked-at (:394-395).
  - A grants register is built for one scope only: `authority_grants`, created in the `an_owner_names_who_may_send` migration (table at lines 65-94; scope CHECK `IN ('vendor_send')` at :77). It is served by `apps/api-gateway/src/organizations/authority-grants.service.ts`, whose issue DTO accepts only `vendor_send` (`authority-grants.dto.ts:28-30`).
- **The open part.** Whether that register, or anything else, admits a person to goal writes (a goal scope, its limits, who may issue it) is not decided. It is owned by another session. The goal routes do not read `authority_grants`.
- **Why here and not in OPEN-DECISIONS.md.** This PR is at the 15-file cap, so no register row was added. Filing it there, appended after the last section the way OD-180 and OD-200 were, would move no existing citation. The other session should file it there when it picks this up.
- **Where a widening lands:**
  - the four `@Roles("owner", "manager")` lines;
  - their four rows in `route-access.expected.json`;
  - `goalRoleReasonFor` (`/recommendations`);
  - `canWrite` (`useGoalsDesk.ts`).
- **Risk.** Until then, a person the founder means to admit is refused 403 and shown the reason.

## Goal reads return the target to staff, while `/ask` withholds it from them — OPEN — 2026-10-01

- **The open reads.** `GET /analytics/goals/:rid`, `GET …/progress` and `GET …/:goalId/progress` stay open to every member and return `target_value`.
- **The /ask rule.** ADR 0145 makes the `/ask` reading `goals.targets` owner/manager-only, because it is money (`0145-mudavym-answers-out-of-a-reading.md:646`, `:1420`).
- **Related.** OD-180 fork 3 records the same figures on the bell (goal-reached) and over ungated HTTP.
- **Not this lane's decision.** The `/reports` desk tells staff "You can read every figure here", so gating the reads changes what staff see on two pages. It needs the founder's call.
