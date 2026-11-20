import { ForbiddenException } from "@nestjs/common";
import { AuthService } from "./auth.service";
import type { RegisterRestaurantDto } from "./dto/register-restaurant.dto";

/**
 * DD-r102-7, the premise (r103). `POST /auth/register/restaurant` is @Public
 * and opens an organization, a restaurant and an owner on an address nobody
 * has proved (`users.email_verified = false`), while `createFirstHouse`
 * refuses the same account until it is verified. Two doors into one house,
 * two rules. This pins the gap as it stands today; the day registerRestaurant
 * follows createFirstHouse's rules (verified only, one transaction, the
 * onboarding row inside it) the first test flips and is rewritten, not
 * deleted.
 */
type Insert = { table: string; payload: Record<string, unknown> };

function makeService(userRow: Record<string, unknown> = {}) {
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
          data: { user_id: "user-1", email: "o@x.com", role: "owner", ...userRow },
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
  (svc as any).emailAlreadyRegistered = jest.fn().mockResolvedValue(false);
  return { svc, inserts };
}

const DTO: RegisterRestaurantDto = {
  name: "Aldemir",
  email: "o@x.com",
  password: "a-long-enough-password",
  restaurantName: "Sim Meyhouse",
  address: "3130 Alpine Rd",
  city: "Portola Valley",
  country: "United States",
};

describe("two doors into one house (DD-r102-7 premise)", () => {
  it("registerRestaurant opens an org, a restaurant and an owner on an unverified address", async () => {
    const { svc, inserts } = makeService();
    await svc.registerRestaurant(DTO);
    const tables = inserts.map((i) => i.table);
    expect(tables).toEqual(expect.arrayContaining(["organizations", "restaurants", "users"]));
    const user = inserts.find((i) => i.table === "users")!.payload;
    expect(user.email_verified).toBe(false);
    expect(user.role).toBe("owner");
  });

  it("createFirstHouse refuses the same unverified account and writes nothing", async () => {
    const { svc, inserts } = makeService({ email_verified: false, restaurant_id: null });
    await expect(
      svc.createFirstHouse("user-1", { restaurantName: "Sim Meyhouse" } as any),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(inserts).toEqual([]);
  });
});
