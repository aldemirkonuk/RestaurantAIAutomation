import { ForbiddenException } from "@nestjs/common";
import { MenusService } from "./menus.service";
import { OnboardingController } from "./menus.controller";
import { OrganizationsService } from "../organizations/organizations.service";

/**
 * The low-stock step (integ9 first week, S160).
 *
 * F-1060: the house-wide number is an owner's or a manager's; a waiter who
 * opened /get-started?step=threshold could set it and clear the owner's
 * "Finish setup".
 * F-1059: the default reaches only items added after it; items carried now
 * get the number only on an explicit, counted ask (applyToCarried).
 * F-1061: a draft read is not the menu half of "activated".
 */

type Call = {
  table: string;
  op: string;
  patch?: any;
  filters: [string, unknown][];
};

function fakeDb(
  opts: {
    carried?: number;
    activeMenu?: boolean;
    progress?: Record<string, any>;
  } = {},
) {
  const calls: Call[] = [];
  const from = (table: string) => {
    const call: Call = { table, op: "select", filters: [] };
    calls.push(call);
    const result = () => {
      if (table === "restaurant_inventory" && call.op === "update")
        return {
          data: Array.from({ length: opts.carried ?? 0 }, (_, i) => ({
            id: `inv-${i}`,
          })),
          error: null,
        };
      if (table === "restaurant_inventory")
        return { data: null, count: opts.carried ?? 0, error: null };
      return { data: null, error: null };
    };
    const c: any = {
      select: () => c,
      update: (patch: any) => {
        call.op = "update";
        call.patch = patch;
        return c;
      },
      eq: (col: string, val: unknown) => {
        call.filters.push([col, val]);
        return c;
      },
      maybeSingle: async () => {
        if (table === "user_onboarding_progress")
          return { data: opts.progress ?? null, error: null };
        if (table === "restaurant_menus")
          return { data: opts.activeMenu ? { id: "m-1" } : null, error: null };
        if (table === "restaurants")
          return { data: { threshold_configured: true }, error: null };
        return { data: null, error: null };
      },
      then: (res: any, rej: any) => Promise.resolve(result()).then(res, rej),
    };
    return c;
  };
  return { db: { supabase: { from } } as any, calls };
}

function controllerFor(role: string | null, db: any) {
  const organizations = new OrganizationsService({} as never);
  jest.spyOn(organizations, "resolveRestaurantRole").mockResolvedValue(role);
  const menus = new MenusService(db, {} as any, {} as any, {} as any);
  return new OnboardingController(menus, {} as any, organizations);
}

describe("PATCH /onboarding/threshold — who may set the house's low-stock number (F-1060)", () => {
  it.each(["staff", null])(
    "%s is refused, and nothing is written",
    async (role) => {
      const { db, calls } = fakeDb({ carried: 5 });
      const c = controllerFor(role as string | null, db);
      await expect(
        c.setThreshold("u-1", {
          restaurantId: "house-1",
          thresholdMin: 6,
          applyToCarried: true,
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(calls.filter((k) => k.op === "update")).toHaveLength(0);
    },
  );

  it("staff is refused the carried count too", async () => {
    const { db } = fakeDb({ carried: 5 });
    await expect(
      controllerFor("staff", db).getThreshold("house-1", "u-1"),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it.each(["owner", "manager"])("a %s may set it", async (role) => {
    const { db } = fakeDb();
    const out = await controllerFor(role, db).setThreshold("u-1", {
      restaurantId: "house-1",
      thresholdMin: 6,
    });
    expect(out).toMatchObject({
      default_threshold_min: 6,
      threshold_configured: true,
    });
  });
});

describe("the house default and the items carried now (F-1059)", () => {
  it("saving the number touches no carried item unless asked", async () => {
    const { db, calls } = fakeDb({ carried: 133 });
    const out = await controllerFor("owner", db).setThreshold("u-1", {
      restaurantId: "house-1",
      thresholdMin: 6,
    });
    expect(out.applied_to_carried).toBe(0);
    expect(
      calls.filter((k) => k.table === "restaurant_inventory"),
    ).toHaveLength(0);
    expect(calls.find((k) => k.table === "restaurants")?.patch).toEqual({
      default_threshold_min: 6,
      threshold_configured: true,
    });
  });

  it("the explicit ask sets the number on every item the house carries, and says how many", async () => {
    const { db, calls } = fakeDb({ carried: 133 });
    const out = await controllerFor("owner", db).setThreshold("u-1", {
      restaurantId: "house-1",
      thresholdMin: 6,
      applyToCarried: true,
    });
    expect(out.applied_to_carried).toBe(133);
    const write = calls.find(
      (k) => k.table === "restaurant_inventory" && k.op === "update",
    );
    expect(write?.patch).toEqual({ threshold_min: 6 });
    expect(write?.filters).toEqual([
      ["restaurant_id", "house-1"],
      ["is_active", true],
    ]);
  });

  it("GET says how many items the house carries now, for the step to name", async () => {
    const { db } = fakeDb({ carried: 133 });
    await expect(
      controllerFor("manager", db).getThreshold("house-1", "u-1"),
    ).resolves.toEqual({ carried: 133 });
  });
});

describe("GET /onboarding/progress — a draft read is not the menu half (F-1061)", () => {
  const row = {
    id: "row-1",
    user_id: "owner",
    restaurant_id: "house-1",
    menu_uploaded: true,
  };

  it("a house with only a draft read and its threshold set is not activated", async () => {
    const { db } = fakeDb({ progress: row, activeMenu: false });
    const p = await new MenusService(
      db,
      {} as any,
      {} as any,
      {} as any,
    ).getOnboardingProgress("owner", "house-1");
    expect(p.menu_uploaded).toBe(true);
    expect(p.menu_current).toBe(false);
    expect(p.activated).toBe(false);
  });

  it("a house with a current menu and its threshold set is activated", async () => {
    const { db } = fakeDb({ progress: row, activeMenu: true });
    const p = await new MenusService(
      db,
      {} as any,
      {} as any,
      {} as any,
    ).getOnboardingProgress("owner", "house-1");
    expect(p.menu_current).toBe(true);
    expect(p.activated).toBe(true);
  });
});
