import { ForbiddenException } from "@nestjs/common";
import { assertTenantMatch } from "./assert-tenant-match";

/**
 * These pin the comparison itself. The reason it lives in its own function is
 * covered in the file header: the global TenantGuard ran before passport
 * populated `request.user`, so the identical comparison inside that guard could
 * never be reached on an authenticated route. Tenant isolation was not enforced
 * anywhere until 2026-08-26.
 */

const req = (over: any = {}) => ({
  params: {},
  query: {},
  body: {},
  ...over,
});

describe("assertTenantMatch", () => {
  it("throws when an authenticated user names a different restaurant", () => {
    expect(() =>
      assertTenantMatch(
        req({
          user: { userId: "u1", restaurantId: "rest-a" },
          params: { restaurantId: "rest-b" },
        }),
      ),
    ).toThrow(ForbiddenException);
  });

  it("checks query and body, not only path params", () => {
    // The gateway takes restaurantId from all three; a guard that only read
    // params would be trivially bypassed by moving it into the query string.
    expect(() =>
      assertTenantMatch(
        req({
          user: { userId: "u1", restaurantId: "rest-a" },
          query: { restaurantId: "rest-b" },
        }),
      ),
    ).toThrow(ForbiddenException);
    expect(() =>
      assertTenantMatch(
        req({
          user: { userId: "u1", restaurantId: "rest-a" },
          body: { restaurant_id: "rest-b" },
        }),
      ),
    ).toThrow(ForbiddenException);
  });

  it("throws when a tenantless session names any restaurant", () => {
    expect(() =>
      assertTenantMatch(
        req({ user: { userId: "u1" }, params: { restaurantId: "rest-b" } }),
      ),
    ).toThrow(ForbiddenException);
  });

  it("allows a tenantless session on a route that names no restaurant", () => {
    // Onboarding, profile and settings are ordinary for a user who has not
    // joined a restaurant yet; denying these would break signup.
    expect(() =>
      assertTenantMatch(req({ user: { userId: "u1" } })),
    ).not.toThrow();
  });

  it("allows a matching tenant", () => {
    expect(() =>
      assertTenantMatch(
        req({
          user: { userId: "u1", restaurantId: "rest-a" },
          params: { restaurantId: "rest-a" },
        }),
      ),
    ).not.toThrow();
  });

  it("does nothing without a user — authentication is not its job", () => {
    // @Public routes reach this with no user; throwing here would break every
    // webhook, the login route, and the vendor portal.
    expect(() =>
      assertTenantMatch(req({ params: { restaurantId: "rest-b" } })),
    ).not.toThrow();
  });

  it("tolerates a non-object body without throwing", () => {
    expect(() =>
      assertTenantMatch(
        req({ user: { userId: "u1", restaurantId: "rest-a" }, body: "raw" }),
      ),
    ).not.toThrow();
  });
});
