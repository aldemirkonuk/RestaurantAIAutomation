import axios from "axios";
import * as crypto from "crypto";
import { SimposService } from "./simpos.service";
import { DatabaseService } from "../database/database.service";

jest.mock("axios");
const mockedAxios = axios as jest.Mocked<typeof axios>;

/**
 * SimPOS testbed plan, decisions C25/C27/C28/C31 and the UI-spec Loss box.
 *
 * Locks in: the sim-namespace guard rejects non-sim tenants, closing a check
 * excludes voided lines but keeps comped/discounted ones, the webhook is
 * HMAC-signed with the shared secret, and the Loss total only counts
 * voided/comped/discount amounts.
 */

type Row = Record<string, any>;

function makeFakeSupabase(initial: Record<string, Row[]> = {}) {
  const tables: Record<string, Row[]> = JSON.parse(JSON.stringify(initial));
  let idSeq = 0;

  function from(table: string) {
    const filters: Array<[string, any]> = [];
    const inFilters: Array<[string, any[]]> = [];
    let selectOpts: any = null;
    let pendingInsert: Row[] | null = null;
    let pendingUpdate: Row | "__none__" = "__none__";
    let orderSpec: { col: string; ascending: boolean } | null = null;

    const matches = (row: Row) =>
      filters.every(([c, v]) => row[c] === v) &&
      inFilters.every(([c, vals]) => vals.includes(row[c]));

    const apply = (): Row[] => {
      if (pendingInsert) {
        const created = pendingInsert.map((r) => ({
          id: r.id ?? `id-${++idSeq}`,
          ...r,
        }));
        tables[table] = [...(tables[table] || []), ...created];
        return created;
      }
      if (pendingUpdate !== "__none__") {
        tables[table] = (tables[table] || []).map((r) =>
          matches(r) ? { ...r, ...(pendingUpdate as Row) } : r,
        );
        return (tables[table] || []).filter(matches);
      }
      let result = (tables[table] || []).filter(matches);
      if (orderSpec) {
        const { col, ascending } = orderSpec;
        result = [...result].sort((a, b) => {
          if (a[col] < b[col]) return ascending ? -1 : 1;
          if (a[col] > b[col]) return ascending ? 1 : -1;
          return 0;
        });
      }
      return result;
    };

    const api: any = {
      select(_cols?: string, opts?: any) {
        selectOpts = opts;
        return api;
      },
      eq(col: string, val: any) {
        filters.push([col, val]);
        return api;
      },
      in(col: string, vals: any[]) {
        inFilters.push([col, vals]);
        return api;
      },
      order(col: string, opts?: { ascending?: boolean }) {
        orderSpec = { col, ascending: opts?.ascending ?? true };
        return api;
      },
      limit() {
        return api;
      },
      insert(payload: Row | Row[]) {
        pendingInsert = Array.isArray(payload) ? payload : [payload];
        return api;
      },
      update(payload: Row) {
        pendingUpdate = payload;
        return api;
      },
      maybeSingle: async () => {
        const rows = apply();
        return { data: rows[0] ?? null, error: null };
      },
      single: async () => {
        const rows = apply();
        return rows[0]
          ? { data: rows[0], error: null }
          : { data: null, error: { message: "not found" } };
      },
      then(resolve: any) {
        const rows = apply();
        if (selectOpts?.count === "exact" && selectOpts?.head) {
          resolve({ count: rows.length, data: null, error: null });
        } else {
          resolve({ data: rows, error: null });
        }
      },
    };
    return api;
  }

  return { supabase: { from } as any, tables };
}

function makeService(initial: Record<string, Row[]> = {}) {
  const { supabase, tables } = makeFakeSupabase(initial);
  const dbService = { supabase } as unknown as DatabaseService;
  const service = new SimposService(dbService);
  return { service, tables };
}

// Real uuids, not "sim-rest-1". `restaurants.id` is a uuid column, so the old
// fixtures described a row that could not exist — and they hid a real gap: the
// webhook URL builder now asserts the id's shape before interpolating it
// (CodeQL js/request-forgery, critical), and readable-but-impossible ids made
// that guard look like a regression rather than a fix.
const SIM_RESTAURANT = "11111111-1111-4111-8111-111111111111";
const NON_SIM_RESTAURANT = "22222222-2222-4222-8222-222222222222";

describe("SimposService.assertSimRestaurant (decision C31)", () => {
  it("rejects a restaurant whose slug does not start with sim-", async () => {
    const { service } = makeService({
      restaurants: [{ id: NON_SIM_RESTAURANT, slug: "acme-bistro" }],
    });
    await expect(
      service.assertSimRestaurant(NON_SIM_RESTAURANT),
    ).rejects.toThrow(/refuses to target/);
  });

  it("accepts a sim.* tenant", async () => {
    const { service } = makeService({
      restaurants: [{ id: SIM_RESTAURANT, slug: "sim-bistro-1" }],
    });
    await expect(
      service.assertSimRestaurant(SIM_RESTAURANT),
    ).resolves.toBeUndefined();
  });

  it("propagates the guard to every other method (e.g. listCatalog)", async () => {
    const { service } = makeService({
      restaurants: [{ id: NON_SIM_RESTAURANT, slug: "acme-bistro" }],
    });
    await expect(service.listCatalog(NON_SIM_RESTAURANT)).rejects.toThrow(
      /refuses to target/,
    );
  });
});

describe("SimposService — Loss total (UI spec)", () => {
  it("counts voided/comped price*qty and discount_amount, ignores active lines", async () => {
    const checkId = "chk-1";
    const { service } = makeService({
      restaurants: [{ id: SIM_RESTAURANT, slug: "sim-bistro-1" }],
      simpos_checks: [
        { id: checkId, restaurant_id: SIM_RESTAURANT, status: "open" },
      ],
      simpos_check_lines: [
        {
          id: "l1",
          check_id: checkId,
          status: "active",
          unit_price_snapshot: 50,
          qty: 1,
          discount_amount: 0,
        },
        {
          id: "l2",
          check_id: checkId,
          status: "voided",
          unit_price_snapshot: 40,
          qty: 2,
          discount_amount: 0,
        },
        {
          id: "l3",
          check_id: checkId,
          status: "comped",
          unit_price_snapshot: 30,
          qty: 1,
          discount_amount: 0,
        },
        {
          id: "l4",
          check_id: checkId,
          status: "discounted",
          unit_price_snapshot: 60,
          qty: 1,
          discount_amount: 15,
        },
      ],
    });

    const result = await service.getCheck(SIM_RESTAURANT, checkId);
    // voided: 40*2=80, comped: 30*1=30, discounted: +15, active ignored -> 125
    expect(result.lossTotal).toBe(125);
  });
});

describe("SimposService.listOrders (order log page)", () => {
  it("returns every check with its lines, Loss total, and webhook status, newest first", async () => {
    const { service } = makeService({
      restaurants: [{ id: SIM_RESTAURANT, slug: "sim-bistro-1" }],
      simpos_checks: [
        {
          id: "chk-old",
          restaurant_id: SIM_RESTAURANT,
          status: "closed",
          opened_at: "2026-08-01T18:00:00Z",
          webhook_status: "sent",
        },
        {
          id: "chk-new",
          restaurant_id: SIM_RESTAURANT,
          status: "closed",
          opened_at: "2026-08-05T18:00:00Z",
          webhook_status: "failed",
          webhook_error: "boom",
        },
      ],
      simpos_check_lines: [
        {
          id: "l1",
          check_id: "chk-new",
          status: "voided",
          unit_price_snapshot: 40,
          qty: 1,
          discount_amount: 0,
        },
      ],
    });

    const orders = await service.listOrders(SIM_RESTAURANT);

    expect(orders).toHaveLength(2);
    const [first] = orders;
    expect(first.id).toBe("chk-new");
    expect(first.webhook_status).toBe("failed");
    expect(first.lossTotal).toBe(40);
    expect(orders[1].lossTotal).toBe(0);
  });
});

describe("SimposService.closeCheck (decisions C25/C27/C28)", () => {
  const checkId = "chk-1";
  const catalogId = "cat-1";

  function baseTables() {
    return {
      restaurants: [{ id: SIM_RESTAURANT, slug: "sim-bistro-1" }],
      simpos_checks: [
        {
          id: checkId,
          restaurant_id: SIM_RESTAURANT,
          status: "open",
          opened_at: "2026-08-05T18:00:00Z",
        },
      ],
      simpos_catalog: [
        {
          id: catalogId,
          restaurant_id: SIM_RESTAURANT,
          external_item_id: "plu-123",
          wine_name: "Opus One",
        },
      ],
      simpos_check_lines: [
        {
          id: "l1",
          check_id: checkId,
          catalog_id: catalogId,
          status: "active",
          item_name_snapshot: "Opus One",
          unit_price_snapshot: 45,
          qty: 2,
        },
        {
          id: "l2",
          check_id: checkId,
          catalog_id: catalogId,
          status: "voided",
          item_name_snapshot: "Opus One",
          unit_price_snapshot: 45,
          qty: 1,
        },
      ],
    };
  }

  beforeEach(() => {
    process.env.POS_HUB_WEBHOOK_SECRET = "test-secret";
    mockedAxios.post.mockReset();
    mockedAxios.post.mockResolvedValue({ status: 200, data: { ok: true } });
  });

  afterEach(() => {
    delete process.env.POS_HUB_WEBHOOK_SECRET;
  });

  it("excludes voided lines from the webhook payload and uses the catalog's external_item_id", async () => {
    const { service } = makeService(baseTables());

    await service.closeCheck(SIM_RESTAURANT, checkId);

    expect(mockedAxios.post).toHaveBeenCalledTimes(1);
    const [url, body, config] = mockedAxios.post.mock.calls[0];
    expect(url).toContain("/pos-hub/webhook/generic_webhook/");
    const parsed = JSON.parse(body as string);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].items).toHaveLength(1); // voided line excluded
    expect(parsed[0].items[0].externalItemId).toBe("plu-123");
    expect(parsed[0].items[0].qty).toBe(2);
    // This asserted `true` until 2026-09-05, when `is_wine: true` was hard-coded
    // on every line. It is now read from the button's category, and this fixture
    // has none — so the answer is "not wine", which is the safe direction for an
    // uncategorised button (lens defect 5).
    expect(parsed[0].items[0].is_wine).toBe(false);

    // HMAC signature must match the exact bytes sent.
    const expectedSig = crypto
      .createHmac("sha256", "test-secret")
      .update(body as string)
      .digest("hex");
    expect((config as any).headers["X-Pos-Hub-Signature"]).toBe(expectedSig);
  });

  it("marks the check closed and records webhook delivery status", async () => {
    const { service, tables } = makeService(baseTables());

    const result = await service.closeCheck(SIM_RESTAURANT, checkId);

    expect(result.check.status).toBe("closed");
    const stored = tables.simpos_checks.find((c: Row) => c.id === checkId);
    expect(stored!.status).toBe("closed");
    expect(stored!.webhook_status).toBe("sent");
  });

  it("fails closed (does not throw) and records failure when no secret is configured", async () => {
    delete process.env.POS_HUB_WEBHOOK_SECRET;
    const { service, tables } = makeService(baseTables());

    const result = await service.closeCheck(SIM_RESTAURANT, checkId);

    expect(mockedAxios.post).not.toHaveBeenCalled();
    expect(result.webhook.ok).toBe(false);
    const stored = tables.simpos_checks.find((c: Row) => c.id === checkId);
    expect(stored!.webhook_status).toBe("failed");
  });

  it("refuses to close an already-closed check", async () => {
    const tablesData = baseTables();
    tablesData.simpos_checks[0].status = "closed";
    const { service } = makeService(tablesData);

    await expect(service.closeCheck(SIM_RESTAURANT, checkId)).rejects.toThrow(
      /already closed/,
    );
  });
});

/**
 * SimPOS behaves like a POS (lens defects 3, 4, 5, 11).
 *
 * The whole value of a testbed is that what it exercises is what a real
 * provider will exercise. On the 2026-09-03 run it was not: every button cost
 * $45, every line was wine, the webhook carried no money, and 44 checks rang
 * after the venue's published close with nothing noticing. Each of those made
 * a downstream surface compute over a fiction rather than over a gap.
 */
describe("SimposService — the catalog tells the truth about price and kind", () => {
  const SIM = SIM_RESTAURANT;

  function seedTables(inventory: Row[]) {
    return {
      restaurants: [{ id: SIM, slug: "sim-bistro-1" }],
      simpos_catalog: [] as Row[],
      _inventory: inventory,
    };
  }

  function serviceWithInventory(inventory: Row[]) {
    const { supabase, tables } = makeFakeSupabase(seedTables(inventory));
    const dbService = {
      supabase,
      getRestaurantInventory: async () => inventory,
    } as unknown as DatabaseService;
    return { service: new SimposService(dbService), tables };
  }

  it("seeds price null rather than a $45 placeholder when no price is known", async () => {
    const { service, tables } = serviceWithInventory([
      {
        id: "inv-1",
        wine_name: "Haydari",
        bottle_size_ml: 750,
        master_wine_library: { name: "Haydari", producer: null, vintage: null },
      },
    ]);

    await service.seedCatalogIfEmpty(SIM);

    expect(tables.simpos_catalog).toHaveLength(1);
    expect(tables.simpos_catalog[0].price).toBeNull();
  });

  it("still seeds a real menu price when the inventory row has one", async () => {
    const { service, tables } = serviceWithInventory([
      {
        id: "inv-2",
        wine_name: "Akakies",
        menu_price_current: 62,
        bottle_size_ml: 750,
        master_wine_library: { name: "Akakies" },
      },
    ]);

    await service.seedCatalogIfEmpty(SIM);

    expect(tables.simpos_catalog[0].price).toBe(62);
  });

  it("carries a category onto the seeded button instead of assuming wine", async () => {
    const { service, tables } = serviceWithInventory([
      {
        id: "inv-3",
        wine_name: "Turkish coffee",
        // beverage_kind lives on master_wine_library and is trigger-maintained
        // (20260817060000_beverage_kind_classification.sql) — never set by
        // application code, which is exactly why it is worth reading.
        master_wine_library: {
          name: "Turkish coffee",
          beverage_kind: "non_alcoholic",
        },
      },
    ]);

    await service.seedCatalogIfEmpty(SIM);

    expect(tables.simpos_catalog[0].category).toBe("non_alcoholic");
  });
});

describe("SimposService.closeCheck — the webhook carries what a POS carries", () => {
  const checkId = "chk-money";
  const catalogId = "cat-money";
  const SIM = SIM_RESTAURANT;

  function tablesWith(
    overrides: { check?: Row; catalog?: Row; lines?: Row[] } = {},
  ) {
    return {
      restaurants: [
        {
          id: SIM,
          slug: "sim-bistro-1",
          timezone: "America/Los_Angeles",
          // The contract requires all seven keys; [] means closed that day.
          // Friday closes at 22:00 — the published Meyhouse hour the lens run's
          // 44 checks all rang past.
          operating_hours: {
            mon: [],
            tue: [{ open: "17:00", close: "22:00" }],
            wed: [{ open: "17:00", close: "22:00" }],
            thu: [{ open: "17:00", close: "22:00" }],
            fri: [{ open: "17:00", close: "22:00" }],
            sat: [{ open: "17:00", close: "22:00" }],
            sun: [],
          },
        },
      ],
      simpos_checks: [
        {
          id: checkId,
          restaurant_id: SIM,
          status: "open",
          opened_at: "2026-09-04T01:00:00Z",
          table_id: "tbl-7",
          covers: 4,
          server_name: "Deniz",
          ...(overrides.check || {}),
        },
      ],
      simpos_catalog: [
        {
          id: catalogId,
          restaurant_id: SIM,
          external_item_id: "plu-1",
          wine_name: "Akakies",
          category: "wine",
          ...(overrides.catalog || {}),
        },
      ],
      simpos_check_lines: overrides.lines || [
        {
          id: "l1",
          check_id: checkId,
          catalog_id: catalogId,
          status: "active",
          item_name_snapshot: "Akakies",
          unit_price_snapshot: 60,
          qty: 2,
          discount_amount: 0,
        },
      ],
    };
  }

  beforeEach(() => {
    process.env.POS_HUB_WEBHOOK_SECRET = "test-secret";
    mockedAxios.post.mockReset();
    mockedAxios.post.mockResolvedValue({ status: 200, data: { ok: true } });
  });
  afterEach(() => {
    delete process.env.POS_HUB_WEBHOOK_SECRET;
  });

  const sentPayload = () =>
    JSON.parse(mockedAxios.post.mock.calls[0][1] as string)[0];

  it("sends subtotal, total, tip, covers, table and server (ADR 0011's contract)", async () => {
    const { service } = makeService(tablesWith());

    await service.closeCheck(SIM, checkId);

    const p = sentPayload();
    expect(p.subtotal).toBe(120);
    expect(p.total).toBe(120);
    expect(p.covers).toBe(4);
    expect(p.tableRef).toBe("tbl-7");
    expect(p.serverName).toBe("Deniz");
  });

  it("sends covers null — not 0 — when no table was opened (ADR 0105 D5)", async () => {
    const { service } = makeService(
      tablesWith({
        check: { covers: null, table_id: null, server_name: null },
      }),
    );

    await service.closeCheck(SIM, checkId);

    const p = sentPayload();
    expect(p.covers).toBeNull();
    expect(p.tableRef).toBeNull();
  });

  it("sends a line price of null for an unpriced button, and leaves it out of the total", async () => {
    const { service } = makeService(
      tablesWith({
        lines: [
          {
            id: "l1",
            check_id: checkId,
            catalog_id: catalogId,
            status: "active",
            item_name_snapshot: "Akakies",
            unit_price_snapshot: null,
            qty: 2,
            discount_amount: 0,
          },
        ],
      }),
    );

    await service.closeCheck(SIM, checkId);

    const p = sentPayload();
    expect(p.items[0].price).toBeNull();
    // Nothing priced, so the check's money is unknown — not $0.00.
    expect(p.subtotal).toBeNull();
    expect(p.total).toBeNull();
  });

  it("declares a meze as not-wine instead of hard-coding is_wine: true", async () => {
    const { service } = makeService(
      tablesWith({ catalog: { category: "food", wine_name: "Haydari" } }),
    );

    await service.closeCheck(SIM, checkId);

    expect(sentPayload().items[0].is_wine).toBe(false);
  });

  it("treats an uncategorised button as not-wine — the safe direction", async () => {
    const { service } = makeService(
      tablesWith({ catalog: { category: null } }),
    );

    await service.closeCheck(SIM, checkId);

    expect(sentPayload().items[0].is_wine).toBe(false);
  });

  it("flags a check rung after the venue's published close, and does not refuse it", async () => {
    // 2026-09-05T06:20:00Z is 23:20 Friday in America/Los_Angeles — 80 minutes
    // past the 22:00 close, the exact shape all 44 lens checks had.
    const realNow = Date.now;
    Date.now = () => new Date("2026-09-05T06:20:00.000Z").getTime();
    try {
      const { service, tables } = makeService(tablesWith());

      const result = await service.closeCheck(SIM, checkId);

      expect(result.check.status).toBe("closed");
      const stored = tables.simpos_checks.find((c: Row) => c.id === checkId);
      expect(stored!.hours_state).toBe("outside_hours");
    } finally {
      Date.now = realNow;
    }
  });

  it("records that the question could not be answered, not that the venue was open", async () => {
    const t = tablesWith();
    t.restaurants[0].operating_hours = null as any;
    const { service, tables } = makeService(t);

    await service.closeCheck(SIM, checkId);

    const stored = tables.simpos_checks.find((c: Row) => c.id === checkId);
    expect(stored!.hours_state).toBe("hours_unknown");
  });
});
