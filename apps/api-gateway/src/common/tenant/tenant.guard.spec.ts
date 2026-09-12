import { ForbiddenException } from "@nestjs/common";
import { TenantGuard } from "./tenant.guard";

/**
 * TenantGuard is applied globally and FAILS OPEN by design — it is a
 * cross-tenant check, not an authentication check, and @Public routes pass
 * through it with no user. These tests pin exactly where that openness stops.
 *
 * The hole these were written for (closed 2026-08-25, ADR 0019 D1): an
 * authenticated user whose session carried NO restaurantId skipped the
 * comparison entirely, so they could name any restaurant in a param, query or
 * body and be let through. A user WITH a tenant was always caught.
 */

const ctx = (request: any, meta: Record<string, boolean> = {}) =>
  ({
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => "handler",
    getClass: () => "class",
    __meta: meta,
  }) as any;

const guardWith = (meta: Record<string, boolean> = {}) => {
  const reflector: any = {
    getAllAndOverride: (key: string) => meta[key],
  };
  return new TenantGuard(reflector);
};

const req = (over: any = {}) => ({
  method: "GET",
  url: "/api/v1/analytics/financial/rest-b",
  params: {},
  query: {},
  body: {},
  ...over,
});

describe("TenantGuard", () => {
  it("denies a tenantless user who names a restaurant in a param", () => {
    const guard = guardWith();
    expect(() =>
      guard.canActivate(
        ctx(
          req({
            user: { userId: "u1" }, // authenticated, no restaurantId
            params: { restaurantId: "rest-b" },
          }),
        ),
      ),
    ).toThrow(ForbiddenException);
  });

  it("denies a tenantless user who names a restaurant in a query or body", () => {
    const guard = guardWith();
    expect(() =>
      guard.canActivate(
        ctx(req({ user: { userId: "u1" }, query: { restaurantId: "rest-b" } })),
      ),
    ).toThrow(ForbiddenException);
    expect(() =>
      guard.canActivate(
        ctx(req({ user: { userId: "u1" }, body: { restaurant_id: "rest-b" } })),
      ),
    ).toThrow(ForbiddenException);
  });

  it("allows a tenantless user on a route that names no tenant", () => {
    // Onboarding, profile and settings are ordinary for a user who has not
    // joined a restaurant yet. Denying these would lock people out of signup.
    const guard = guardWith();
    expect(guard.canActivate(ctx(req({ user: { userId: "u1" } })))).toBe(true);
  });

  it("still denies a cross-tenant request from a user who HAS a tenant", () => {
    const guard = guardWith();
    expect(() =>
      guard.canActivate(
        ctx(
          req({
            user: { userId: "u1", restaurantId: "rest-a" },
            params: { restaurantId: "rest-b" },
          }),
        ),
      ),
    ).toThrow(ForbiddenException);
  });

  it("allows a matching tenant and stamps request.tenantId", () => {
    const guard = guardWith();
    const request = req({
      user: { userId: "u1", restaurantId: "rest-a" },
      params: { restaurantId: "rest-a" },
    });
    expect(guard.canActivate(ctx(request))).toBe(true);
    expect((request as any).tenantId).toBe("rest-a");
  });

  it("lets unauthenticated requests through — auth is JwtAuthGuard's job", () => {
    // @Public routes (webhooks, login, vendor portal) reach this guard with no
    // user. Throwing here would break every one of them.
    const guard = guardWith();
    expect(
      guard.canActivate(ctx(req({ params: { restaurantId: "rest-b" } }))),
    ).toBe(true);
  });
});
