import { HttpException } from "@nestjs/common";
import { PosHubService } from "./pos-hub.service";
import { DatabaseService } from "../database/database.service";

/**
 * A FILE IMPORT BACKFILLS THE HOUSE'S TILL (F-1195).
 *
 * The same check arriving from the till's webhook and from a file import was
 * stored twice: the import wrote under its own `csv_import` source, so the
 * upsert on (restaurant_id, source, external_check_id) and the
 * `pos:{source}:...` stock keys never met the till's copy. Takings, tips and
 * stock were all doubled. An import now writes under the house's till, so the
 * check is stored once and takes stock once.
 *
 * The database below keeps pos_checks on its real unique key and stock
 * idempotent on the key, the way apply_stock_movement does; the assertions
 * are on the rows and the stock that result.
 */

type Row = Record<string, any>;

const MAPPINGS = [
  {
    external_item_id: "caymus",
    item_name: "Caymus Cabernet",
    is_wine: true,
    inventory_id: "inv-caymus",
    sale_unit: "bottle",
  },
];

function makeDb(opts: { tillReadError?: string } = {}) {
  const checks = new Map<string, Row>();
  const tx = new Map<string, Row>();
  const stock: Record<string, number> = { "inv-caymus": 12 };

  const client: any = {
    from(table: string) {
      const filters: Record<string, unknown> = {};
      const q: any = {
        select: () => q,
        eq: (col: string, val: unknown) => {
          filters[col] = val;
          return q;
        },
        in: () => q,
        limit: async () => {
          if (opts.tillReadError) {
            return { data: null, error: { message: opts.tillReadError } };
          }
          const rows = [...checks.values()].filter(
            (r) =>
              r.restaurant_id === filters.restaurant_id &&
              r.source === filters.source,
          );
          return { data: rows.map((r) => ({ id: r.id })), error: null };
        },
        like: async (_col: string, pattern: string) => {
          const prefix = pattern.replace(/%$/, "").replace(/\\(.)/g, "$1");
          const rows =
            table === "inventory_transactions" ? [...tx.values()] : [];
          return {
            data: rows.filter((r) => r.idempotency_key.startsWith(prefix)),
            error: null,
          };
        },
        upsert: async (row: Row) => {
          if (table === "pos_checks") {
            const key = `${row.restaurant_id}|${row.source}|${row.external_check_id}`;
            checks.set(key, {
              id: checks.get(key)?.id ?? `chk-${checks.size + 1}`,
              ...row,
            });
          }
          return { error: null };
        },
        insert: async () => ({ error: null }),
      };
      if (table === "pos_item_mappings") {
        q.in = async () => ({ data: MAPPINGS, error: null });
      }
      if (table === "restaurant_inventory") {
        q.in = async () => ({
          data: [{ id: "inv-caymus", bottle_size_ml: 750, pour_size_ml: 150 }],
          error: null,
        });
      }
      if (table === "restaurant_tables") {
        q.eq = () => ({ eq: async () => ({ data: [], error: null }) });
      }
      return q;
    },
    rpc: async (name: string, args: Row) => {
      if (name !== "apply_stock_movement") return { data: null, error: null };
      const key = args.p_idempotency_key as string;
      if (tx.has(key)) return { data: tx.get(key)!.id, error: null };
      stock[args.p_inventory_id] += Number(args.p_delta);
      const id = `tx-${tx.size + 1}`;
      tx.set(key, {
        id,
        idempotency_key: key,
        inventory_id: args.p_inventory_id,
        quantity_change: Number(args.p_delta),
      });
      return { data: id, error: null };
    },
  };

  return {
    service: new PosHubService({
      getClient: () => client,
    } as unknown as DatabaseService),
    checks,
    stock,
  };
}

const theCheck = {
  externalCheckId: "c-1",
  openedAt: "2026-09-02T18:00:00Z",
  closedAt: "2026-09-02T19:00:00Z",
  total: 180,
  tip: 20,
  items: [
    { name: "Caymus Cabernet", externalItemId: "caymus", qty: 2, price: 90 },
  ],
};

describe("a file import of a check the till already sent (F-1195)", () => {
  it("stores it once and takes its stock once", async () => {
    const { service, checks, stock } = makeDb();

    await service.ingest("r1", "generic_webhook", [theCheck]);
    expect(stock["inv-caymus"]).toBe(10);

    const res = await service.ingest("r1", "csv_import", [theCheck]);

    expect(res.storedUnder).toBe("generic_webhook");
    expect(res.upserted).toBe(1);
    expect(checks.size).toBe(1);
    expect([...checks.values()][0]).toMatchObject({
      source: "generic_webhook",
      external_check_id: "c-1",
      total: 180,
      tip: 20,
    });
    expect(stock["inv-caymus"]).toBe(10);
    expect(res.stock).toMatchObject({ booked: 0, alreadyBooked: 1 });
  });

  it("the till's webhook after the import does not store or book it again", async () => {
    const { service, checks, stock } = makeDb();

    await service.ingest("r1", "generic_webhook", [
      { ...theCheck, externalCheckId: "c-0" },
    ]);
    await service.ingest("r1", "csv_import", [theCheck]);
    await service.ingest("r1", "generic_webhook", [theCheck]);

    expect(checks.size).toBe(2);
    expect([...checks.values()].map((r) => r.source)).toEqual([
      "generic_webhook",
      "generic_webhook",
    ]);
    expect(stock["inv-caymus"]).toBe(8);
  });

  it("writes under the till the file names", async () => {
    const { service, checks } = makeDb();

    const res = await service.ingest("r1", "csv_import", {
      till: "toast",
      checks: [theCheck],
    });

    expect(res.storedUnder).toBe("toast");
    expect([...checks.values()][0].source).toBe("toast");
  });

  it("keeps a house with no till yet under the file import", async () => {
    const { service, checks } = makeDb();

    const res = await service.ingest("r1", "csv_import", [theCheck]);

    expect(res.storedUnder).toBe("csv_import");
    expect([...checks.values()][0].source).toBe("csv_import");
  });

  it("refuses to guess between two tills, and imports nothing", async () => {
    const { service, checks } = makeDb();
    // Rows as each till's own adapter stores them.
    for (const [source, id] of [
      ["square", "s-1"],
      ["toast", "t-1"],
    ]) {
      checks.set(`r1|${source}|${id}`, {
        id,
        restaurant_id: "r1",
        source,
        external_check_id: id,
      });
    }

    await expect(
      service.ingest("r1", "csv_import", [theCheck]),
    ).rejects.toThrow(
      /more than one till \((Square, Toast|Toast, Square)\).*Nothing was imported/,
    );
    expect(checks.size).toBe(2);
  });

  it("refuses a till it cannot take checks from", async () => {
    const { service, checks } = makeDb();

    await expect(
      service.ingest("r1", "csv_import", {
        till: "csv_import",
        checks: [theCheck],
      }),
    ).rejects.toThrow(/Nothing was imported/);
    expect(checks.size).toBe(0);
  });

  it("an unread till is not read as no till: nothing is imported", async () => {
    const { service, checks } = makeDb({ tillReadError: "timeout" });

    const err = await service
      .ingest("r1", "csv_import", [theCheck])
      .catch((e) => e);

    expect(err).toBeInstanceOf(HttpException);
    expect((err as HttpException).getStatus()).toBe(503);
    expect(checks.size).toBe(0);
  });
});
