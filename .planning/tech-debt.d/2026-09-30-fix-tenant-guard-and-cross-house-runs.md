## House names the tenant guard does not read — OPEN — 2026-09-30

Filed by `fix/tenant-guard-and-cross-house-runs` (PR #537, [ADR 0243](../decisions/0243-a-house-is-named-by-one-string-and-cross-house-runs-are-operators-only.md)). The PR #537 adversarial reviewers sent the body, query and key-name shapes below through real qs and the real guard (reports at 81f2f7a3d and df35e3259).

**What.** `assertTenantMatch` (`apps/api-gateway/src/common/tenant/assert-tenant-match.ts`) compares only the **top-level** `restaurantId` and `restaurant_id` of `params`, `query` and `body`. It runs in three places:

- in `JwtAuthGuard`, right after passport, on routes not marked `@Public()`;
- in the global `TenantGuard`, when a user is already set, and not at all on routes marked `@Public()` or `@TenantBypass()` (`tenant.guard.ts:23-32` returns early for both);
- in `DevTruthController`'s direct call.

ADR 0243 made it refuse non-string values under those two key names, in those three request parts. It does not look at:

- **A top-level array body**, `[{"restaurantId":"B"}]`. `body.restaurantId` is undefined, so nothing is named.
- **Nested keys**, such as `{contact:{restaurant_id:"B"}}`, `{items:[{restaurantId:"B"}]}` and `?filter[restaurantId]=B` (qs gives `{filter:{restaurantId:"B"}}`).
- **Other key names**, such as `tenantId`, `RestaurantId`, `houseId`, or a generic `:id`.
- **Routes where the check does not run.** These are `@Public()` routes (`JwtAuthGuard` returns early for them, `jwt-auth.guard.ts:33-34`) and routes authenticated only by a machine credential such as `ServiceKeyGuard`, for example `POST /communications/text-credits/reconcile` (`communications/text/credits/text-credits.controller.ts:487-509`, body `restaurantId`, `X-Admin-Key`). There is no user to compare against. On those routes the house is authorised by whatever the route itself checks (a signature, a token, the service key), not by this guard. On a `ServiceKeyGuard` route that takes a house from the body, holding the key lets the caller name any house.

**Today.** What was searched, and what was found:

- **Nested shapes, in the reviewers' own words.**
  - The adversarial reviewer at 81f2f7a3d wrote "No current controller reads those shapes" (the top-level array body, the nested keys, and `tenantId`/`RestaurantId`).
  - The adversarial reviewer at df35e3259 grepped the gateway (non-spec) and found no reader of `restaurantID` or `restaurant-id`, no `x-restaurant*` header read, and no `@Query`/`@Body`/`@Param` DTO field that is not a string.
  - The correctness reviewer at df35e3259 ran a heuristic grep of the controllers, found no array-typed `@Body` and no item-map read of `restaurantId`, and states it was not a full sweep. The same reviewer counted 27 `restaurantId`/`restaurant_id` fields in `*.dto.ts`; this lane re-counted 27, all typed `string`. [Corrected 2026-10-01, audit of PR #537 at 08a3f7f4c, round 4: 28. The one-line `@IsString() restaurantId: string;` at `auth/dto/invite.dto.ts:4` was missed; re-counted at e88593bf8, 28, all typed `string`.]

  These are search results, not a guarantee. This lane also found no class in the gateway's `*.dto.ts` files that declares a `restaurantId`/`restaurant_id` and is referenced with `@Type(() => …)` in `src/`. The only array-typed uses of such classes are response DTOs.
- **Other key names.** A reviewer found one route family that names a house by another key: `PATCH` and `GET /organizations/locations/:id` (`organizations.controller.ts:96-121`). The house is the path `:id`, which `organizations.service.ts:327-329` names `restaurantId` (line numbers in this entry are at c47fd8a01; at dc7d4f523 and e88593bf8, where the file is unchanged, `:327-329` is `:328-330`), so `assertTenantMatch` never compares it. The service authorises it instead:
  - the caller must have an organization (403 "User has no organization" if none: `organizations.service.ts:339-340`, `:382-383`; at dc7d4f523 and e88593bf8 `:340-341`, `:383-384`), and the restaurant must belong to one of them (`getUserOrgIdsWithFallback`, then `.in("organization_id", orgIds)`; 404 if not: `:349-350`, `:391-392`; at dc7d4f523 and e88593bf8 `:349-350`, `:392-393`);
  - `getLocation`, and an `updateLocation` that changes the chain, name, city, email or phone, also require an owner or manager role at that restaurant (`assertManagerOrOwner`).
- **What this lane's own grep covered.** It looked for `@Query`/`@Body`/`@Headers` keys named `houseId`, `house_id`, `rid`, `restaurant`, `tenantId`, `x-restaurant-id` or `x-tenant-id`, and for `@Param` keys named `rid`, `houseId`, `house_id`, `tenantId`, `restaurant`, `venueId` or `locationId`. The only hits were provider and storage `locationId`, which are not houses. It did not look for houses named by a generic `:id`, which is how it missed the organizations routes.

The risk is the next controller that reads `dto.items[i].restaurantId`, or `@Query("tenantId")`, or a house `:id`, and authorises it no further.

**Fix (deferred sweep).** For each shape:

- Either refuse it at the guard (for example, walk the body for any `restaurantId`/`restaurant_id` key at any depth), or make controllers derive the house from `user.restaurantId` rather than from the request (the tenant-change route excepted).
- Add a static guard that fails CI when a controller reads a house id from a nested DTO or an unlisted key.
- For `ServiceKeyGuard` routes that take a house in the body, record in each route's comment that holding the key lets the caller name any house.

## An empty house name names nothing, and one unmounted route reads that as every house — OPEN — 2026-09-30

Filed by the same branch.

**What.** ADR 0243 keeps `""` (with `null` and `undefined`) as "names nothing" in `assertTenantMatch`, so `?restaurant_id=` passes the guard. That is safe where a controller then uses the caller's own house or refuses the request. It is not safe where the controller drops the house filter. `ContactsService.findAll` (`apps/api-gateway/src/contacts/contacts.service.ts:72`) does the opposite: the house filter sits under `if (restaurantId) {`, so a missing or empty value returns every house's active contacts.

**Why it is not live.** `ContactsModule` is not imported by `AppModule`, so `GET /contacts` is not mounted today.

**Fix.** Before `ContactsModule` is mounted, make `findAll` take the house from `user.restaurantId` and filter unconditionally. Then sweep for the same `if (restaurantId)` / `if (restaurant_id)` optional-filter pattern on mounted routes.

**No executable claim.** An open claim was filed for this entry in `c28e90ae8` and withdrawn in the next commit. The PR #537 re-plan measured it getting two cases wrong:

- a real fix that renames the variable, `.eq("restaurant_id", houseId)`, left it open (exit 1);
- a pseudo-fix, `if (restaurantId?.length) {`, which still widens on `""`, flipped it (exit 0).

The text match it used could not tell a filter applied on every path from one applied under a condition. This entry is closed by hand, with a test that sends `?restaurant_id=` and asserts that only the caller's house comes back.
