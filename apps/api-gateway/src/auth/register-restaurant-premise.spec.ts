import { ForbiddenException } from "@nestjs/common";
import { AuthService } from "./auth.service";
import type { RegisterRestaurantDto } from "./dto/register-restaurant.dto";

/**
 * DD-r102-7 premise, flipped (DD-r104-6 PR 2, r105). `POST /auth/register/
 * restaurant` is @Public. It used to open an organization, a restaurant and an
 * owner on an address nobody had proved (`users.email_verified = false`) while
 * `createFirstHouse` refused the same account until it was verified: two doors
 * into one house, two rules. Now both follow one rule: verified only, and the
 * house is written by `createFirstHouse` (org, restaurant, onboarding row in
 * one compensating unit). The first test is the old one, turned over.
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

describe("two doors into one house, one rule (DD-r104-6 PR 2)", () => {
  it("registerRestaurant refuses an unverified address and writes nothing", async () => {
    const { svc, inserts } = makeService({ email_verified: false });
    (svc as any).validateUser = jest
      .fn()
      .mockResolvedValue({ user_id: "user-1", email_verified: false });
    await expect(svc.registerRestaurant(DTO)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(inserts).toEqual([]);
  });

  it("registerRestaurant never creates an account, even for a verified address", async () => {
    const { svc, inserts } = makeService({ email_verified: true, restaurant_id: null });
    (svc as any).validateUser = jest
      .fn()
      .mockResolvedValue({ user_id: "user-1", email_verified: true });
    await svc.registerRestaurant(DTO);
    const tables = inserts.map((i) => i.table);
    expect(tables).toEqual(
      expect.arrayContaining(["organizations", "restaurants", "user_onboarding_progress"]),
    );
    expect(tables).not.toContain("users");
  });

  it("createFirstHouse refuses the same unverified account and writes nothing", async () => {
    const { svc, inserts } = makeService({ email_verified: false, restaurant_id: null });
    await expect(
      svc.createFirstHouse("user-1", { restaurantName: "Sim Meyhouse" } as any),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(inserts).toEqual([]);
  });
});
