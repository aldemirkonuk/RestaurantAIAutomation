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
export function assertTenantMatch(request: {
  user?: { userId?: string; restaurantId?: string } | null;
  params?: Record<string, unknown>;
  query?: Record<string, unknown>;
  body?: unknown;
}): void {
  const user = request.user;
  if (!user) return; // authentication is JwtAuthGuard's job, not this one's

  const body =
    request.body && typeof request.body === "object"
      ? (request.body as Record<string, unknown>)
      : undefined;

  const named = [
    request.params?.restaurantId,
    request.params?.restaurant_id,
    request.query?.restaurantId,
    request.query?.restaurant_id,
    body?.restaurantId,
    body?.restaurant_id,
  ]
    .filter((v) => typeof v === "string" && v.length > 0)
    .map(String);

  if (named.length === 0) return; // nothing to violate

  // A session with no tenant may not reach into one by naming it. Tenantless
  // users are ordinary — onboarding, profile, settings — but those routes name
  // no restaurant, so they are unaffected by this branch.
  if (!user.restaurantId) {
    throw new ForbiddenException("Tenant isolation violation");
  }

  const tenantId = String(user.restaurantId);
  if (named.some((value) => value !== tenantId)) {
    throw new ForbiddenException("Tenant isolation violation");
  }
}
