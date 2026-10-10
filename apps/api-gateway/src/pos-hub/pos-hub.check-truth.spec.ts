/**
 * A check keeps its newest copy, every unmapped drink is asked about, a size
 * the hub cannot name is asked about, and a house can unplug its till.
 * Sim wave 21: F-639, F-640, F-641, F-643. Fixtures are synthetic.
 *
 * Before this change: `copyIsStale` and `categoryIsFood` did not exist; an
 * older or un-voiding copy was upserted over the stored one and moved stock;
 * an unmapped "Efes Draft" or "Kavaklıdere Öküzgözü" line was dropped without a
 * queue row; a glass of a wine mapped as a bottle took a bottle off stock;
 * no adapter carried a version or a modifier; and nothing refused a feed a
 * house had switched off.
 */
import { HttpStatus, Logger } from "@nestjs/common";
import {
  PosHubService,
  categoryIsFood,
  copyIsStale,
} from "./pos-hub.service";
import { squareAdapter, toastAdapter } from "./pos-adapters";
import { DatabaseService } from "../database/database.service";

type Row = Record<string, any>;

interface DbOpts {
  mappings?: Row[];
  inventory?: Row[];
  stored?: Row | null;
  storedError?: { message: string } | null;
  connection?: Row | null;
  connectionError?: { message: string } | null;
}

function makeDb(opts: DbOpts = {}) {
  const calls = {
    checks: [] as Row[],
    rpc: [] as Array<{ fn: string; args: Row }>,
    queued: [] as Row[],
    connections: [] as Array<{ row: Row; opts: Row }>,
  };
  const booked: Array<{ fn: string; args: Row }> = [];
  const client: any = {
    from(table: string) {
      const q: any = {
        select: () => q,
        eq: () => q,
        in: async () => ({ data: [], error: null }),
        maybeSingle: async () => {
          if (table === "pos_checks")
            return {
              data: opts.storedError ? null : (opts.stored ?? null),
              error: opts.storedError ?? null,
            };
          if (table === "pos_connections")
            return {
              data: opts.connectionError ? null : (opts.connection ?? null),
              error: opts.connectionError ?? null,
            };
          return { data: null, error: null };
        },
        like: async () => ({
          data:
            table === "inventory_transactions"
              ? booked
                  .filter((c) => c.fn === "apply_stock_movement")
                  .map((c) => ({
                    idempotency_key: c.args.p_idempotency_key,
                    inventory_id: c.args.p_inventory_id,
                    quantity_change: c.args.p_delta,
                  }))
              : [],
          error: null,
        }),
        upsert: async (row: Row, o: Row) => {
          if (table === "pos_checks") calls.checks.push(row);
          if (table === "pos_connections")
            calls.connections.push({ row, opts: o });
          return { error: null };
        },
        insert: async (row: Row) => {
          if (table === "pos_unresolved_lines") calls.queued.push(row);
          return { error: null };
        },
      };
      if (table === "pos_item_mappings") {
        q.in = async () => ({ data: opts.mappings ?? [], error: null });
      }
      if (table === "restaurant_inventory") {
        q.in = async (_c: string, ids: string[]) => ({
          data: (opts.inventory ?? []).filter((r) => ids.includes(r.id)),
          error: null,
        });
      }
      if (table === "restaurant_tables") {
        q.eq = () => ({ eq: async () => ({ data: [], error: null }) });
      }
      return q;
    },
    rpc: async (fn: string, args: Row) => {
      calls.rpc.push({ fn, args });
      booked.push({ fn, args });
      return { data: "tx-1", error: null };
    },
  };
  return {
    service: new PosHubService({
      getClient: () => client,
    } as unknown as DatabaseService),
    calls,
  };
}

const BOTTLE = {
  external_item_id: "btl-1",
  item_name: "SYNTHETIC Yakut bottle",
  is_wine: true,
  inventory_id: "inv-1",
  sale_unit: "bottle",
  sale_volume_ml: null,
};
const INVENTORY = [{ id: "inv-1", bottle_size_ml: 750, pour_size_ml: 150 }];

const check = (id: string, extra: Row = {}, items?: Row[]) => ({
  externalCheckId: id,
  openedAt: "2026-07-14T18:00:00Z",
  closedAt: "2026-07-14T21:00:00Z",
  items: items ?? [
    {
      name: BOTTLE.item_name,
      externalItemId: BOTTLE.external_item_id,
      qty: 1,
      price: 40,
    },
  ],
  ...extra,
});

const ingest = async (service: PosHubService, checks: Row[]) =>
  (await service.ingest("r-1", "generic_webhook", checks)) as any;

beforeEach(() => {
  jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

describe("F-639: copyIsStale — which copy of a check is kept", () => {
  const stored = {
    voided: true,
    closed_at: "2026-07-14T21:00:00Z",
    source_version: 5,
    source_modified_at: "2026-07-14T21:05:00Z",
  };

  it("an older version is older, whatever it says", () => {
    expect(
      copyIsStale(stored, { voided: true, closedAt: "x", sourceVersion: 4 }),
    ).toBe("older");
  });
  it("by modified-at when either copy names no version", () => {
    expect(
      copyIsStale(
        { ...stored, source_version: null },
        {
          voided: true,
          closedAt: "x",
          sourceVersion: 9,
          sourceModifiedAt: "2026-07-14T21:04:00Z",
        },
      ),
    ).toBe("older");
  });
  it("a copy not known to be newer may not un-void or re-open", () => {
    expect(copyIsStale(stored, { voided: false, closedAt: "x" })).toBe(
      "would_undo",
    );
    expect(
      copyIsStale(stored, { voided: true, closedAt: null, sourceVersion: 5 }),
    ).toBe("would_undo");
  });
  it("a newer copy may un-void, and no stored copy is never stale", () => {
    expect(
      copyIsStale(stored, { voided: false, closedAt: null, sourceVersion: 6 }),
    ).toBeNull();
    expect(copyIsStale(null, { voided: false, closedAt: null })).toBeNull();
  });
});

describe("F-639: ingest keeps the newest copy", () => {
  it("skips an older versioned copy: no row written, no stock moved", async () => {
    const { service, calls } = makeDb({
      mappings: [BOTTLE],
      inventory: INVENTORY,
      stored: {
        voided: true,
        closed_at: "2026-07-14T21:00:00Z",
        source_version: 5,
        source_modified_at: null,
      },
    });
    const res = await ingest(service, [check("c-1", { sourceVersion: 4 })]);
    expect(res.olderCopies).toBe(1);
    expect(res.upserted).toBe(0);
    expect(calls.checks).toHaveLength(0);
    expect(calls.rpc).toHaveLength(0);
  });

  it("stores the version it was given, so the next copy is judged against it", async () => {
    const { service, calls } = makeDb({ mappings: [BOTTLE], inventory: INVENTORY });
    await ingest(service, [
      check("c-1", {
        sourceVersion: 7,
        sourceModifiedAt: "2026-07-14T21:05:00Z",
      }),
    ]);
    expect(calls.checks[0]).toMatchObject({
      source_version: 7,
      source_modified_at: "2026-07-14T21:05:00.000Z",
    });
  });

  it("refuses the check when the stored copy cannot be read", async () => {
    const { service, calls } = makeDb({
      mappings: [BOTTLE],
      inventory: INVENTORY,
      storedError: { message: "timeout" },
    });
    const res = await ingest(service, [check("c-1", { sourceVersion: 1 })]);
    expect(calls.checks).toHaveLength(0);
    expect(res.errors.join(" ")).toMatch(/could not be read/);
  });

  it("a late 'closed' copy after the void was booked takes nothing off stock again", async () => {
    const { service, calls } = makeDb({ mappings: [BOTTLE], inventory: INVENTORY });
    await ingest(service, [check("c-1")]);
    await ingest(service, [check("c-1", { voided: true })]);
    const before = calls.rpc.length;
    expect(before).toBeGreaterThanOrEqual(2);

    const res = await ingest(service, [check("c-1")]);

    expect(calls.rpc.length).toBe(before);
    expect(res.olderCopies).toBe(1);
  });
});

describe("F-640: every unmapped drink is asked about", () => {
  it("categoryIsFood reads whole words, both lower-casings", () => {
    expect(categoryIsFood("Mains")).toBe(true);
    expect(categoryIsFood("TATLILAR")).toBe(true);
    expect(categoryIsFood("Beer")).toBe(false);
    expect(categoryIsFood("Sidecar cocktails")).toBe(false);
    expect(categoryIsFood(null)).toBe(false);
  });

  it("queues an unmapped Turkish wine, a draft beer and a rakı; not a categorised plate", async () => {
    const { service, calls } = makeDb();
    const res = await ingest(service, [
      check("c-2", {}, [
        { name: "Kavaklıdere Öküzgözü 2022", externalItemId: "a", qty: 1, price: 30 },
        { name: "Efes Draft", externalItemId: "b", qty: 2, price: 8 },
        { name: "Yeni Rakı 35cl", externalItemId: "c", qty: 1, price: 20 },
        { name: "Kale salad", externalItemId: "d", qty: 1, price: 12, category: "Salads" },
      ]),
    ]);
    expect(calls.queued.map((r) => r.external_item_id).sort()).toEqual([
      "a",
      "b",
      "c",
    ]);
    expect(calls.queued.every((r) => r.reason === "unmapped")).toBe(true);
    const items = calls.checks[0].items;
    expect(items.map((i: Row) => i.is_wine)).toEqual([true, true, true, false]);
    // Internal markers never reach the stored line.
    expect(items[0]).not.toHaveProperty("unmapped_drink");
    expect(items[0]).not.toHaveProperty("size_unnamed");
    expect(res.stock.queued.unmapped).toBe(3);
  });

  it("an unmapped line with no category is asked about, not assumed food", async () => {
    const { service, calls } = makeDb();
    await ingest(service, [
      check("c-3", {}, [
        { name: "House special", externalItemId: "h", qty: 1, price: 9 },
      ]),
    ]);
    expect(calls.queued).toHaveLength(1);
    expect(calls.checks[0].items[0].is_wine).toBe(false);
  });
});

describe("F-641: a size the hub cannot name is asked about", () => {
  it("a modifier no mapping names queues the line as no_sale_volume and moves nothing", async () => {
    const { service, calls } = makeDb({ mappings: [BOTTLE], inventory: INVENTORY });
    await ingest(service, [
      check("c-4", {}, [
        {
          name: BOTTLE.item_name,
          externalItemId: "btl-1",
          modifierIds: ["glass-mod"],
          qty: 1,
          price: 9,
        },
      ]),
    ]);
    expect(calls.rpc).toHaveLength(0);
    expect(calls.queued).toEqual([
      expect.objectContaining({ external_item_id: "btl-1", reason: "no_sale_volume" }),
    ]);
    expect(calls.checks[0].items[0].modifier_ids).toEqual(["glass-mod"]);
  });

  it("a mapping keyed <item>:<modifier> names the size and wins", async () => {
    const GLASS = {
      ...BOTTLE,
      external_item_id: "btl-1:glass-mod",
      sale_unit: null,
      sale_volume_ml: 150,
    };
    const { service, calls } = makeDb({
      mappings: [BOTTLE, GLASS],
      inventory: INVENTORY,
    });
    await ingest(service, [
      check("c-5", {}, [
        {
          name: BOTTLE.item_name,
          externalItemId: "btl-1",
          modifierIds: ["glass-mod"],
          qty: 1,
          price: 9,
        },
      ]),
    ]);
    expect(calls.queued).toHaveLength(0);
    expect(calls.checks[0].items[0].sale_volume_ml).toBe(150);
    expect(calls.rpc.length).toBeGreaterThan(0);
  });
});

describe("F-639 / F-641: adapters carry versions and modifiers", () => {
  it("Toast: modifiedDate, voided, and each modifier's guid", () => {
    const [c] = toastAdapter.normalize({
      checks: [
        {
          guid: "t-1",
          voided: true,
          modifiedDate: "2026-07-14T21:05:00.000+0000",
          selections: [
            {
              displayName: "Yakut",
              item: { guid: "itm" },
              quantity: 1,
              price: 9,
              modifiers: [{ item: { guid: "glass" } }, { guid: "ice" }],
            },
          ],
        },
      ],
    });
    expect(c.voided).toBe(true);
    expect(c.sourceModifiedAt).toBe("2026-07-14T21:05:00.000Z");
    expect(c.items[0].modifierIds).toEqual(["glass", "ice"]);
  });

  it("Square: version, updated_at and the line's modifier catalog ids", () => {
    const [c] = squareAdapter.normalize({
      orders: [
        {
          id: "sq-1",
          version: 3,
          updated_at: "2026-07-14T21:05:00Z",
          line_items: [
            {
              name: "Yakut",
              catalog_object_id: "itm",
              quantity: "1",
              base_price_money: { amount: 900 },
              modifiers: [{ catalog_object_id: "glass" }],
            },
          ],
        },
      ],
    });
    expect(c.sourceVersion).toBe(3);
    expect(c.sourceModifiedAt).toBe("2026-07-14T21:05:00.000Z");
    expect(c.items[0].modifierIds).toEqual(["glass"]);
  });
});

describe("F-643: a house can unplug its till", () => {
  it("no row is a feed never switched, and is taken", async () => {
    const { service } = makeDb();
    await expect(service.assertConnected("r-1", "toast")).resolves.toBeUndefined();
  });
  it("a switched-off feed is refused with 409 in plain words", async () => {
    const { service } = makeDb({ connection: { enabled: false } });
    await expect(service.assertConnected("r-1", "toast")).rejects.toMatchObject({
      status: HttpStatus.CONFLICT,
      message: expect.stringMatching(/disconnected toast/),
    });
  });
  it("a read that fails refuses with 503 rather than taking the feed", async () => {
    const { service } = makeDb({ connectionError: { message: "down" } });
    await expect(service.assertConnected("r-1", "toast")).rejects.toMatchObject({
      status: HttpStatus.SERVICE_UNAVAILABLE,
    });
  });
  it("setConnection writes one row per house and provider, with who changed it", async () => {
    const { service, calls } = makeDb();
    await service.setConnection("r-1", "toast", false, "u-1");
    expect(calls.connections).toEqual([
      {
        row: expect.objectContaining({
          restaurant_id: "r-1",
          provider: "toast",
          enabled: false,
          changed_by: "u-1",
        }),
        opts: { onConflict: "restaurant_id,provider" },
      },
    ]);
    await expect(
      service.setConnection("r-1", "nonsense", false, "u-1"),
    ).rejects.toThrow(/Unknown POS provider/);
  });
  it("listConnections returns each switched provider, and throws when the read fails (F-914)", async () => {
    const reads: Array<{ table: string; col: string; val: unknown }> = [];
    const clientWith = (result: { data: unknown; error: unknown }) =>
      ({
        from: (table: string) => ({
          select: () => ({
            eq: async (col: string, val: unknown) => {
              reads.push({ table, col, val });
              return result;
            },
          }),
        }),
      }) as any;
    const ok = new PosHubService({
      getClient: () =>
        clientWith({
          data: [{ provider: "toast", enabled: false, changed_at: "2026-10-10T09:00:00Z" }],
          error: null,
        }),
    } as unknown as DatabaseService);
    await expect(ok.listConnections("r-1")).resolves.toEqual({
      connections: [
        {
          provider: "toast",
          providerName: expect.any(String),
          enabled: false,
          changedAt: "2026-10-10T09:00:00Z",
        },
      ],
    });
    expect(reads).toEqual([
      { table: "pos_connections", col: "restaurant_id", val: "r-1" },
    ]);
    const down = new PosHubService({
      getClient: () => clientWith({ data: null, error: { message: "down" } }),
    } as unknown as DatabaseService);
    await expect(down.listConnections("r-1")).rejects.toThrow(/down/);
  });
});
