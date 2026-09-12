import { ForbiddenException } from "@nestjs/common";

/**
 * The tenant-isolation comparison, extracted so it can run WHERE THE USER
 * EXISTS.
 *
 * Why this file exists (found 2026-08-26): `TenantGuard` is registered as an
 * `APP_GUARD` (`app.module.ts:129`), and `JwtAuthGuard` is not — it is applied
 * per controller with `@UseGuards`. Nest runs guards global → controller →
 * route, so the global TenantGuard executed BEFORE passport had populated
 * `request.user`. Its first branch reads `if (!user) return true`, so on every
 * authenticated route it saw no user and waved the request through.
 *
 * The consequence: tenant isolation was not enforced anywhere. The guard read
 * like a working check, had a real comparison in it, and could never reach it.
 * A fix applied to that comparison on 2026-08-25 was inert for the same reason.
 *
 * So the comparison now also runs inside `JwtAuthGuard`, immediately after
 * authentication, which is the first point at which the answer is knowable.
 * `TenantGuard` keeps calling it too — harmless when there is no user, and it
 * still covers anything that populates `request.user` earlier.
 */
export function assertTenantMatch(
  request: {
    user?: { userId?: string; restaurantId?: string } | null;
    params?: Record<string, unknown>;
    query?: Record<string, unknown>;
    body?: unknown;
  },
  options: {
    /**
     * Skip the BODY-derived tenant names only. Path and query names are still
     * compared, so the route keeps full isolation over what it reads.
     *
     * Exists for exactly one shape of route: one whose PURPOSE is to change
     * the caller's tenant, and which therefore must name a restaurant the
     * caller is not currently in. `POST /auth/switch-restaurant` is the only
     * such route today. Before this, that endpoint was dead by construction —
     * the body carried the target restaurant, this function saw a tenant that
     * differed from the JWT's, and threw before `switchRestaurant()` could run
     * the membership check that authorises the move. Verified against
     * production 2026-09-01: three users hold access to more than one
     * restaurant and none of them could switch.
     *
     * This is not a hole. The route still proves membership before issuing a
     * token — `auth.service.ts#switchRestaurant` — so authorisation happens,
     * just in the place that can actually answer the question. What is removed
     * is a check that could only ever produce a false negative here.
     */
    allowBodyTenantChange?: boolean;
  } = {},
): void {
  const user = request.user;
  if (!user) return; // authentication is JwtAuthGuard's job, not this one's

  const body =
    request.body && typeof request.body === "object"
      ? (request.body as Record<string, unknown>)
      : undefined;

  const clean = (values: unknown[]) =>
    values.filter((v) => typeof v === "string" && v.length > 0).map(String);

  const fromPathAndQuery = clean([
    request.params?.restaurantId,
    request.params?.restaurant_id,
    request.query?.restaurantId,
    request.query?.restaurant_id,
  ]);
  const fromBody = clean([body?.restaurantId, body?.restaurant_id]);

  // Every name the request carries, exemption or not. The tenantless branch
  // below is judged against ALL of them: the exemption permits changing which
  // tenant you are in, never acquiring one for free.
  const allNamed = [...fromPathAndQuery, ...fromBody];
  if (allNamed.length === 0) return; // nothing to violate

  // A session with no tenant may not reach into one by naming it. Tenantless
  // users are ordinary — onboarding, profile, settings — but those routes name
  // no restaurant, so they are unaffected by this branch.
  if (!user.restaurantId) {
    throw new ForbiddenException("Tenant isolation violation");
  }

  // Only these are compared against the caller's tenant. On an exempt route the
  // body may legitimately name a different restaurant — that is the switch —
  // while a path or query naming one is still a read into another tenant.
  const compared = options.allowBodyTenantChange
    ? fromPathAndQuery
    : allNamed;

  const tenantId = String(user.restaurantId);
  if (compared.some((value) => value !== tenantId)) {
    throw new ForbiddenException("Tenant isolation violation");
  }
}
