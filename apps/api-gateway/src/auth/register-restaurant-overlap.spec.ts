import { AuthService } from "./auth.service";
import type { RegisterRestaurantDto } from "./dto/register-restaurant.dto";

const bcryptHash = jest.fn();
jest.mock("bcrypt", () => ({
  hash: (...args: unknown[]) => bcryptHash(...args),
  compare: jest.fn(),
}));

/**
 * Perf p8-s7. registerRestaurant used to wait for the organization and
 * restaurant inserts before it started bcrypt, then wrote the owner link,
 * the membership and the access row one after another with their answers
 * unread. The hash now starts first (it runs on the thread pool while the
 * inserts are on the wire) and the three writes go out together, as
 * createFirstHouse already does; a failed one rolls the house back.
 */

type Event = string;
type Fail = Partial<Record<string, { code?: string; message: string }>>;

function harness(opts: { fail?: Fail; gateAccess?: boolean } = {}) {
  const events: Event[] = [];
  const deletes: string[] = [];
  let startedAccess = 0;
  let releaseAccess: () => void = () => undefined;
  const accessGate = new Promise<void>((r) => (releaseAccess = r));

  const chain = (table: string, result: any): any => {
    let op = "read";
    const c: any = {
      select: () => c,
      update: () => {
        op = "update";
        return c;
      },
      insert: () => {
        op = "insert";
        return c;
      },
      delete: () => {
        op = "delete";
        return c;
      },
      eq: () => c,
      maybeSingle: async () => ({ data: null, error: null }),
      single: async () => {
        events.push(`insert:${table}`);
        const failure = opts.fail?.[`${table}.insert`];
        return failure ? { data: null, error: failure } : result;
      },
      then: (resolve: (v: unknown) => unknown, reject: any) => {
        if (op === "delete") deletes.push(table);
        const isAccess =
          table === "organization_members" ||
          table === "user_restaurant_access" ||
          (table === "organizations" && op === "update");
        if (isAccess) {
          events.push(`${op}:${table}`);
          startedAccess += 1;
          if (startedAccess === 3) releaseAccess();
        }
        const failure = opts.fail?.[`${table}.${op}`];
        const answer = { error: failure ?? null };
        const wait =
          isAccess && opts.gateAccess ? accessGate : Promise.resolve();
        return wait.then(() => answer).then(resolve, reject);
      },
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
  (svc as any).emailAlreadyRegistered = jest.fn().mockResolvedValue(false);
  return { svc, events, deletes };
}

const DTO = {
  name: "Aldemir",
  email: "o@x.com",
  password: "a-long-enough-password",
  restaurantName: "Chez Community",
  address: "No:3A Yerguzlar Caddesi",
  city: "Fethiye",
  country: "Türkiye",
} as RegisterRestaurantDto;

describe("registerRestaurant — the hash and the writes overlap", () => {
  beforeEach(() => {
    bcryptHash.mockReset();
  });

  it("starts the hash before the organization insert", async () => {
    const { svc, events } = harness();
    bcryptHash.mockImplementation(async () => {
      events.push("hash");
      return "hashed";
    });
    await svc.registerRestaurant(DTO);
    expect(events.indexOf("hash")).toBeGreaterThanOrEqual(0);
    expect(events.indexOf("hash")).toBeLessThan(
      events.indexOf("insert:organizations"),
    );
  });

  it("starts the three access writes together, not one after another", async () => {
    // Each write answers only once all three have started: run serially, the
    // first would wait forever for the other two.
    const { svc, events } = harness({ gateAccess: true });
    bcryptHash.mockResolvedValue("hashed");
    await svc.registerRestaurant(DTO);
    expect(events).toEqual(
      expect.arrayContaining([
        "update:organizations",
        "insert:organization_members",
        "insert:user_restaurant_access",
      ]),
    );
  });

  it.each([
    ["organizations.update"],
    ["organization_members.insert"],
    ["user_restaurant_access.insert"],
  ])("a failed %s rolls the house back and refuses", async (key) => {
    const { svc, deletes } = harness({
      fail: { [key]: { code: "23503", message: "boom" } },
    });
    bcryptHash.mockResolvedValue("hashed");
    await expect(svc.registerRestaurant(DTO)).rejects.toBeDefined();
    expect(deletes).toEqual(
      expect.arrayContaining(["users", "restaurants", "organizations"]),
    );
  });

  it("a hash that fails after the restaurant insert fails leaves no unhandled rejection", async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);
    try {
      const { svc, deletes } = harness({
        fail: { "restaurants.insert": { code: "XX000", message: "down" } },
      });
      bcryptHash.mockRejectedValue(new Error("hash failed"));
      await expect(svc.registerRestaurant(DTO)).rejects.toBeDefined();
      await new Promise((r) => setImmediate(r));
      expect(unhandled).toEqual([]);
      expect(deletes).toContain("organizations");
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });

  it("a hash that fails after the inserts succeeded still refuses and rolls back", async () => {
    const { svc, deletes } = harness();
    bcryptHash.mockRejectedValue(new Error("hash failed"));
    await expect(svc.registerRestaurant(DTO)).rejects.toBeDefined();
    expect(deletes).toEqual(
      expect.arrayContaining(["restaurants", "organizations"]),
    );
  });
});
