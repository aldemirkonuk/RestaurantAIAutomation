## House names the tenant guard does not read — OPEN — 2026-09-30

Filed by `fix/tenant-guard-and-cross-house-runs` (PR #537, [ADR 0243](../decisions/0243-a-house-is-named-by-one-string-and-cross-house-runs-are-operators-only.md)). The PR #537 adversarial reviewer measured the shapes below against real qs.

**What.** `assertTenantMatch` (`apps/api-gateway/src/common/tenant/assert-tenant-match.ts`) compares only the **top-level** `restaurantId` and `restaurant_id` of `params`, `query` and `body`. It runs in `JwtAuthGuard` right after passport, in the global `TenantGuard` when a user is already set, and in `DevTruthController`'s direct call. ADR 0243 made it refuse non-string values in those six places. It does not look at:

- **A top-level array body**, `[{"restaurantId":"B"}]`. `body.restaurantId` is undefined, so nothing is named.
- **Nested keys**, such as `{contact:{restaurant_id:"B"}}`, `{items:[{restaurantId:"B"}]}` and `?filter[restaurantId]=B` (qs gives `{filter:{restaurantId:"B"}}`).
- **Other key names**, such as `tenantId`, `RestaurantId` and `houseId`.
- **Routes that never run `JwtAuthGuard`.** These are `@Public()` routes and machine-authenticated `ServiceKeyGuard` routes, for example `POST /communications/text-credits/reconcile` (`communications/text/credits/text-credits.controller.ts:487-509`, body `restaurantId`, `X-Admin-Key`). There is no user to compare against, so the house those routes act on is only as safe as the key.

**Today.** Both PR #537 reviewers swept the controllers and found none that reads a house from those shapes. This lane also found:

- No nested request DTO class declares a `restaurantId`/`restaurant_id`.
- No controller takes the house from another key or header.

So nothing is exploitable today that we know of. The risk is the next controller that reads `dto.items[i].restaurantId`, or `@Query("tenantId")`, and trusts it.

**Fix (deferred sweep).** For each shape:

- Either refuse it at the guard (for example, walk the body for any `restaurantId`/`restaurant_id` key at any depth), or make controllers derive the house from `user.restaurantId` and never from the request.
- Add a static guard that fails CI when a controller reads a house id from a nested DTO or an unlisted key.
- For `ServiceKeyGuard` routes that take a house in the body, record in each route's comment that the key is platform authority over every house.

## An empty house name names nothing, and one unmounted route reads that as every house — OPEN — 2026-09-30

Filed by the same branch.

**What.** ADR 0243 keeps `""` (with `null` and `undefined`) as "names nothing" in `assertTenantMatch`, so `?restaurant_id=` passes the guard. That is safe only where a controller treats "nothing named" as the caller's own house. `ContactsService.findAll` (`apps/api-gateway/src/contacts/contacts.service.ts:72`) does the opposite: the house filter sits under `if (restaurantId) {`, so a missing or empty value returns every house's active contacts.

**Why it is not live.** `ContactsModule` is not imported by `AppModule`, so `GET /contacts` is not mounted today.

**Fix.** Before `ContactsModule` is mounted, make `findAll` take the house from `user.restaurantId` and filter unconditionally. Then sweep for the same `if (restaurantId)` / `if (restaurant_id)` optional-filter pattern on mounted routes.

Claim `CONTACTS-FINDALL-EMPTY-HOUSE-READS-EVERY-HOUSE` (`claims.d/fix-tenant-guard-and-cross-house-runs.jsonl:4`, status `open`) verifies once the filter is unconditional. The claims runner then fails the build until the row is flipped to `resolved`, so this entry cannot be fixed and left standing.
