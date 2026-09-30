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

  it("lets a tenantless session name, in the body of the exempt route, the house it chooses", () => {
    // ADR 0164: a person with several houses signs in to none and chooses one
    // through POST /auth/switch-restaurant, which mints it only where they
    // hold an active membership row. [Until 2026-09-18 this test pinned the
    // opposite ("still refuses a tenantless session naming a restaurant, even
    // when exempt"), which made choosing impossible.]
    expect(() =>
      assertTenantMatch(
        req({ user: { userId: "u1" }, body: { restaurantId: "rest-b" } }),
        { allowBodyTenantChange: true },
      ),
    ).not.toThrow();
  });

  it("still refuses a tenantless session naming a restaurant without the exemption", () => {
    expect(() =>
      assertTenantMatch(
        req({ user: { userId: "u1" }, body: { restaurantId: "rest-b" } }),
      ),
    ).toThrow();
  });

  it("still refuses a tenantless session naming a restaurant in the path or query, even when exempt", () => {
    // A session in no house reads no house's data on the way in.
    expect(() =>
      assertTenantMatch(
        req({ user: { userId: "u1" }, params: { restaurantId: "rest-b" } }),
        { allowBodyTenantChange: true },
      ),
    ).toThrow();
    expect(() =>
      assertTenantMatch(
        req({
          user: { userId: "u1" },
          query: { restaurantId: "rest-b" },
          body: { restaurantId: "rest-b" },
        }),
        { allowBodyTenantChange: true },
      ),
    ).toThrow();
  });
});

/**
 * A house is named by ONE string, or it is not named at all.
 *
 * Found 2026-09-29 by the 817-route audit: this function kept only the STRING
 * values of `restaurantId` / `restaurant_id` and skipped everything else, so a
 * value it could not compare was treated as a value that was not there. Express
 * 4's query parser (qs) turns `?restaurantId[]=B` into `["B"]` and a repeated
 * key into `["A", "B"]`; the JSON and urlencoded body parsers deliver arrays and
 * objects as-is. postgrest-js then renders `.eq(col, ["B"])` as `eq.B`, so on
 * a route whose controller takes the house from one of these top-level keys a
 * member of house A could name house B (analytics.controller.ts
 * `insight-catalog/types`, auth.controller.ts `me/role`, the toast routes, …)
 * — and the guard, having seen "no house named", waved it through.
 *
 * The refusal is the guard's existing one — `ForbiddenException("Tenant
 * isolation violation")` — not a 400: the three callers of this function
 * (JwtAuthGuard, TenantGuard, DevTruthController) and the refusal tests above
 * expect that one exception, and "a house this guard cannot prove is yours"
 * is exactly what a mismatch is. `null`, `undefined` and `""` still mean "not
 * named": none of them names another house to this guard. A controller that
 * turns "nothing named" into "no house filter" can still read every house;
 * see the `""` entry in tech-debt.d/2026-09-30-fix-tenant-guard-and-cross-house-runs.md.
 *
 * The ten refusal cases below were run against the pre-fix implementation and
 * observed to FAIL before being kept. "still refuses a single string naming
 * another house" is a pin that passed before and after, like the two "still
 * passes/treats" cases.
 */
describe("assertTenantMatch — a house is named by one string", () => {
  const user = { userId: "u1", restaurantId: "rest-a" };
  const refused = (fn: () => void) => {
    expect(fn).toThrow(ForbiddenException);
    expect(fn).toThrow("Tenant isolation violation");
  };

  it("refuses an array in the query (?restaurantId[]=rest-b)", () => {
    refused(() =>
      assertTenantMatch(req({ user, query: { restaurantId: ["rest-b"] } })),
    );
    refused(() =>
      assertTenantMatch(req({ user, query: { restaurant_id: ["rest-b"] } })),
    );
  });

  it("refuses a repeated query key (?restaurantId=rest-a&restaurantId=rest-b)", () => {
    // qs turns a repeated key into an array; leading with the caller's own
    // house must not launder the second one.
    refused(() =>
      assertTenantMatch(
        req({ user, query: { restaurantId: ["rest-a", "rest-b"] } }),
      ),
    );
  });

  it("refuses an array even when it holds only the caller's own house", () => {
    // Not a single string, so not a name this guard can vouch for; what a
    // controller does with an array is not something to bet on.
    refused(() =>
      assertTenantMatch(req({ user, query: { restaurantId: ["rest-a"] } })),
    );
  });

  it("refuses an object in the query (?restaurant_id[x]=rest-b)", () => {
    refused(() =>
      assertTenantMatch(
        req({ user, query: { restaurant_id: { x: "rest-b" } } }),
      ),
    );
  });

  it("refuses an array in the body", () => {
    refused(() =>
      assertTenantMatch(req({ user, body: { restaurantId: ["rest-b"] } })),
    );
    refused(() =>
      assertTenantMatch(req({ user, body: { restaurant_id: ["rest-b"] } })),
    );
  });

  it("refuses an object in the body", () => {
    refused(() =>
      assertTenantMatch(
        req({ user, body: { restaurantId: { id: "rest-b" } } }),
      ),
    );
    refused(() =>
      assertTenantMatch(
        req({ user, body: { restaurant_id: { $ne: "rest-a" } } }),
      ),
    );
  });

  it("refuses a number or a boolean in the body", () => {
    refused(() => assertTenantMatch(req({ user, body: { restaurantId: 42 } })));
    refused(() =>
      assertTenantMatch(req({ user, body: { restaurant_id: true } })),
    );
  });

  it("refuses a non-string path param (defence in depth; Express gives strings)", () => {
    refused(() =>
      assertTenantMatch(req({ user, params: { restaurantId: ["rest-b"] } })),
    );
  });

  it("refuses a tenantless session sending an array", () => {
    // Before: an array was "nothing named", so a session in no house passed
    // the one branch written to stop it reaching into a house.
    refused(() =>
      assertTenantMatch(
        req({ user: { userId: "u1" }, query: { restaurantId: ["rest-b"] } }),
      ),
    );
  });

  it("refuses a non-string body name even on the tenant-change route", () => {
    // The exemption lets the body name ANOTHER house; it does not make a
    // malformed name acceptable, and switchRestaurant should never see one.
    refused(() =>
      assertTenantMatch(req({ user, body: { restaurantId: ["rest-b"] } }), {
        allowBodyTenantChange: true,
      }),
    );
    refused(() =>
      assertTenantMatch(
        req({
          user: { userId: "u1" },
          body: { restaurantId: { id: "rest-b" } },
        }),
        { allowBodyTenantChange: true },
      ),
    );
  });

  it("still passes a single string naming the caller's house, in each place", () => {
    expect(() =>
      assertTenantMatch(
        req({
          user,
          params: { restaurantId: "rest-a" },
          query: { restaurant_id: "rest-a" },
          body: { restaurantId: "rest-a", restaurant_id: "rest-a" },
        }),
      ),
    ).not.toThrow();
  });

  it("still treats null, undefined and an empty string as not named", () => {
    expect(() =>
      assertTenantMatch(
        req({
          user,
          query: { restaurantId: "" },
          body: { restaurantId: null, restaurant_id: undefined },
        }),
      ),
    ).not.toThrow();
    // …including for a session in no house (onboarding forms send nulls).
    expect(() =>
      assertTenantMatch(
        req({ user: { userId: "u1" }, body: { restaurantId: null } }),
      ),
    ).not.toThrow();
  });

  it("still refuses a single string naming another house", () => {
    refused(() =>
      assertTenantMatch(req({ user, query: { restaurantId: "rest-b" } })),
    );
  });
});
