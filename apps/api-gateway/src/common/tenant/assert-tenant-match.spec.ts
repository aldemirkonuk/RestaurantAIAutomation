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

/**
 * The switch-restaurant exemption.
 *
 * Found 2026-09-01: `POST /auth/switch-restaurant` carries the TARGET
 * restaurant in its body, and this function refused any body naming a
 * restaurant other than the caller's current one — so the single route whose
 * job is to change tenants was dead by construction, and threw before
 * `switchRestaurant()` could run the membership check that authorises the
 * move. Verified against production: three users hold access to more than one
 * restaurant and none of them could switch.
 *
 * Every test below was run against the un-exempted implementation and observed
 * to FAIL before being kept.
 */
describe("assertTenantMatch — allowBodyTenantChange", () => {
  const user = { userId: "u1", restaurantId: "rest-a" };

  it("lets the switch route name another restaurant in the body", () => {
    expect(() =>
      assertTenantMatch(req({ user, body: { restaurantId: "rest-b" } }), {
        allowBodyTenantChange: true,
      }),
    ).not.toThrow();
  });

  it("still refuses that same body without the exemption", () => {
    // The exemption must be opt-in per route, never the default.
    expect(() =>
      assertTenantMatch(req({ user, body: { restaurantId: "rest-b" } })),
    ).toThrow();
  });

  it("still refuses a PATH naming another restaurant, even when exempt", () => {
    // The exemption covers body-derived names ONLY. A route may change the
    // caller's tenant; it may not read another tenant's data on the way.
    expect(() =>
      assertTenantMatch(
        req({ user, params: { restaurantId: "rest-b" } }),
        { allowBodyTenantChange: true },
      ),
    ).toThrow();
  });

  it("still refuses a QUERY naming another restaurant, even when exempt", () => {
    expect(() =>
      assertTenantMatch(
        req({ user, query: { restaurantId: "rest-b" } }),
        { allowBodyTenantChange: true },
      ),
    ).toThrow();
  });

  it("still refuses a tenantless session naming a restaurant, even when exempt", () => {
    // A session with no tenant may not reach into one by naming it — the
    // exemption is about CHANGING tenant, not about acquiring one for free.
    expect(() =>
      assertTenantMatch(
        req({ user: { userId: "u1" }, body: { restaurantId: "rest-b" } }),
        { allowBodyTenantChange: true },
      ),
    ).toThrow();
  });
});
