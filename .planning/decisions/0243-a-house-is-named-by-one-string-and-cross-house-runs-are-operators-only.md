# 0243 — A house is named by one string, and a run across every house is an operator's

- **Status:** Locked 2026-09-30. The founder ruled on 2026-09-29 that these verified live holes be fixed now (relayed by the lane coordinator). On 2026-09-30 he chose who may run the clock (verbatim below). The 403 status and the refusal of a production `now` were delegated to the fix lane by the brief and are recorded here as that lane's choices.
- **Date:** 2026-09-30
- **Decider:** Aldemir (founder). His pick for `clocks/run`, verbatim, 2026-09-30: *"Operator-only (Recommended)"*.
- **Keywords:** tenant isolation, assertTenantMatch, JwtAuthGuard, restaurantId array, restaurant_id object, qs, postgrest eq, TenantBypass, delivery clocks, clocks/run, runDue, now, lapse, recurring orders, execute-check, NonProductionGuard, PlatformOperatorGuard, platform operator, cross-house
- **Links:** branch `fix/tenant-guard-and-cross-house-runs`; claims `claims.d/fix-tenant-guard-and-cross-house-runs.jsonl:1-3`; [[0143-the-arrival-the-desk-the-sommelier-and-the-two-rooms]] §2 (the platform operator gate reused here); [[0103-a-delivery-is-agreed-before-it-is-verified]] D9/A10 (the clock ladder); [[0164-sessions-follow-membership-and-several-houses-choose]] (the tenant-change exemption); [[0019-p2-build-scope]] D2 (dev/test routes kept off production; `NonProductionGuard`).

## Context

In September 2026 an audit traced all 817 gateway routes. It is on the branch `docs/endpoints-regenerate` (to land), and its findings are cited below by route anchor in `.planning/foundation/ENDPOINTS.md`, never by line: generated data moves. The audit found three live holes. Each was re-verified on `origin/main` c47fd8a01 before it was fixed. The `file:line` citations below are that re-verification, all at c47fd8a01.

1. **The tenant guard skipped any value that was not a string.** `assertTenantMatch` (`apps/api-gateway/src/common/tenant/assert-tenant-match.ts:61-70` at c47fd8a01) kept only the string values of `restaurantId`/`restaurant_id` in params, query and body. It dropped everything else as if nothing had been named. Three facts turn that into a hole:
   - Express 4's query parser (qs) turns `?restaurantId[]=B` into `["B"]`, a repeated key into `["A","B"]`, and `?restaurant_id[x]=B` into an object.
   - The JSON and urlencoded body parsers pass arrays and objects through unchanged.
   - postgrest-js renders `.eq(col, ["B"])` as `eq.B`.

   So a member of house A could read house B wherever a controller takes the house from the query or the body, and the guard saw "no house named". Guard: `assert-tenant-match.ts:61-70`. Raw `@Query("restaurantId")` sites:
   - `analytics.controller.ts:295` (`.planning/foundation/ENDPOINTS.md#get-analytics-insight-catalog-types`)
   - `auth.controller.ts:454` (`.planning/foundation/ENDPOINTS.md#get-auth-me-role`)
   - `toast/toast.controller.ts:176`, `:234`, `:290` (`.planning/foundation/ENDPOINTS.md#get-toast-menus`, `ENDPOINTS.md#post-toast-orders`, `ENDPOINTS.md#get-toast-sales`)
2. **`POST /procurement/deliveries/clocks/run`** (`.planning/foundation/ENDPOINTS.md#post-procurement-deliveries-clocks-run`; `deliveries.controller.ts:287-300`). This route runs `DeliveryClockService.runDue` (`delivery-clock.service.ts:355`), the hourly poller, over the 500 earliest open `delivery_timers` of every house. The read at `:366-372` has no house filter. It accepted a body `now` meaning "run the ladder as if it were that moment", and the class-level `JwtAuthGuard` was its only guard. Any verified member of any house could send a date a year ahead. Every house's open timers would lapse: the delivery moves to LAPSED with the legal deeming text written on it, and high-priority notices and pushes go out. That text cannot be taken back.
3. **`POST /recurring-orders/:restaurantId/execute-check`** (`.planning/foundation/ENDPOINTS.md#post-recurring-orders-restaurantid-execute-check`; `recurring-orders.controller.ts:154-160`). This route runs the 08:00 cron body `executeDueRecurringOrders` (`recurring-orders.service.ts:640-651`, no house filter) for every house's due schedules and ignores the path house. Its summary says "(dev/test)", but it had no environment gate and no role gate. The audit also notes, and this lane did not re-verify, that its auto-approve branch approves with no seal.

**Callers.** `git grep` over `apps/`, `services/`, `scripts/`, `.github/`, `.railway/` and both `vercel.json` files finds none for either route. The real runners are the in-process `@Cron`s (`pollHourly`, `executeDueRecurringOrders`), which never cross HTTP. No web or mobile code sends a house id as an array, and every request DTO types it as a `string`.

## Options considered

### The tenant guard

1. **Refuse any present name that is not one non-empty string, with the guard's existing 403.** **Taken.**
2. **Refuse it with 400 Bad Request.** Rejected. The function throws exactly one exception, `ForbiddenException("Tenant isolation violation")`. All three callers (`JwtAuthGuard`, `TenantGuard`, `DevTruthController`) and every existing test expect it. A name the guard cannot compare is a name it cannot prove is yours, which is what a mismatch is. A second status would split one refusal into two codes for clients to handle, and nothing is gained.
3. **Coerce the value, for example by taking the first element of an array.** Rejected. It launders `["A","B"]` into a pass, and what a controller then does with the raw array is still not something to bet on.
4. **Fix each controller: DTO validation or `user.restaurantId` everywhere.** Rejected as the fix. The guard is the one place every authenticated route passes through. A sweep of the call sites is still defence in depth, but it is a separate operation.
5. **Do nothing.** Cross-house reads stay open on every route that takes the house from the query or the body.

### Who may run the clock

1. **Platform operators only (`PlatformOperatorGuard`: an enabled `platform_operator_grants` row AND a live `developer` role, read from the database).** **Taken, the founder's pick.**
2. **Owners or managers, running their own house only.** Rejected. Nothing calls the route today. A catch-up after an outage is an operations act, not a house one. `runDue` would also have to be rewritten per house for this to mean anything. Opening the route later is additive.
3. **A service-key door (`ServiceKeyGuard`) for a scheduler.** Rejected: no scheduler calls it. The hourly runner is in-process.
4. **Keep `now` in production for operators.** Rejected. A deadline that passes early writes legal text that cannot be taken back, and nothing in production needs to time-travel. Outside production `now` stays, for tests and demos.

### execute-check

1. **Non-production, then platform operators only (`NonProductionGuard`, then `PlatformOperatorGuard`).** **Taken**, as the brief laid down for a dev/test route with no caller. Production answers 404 to everyone, so it does not confirm the route exists.
2. **Owners or managers, scoped to the path house.** Rejected. It would build a new product surface out of scaffolding that nothing calls, and the service would need a per-house variant.

## Decision

Three rules:

- A house is named by one non-empty string or not at all. `null`, `undefined` and `""` still name nothing. Any other value in `restaurantId`/`restaurant_id` (params, query or body) is refused with 403 "Tenant isolation violation". That includes on the tenant-change route: its exemption covers naming *another* house, never a malformed one.
- `clocks/run` is for platform operators, and it refuses a body `now` with 400 in production.
- `execute-check` answers 404 in production and admits only platform operators elsewhere.

What carried it: the guard is the single choke point, and the two routes act on every house, which makes running them a platform act.

**Side effect, deliberate.** `JwtAuthGuard` does not read `@TenantBypass()` before it calls `assertTenantMatch`. The non-string refusal therefore also applies on bypass routes (the Studio proxy, agent operations). No client sends such a value there.

## Consequences

- **Easier.** One rule, in one function, closes the whole class of array and object house names. It is pinned by a unit spec and by an HTTP-level spec that runs real Express and the real `JwtAuthGuard`.
- **Easier.** The two cross-house runs are no longer reachable by house members, and the in-process crons are unchanged.
- **Harder.** A future client that sends a house id as a number or an array gets 403. Every DTO types it as a string today.
- **Given up.** No house can trigger its own clock catch-up, and `execute-check` has no production use.
- **Not changed.** Controllers that take the house from the query or the body still rely on the guard alone. Moving them to `user.restaurantId` is defence in depth, left for a separate sweep.
- **Revisit if** a house-facing "catch up my deadlines" action is wanted. That means a per-house `runDue` and option 2 above. Also revisit if a scheduler outside the process needs `clocks/run`: that means the service-key door, option 3.

## Evidence

The branch adds three spec files, and every spec below was red on c47fd8a01 before the fix:

| Spec | Red before the fix | Green after |
|---|---|---|
| `assert-tenant-match.spec.ts` | 10 | all |
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
| Remove the `ProcurementModule` providers | the full-app boot spec fails |

Each claim in the fragment was mutated against the unfixed files and fails.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-09-30 | — | Created on `fix/tenant-guard-and-cross-house-runs`. No independent adversarial review yet; the PR audit gate is where that happens. |
