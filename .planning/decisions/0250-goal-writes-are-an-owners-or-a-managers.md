# 0250 — Goal writes are an owner's or a manager's, and a goal's author is the person on the token

- **Status:**
  - **Locked 2026-10-01** for the rule in force: owners and managers only, for create, edit, status and "Ask the book".
  - The founder's intended rule also admits **"authorized personnel"**. The term is already recorded: [[0112-one-modal-policy-three-shapes-one-primitive]] carries it in the founder's words (:355) and defines it as a grant row (:394-395), and a grants register is built for `vendor_send` only. **Whether and how authorized personnel reach goal writes is OPEN and owned by another session.** This record builds nothing for it (see Decision §5).
  - Scenario requests are unchanged; the founder was not asked about them (Decision §6).
- **Date:** 2026-10-01
- **Decider:** Aldemir (founder), in session 9512567d on 2026-10-01T17:08:50Z. His four answers are quoted verbatim under "The question and the answers".
- **Keywords:** goals, analytics_goals, createGoal, updateGoal, updateGoalStatus, cutting-spec, Ask the book, RolesGuard, Roles, owner, manager, staff, authorized personnel, created_by, CurrentUser, Make this a goal, Set a goal, goals desk, Forbidden resource, goal_scenario_request
- **Links:**
  - branch `fix/goal-writes-need-a-manager`;
  - claims `claims.d/fix-goal-writes-need-a-manager.jsonl:1-2`;
  - debt `tech-debt.d/2026-10-01-fix-goal-writes-need-a-manager.md`;
  - [[0164-sessions-follow-membership-and-several-houses-choose]] ("Keep managers in"; exact-match `@Roles`);
  - [[0162-managers-grant-manager-or-staff-on-both-doors]] (the role is the token's house's access row);
  - [[0120-a-goal-comes-from-a-book-a-model-comes-from-the-task]] (the scenario book and requests);
  - [[0145-mudavym-answers-out-of-a-reading]] (`goals.targets` is owner/manager on `/ask`);
  - [[0112-one-modal-policy-three-shapes-one-primitive]] (authorized personnel: the founder's words at :355, the grant row at :394-395);
  - `.planning/06-pages/reports.md` §9.8, §13.17.

## Context

The review of PR #562 on 2026-10-01 found that the goal write routes have no role gate. The finding was re-measured at `origin/main` 1c1a676f8 before anything was built.

- **The routes.** `apps/api-gateway/src/analytics/analytics.controller.ts` has one class-level guard, `@UseGuards(JwtAuthGuard)` (:113). Its only `@Roles` was the insight-catalog toggle (:350-352). These four routes had no role gate:
  - `POST goals/:restaurantId` (:782)
  - `PATCH goals/:restaurantId/:goalId` (:827)
  - `POST goals/:restaurantId/:goalId/cutting-spec` (:848)
  - `PUT goals/:restaurantId/:goalId/status` (:896)
- **The service.** `goals.service.ts` checks no role.
- **No other writers.** No other module writes `analytics_goals`, apart from the `current_value` refresh that a progress read triggers (`goals.service.ts:445-449`) and the founder-run `scripts/delete_demo_house.py`. No Python, no edge function, no mobile.
- **The database.** Measured read-only in production on 2026-10-01: row-level security is on, there are no policies, and only `service_role` holds grants. So the gateway is the only door.
- **Measured.** A Nest test ran the real controller, `JwtAuthGuard`, passport, `JwtStrategy` and `AuthService.validateJwtPayload` over a stub database, with a staff member's active access row. Create answered 201, edit 200, cutting-spec 201 and status 200, and every call reached `GoalsService`.
- **Tenant matching held.** A member of another house got 403, so the gap was inside one house.
- **The model call.** `cutting-spec` writes no goal. It reads one goal and calls the paid model (`goals.service.ts:642`), so for staff it spent the house's model budget.
- **The author.** `createGoal` stored `created_by` from the request body (`goals.service.ts:260`; the column has no foreign key). The controller passed `body: any` through, so a caller could name anyone as a goal's author.
- **What the product already says:**
  - The `/reports` goals desk tells staff "Goals are set by owners and managers. You can read every figure here; the controls are theirs." (`apps/web/src/pages/reports/next/useGoalsDesk.ts:142` at 1c1a676f8). It calls its own gate "a courtesy" (:21-23).
  - `/help` says goals "are set and edited on Reports, by an owner or manager" (`apps/web/src/pages/help/next/hp-guide.ts:97`).
  - The founder's words, 2026-09-03 (`.planning/06-pages/reports.md:540`): "the Goals section that owners/managers decide".
  - `reports.md` §13.17 filed the guard as "a decision, not a patch".
- **What the product did instead.** `/recommendations` offered staff "Make this a goal" (`Entry.tsx:895-904`) and the margin's "Set a goal →" (`GoalsMargin.tsx:115`). Both post a goal, and nothing checked a role (measured in the page's vitest harness with role `staff`).
- **No prior record.** No ADR or OD decided who may set goals.
- **Production on 2026-10-01** (read-only aggregate counts):
  - 0 goals;
  - 20 active access rows: 15 owner, 4 manager, 1 staff;
  - 0 active rows with a null role;
  - 0 owners or managers without an active row in their home house.

## The question and the answers

Asked on 2026-10-01 in session 9512567d. The text below is the questions and options exactly as asked (`AskUserQuestion`), then the answers exactly as returned.

**Q1.** "Goals, as measured at main. Any staff token can create, edit and set the status of goals: 201 or 200 on every write route, with no role gate on the gateway. The /reports desk tells staff that goals are set by owners and managers, and the help page says the same. Your 2026-09-03 words in reports.md:540 were 'the Goals section that owners/managers decide'. No ADR records a rule. Production has 0 goals. Who may create, edit and change the status of a goal?"
- "Owners and managers (Recommended)" :: "Gate create, edit and status with RolesGuard and @Roles('owner','manager'), the same as exports and the insight toggle in the same controller. The role comes from the token's active access row, the same one the web reads, so server and page agree. Staff get 403."
- "Every member" :: "Leave the routes open, and rewrite the desk and help copy and give staff controls on /reports. This contradicts your 2026-09-03 words."
- "Owners only" :: "Nothing in the code or ADRs points this way, and ADR 0164 kept managers in."

**Answer (typed by the founder, verbatim):** "owners and managers and authorized personnel other session will work on this, you for now decide only option 1"

**Q2.** "'Ask the book' (POST goals/:id/cutting-spec) changes no goal row, but it calls the paid model and spends the house's model budget. Staff can call it today, although the web hides it from them. Should it follow the same rule?"
- "Same rule as writes (Recommended)" :: "Owners and managers only, which matches what the web already shows and protects the model budget."
- "Leave it open" :: "Any member may call it, and staff calls spend the house's model budget."

**Answer:** "Same rule as writes (Recommended)"

**Q3.** "On /recommendations, staff see 'Make this a goal' and 'Set a goal →' today, and both post a goal. Once the gate is in place they would get a raw 'Forbidden resource'. What should staff see there?"
- "Disabled with a reason (Recommended)" :: "'Make this a goal' stays visible but disabled, with a short reason, using the page's existing disabled-button pattern (Entry.tsx:906-913). 'Set a goal →' is disabled the same way."
- "Hide both" :: "Staff do not see either control."

**Answer:** "Disabled with a reason (Recommended)"

**Q4.** "The builder also found that createGoal stores created_by from the request body, unchecked (goals.service.ts:260; it has no foreign key). The caller can name anyone as the goal's author. Fix it in the same PR?"
- "Take it from the token (Recommended)" :: "Record the signed-in person as created_by and ignore the body's value. About 2 files plus a spec, in the same PR."
- "Separate PR" :: "Keep this PR to the role gate and file created_by as open."

**Answer:** "Take it from the token (Recommended)"

## Options considered

1. **Who writes.**
   - (a) Owners and managers: chosen, as the rule in force today.
   - (b) Every member: rejected. It contradicts the founder's 2026-09-03 words and every sentence the product already shows.
   - (c) Owners only: rejected. Nothing points to it, and ADR 0164 kept managers in.
   - (d) Owners, managers and "authorized personnel": the founder's intended rule. Whether and how authorized personnel reach goal writes is deferred to another session, by his instruction.
2. **"Ask the book".**
   - Same rule: chosen. The web already hides the button from staff, and the route spends the model budget.
   - Leave open: rejected.
3. **The gate mechanism.**
   - **`RolesGuard` with `@Roles("owner", "manager")` per handler: chosen.**
     - It is the pattern of the sibling routes: the insight-catalog toggle in the same controller (`analytics.controller.ts:350-352`) and the report exports (`report-exports.controller.ts:55-56`).
     - It reads `req.user.role`. `JwtStrategy` sets that from the caller's active `user_restaurant_access` row in the token's house (`jwt.strategy.ts:68`; `auth.service.ts` `validateJwtPayload`). It never falls back to `users.role`.
     - That row is the same one the web's `activeRole` reads (`auth.service.ts` `getUserRoleAtRestaurant`), so the server and both pages agree.
     - It adds no database read and no module import, and `route-access.spec.ts` pins it.
     - It is also the simplest thing to widen once it is decided whether authorized personnel reach goal writes.
   - **`OrganizationsService.assertCanManageRestaurant` per handler: rejected.**
     - It would need `OrganizationsModule` imported into `AnalyticsModule` (`analytics.module.ts:36` imports only Database, Auth and Pricing).
     - It adds one or two reads per write, and nothing in `route-access.spec.ts` would see it.
     - Its `users.role` fallback is being rewritten in open PR #561.
     - At 1c1a676f8 that fallback admits an active access row with a null role, which the web shows as read-only. There are 0 such rows in production today, but server and page would disagree in principle. #561 narrows the fallback, which is one more reason not to build on it while it moves.
     - Its one advantage, a readable refusal, is met on the web instead (Decision §4).
4. **What staff see on `/recommendations`.**
   - Disabled with a reason: chosen.
   - Hide both: rejected.
   - Leave it alone: not offered, because they would read "Forbidden resource".
5. **The author.**
   - Take `created_by` from the token: chosen.
   - Separate PR: rejected.
6. **Doing nothing.** Any member keeps writing goals and spending the model budget, while three surfaces say they cannot.

## Decision

1. **Rule in force: owners and managers only.** These routes carry `@UseGuards(RolesGuard)` and `@Roles("owner", "manager")`, behind the class-level `JwtAuthGuard`:
   - `POST goals/:restaurantId` (create)
   - `PATCH goals/:restaurantId/:goalId` (edit)
   - `PUT goals/:restaurantId/:goalId/status` (status)
   - `POST goals/:restaurantId/:goalId/cutting-spec` ("Ask the book")

   `RolesGuard` is exact-match (ADR 0164). Anyone else gets 403 `{ message: "Forbidden resource" }` before the handler runs. That includes staff, an active access row that names no role (whatever `users.role` says), and the platform admin. Nothing is written and no model is called.
2. **The reads stay open to every member.** These carry no role gate:
   - `GET goals/:restaurantId`
   - `GET goals/:restaurantId/progress`
   - `GET goals/:restaurantId/:goalId/progress`

   The desk's "You can read every figure here" stays true. Whether staff should see targets is a separate, open question (debt fragment, entry 3).
3. **A goal's author is the person on the token.** `createGoal` receives the body with `createdBy` set after the spread, from `@CurrentUser()`, so a body `createdBy` is overwritten. A call with no user id records `null`. `JwtAuthGuard` admits none without one.
4. **The web.**
   - On `/recommendations`, "Make this a goal" and the margin's "Set a goal →" are drawn as disabled `rc-dark` buttons whose title is the reason. That is the existing pattern at `Entry.tsx:906-913`.
   - The margin's own sentence "The target is yours to type." is replaced by the reason.
   - The reason is `goalRoleReasonFor(activeRole)`. It reads `activeRole` alone, never the `user.role` fallback the shell uses, because the gateway does not read that.
     - Staff read: "Goals are set by owners and managers."
     - A null or any other role reads: "Your role at this restaurant is not confirmed here, so setting a goal is not offered. Ask a manager or an owner to set one."
   - If a 403 "Forbidden resource" still reaches either page (a role changed while the page was open), it is shown as "Only an owner or a manager of this house can do this, and this house does not have you as one. Nothing was changed." This is `goalWriteRoleRefusal` in `useGoalsDesk.ts`, used by the desk's write and ask paths and by `/recommendations`.
   - Any other 403 keeps its own words, because this sentence would be untrue of it.
5. **Whether authorized personnel reach goal writes is OPEN and belongs to another session.** The founder's words: "owners and managers and authorized personnel other session will work on this, you for now decide only option 1".
   - **What is already recorded and built.**
     - [[0112-one-modal-policy-three-shapes-one-primitive]] records the term in the founder's amendment words, "owner/manager or authorized personnel (owner can give access)" (`0112-one-modal-policy-three-shapes-one-primitive.md:355`).
     - The same record defines authorized personnel as "a first-class grant row — grantor, grantee, scope, limit, expiry, revoked-at" (:394-395).
     - A grants register exists for one scope only: the `authority_grants` register built in the `an_owner_names_who_may_send` migration (the table at lines 65-94; its scope CHECK at :77 is `IN ('vendor_send')`) and served by `apps/api-gateway/src/organizations/authority-grants.service.ts`, whose issue DTO accepts only `vendor_send` (`authority-grants.dto.ts:28-30`).
   - **What is open.** Whether that register, or anything else, admits a person to goal writes (a new scope, its limits, who issues it) is not decided. It is owned by another session.
   - **What this record does.** Nothing for it. The goal routes do not read `authority_grants`, and no scope is added. Until that session decides, the rule in force is item 1.
   - The places a widening lands:
     - the four `@Roles` lines;
     - their four rows in `route-access.expected.json`;
     - `goalRoleReasonFor` in `useRecommendationsNextData.ts`;
     - the desk's `canWrite` in `useGoalsDesk.ts`.
6. **Scenario requests are unchanged.** `POST goal-scenarios/requests/:restaurantId` stays a plain authenticated write for any member, with the actor read from the token. ADR 0120 made it that deliberately (`0120-a-goal-comes-from-a-book-a-model-comes-from-the-task.md:293`): a request stores words, creates no scenario, moves no money and sends nothing. The founder was not asked; this record changes nothing about it.

## Consequences

- **Easier.**
  - The desk's sentence, the help page and the gateway now say the same thing.
  - A staff member can no longer spend the model budget through "Ask the book".
  - A goal names its real author.
- **Harder.**
  - Staff lose the one goal door they had (`/recommendations`) until it is decided whether authorized personnel reach goal writes, if staff are meant to be among them.
  - A person the founder intends to admit is refused 403 and shown the reason until then.
- **Revisit when** the other session decides whether authorized personnel reach goal writes, or when someone asks for staff to set goals.

## Evidence

- **Gateway spec** `apps/api-gateway/src/analytics/goal-writes-need-a-manager.spec.ts`, run with the real `JwtAuthGuard`, `JwtStrategy` and `validateJwtPayload`, and the real `GoalsService` over the stub database:
  - staff and a no-role row get 403 on all four routes, with nothing reaching the service and no `analytics_goals` write;
  - owners and managers pass;
  - `created_by` comes from the token;
  - reads and the scenario request stay open;
  - the tenant check and 401 still hold.
- **Web tests:**
  - `RecommendationsNext.test.tsx` (disabled doors and their reasons);
  - `useRecommendationsNextData.test.tsx` (the reason from `activeRole` alone, and the 403 words).
- **Claims:** `GOAL-WRITES-NEED-AN-OWNER-OR-MANAGER` and `GOAL-DOORS-DISABLED-WITH-A-REASON`. Both are static, both are red on `origin/main`, and both were mutation-checked per behaviour.
- **Not run:** a browser session or a live gateway.

## Review trail

| Date | Who | What |
|---|---|---|
| 2026-10-01 | review of PR #562 | Found the four goal write routes ungated (`analytics.controller.ts`, class-level `JwtAuthGuard` only). |
| 2026-10-01 | lane `fix/goal-writes-need-a-manager` | Re-measured at 1c1a676f8 (staff 201/200/201/200 with the real guard stack). Found the `/recommendations` doors and `created_by` from the body. Production counts read-only. Asked the founder. |
| 2026-10-01 | founder | Answered Q1-Q4 (verbatim above). Locked the rule in force. Whether authorized personnel reach goal writes left OPEN for another session. |
| 2026-10-01 | review of PR #564, round 1 | Corrected: this record had said the meaning of "authorized personnel" was "not decided and not built". ADR 0112 records it (:355, :394-395), and an `authority_grants` register is built for `vendor_send` only. The OPEN part is narrowed to whether and how it reaches goal writes. Also corrected the `/help` citation to `hp-guide.ts:97`. |
