import { ScheduledTasksService } from "./scheduled-tasks.service";
import { ScheduledTenantsService } from "./scheduled-tenants.service";
import { RecipientResolverService } from "./recipient-resolver.service";

/**
 * OD-87 / ADR 0022 — the scheduled jobs must serve every opted-in restaurant,
 * and one restaurant's failure must not cost the others their run.
 *
 * Every cron in `scheduled-tasks.service.ts` used to gate on a single
 * `DEFAULT_RESTAURANT_ID` env var, so restaurant #2 onwards silently received
 * no email, SMS or notification at all — no error, no log, nothing to notice.
 *
 * These tests pin three things, in the order they can bite:
 *
 *   1. ITERATION      — N opted-in restaurants produce N sends, not one.
 *   2. ISOLATION      — a tenant that throws does not abort the tenants after it.
 *   3. NO SPILLOVER   — a tenant that resolves no recipients of its own must NOT
 *                       fall through to the global MANAGER_EMAIL, which belongs
 *                       to a different restaurant. Verified against production:
 *                       6 of 10 restaurants have only an `owner` row and no
 *                       `manager`, so this fallback fires for most tenants.
 *
 * ...and, just as important, that opting nobody in changes nothing: with no
 * flag rows the enumeration is exactly `[DEFAULT_RESTAURANT_ID]`.
 */

const LEGACY_ID = "legacy-restaurant";

type Row = Record<string, any>;

/**
 * Minimal Supabase client stub that ACTUALLY FILTERS.
 *
 * The first version of this stub returned every row of a table regardless of
 * `.eq()` / `.in()`, and that made the iteration tests unable to fail: with the
 * fix reverted to a single tenant, `list()` still "found" three restaurants
 * because the stub handed back all three rows no matter which ids were asked
 * for. A test that cannot distinguish one tenant from three is not testing
 * multi-tenancy.
 *
 * So `eq`, `in` and `is` are recorded and applied to the rows. A table listed in
 * `throwOn` returns a Supabase-shaped error instead.
 */
function makeClient(tables: Record<string, Row[]>, throwOn: string[] = []) {
  return {
    from: jest.fn((table: string) => {
      const filters: Array<(r: Row) => boolean> = [];
      const builder: any = {};
      for (const m of ["select", "gte", "lte", "order", "limit", "not"]) {
        builder[m] = jest.fn(() => builder);
      }
      builder.eq = jest.fn((col: string, val: any) => {
        filters.push((r) => r[col] === val);
        return builder;
      });
      builder.in = jest.fn((col: string, vals: any[]) => {
        filters.push((r) => vals.includes(r[col]));
        return builder;
      });
      builder.is = jest.fn((col: string, val: any) => {
        filters.push((r) => (r[col] ?? null) === val);
        return builder;
      });
      builder.insert = jest.fn(() =>
        Promise.resolve({ data: null, error: null }),
      );
      builder.update = jest.fn(() => builder);
      builder.then = (resolve: any, reject: any) => {
        if (throwOn.includes(table)) {
          return Promise.resolve({
            data: null,
            error: { message: `${table} exploded` },
          }).then(resolve, reject);
        }
        const rows = (tables[table] ?? []).filter((r) =>
          filters.every((f) => f(r)),
        );
        return Promise.resolve({ data: rows, error: null }).then(
          resolve,
          reject,
        );
      };
      return builder;
    }),
  };
}

/** A `restaurants` row as the enumeration query expects to find it. */
function restaurant(id: string, name: string, extra: Row = {}): Row {
  return {
    id,
    name,
    timezone: "UTC",
    is_active: true,
    deleted_at: null,
    ...extra,
  };
}

/** A `restaurant_feature_flags` row opting one restaurant in. */
function optIn(restaurantId: string): Row {
  return {
    restaurant_id: restaurantId,
    flag_name: ScheduledTenantsService.OPT_IN_FLAG,
    enabled: true,
  };
}

function makeTenantsService(opts: {
  restaurants?: Row[];
  flags?: Row[];
  legacyId?: string | null;
  throwOn?: string[];
}) {
  const client = makeClient(
    {
      restaurants: opts.restaurants ?? [],
      restaurant_feature_flags: opts.flags ?? [],
    },
    opts.throwOn ?? [],
  );
  const config = {
    get: (key: string) =>
      key === "DEFAULT_RESTAURANT_ID"
        ? opts.legacyId === undefined
          ? LEGACY_ID
          : (opts.legacyId ?? undefined)
        : undefined,
  };
  const databaseService = { getClient: () => client, supabase: client };
  return new ScheduledTenantsService(config as any, databaseService as any);
}

describe("ScheduledTenantsService — who the crons serve", () => {
  it("serves only DEFAULT_RESTAURANT_ID when nobody has opted in (behaviour unchanged)", async () => {
    // The decisive case for "this deploy changes nothing": production has 10
    // restaurants and no opt-in flag rows, so this is what runs on day one.
    const tenants = await makeTenantsService({
      restaurants: [
        restaurant(LEGACY_ID, "Legacy"),
        restaurant("other-1", "Not opted in"),
        restaurant("other-2", "Also not opted in"),
      ],
      flags: [],
    }).list();

    expect(tenants).toHaveLength(1);
    expect(tenants[0].id).toBe(LEGACY_ID);
    expect(tenants[0].isLegacyDefault).toBe(true);
  });

  it("adds restaurants that carry the scheduled_communications flag", async () => {
    const tenants = await makeTenantsService({
      restaurants: [
        restaurant("aaa", "Alpha"),
        restaurant("unflagged", "Bystander"),
        restaurant(LEGACY_ID, "Legacy"),
      ],
      flags: [optIn("aaa")],
    }).list();

    expect(tenants.map((t) => t.id).sort()).toEqual(["aaa", LEGACY_ID].sort());
    // Only the configured default carries the legacy carve-out.
    expect(tenants.find((t) => t.id === "aaa")!.isLegacyDefault).toBe(false);
  });

  it("ignores a flag row whose `enabled` is false", async () => {
    const tenants = await makeTenantsService({
      restaurants: [
        restaurant("aaa", "Alpha"),
        restaurant(LEGACY_ID, "Legacy"),
      ],
      flags: [{ ...optIn("aaa"), enabled: false }],
    }).list();

    expect(tenants.map((t) => t.id)).toEqual([LEGACY_ID]);
  });

  it("does not serve a restaurant that is inactive or soft-deleted", async () => {
    const tenants = await makeTenantsService({
      restaurants: [
        restaurant(LEGACY_ID, "Legacy"),
        restaurant("switched-off", "Deactivated", { is_active: false }),
        restaurant("gone", "Soft deleted", { deleted_at: "2026-01-01" }),
      ],
      flags: [optIn("switched-off"), optIn("gone")],
    }).list();

    expect(tenants.map((t) => t.id)).toEqual([LEGACY_ID]);
  });

  it("throws rather than quietly returning nobody when the flag query fails", async () => {
    // Returning [] here would recreate OD-87 exactly: jobs doing nothing, silently.
    await expect(
      makeTenantsService({
        throwOn: ["restaurant_feature_flags"],
      }).list(),
    ).rejects.toThrow(/scheduled_communications/);
  });

  it("runs the body once per tenant and reports every one as succeeded", async () => {
    const tenants = makeTenantsService({
      restaurants: [
        restaurant("a", "A"),
        restaurant("b", "B"),
        restaurant(LEGACY_ID, "Legacy"),
      ],
      flags: [optIn("a"), optIn("b")],
    });

    const seen: string[] = [];
    const summary = await tenants.runPerTenant("test-job", async (t) => {
      seen.push(t.id);
    });

    expect(seen.sort()).toEqual(["a", "b", LEGACY_ID].sort());
    expect(summary).toEqual({ tenants: 3, succeeded: 3, failed: 0 });
  });

  it("keeps going when one tenant throws, and counts it as failed", async () => {
    const tenants = makeTenantsService({
      restaurants: [
        restaurant("a", "A"),
        restaurant("b", "B"),
        restaurant("c", "C"),
      ],
      flags: [optIn("a"), optIn("b"), optIn("c")],
      legacyId: null,
    });

    const seen: string[] = [];
    const summary = await tenants.runPerTenant("test-job", async (t) => {
      if (t.id === "b") throw new Error("tenant b is broken");
      seen.push(t.id);
    });

    expect(seen).toEqual(["a", "c"]);
    expect(summary).toEqual({ tenants: 3, succeeded: 2, failed: 1 });
  });
});

// ---------------------------------------------------------------------------

/** Builds the cron service on top of a REAL ScheduledTenantsService. */
function makeScheduledTasks(opts: {
  restaurants: Row[];
  flags?: Row[];
  emailsByRestaurant?: Record<string, string[]>;
  inventoryThrowsFor?: string[];
}) {
  const tenants = makeTenantsService({
    restaurants: opts.restaurants,
    flags: opts.flags ?? [],
  });

  const gmailService = {
    sendInventoryAuditReminder: jest.fn(async () => ({ success: true })),
  };

  const recipientResolver = {
    resolveRecipients: jest.fn(async ({ restaurantId }: any) => ({
      emails: opts.emailsByRestaurant?.[restaurantId] ?? [
        `manager@${restaurantId}.test`,
      ],
      phones: [],
    })),
  };

  const databaseService = {
    getClient: () => makeClient({}),
    supabase: makeClient({}),
    getRestaurantInventory: jest.fn(async (id: string) => {
      if (opts.inventoryThrowsFor?.includes(id)) {
        throw new Error(`inventory read failed for ${id}`);
      }
      return [{ stock_live: 4, last_purchase_price: 10 }];
    }),
    getLowStockItems: jest.fn(async () => []),
  };

  const service = new ScheduledTasksService(
    { get: () => undefined } as any,
    {} as any,
    databaseService as any,
    gmailService as any,
    recipientResolver as any,
    tenants,
  );

  return { service, gmailService, recipientResolver };
}

const THREE = [
  restaurant("r1", "One"),
  restaurant("r2", "Two"),
  restaurant("r3", "Three"),
];
const THREE_FLAGS = [optIn("r1"), optIn("r2"), optIn("r3")];

describe("scheduled jobs — per-tenant iteration", () => {
  it("emails all three opted-in restaurants, not just one", async () => {
    const { service, gmailService } = makeScheduledTasks({
      restaurants: THREE,
      flags: THREE_FLAGS,
    });

    await service.sendInventoryAuditReminder();

    expect(gmailService.sendInventoryAuditReminder).toHaveBeenCalledTimes(3);
    const names = gmailService.sendInventoryAuditReminder.mock.calls.map(
      (c: any[]) => c[0].restaurantName,
    );
    // Each email must name its OWN restaurant. Before this change every one of
    // them said "WineOps Restaurant".
    expect(names.sort()).toEqual(["One", "Three", "Two"]);
  });

  it("still serves restaurants 1 and 3 when restaurant 2 throws", async () => {
    const { service, gmailService } = makeScheduledTasks({
      restaurants: THREE,
      flags: THREE_FLAGS,
      inventoryThrowsFor: ["r2"],
    });

    await service.sendInventoryAuditReminder();

    expect(gmailService.sendInventoryAuditReminder).toHaveBeenCalledTimes(2);
    const served = gmailService.sendInventoryAuditReminder.mock.calls.map(
      (c: any[]) => c[0].restaurantName,
    );
    expect(served.sort()).toEqual(["One", "Three"]);
  });

  it("addresses each restaurant's own recipients, never another tenant's", async () => {
    const { service, gmailService } = makeScheduledTasks({
      restaurants: THREE,
      flags: THREE_FLAGS,
      emailsByRestaurant: {
        r1: ["a@one.test"],
        r2: ["b@two.test"],
        r3: ["c@three.test"],
      },
    });

    await service.sendInventoryAuditReminder();

    const pairs = gmailService.sendInventoryAuditReminder.mock.calls.map(
      (c: any[]) => [c[0].restaurantName, c[0].to],
    );
    expect(pairs.sort()).toEqual(
      [
        ["One", ["a@one.test"]],
        ["Two", ["b@two.test"]],
        ["Three", ["c@three.test"]],
      ].sort(),
    );
  });

  it("sends nothing for a restaurant that resolves no recipients", async () => {
    const { service, gmailService } = makeScheduledTasks({
      restaurants: THREE,
      flags: THREE_FLAGS,
      emailsByRestaurant: { r1: [], r2: [], r3: ["c@three.test"] },
    });

    await service.sendInventoryAuditReminder();

    expect(gmailService.sendInventoryAuditReminder).toHaveBeenCalledTimes(1);
    // `.mock.calls` is typed `[]` on a bare jest.fn(), so indexing it is a
    // type error once specs are actually checked (OD-97). Reading the call
    // through a local keeps the assertion identical and the type honest.
    const [firstCall] = gmailService.sendInventoryAuditReminder.mock
      .calls as unknown as Array<[{ restaurantName: string }]>;
    expect(firstCall[0].restaurantName).toBe("Three");
  });
});

// ---------------------------------------------------------------------------

describe("RecipientResolverService — the env fallback is tenant-scoped", () => {
  /** Resolver whose restaurant has no matching users at all. */
  function makeResolver() {
    const client = makeClient({ user_restaurant_access: [] });
    const config = {
      get: (key: string) =>
        key === "MANAGER_EMAIL"
          ? "founder@legacy.test"
          : key === "MANAGER_PHONE"
            ? "+15550000000"
            : undefined,
    };
    return new RecipientResolverService(
      config as any,
      {
        getClient: () => client,
        supabase: client,
      } as any,
    );
  }

  it("still falls back to MANAGER_EMAIL by default (existing callers unchanged)", async () => {
    const result = await makeResolver().resolveRecipients({
      restaurantId: LEGACY_ID,
      roles: ["manager"],
      channels: ["email"],
    });

    expect(result.emails).toEqual(["founder@legacy.test"]);
  });

  it("sends nothing rather than mailing another tenant's manager when the fallback is disabled", async () => {
    // This is the leak the naive "loop over all restaurants" fix would have
    // shipped: restaurant B has no manager row, so B's operational data would
    // have gone to the address configured for restaurant A.
    const result = await makeResolver().resolveRecipients({
      restaurantId: "some-other-tenant",
      roles: ["manager"],
      channels: ["email"],
      allowDefaultFallback: false,
    });

    expect(result.emails).toEqual([]);
  });
});
