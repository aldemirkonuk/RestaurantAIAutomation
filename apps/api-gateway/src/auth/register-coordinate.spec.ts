import { AuthService } from "./auth.service";
import type { RegisterRestaurantDto } from "./dto/register-restaurant.dto";

/**
 * Sign-up writes the point the house asserted — and nothing when it did not.
 *
 * The measurement behind ADR 0111: `restaurants.latitude` / `.longitude` have
 * existed since `20260807001252_distributor_geo_foundation.sql:50-51` and were
 * NULL on all 14 production rows, while 13 of those rows carried an address.
 * The sign-up form had the coordinate in hand — Google Places resolves it in
 * the same `fetchFields` call that fills the city and the postcode — and threw
 * it away. Every weather-derived signal on `/calendar` was blocked on that.
 *
 * The other half of this spec is the one that matters more: the service must
 * never INVENT a point. No default city, no 0,0, no geocode of the typed
 * address. Two production rows exist with an address and no place selection,
 * and for those the honest column value is NULL.
 */

type Insert = { table: string; payload: Record<string, unknown> };

function makeService() {
  const inserts: Insert[] = [];

  const chain = (table: string, result: any): any => {
    const c: any = {
      select: () => c,
      update: () => c,
      insert: (payload: Record<string, unknown>) => {
        inserts.push({ table, payload });
        return c;
      },
      delete: () => c,
      eq: () => c,
      maybeSingle: async () => ({ data: null, error: null }),
      single: async () => result,
      then: (resolve: (v: unknown) => unknown) =>
        Promise.resolve({ error: null }).then(resolve),
    };
    return c;
  };

  const supabase = {
    from: (table: string) => {
      if (table === "organizations")
        return chain(table, { data: { id: "org-1" }, error: null });
      if (table === "restaurants")
        return chain(table, { data: { id: "rest-1" }, error: null });
      if (table === "users")
        return chain(table, {
          data: { user_id: "user-1", email: "o@x.com", role: "owner" },
          error: null,
        });
      return chain(table, { data: null, error: null });
    },
  };

  // Constructor order per auth.service.ts: jwt, config, database, blacklist, gmail.
  const svc = new AuthService(
    { sign: () => "tok", signAsync: async () => "tok" } as any,
    { get: () => undefined } as any,
    { supabase } as any,
    { isBlacklisted: async () => false, blacklist: async () => undefined } as any,
    { sendOnboardingEmail: async () => undefined } as any,
  );

  (svc as any).generateTokens = jest
    .fn()
    .mockResolvedValue({ accessToken: "a", refreshToken: "r" });
  (svc as any).queueEmailVerification = jest.fn().mockResolvedValue(undefined);

  return { svc, inserts };
}

const BASE: RegisterRestaurantDto = {
  name: "Aldemir",
  email: "o@x.com",
  password: "a-long-enough-password",
  restaurantName: "Sim Meyhouse",
  address: "3130 Alpine Rd",
  city: "Portola Valley",
  country: "United States",
};

const restaurantPayload = (inserts: Insert[]) =>
  inserts.find((i) => i.table === "restaurants")?.payload ?? {};

describe("registerRestaurant — the coordinate", () => {
  it("writes latitude, longitude and the place id when a place was chosen", async () => {
    const { svc, inserts } = makeService();

    await svc.registerRestaurant({
      ...BASE,
      latitude: 37.4419,
      longitude: -122.143,
      googlePlaceId: "ChIJabc123",
    });

    const row = restaurantPayload(inserts);
    expect(row.latitude).toBe(37.4419);
    expect(row.longitude).toBe(-122.143);
    expect(row.google_place_id).toBe("ChIJabc123");
  });

  it("writes NO coordinate columns at all for a hand-typed address", async () => {
    // The load-bearing assertion. `undefined` in a supabase-js insert payload
    // still names the column; the keys must be ABSENT so the row keeps the
    // database default (NULL) and the product renders the honest sentence.
    const { svc, inserts } = makeService();

    await svc.registerRestaurant({ ...BASE });

    const row = restaurantPayload(inserts);
    expect("latitude" in row).toBe(false);
    expect("longitude" in row).toBe(false);
    expect("google_place_id" in row).toBe(false);
  });

  it("refuses a half-pair rather than storing one axis", async () => {
    const { svc, inserts } = makeService();

    await svc.registerRestaurant({ ...BASE, latitude: 37.4419 });

    const row = restaurantPayload(inserts);
    expect("latitude" in row).toBe(false);
    expect("longitude" in row).toBe(false);
  });

  it("never invents a point from an out-of-range or non-finite pair", async () => {
    for (const pair of [
      { latitude: 91, longitude: 10 },
      { latitude: 10, longitude: 181 },
      { latitude: Number.NaN, longitude: 10 },
      { latitude: 10, longitude: Number.POSITIVE_INFINITY },
    ]) {
      const { svc, inserts } = makeService();
      await svc.registerRestaurant({ ...BASE, ...pair });
      const row = restaurantPayload(inserts);
      expect("latitude" in row).toBe(false);
      expect("longitude" in row).toBe(false);
    }
  });

  it("keeps 0,0 only when the operator's own selection said so", async () => {
    // Null Island is a legal coordinate. The rule is "never DEFAULT to it",
    // not "never store it" — silently dropping a real selection would be its
    // own fabrication in the other direction.
    const { svc, inserts } = makeService();

    await svc.registerRestaurant({ ...BASE, latitude: 0, longitude: 0 });

    const row = restaurantPayload(inserts);
    expect(row.latitude).toBe(0);
    expect(row.longitude).toBe(0);
  });

  it("does not store a place id with no coordinate behind it", async () => {
    // `restaurants.google_place_id` carries a UNIQUE index
    // (20260807001252_distributor_geo_foundation.sql:65-66). A row holding the
    // id and no point would occupy that key while asserting no location.
    const { svc, inserts } = makeService();

    await svc.registerRestaurant({ ...BASE, googlePlaceId: "ChIJabc123" });

    expect("google_place_id" in restaurantPayload(inserts)).toBe(false);
  });
});
