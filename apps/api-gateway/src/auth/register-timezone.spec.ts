import { AuthService } from "./auth.service";
import { resolveSignUpTimezone } from "./sign-up-timezone";
import type { RegisterRestaurantDto } from "./dto/register-restaurant.dto";
import type { CreateFirstHouseDto } from "./dto/create-first-house.dto";

/**
 * Item 62 (2026-09-27), founder verbatim: *"Browser zone, else none
 * (Recommended)"* — rejected "Save nothing" and "Keep New York default".
 *
 * PRE-FIX PROOF. `git show HEAD:apps/api-gateway/src/auth/auth.service.ts |
 * grep -n 'America/New_York'` returned
 * `timezone: dto.timezone || "America/New_York",` inside `registerRestaurant`
 * before this change — an application-level re-invention of the fault ADR
 * 0116 had already removed from the COLUMN
 * (`20260903170000_a_default_is_not_an_answer.sql` drops
 * `restaurants.timezone DEFAULT 'America/Los_Angeles'` and leaves the column
 * nullable; confirmed still true on `origin/main` — no later migration
 * touches it). No migration is added here because none is needed: the column
 * was already nullable with no default.
 */

type Insert = { table: string; payload: Record<string, unknown> };

function makeRegisterService() {
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

  const svc = new AuthService(
    { sign: () => "tok", signAsync: async () => "tok" } as any,
    { get: () => undefined } as any,
    { supabase } as any,
    {
      isBlacklisted: async () => false,
      blacklist: async () => undefined,
    } as any,
    { sendOnboardingEmail: async () => undefined } as any,
  );

  (svc as any).generateTokens = jest
    .fn()
    .mockResolvedValue({ accessToken: "a", refreshToken: "r" });
  (svc as any).queueEmailVerification = jest.fn().mockResolvedValue(undefined);

  return { svc, inserts };
}

/**
 * `createFirstHouse` also reads `users` (to confirm the caller is verified
 * and owns no house yet) before it writes anything, so its harness needs a
 * richer `users` row than `registerRestaurant`'s.
 */
function makeFirstHouseService() {
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
      if (table === "users")
        return chain(table, {
          data: {
            user_id: "user-1",
            email: "o@x.com",
            role: "owner",
            email_verified: true,
            restaurant_id: null,
          },
          error: null,
        });
      if (table === "organizations")
        return chain(table, { data: { id: "org-1" }, error: null });
      if (table === "restaurants")
        return chain(table, { data: { id: "rest-1" }, error: null });
      return chain(table, { data: null, error: null });
    },
  };

  const svc = new AuthService(
    { sign: () => "tok", signAsync: async () => "tok" } as any,
    { get: () => undefined } as any,
    { supabase } as any,
    {
      isBlacklisted: async () => false,
      blacklist: async () => undefined,
    } as any,
    { sendOnboardingEmail: async () => undefined } as any,
  );

  (svc as any).generateTokens = jest
    .fn()
    .mockResolvedValue({ accessToken: "a", refreshToken: "r" });

  return { svc, inserts };
}

const restaurantPayload = (inserts: Insert[]) =>
  inserts.find((i) => i.table === "restaurants")?.payload ?? {};

const BASE: RegisterRestaurantDto = {
  name: "Aldemir",
  email: "o@x.com",
  password: "a-long-enough-password",
  restaurantName: "Chez Community",
  address: "No:3A Yerguzlar Caddesi",
  city: "Fethiye",
  country: "Türkiye",
} as RegisterRestaurantDto;

const FIRST_HOUSE_BASE: CreateFirstHouseDto = {
  restaurantName: "Meyhane",
  address: "1 House Street",
  city: "Istanbul",
  country: "Türkiye",
} as CreateFirstHouseDto;

describe("resolveSignUpTimezone", () => {
  it("stores a real IANA zone as-is", () => {
    expect(resolveSignUpTimezone("Europe/Istanbul")).toBe("Europe/Istanbul");
    expect(resolveSignUpTimezone("America/New_York")).toBe("America/New_York");
  });

  it("turns an invalid zone into null rather than storing garbage", () => {
    expect(resolveSignUpTimezone("Not/AZone")).toBeNull();
    expect(resolveSignUpTimezone("just a string")).toBeNull();
  });

  it("stores Intl's resolved name, not the caller's spelling", () => {
    expect(resolveSignUpTimezone("america/new_york")).toBe("America/New_York");
    expect(resolveSignUpTimezone("US/Eastern")).toBe("America/New_York");
    expect(resolveSignUpTimezone("utc")).toBe("UTC");
  });

  it("refuses a bare UTC offset — it is not an IANA zone name", () => {
    // Node 22's Intl accepts these and resolves them to themselves, so
    // isKnownTimeZone alone would let them through (measured 2026-09-27).
    expect(resolveSignUpTimezone("+05:00")).toBeNull();
    expect(resolveSignUpTimezone("-03:30")).toBeNull();
    expect(resolveSignUpTimezone("+0530")).toBeNull();
  });

  it("turns an absent zone into null", () => {
    expect(resolveSignUpTimezone(undefined)).toBeNull();
    expect(resolveSignUpTimezone(null)).toBeNull();
    expect(resolveSignUpTimezone("")).toBeNull();
  });
});

describe("registerRestaurant — the house's timezone (item 62)", () => {
  it("writes the browser zone the sign-up form sent, when it is real", async () => {
    const { svc, inserts } = makeRegisterService();

    await svc.registerRestaurant({ ...BASE, timezone: "Europe/Istanbul" });

    expect(restaurantPayload(inserts).timezone).toBe("Europe/Istanbul");
  });

  it("writes NULL — never America/New_York — for an invalid zone", async () => {
    const { svc, inserts } = makeRegisterService();

    await svc.registerRestaurant({ ...BASE, timezone: "not a real zone" });

    const row = restaurantPayload(inserts);
    expect(row.timezone).toBeNull();
    expect(row.timezone).not.toBe("America/New_York");
  });

  it("writes NULL — never America/New_York — when no zone arrived at all", async () => {
    const { svc, inserts } = makeRegisterService();

    await svc.registerRestaurant({ ...BASE });

    const row = restaurantPayload(inserts);
    expect(row.timezone).toBeNull();
    expect(row.timezone).not.toBe("America/New_York");
  });

  it("names the timezone key on every insert, so the capture guard can read it", async () => {
    const { svc, inserts } = makeRegisterService();

    await svc.registerRestaurant({ ...BASE });

    expect(Object.keys(restaurantPayload(inserts))).toContain("timezone");
  });
});

describe("createFirstHouse — the house's timezone (item 62)", () => {
  it("writes the browser zone the arrival form sent, when it is real", async () => {
    const { svc, inserts } = makeFirstHouseService();

    await svc.createFirstHouse("user-1", {
      ...FIRST_HOUSE_BASE,
      timezone: "Europe/Istanbul",
    });

    expect(restaurantPayload(inserts).timezone).toBe("Europe/Istanbul");
  });

  it("writes NULL for an invalid zone rather than storing the caller's string as-is", async () => {
    const { svc, inserts } = makeFirstHouseService();

    await svc.createFirstHouse("user-1", {
      ...FIRST_HOUSE_BASE,
      timezone: "not a real zone",
    });

    expect(restaurantPayload(inserts).timezone).toBeNull();
  });

  it("writes NULL when no zone arrived at all", async () => {
    const { svc, inserts } = makeFirstHouseService();

    await svc.createFirstHouse("user-1", { ...FIRST_HOUSE_BASE });

    expect(restaurantPayload(inserts).timezone).toBeNull();
  });
});
