import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { ProvidersController } from "./providers.controller";
import { ProvidersService } from "./providers.service";

/**
 * Provider sub-resources were keyed by provider id alone (ADR 0147). GET
 * :id/orders, :id/performance and :id/contacts, and the contact writes, took
 * no restaurant from the token, and the service filtered only on
 * `provider_id`, so any signed-in user of any house who held a provider uuid
 * could read another house's order history, performance row and contacts, or
 * write contacts onto it.
 *
 * GET :id already 404s a foreign provider (`getProvider` filters
 * restaurant_id). These routes now call that first; a foreign id is the same
 * 404 as a missing one, and the sub-table is not queried.
 */

const HOUSE_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const HOUSE_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PROV_A = "11111111-1111-4111-8111-111111111111";
const PROV_B = "22222222-2222-4222-8222-222222222222";

type Row = Record<string, unknown>;

const forbidden = (name: string) =>
  new Proxy(
    {},
    {
      get(_t, prop) {
        throw new Error(
          `provider-subresources-are-house-scoped.spec: ${name}.${String(prop)} was called`,
        );
      },
    },
  ) as never;

function makeSupabase(seed: {
  providers: Row[];
  procurement_orders: Row[];
  provider_performance_metrics: Row[];
  provider_contacts: Row[];
}) {
  const tables: Record<string, Row[]> = {
    providers: seed.providers.map((r) => ({ ...r })),
    procurement_orders: seed.procurement_orders.map((r) => ({ ...r })),
    provider_performance_metrics: seed.provider_performance_metrics.map(
      (r) => ({ ...r }),
    ),
    provider_contacts: seed.provider_contacts.map((r) => ({ ...r })),
  };
  const queried: string[] = [];

  const from = (table: string) => {
    queried.push(table);
    let rows = [...(tables[table] ?? [])];
    const q: Record<string, unknown> = {};
    const self = () => q;
    q.select = self;
    q.eq = (col: string, val: unknown) => {
      rows = rows.filter((r) => r[col] === val);
      return q;
    };
    q.is = (col: string, val: unknown) => {
      rows = rows.filter((r) => r[col] == val);
      return q;
    };
    q.order = self;
    q.limit = self;
    q.maybeSingle = () =>
      Promise.resolve({ data: rows[0] ?? null, error: null });
    q.single = () =>
      Promise.resolve(
        rows[0]
          ? { data: rows[0], error: null }
          : { data: null, error: { code: "PGRST116", message: "none" } },
      );
    q.insert = (payload: Row) => {
      const row = { id: "new-contact", ...payload };
      tables[table].push(row);
      rows = [row];
      return q;
    };
    q.update = () => q;
    q.delete = () => q;
    (q as { then: typeof Promise.prototype.then }).then = (
      onFulfilled,
      onRejected,
    ) =>
      Promise.resolve({ data: rows, error: null }).then(
        onFulfilled,
        onRejected,
      );
    return q;
  };

  return { from, queried };
}

function controllerFor(supabase: { from: (t: string) => unknown }) {
  return new ProvidersController(
    new ProvidersService(
      { supabase } as never,
      { track: async () => undefined } as never,
      forbidden("ProcurementService"),
    ),
    forbidden("OrganizationsService"),
  );
}

const seed = () => ({
  providers: [
    { id: PROV_A, name: "House A vendor", restaurant_id: HOUSE_A },
    { id: PROV_B, name: "House B vendor", restaurant_id: HOUSE_B },
  ],
  procurement_orders: [
    { id: "ord-a", provider_id: PROV_A, restaurant_id: HOUSE_A, total: 12 },
    { id: "ord-b", provider_id: PROV_B, restaurant_id: HOUSE_B, total: 99 },
  ],
  provider_performance_metrics: [
    { id: "perf-a", provider_id: PROV_A, on_time: 1 },
    { id: "perf-b", provider_id: PROV_B, on_time: 0 },
  ],
  provider_contacts: [
    { id: "c-a", provider_id: PROV_A, name: "A sales", is_primary: true },
    { id: "c-b", provider_id: PROV_B, name: "B sales", is_primary: true },
  ],
});

const userA = { restaurantId: HOUSE_A };
const userB = { restaurantId: HOUSE_B };

describe("provider sub-resources belong to the caller's house", () => {
  it("GET orders for another house's provider is 404 and does not read orders", async () => {
    const supabase = makeSupabase(seed());
    const controller = controllerFor(supabase);

    await expect(
      controller.getProviderOrders(PROV_A, userB),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(supabase.queried).toEqual(["providers"]);
    expect(supabase.queried).not.toContain("procurement_orders");
  });

  it("GET orders for this house's provider returns only that house's rows", async () => {
    const supabase = makeSupabase(seed());
    const controller = controllerFor(supabase);

    const rows = await controller.getProviderOrders(PROV_A, userA);
    expect(rows).toEqual([
      { id: "ord-a", provider_id: PROV_A, restaurant_id: HOUSE_A, total: 12 },
    ]);
    expect(supabase.queried).toContain("procurement_orders");
  });

  it("GET performance for another house's provider is 404 and does not read metrics", async () => {
    const supabase = makeSupabase(seed());
    const controller = controllerFor(supabase);

    await expect(
      controller.getProviderPerformance(PROV_A, userB),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(supabase.queried).not.toContain("provider_performance_metrics");
  });

  it("GET contacts for another house's provider is 404 and does not read contacts", async () => {
    const supabase = makeSupabase(seed());
    const controller = controllerFor(supabase);

    await expect(
      controller.getProviderContacts(PROV_A, userB),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(supabase.queried).not.toContain("provider_contacts");
  });

  it("GET contacts for this house's provider returns that vendor's people", async () => {
    const supabase = makeSupabase(seed());
    const controller = controllerFor(supabase);

    const rows = await controller.getProviderContacts(PROV_A, userA);
    // Only house A's person. The reach fields (ADR 0121 P0 item 2, merged
    // from main) are that mapper's business, not this spec's.
    expect(rows).toEqual([
      expect.objectContaining({
        id: "c-a",
        providerId: PROV_A,
        name: "A sales",
        isPrimary: true,
      }),
    ]);
    expect(rows).toHaveLength(1);
  });

  it("POST a contact onto another house's provider is 404 and inserts nothing", async () => {
    const supabase = makeSupabase(seed());
    const controller = controllerFor(supabase);

    await expect(
      controller.addProviderContact(
        PROV_A,
        { name: "intruder" } as never,
        userB,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(supabase.queried).not.toContain("provider_contacts");
  });

  it("a session that names no house is 403, not an unscoped read", async () => {
    const supabase = makeSupabase(seed());
    const controller = controllerFor(supabase);

    await expect(
      controller.getProviderOrders(PROV_A, { restaurantId: null }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(supabase.queried).toEqual([]);
  });
});

/**
 * EVERY route of the providers controller, not only the sub-resources
 * (ADR 0147, extended 2026-09-25 while bringing #412 up to main). Each row is
 * called by house A's person with HOUSE B's provider id: it must answer 404 —
 * the same as a missing id, never a 403 that would confirm the id exists — and
 * house B's rows must come out byte-identical. The second table calls every
 * route with a session that names no house: 403, and no table is touched.
 */
function makeWorld() {
  const tables: Record<string, Row[]> = {
    providers: [
      { id: PROV_A, name: "House A vendor", restaurant_id: HOUSE_A },
      { id: PROV_B, name: "House B vendor", restaurant_id: HOUSE_B },
    ],
    procurement_orders: [
      { id: "ord-a", provider_id: PROV_A, restaurant_id: HOUSE_A },
      { id: "ord-b", provider_id: PROV_B, restaurant_id: HOUSE_B },
    ],
    provider_performance_metrics: [
      { id: "perf-b", provider_id: PROV_B, on_time: 0 },
    ],
    provider_contacts: [
      { id: "c-a", provider_id: PROV_A, name: "A sales" },
      { id: "c-b", provider_id: PROV_B, name: "B sales" },
    ],
    provider_locations: [
      {
        id: "loc-a",
        provider_id: PROV_A,
        restaurant_id: HOUSE_A,
        name: "A depot",
      },
      {
        id: "loc-b",
        provider_id: PROV_B,
        restaurant_id: HOUSE_B,
        name: "B depot",
      },
    ],
    provider_ratings: [],
    users: [],
  };
  const before = JSON.stringify(tables);
  const queried: string[] = [];
  const writes: { table: string; op: string; payload?: unknown }[] = [];

  const from = (table: string) => {
    queried.push(table);
    tables[table] = tables[table] ?? [];
    let rows = [...tables[table]];
    let op: "select" | "update" | "delete" | "insert" = "select";
    let patch: Row = {};
    const q: Record<string, unknown> = {};
    const self = () => q;
    const apply = () => {
      if (op === "update") {
        for (const r of rows) Object.assign(r, patch);
      }
      if (op === "delete") {
        tables[table] = tables[table].filter((r) => !rows.includes(r));
      }
    };
    q.select = self;
    q.eq = (col: string, val: unknown) => {
      rows = rows.filter((r) => r[col] === val);
      return q;
    };
    q.is = (col: string, val: unknown) => {
      rows = rows.filter((r) => r[col] == val);
      return q;
    };
    for (const noop of [
      "not",
      "neq",
      "in",
      "or",
      "overlaps",
      "contains",
      "ilike",
      "order",
      "limit",
      "range",
    ]) {
      q[noop] = self;
    }
    q.insert = (payload: Row) => {
      op = "insert";
      writes.push({ table, op, payload });
      const row = { id: `new-${table}`, ...payload };
      tables[table].push(row);
      rows = [row];
      return q;
    };
    q.update = (payload: Row) => {
      op = "update";
      patch = payload;
      writes.push({ table, op, payload });
      return q;
    };
    q.delete = () => {
      op = "delete";
      writes.push({ table, op });
      return q;
    };
    q.maybeSingle = () => {
      apply();
      return Promise.resolve({ data: rows[0] ?? null, error: null });
    };
    q.single = () => {
      apply();
      return Promise.resolve(
        rows[0]
          ? { data: rows[0], error: null }
          : { data: null, error: { code: "PGRST116", message: "none" } },
      );
    };
    (q as { then: typeof Promise.prototype.then }).then = (
      onFulfilled,
      onRejected,
    ) => {
      apply();
      return Promise.resolve({ data: rows, error: null }).then(
        onFulfilled,
        onRejected,
      );
    };
    return q;
  };

  /** House B's rows, exactly as seeded. */
  const houseB = (t: Record<string, Row[]>) =>
    JSON.stringify(
      Object.fromEntries(
        Object.entries(t).map(([k, v]) => [
          k,
          v.filter(
            (r) =>
              r.restaurant_id === HOUSE_B ||
              r.provider_id === PROV_B ||
              r.id === PROV_B,
          ),
        ]),
      ),
    );
  const houseBBefore = houseB(JSON.parse(before));

  const controller = new ProvidersController(
    new ProvidersService(
      { supabase: { from } } as never,
      { createEvent: async () => ({}), track: async () => undefined } as never,
      forbidden("ProcurementService"),
    ),
    { resolveRestaurantRole: async () => "manager" } as never,
  );

  return {
    controller,
    queried,
    writes,
    houseBUntouched: () => houseB(tables) === houseBBefore,
    insertsNaming: (id: string) =>
      writes.filter(
        (w) =>
          w.op === "insert" && JSON.stringify(w.payload ?? {}).includes(id),
      ),
  };
}

type Call = (c: ProvidersController, user: unknown) => Promise<unknown>;
const personA = { userId: "user-a", restaurantId: HOUSE_A };

/** Every route that names a provider (or one of its rows) by id. */
const FOREIGN_ID_ROUTES: [string, Call][] = [
  ["GET :id", (c, u) => c.getProvider(PROV_B, u as never)],
  [
    "PATCH :id",
    (c, u) =>
      c.updateProvider(PROV_B, { name: "renamed" } as never, u as never),
  ],
  ["DELETE :id", (c, u) => c.deleteProvider(PROV_B, u as never)],
  ["GET :id/usual-currency", (c, u) => c.getUsualCurrency(PROV_B, u as never)],
  [
    "PATCH :id/usual-currency",
    (c, u) => c.setUsualCurrency(PROV_B, { currency: "EUR" }, u as never),
  ],
  ["GET :id/orders", (c, u) => c.getProviderOrders(PROV_B, u as never)],
  [
    "GET :id/performance",
    (c, u) => c.getProviderPerformance(PROV_B, u as never),
  ],
  [
    "POST :id/rate",
    (c, u) => c.rateProvider(PROV_B, { rating: 1 } as never, u as never),
  ],
  ["GET :id/contacts", (c, u) => c.getProviderContacts(PROV_B, u as never)],
  [
    "POST :id/contacts",
    (c, u) =>
      c.addProviderContact(PROV_B, { name: "intruder" } as never, u as never),
  ],
  [
    "PATCH :id/contacts/:contactId",
    (c, u) =>
      c.updateProviderContact(
        PROV_B,
        "c-b",
        { name: "renamed" } as never,
        u as never,
      ),
  ],
  [
    "PATCH :id/contacts/:contactId (own vendor, other house's contact)",
    (c, u) =>
      c.updateProviderContact(
        PROV_A,
        "c-b",
        { name: "renamed" } as never,
        u as never,
      ),
  ],
  [
    "DELETE :id/contacts/:contactId",
    (c, u) => c.deleteProviderContact(PROV_B, "c-b", u as never),
  ],
  [
    "PATCH :id/contact-date",
    (c, u) =>
      c.updateContactDate(
        PROV_B,
        { lastContactDate: "2026-09-25" } as never,
        u as never,
      ),
  ],
  ["GET :id/intelligence", (c, u) => c.getIntelligence(PROV_B, u as never)],
  [
    "PATCH :id/intelligence",
    (c, u) =>
      c.updateIntelligence(
        PROV_B,
        { profile_dynamic: { x: 1 } } as never,
        u as never,
      ),
  ],
  [
    "GET :id/intelligence/summary",
    (c, u) => c.getIntelligenceSummary(PROV_B, u as never),
  ],
  ["GET :id/locations", (c, u) => c.getProviderLocations(PROV_B, u as never)],
  [
    "POST :id/locations",
    (c, u) =>
      c.createProviderLocation(
        PROV_B,
        { name: "planted", isPrimary: true } as never,
        u as never,
      ),
  ],
  [
    "PATCH :id/locations/:locationId",
    (c, u) =>
      c.updateProviderLocation(
        PROV_B,
        "loc-b",
        { name: "renamed", isPrimary: true } as never,
        u as never,
      ),
  ],
  [
    "PATCH :id/locations/:locationId (own vendor, other house's location)",
    (c, u) =>
      c.updateProviderLocation(
        PROV_A,
        "loc-b",
        { name: "renamed" } as never,
        u as never,
      ),
  ],
  [
    "DELETE :id/locations/:locationId",
    (c, u) => c.deleteProviderLocation(PROV_B, "loc-b", u as never),
  ],
  [
    "POST :id/retroactive-order",
    (c, u) =>
      c.createRetroactiveOrder(
        PROV_B,
        {
          inventoryId: "inv-a",
          quantity: 1,
          unitType: "bottle",
          invoiceTotal: 10,
        } as never,
        u as never,
      ),
  ],
];

/** Every route, id-bearing or not. */
const ALL_ROUTES: [string, Call][] = [
  ...FOREIGN_ID_ROUTES,
  [
    "GET usual-currency/coverage",
    (c, u) => c.usualCurrencyCoverage(u as never),
  ],
  ["GET search", (c, u) => c.searchProviders(u as never)],
  ["GET search/wine-type", (c, u) => c.searchByWineType(u as never, "red")],
  [
    "GET recommendations",
    (c, u) => c.getRecommendations(undefined, u as never),
  ],
  [
    "GET :id/recommendations",
    (c, u) => c.getProviderRecommendations(PROV_A, undefined, u as never),
  ],
  ["GET match", (c, u) => c.matchProviders(u as never, "House A vendor")],
  [
    "POST bulk-import",
    (c, u) =>
      c.bulkImport(
        { restaurantId: HOUSE_A, providers: [{ name: "x" }] } as never,
        u as never,
      ),
  ],
  [
    "POST import",
    (c, u) =>
      c.importProviders(
        { restaurantId: HOUSE_A, providers: [{ name: "x" }] } as never,
        u as never,
      ),
  ],
  ["POST /", (c, u) => c.createProvider({ name: "x" } as never, u as never)],
  ["GET /", (c, u) => c.listProviders(u as never)],
];

describe("every provider route answers only for the caller's house", () => {
  it.each(FOREIGN_ID_ROUTES)(
    "%s with another house's id is 404 and leaves that house's rows as they were",
    async (_route, call) => {
      const world = makeWorld();
      await expect(call(world.controller, personA)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(world.houseBUntouched()).toBe(true);
      expect(world.insertsNaming(PROV_B)).toEqual([]);
    },
  );

  it.each(ALL_ROUTES)(
    "%s with a session that names no house is 403 and touches no table",
    async (_route, call) => {
      const world = makeWorld();
      await expect(
        call(world.controller, { userId: "user-x", restaurantId: null }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(world.queried).toEqual([]);
    },
  );

  it("GET / lists only this house's vendors", async () => {
    const world = makeWorld();
    const rows = await world.controller.listProviders(personA as never);
    expect(rows.map((r) => r.id)).toEqual([PROV_A]);
  });

  it("POST bulk-import writes the caller's house onto every imported vendor", async () => {
    const world = makeWorld();
    const result = await world.controller.bulkImport(
      {
        restaurantId: HOUSE_A,
        providers: [{ name: "One" }, { name: "Two" }],
      } as never,
      personA as never,
    );
    expect(result.imported).toBe(2);
    const inserted = world.writes.filter(
      (w) => w.table === "providers" && w.op === "insert",
    );
    expect(inserted).toHaveLength(2);
    for (const w of inserted) {
      expect((w.payload as Row).restaurant_id).toBe(HOUSE_A);
    }
  });

  it("PATCH :id on this house's own vendor still writes", async () => {
    const world = makeWorld();
    const updated = await world.controller.updateProvider(
      PROV_A,
      { name: "renamed" } as never,
      personA as never,
    );
    expect(updated.name).toBe("renamed");
    expect(world.houseBUntouched()).toBe(true);
  });
});
