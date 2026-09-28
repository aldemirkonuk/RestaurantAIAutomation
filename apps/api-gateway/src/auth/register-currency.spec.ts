import { AuthService } from "./auth.service";
import type { RegisterRestaurantDto } from "./dto/register-restaurant.dto";

/**
 * Sign-up writes the money the house named — and NULL when nobody named it.
 *
 * THE MEASUREMENT BEHIND THIS (2026-09-05, production, read-only)
 * ---------------------------------------------------------------
 *   restaurants rows                        14
 *   carrying currency = 'USD'               14   <- every one
 *   of those, houses NOT in a dollar country  3   (two TR, one GB)
 *
 * Nobody had typed `USD` on any of them. `restaurants.currency` carried
 * `DEFAULT 'USD'` (`20260805000000_baseline_from_production.sql:3576`) and this
 * insert named no `currency` key at all, so the COLUMN was the writer and an
 * unanswered question was stored as a confident answer — the
 * [[absence-reported-as-health]] fault in a column default.
 *
 * ADR 0117 Q25, founder 2026-09-05: *"correct three rows now, ask each house in
 * onboarding, but set a default based on location"*. The default is dropped by
 * `20260905120000_a_house_names_its_money.sql`, the form asks, and this spec is
 * the half of it that lives in the gateway: what arrives is what is written, and
 * what does not arrive is written as NULL rather than as dollars.
 *
 * PRE-FIX PROOF. `git show HEAD:apps/api-gateway/src/auth/auth.service.ts |
 * grep -n currency` returns nothing inside `registerRestaurant`'s insert: the
 * key did not exist, so no test could have caught this and the fabricated value
 * came from the database rather than from code. The proof of the old behaviour
 * is the column default, quoted above by file and line.
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

/** The Fethiye house, as it actually signed up. */
const TURKISH: RegisterRestaurantDto = {
  name: "Aldemir",
  email: "o@x.com",
  password: "a-long-enough-password",
  restaurantName: "Chez Community",
  address: "No:3A Yerguzlar Caddesi",
  city: "Fethiye",
  country: "Türkiye",
};

const restaurantPayload = (inserts: Insert[]) =>
  inserts.find((i) => i.table === "restaurants")?.payload ?? {};

describe("registerRestaurant — the house's currency", () => {
  it("writes the code the currency step confirmed", async () => {
    const { svc, inserts } = makeService();

    await svc.registerRestaurant({ ...TURKISH, currency: "TRY" });

    expect(restaurantPayload(inserts).currency).toBe("TRY");
  });

  it("writes NULL — never USD — when the step was answered 'not yet'", async () => {
    const { svc, inserts } = makeService();

    await svc.registerRestaurant({ ...TURKISH });

    const row = restaurantPayload(inserts);
    // Explicit null, NOT undefined and NOT an absent key. `undefined` is omitted
    // from the supabase-js payload, which would let the column default fill it —
    // and until 2026-09-05 that default was `'USD'`. Writing the null is what
    // makes "nobody has answered" survive the insert.
    expect(row.currency).toBeNull();
    expect(row.currency).not.toBe("USD");
  });

  it("names the currency key on every insert, so the capture guard can read it", async () => {
    const { svc, inserts } = makeService();

    await svc.registerRestaurant({ ...TURKISH });

    // `check_order_capture_contract.py` reads write payloads without executing
    // them: a column hidden behind a conditional spread is a column it cannot
    // check.
    expect(Object.keys(restaurantPayload(inserts))).toContain("currency");
  });

  it("does not read the country to invent a currency server-side", async () => {
    // The country is Turkiye and the DTO says nothing, so a helpful gateway
    // would write TRY. It must not: the manager confirms the default on the
    // form, where they can see and change it (ADR 0083), and a currency nobody
    // was shown is the same class of claim as the one this whole change removes.
    const { svc, inserts } = makeService();

    await svc.registerRestaurant({ ...TURKISH });

    expect(restaurantPayload(inserts).country).toBe("Türkiye");
    expect(restaurantPayload(inserts).currency).toBeNull();
  });
});
