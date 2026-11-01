# 0243 — A house is named by one string, and two runs across every house are an operator's

- **Status:** Locked 2026-09-30. The founder ruled on 2026-09-29 that these verified live holes be fixed now (relayed by the lane coordinator). On 2026-09-30 he chose who may run the clock (verbatim below). The 403 status and the refusal of a production `now` were delegated to the fix lane by the brief and are recorded here as that lane's choices.
- **Date:** 2026-09-30
- **Decider:** Aldemir (founder). His pick for `clocks/run`, verbatim, 2026-09-30: *"Operator-only (Recommended)"*.
- **Keywords:** tenant isolation, assertTenantMatch, JwtAuthGuard, restaurantId array, restaurant_id object, qs, postgrest eq, TenantBypass, delivery clocks, clocks/run, runDue, now, lapse, recurring orders, execute-check, NonProductionGuard, PlatformOperatorGuard, platform operator, cross-house
- **Links:** branch `fix/tenant-guard-and-cross-house-runs`; claims `claims.d/fix-tenant-guard-and-cross-house-runs.jsonl:1-3`; [[0143-the-arrival-the-desk-the-sommelier-and-the-two-rooms]] §2 (the platform operator gate reused here); [[0103-a-delivery-is-agreed-before-it-is-verified]] D9/A10 (the clock ladder); [[0164-sessions-follow-membership-and-several-houses-choose]] (the tenant-change exemption); [[0019-p2-build-scope]] D2 (dev/test routes kept off production; `NonProductionGuard`).

## Context

In September 2026 an audit traced 817 gateway routes. It is on the branch `docs/endpoints-regenerate`, which lands with #539. Its findings are cited below by route anchor in `.planning/foundation/ENDPOINTS.md`, never by line, because generated data moves. Those anchors exist once #539 lands. The audit found three live holes. Each was re-verified on `origin/main` c47fd8a01 before it was fixed. The `file:line` citations below are that re-verification, all at c47fd8a01.

1. **The tenant guard skipped any value that was not a string.** `assertTenantMatch` (`apps/api-gateway/src/common/tenant/assert-tenant-match.ts:61-70` at c47fd8a01) kept only the non-empty string values of the top-level `restaurantId`/`restaurant_id` in params, query and body. It dropped everything else as if nothing had been named. Three facts turn that into a hole:
   - Express 4's query parser (qs) turns `?restaurantId[]=B` into `["B"]`, a repeated key into `["A","B"]`, and `?restaurant_id[x]=B` into an object.
   - The JSON and urlencoded body parsers pass arrays and objects through unchanged.
   - postgrest-js renders `.eq(col, ["B"])` as `eq.B`.

   So on a route that `JwtAuthGuard` guards and that is not marked `@Public()`, where the controller takes the house from that top-level query or body key, a member of house A could name house B, and the guard saw "no house named". Guard: `assert-tenant-match.ts:61-70`. Raw `@Query("restaurantId")` sites:
   - `analytics.controller.ts:295` (`.planning/foundation/ENDPOINTS.md#get-analytics-insight-catalog-types`, lands with #539)
   - `auth.controller.ts:454` (`.planning/foundation/ENDPOINTS.md#get-auth-me-role`, lands with #539)
   - `toast/toast.controller.ts:176`, `:234`, `:290` (`.planning/foundation/ENDPOINTS.md#get-toast-menus`, `ENDPOINTS.md#post-toast-orders`, `ENDPOINTS.md#get-toast-sales`, lands with #539)
2. **`POST /procurement/deliveries/clocks/run`** (`.planning/foundation/ENDPOINTS.md#post-procurement-deliveries-clocks-run`, lands with #539; `deliveries.controller.ts:287-300`). This route runs `DeliveryClockService.runDue` (`delivery-clock.service.ts:355`), the hourly poller, over up to 500 timers in the states `open`, `notified_half` or `escalated`, earliest due first, from every house. The read at `:366-372` has no house filter. It accepted a body `now` meaning "run the ladder as if it were that moment". Its only controller or route guard was the class-level `JwtAuthGuard`. Any signed-in member of any house, with a verified email and a chosen house, could send a date a year ahead. Each of those timers that was due before that date would fire, up to 500 per call. Where its delivery was not already settled, the delivery moves to LAPSED with the deeming text written to `lapse_deemed`, and a high-priority `delivery_lapsed` notice goes to the house (`delivery-clock.service.ts:580-598`). The only writer of `lapse_deemed` in the gateway is that lapse (`delivery-clock.service.ts:565`). A later document moves the delivery to `LAPSED_AMENDED` and leaves `lapse_deemed` as it was (`delivery.service.ts:349-352`, `:400-401`).
3. **`POST /recurring-orders/:restaurantId/execute-check`** (`.planning/foundation/ENDPOINTS.md#post-recurring-orders-restaurantid-execute-check`, lands with #539; `recurring-orders.controller.ts:154-160`). This route runs the 08:00 cron body `executeDueRecurringOrders` (`recurring-orders.service.ts:640-651`, no house filter) for every house's due schedules and ignores the path house. Its summary says "(dev/test)", but it had no environment gate and no role gate. The audit also notes, and this lane did not re-verify, that its auto-approve branch approves with no seal.

**Callers.** `git grep` over `apps/`, `services/`, `scripts/`, `.github/`, `.railway/` and both `vercel.json` files found no caller of either route. The runners that exist are the in-process `@Cron`s (`pollHourly`, `executeDueRecurringOrders`), which call the service directly, not over HTTP.

**Clients and DTOs.** A search of `apps/web/src` and `apps/mobile` found no `restaurantId`/`restaurant_id` written as an array literal. Every `restaurantId`/`restaurant_id` field in the gateway's `*.dto.ts` files is typed `string`, and no class holding one is referenced with `@Type(() => …)` anywhere in `src/`. The only array-typed uses of those classes are response DTOs inside other response DTOs.

## Options considered

### The tenant guard

1. **Refuse any present name that is not one non-empty string, with the guard's existing 403.** **Taken.**
2. **Refuse it with 400 Bad Request.** Rejected. The function throws exactly one exception, `ForbiddenException("Tenant isolation violation")`. Its three callers (`JwtAuthGuard`, `TenantGuard`, `DevTruthController`) and its own spec (`assert-tenant-match.spec.ts`) expect it. A name the guard cannot compare is a name it cannot prove is yours, which is what a mismatch is. A second status would split one refusal into two codes for clients to handle, and would refuse nothing more.
3. **Coerce the value, for example by taking the first element of an array.** Rejected. It launders `["A","B"]` into a pass, and what a controller then does with the raw array is still not something to bet on.
4. **Fix each controller: DTO validation or `user.restaurantId` everywhere.** Rejected as *this* fix. `JwtAuthGuard` runs this one function on every route it guards that is not marked `@Public()`, right after passport, over the top-level `restaurantId`/`restaurant_id` of params, query and body. So one change closes this hole on all of those routes. It does not reach the shapes listed under "What the guard does not read" below. Those, and moving controllers to `user.restaurantId`, are a separate sweep (`tech-debt.d/2026-09-30-fix-tenant-guard-and-cross-house-runs.md`).
5. **Do nothing.** A member of one house can still name another house as an array or object in a top-level `restaurantId`/`restaurant_id`, on a non-`@Public()` `JwtAuthGuard` route that takes the house from the query or the body.

### Who may run the clock

1. **Platform operators only (`PlatformOperatorGuard`: an enabled `platform_operator_grants` row AND a live `developer` role, read from the database).** **Taken, the founder's pick.**
2. **Owners or managers, running their own house only.** Rejected. The search above found no caller. A catch-up after an outage is an operations act, not a house one. `runDue` would also have to be rewritten per house for this to mean anything. Opening the route later is additive.
3. **A service-key door (`ServiceKeyGuard`) for a scheduler.** Rejected: no scheduler calls it. The hourly runner is in-process.
4. **Keep `now` in production for operators.** Rejected. A deadline fired early writes `lapse_deemed`, which a later document amends but does not clear (see Context), and no production use of `now` was found. Outside production `now` stays, for tests and demos.

### execute-check

1. **Non-production, then platform operators only (`NonProductionGuard`, then `PlatformOperatorGuard`).** **Taken**, as the brief laid down for a dev/test route with no caller found. In production the action runs for no one, and the status depends on who is asking:
   - a caller that `JwtAuthGuard` admits gets 404 from `NonProductionGuard`, operators included. Admitted means a verified email, a chosen house, and a path house equal to the session's;
   - anyone else gets `JwtAuthGuard`'s answer first, because the class guard runs before the route's: 401 for a caller not signed in, and 403 for a path naming another house, an unverified email, or a session in no house. The checks are at `jwt-auth.guard.ts:74`, `:84` and `:94`. A session in no house is refused at `:74` here, because the path names a house.

   The v5 adversarial reviewer measured these statuses with the real guards under `NODE_ENV=production` (report at df35e3259).
2. **Owners or managers, scoped to the path house.** Rejected. It would build a new product surface out of scaffolding with no caller found, and the service would need a per-house variant.

## Decision

Three rules:

- A house is named by one non-empty string or not at all. `null`, `undefined` and `""` still name nothing. Any other value in a **top-level** `restaurantId`/`restaurant_id` of params, query or body is refused with 403 "Tenant isolation violation". This holds wherever the function runs:
  - on every route `JwtAuthGuard` guards that is not marked `@Public()` (`jwt-auth.guard.ts:33-34` returns early for `@Public()`), right after passport;
  - in the global `TenantGuard` when a user is already set, except on routes marked `@Public()` or `@TenantBypass()`, where it returns early (`tenant.guard.ts:23-32`);
  - in `DevTruthController`'s direct call.

  It also holds on the tenant-change route: that exemption lets the body name *another* house, and a non-string body name there is still refused.
- `clocks/run` is for platform operators, and it refuses a body `now` with 400 in production.
- `execute-check` never runs in production. There, a caller that `JwtAuthGuard` admits gets 404, and anyone else gets `JwtAuthGuard`'s 401 or 403 first. Outside production it runs only for a platform operator that `JwtAuthGuard` admits (so naming their own house).

What carried it: `JwtAuthGuard` already sends the top-level house names of every non-`@Public()` route it guards through this one comparison, so the fix belongs there. And the two routes act on every house, which makes running them a platform act.

**What the guard does not read.** None of these is compared. The PR #537 adversarial reviewers sent the body, query and key-name shapes through real qs and the real guard (reports at 81f2f7a3d and df35e3259):
- a top-level array body, `[{"restaurantId":"B"}]`;
- nested keys: `{contact:{restaurant_id}}`, `{items:[{restaurantId}]}`, `?filter[restaurantId]=B`;
- other key names: `tenantId`, `RestaurantId`; and a house named by a generic path `:id`, found by reading the code (below);
- routes where the check does not run: `@Public()` routes (`JwtAuthGuard` returns early for them), and routes authenticated only by a machine credential, such as the `ServiceKeyGuard` route `POST /communications/text-credits/reconcile` (`communications/text/credits/text-credits.controller.ts:487-509`), where there is no user to compare against.

The reviewers' own words, from their reports:
- **Adversarial reviewer at 81f2f7a3d:** "No current controller reads those shapes" (the top-level array body, the nested keys, and `tenantId`/`RestaurantId`).
- **Adversarial reviewer at df35e3259:** a grep of the gateway (non-spec) found no reader of `restaurantID` or `restaurant-id`, no `x-restaurant*` header read, and no `@Query`/`@Body`/`@Param` DTO field that is not a string.
- **Correctness reviewer at df35e3259:** a heuristic grep of the controllers found no array-typed `@Body` and no item-map read of `restaurantId`, and the reviewer states it was not a full sweep. The same reviewer counted 27 `restaurantId`/`restaurant_id` fields in `*.dto.ts`; this lane re-counted 27, all typed `string`.

These are search results, not a guarantee.

For other key names, a reviewer found one route family: `PATCH` and `GET /organizations/locations/:id` (`organizations.controller.ts:96-121`). There the house is the path `:id`, which `organizations.service.ts:327-329` names `restaurantId`. `assertTenantMatch` never compares it. The service authorises it instead:
- the caller must have an organization (403 "User has no organization" if none: `organizations.service.ts:339-340`, `:382-383`), and the restaurant must belong to one of them (404 if not: `:349-350`, `:391-392`);
- `getLocation`, and an `updateLocation` that changes the chain, name, city, email or phone, also require an owner or manager role at that restaurant (`assertManagerOrOwner`).

The per-controller sweep is filed in `tech-debt.d/2026-09-30-fix-tenant-guard-and-cross-house-runs.md`. So is `""`: the guard treats it as "names nothing", and a controller that turns "nothing named" into "no filter" answers for every house.

**The operator registry.** ADR 0143 keeps a reviewed registry of the routes that carry `PlatformOperatorGuard`: `scripts/registries/platform-operator-routes.json`. `scripts/check_platform_operator_routes.cjs` (CI, "Gateway dependency graph resolves") fails when the routes carrying `PlatformOperatorGuard` differ from it. Both routes are added to it here, which takes it from 3 entries to 5. A repository search found no other reader of the file.

**Side effect, deliberate.** `JwtAuthGuard` does not read `@TenantBypass()` before it calls `assertTenantMatch`. The non-string refusal therefore also applies on bypass routes that `JwtAuthGuard` guards (the Studio proxy, agent operations). The client search above found no web or mobile code sending one.

## Consequences

- **Easier.** One rule, in one function, refuses array and object values in the top-level `restaurantId`/`restaurant_id` of params, query and body on every non-`@Public()` route `JwtAuthGuard` guards. It does not cover the shapes listed above. It is pinned by a unit spec and by an HTTP-level spec that runs real Express and the real `JwtAuthGuard` with passport stubbed.
- **Easier.** The two cross-house runs are no longer reachable without platform operator authority (the grant and the `developer` role), and `execute-check` not at all in production. The in-process crons are unchanged.
- **Harder.** A future client that sends a number or an array as the top-level `restaurantId`/`restaurant_id` on a non-`@Public()` `JwtAuthGuard` route gets 403. Every field of that name in the gateway's `*.dto.ts` files is typed `string` today.
- **Given up.** A house member without a platform operator grant cannot trigger a clock catch-up, and `execute-check` has no production use.
- **Not covered.** A platform operator whose session is in no house cannot run the clocks catch-up. `JwtAuthGuard` answers 403 "Choose a house first." (`jwt-auth.guard.ts:94`, `assert-house-chosen.ts:17-18`) before `PlatformOperatorGuard` runs, as the v5 adversarial reviewer measured. This fails safe: the operator chooses a house, then runs it.
- **Not changed.** The controllers named in Context still take the house from the query or the body. Moving them to `user.restaurantId`, and checking the shapes the guard does not read, is left for a separate sweep (tech-debt fragment above).
- **Revisit if** a house-facing "catch up my deadlines" action is wanted. That means a per-house `runDue` and option 2 above. Also revisit if a scheduler outside the process needs `clocks/run`: that means the service-key door, option 3.

## Evidence

The branch adds two spec files and extends a third. The counts below are the cases in each that were red on c47fd8a01 before the fix:

| Spec | Red before the fix | Green after |
|---|---|---|
| `assert-tenant-match.spec.ts` | 10 | 27 of 27 |
| `tenant-name-shape.http.spec.ts` | 9 (200 or 201 with house B echoed back) | 14 of 14 |
| `cross-house-runs.http.spec.ts` | 10 (6 clock, 4 recurring) | 14 of 14 |

Each mutation below was restored from a `cp -p` snapshot afterwards:

| Mutation | Result |
|---|---|
| Revert the guard | 19 red |
| Drop only the production `now` refusal | 1 red |
| Drop only the clock's operator guard | 5 red |
| Drop only `NonProductionGuard` | 1 red |
| Drop only `PlatformOperatorGuard` on `execute-check` | 3 red |
| Remove the `ProcurementModule` providers | `health/liveness.route.spec.ts`, which boots `AppModule`, fails with "Nest can't resolve dependencies of the PlatformOperatorGuard". This was a local, unshipped measurement: it needed a scratch jest `moduleNameMapper` stub for `@simplewebauthn/server`, which is not installed in the lane's worktree. CI's `check_gateway_boots.sh` resolves the same graph with the real module. |

Each of the three claims in the fragment was mutated against the unfixed files and fails.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-09-30 | — | Created on `fix/tenant-guard-and-cross-house-runs`. No independent adversarial review yet. |
| 2026-09-30 | Audit of PR #537 at 81f2f7a3d, round 1 (reports in the PR #537 thread) | Both reviewers APPROVE. The planner withheld HOLDS until the record was as narrow as the code. Narrowed in the next commit: "What the guard does not read" was added, the Consequences and option 4 were narrowed to the top-level keys on `JwtAuthGuard` routes, the evidence row for the boot spec now names the spec and its local stub, and the anchors are marked "lands with #539". The deferred sweep and the `""` hole are filed in `tech-debt.d/2026-09-30-fix-tenant-guard-and-cross-house-runs.md`. |
| 2026-09-30 | Audit re-plan of PR #537 at c28e90ae8, round 2 (reports in the PR #537 thread) | NOT READY: the record was still broader than the code. Fix round 2, doc and claims only: (1) the open contacts claim was withdrawn after two measured misses; (2) the organizations `locations/:id` exception was named, with what authorises it; (3) `TenantGuard`'s early return on `@Public()`/`@TenantBypass()` was stated; (4) this ADR, the fragment, the claims and the PR body were swept for "none", "no controller", "every", "cannot", "always", "never", "only" and "all", and each one that went beyond what was measured was narrowed or removed; (5) the same over-broad wording was narrowed in the code comments of `deliveries.controller.ts`, `recurring-orders.controller.ts` and `assert-tenant-match.ts`, in the headers of the three specs, and in one test title in `cross-house-runs.http.spec.ts` (comment and title text only, no behaviour change; claim 3's verify follows the new title). |
| 2026-09-30 | Audit of PR #537 at df35e3259, round 3, after the rebase onto 597f728d9 (reports in the PR #537 thread) | Correctness BLOCK (F1, F2, F3), adversarial APPROVE. The extra fix round on this PR is recorded in ADR 0231 (the sixth bracket). Round 3 is text only (no behaviour change; edits confined to comments, two test titles and the claim verify string that pins one): F1: `execute-check`'s production statuses are stated as measured, in the options, the Decision, claim 3, the controller comment and the spec title (claim 3's verify follows the title). F2: the reviewers' search results are quoted in their own words, not as "both reviewers swept". F3: the organizations check says 403 with no organization and 404 for a restaurant outside them. Also a narrowed `describe` title in `tenant-name-shape.http.spec.ts`, and the no-house operator note under Consequences. |
