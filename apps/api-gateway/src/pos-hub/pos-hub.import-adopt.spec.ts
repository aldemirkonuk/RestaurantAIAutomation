import { PosHubService } from "./pos-hub.service";
import { DatabaseService } from "../database/database.service";

/**
 * A CHECK A FILE IMPORT STORED BEFORE THE TILL SENT ANYTHING (F-1238).
 *
 * F-1195 stores a file import under the house's till, but a house with no
 * till yet keeps its import under `csv_import`, and its stock under the
 * `pos:csv_import:{check}:` keys. When the till later sends the same check and
 * that row is the till's, the till's copy is a replay of what the import took:
 * reading only `pos:{till}:{check}:` found nothing and took the stock again.
 *
 * The database below keeps pos_checks on its real unique key and stock
 * idempotent on the key, the way apply_stock_movement does; the assertions
 * are on the stock that results.
 */

type Row = Record<string, any>;

function makeDb(
  opts: {
    checkReadError?: string;
    saleUnit?: string;
    moveError?: string;
    timezone?: string | null;
  } = {},
) {
  const MAPPINGS = [
    {
      external_item_id: "caymus",
      item_name: "Caymus Cabernet",
      is_wine: true,
      inventory_id: "inv-caymus",
      sale_unit: opts.saleUnit ?? "bottle",
    },
  ];
  const checks = new Map<string, Row>();
  const tx = new Map<string, Row>();
  const pours = new Map<string, Row>();
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
        maybeSingle: async () => {
          if (table === "restaurants") {
            const timezone =
              opts.timezone === undefined ? "Europe/Istanbul" : opts.timezone;
            // F-1537: unset, a strict no-op, as every house is today.
            return {
              data: { timezone, country: null, tax_basis: "unset" },
              error: null,
            };
          }
          const row = [...checks.values()].find(
            (r) =>
              r.restaurant_id === filters.restaurant_id &&
              r.source === filters.source &&
              r.external_check_id === filters.external_check_id,
          );
          return { data: row ?? null, error: null };
        },
        limit: async () => {
          if (opts.checkReadError && filters.external_check_id) {
            return { data: null, error: { message: opts.checkReadError } };
          }
          const rows = [...checks.values()].filter(
            (r) =>
              r.restaurant_id === filters.restaurant_id &&
              r.source === filters.source &&
              (filters.external_check_id === undefined ||
                r.external_check_id === filters.external_check_id),
          );
          return { data: rows.map((r) => ({ id: r.id })), error: null };
        },
        like: async (_col: string, pattern: string) => {
          const prefix = pattern.replace(/%$/, "").replace(/\\(.)/g, "$1");
          const rows =
            table === "inventory_transactions"
              ? [...tx.values()]
              : table === "pour_events"
                ? [...pours.values()]
                : [];
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
        // pos_checks keeps (restaurant_id, source, external_check_id) unique:
        // moving a row onto a key another row holds is refused (23505).
        update: (patch: Row) => {
          const where: Record<string, unknown> = {};
          const run = () => {
            if (opts.moveError) return { error: { message: opts.moveError } };
            for (const [key, r] of [...checks.entries()]) {
              if (Object.entries(where).some(([c, v]) => r[c] !== v)) continue;
              const moved = { ...r, ...patch };
              const to = `${moved.restaurant_id}|${moved.source}|${moved.external_check_id}`;
              if (to !== key && checks.has(to)) {
                return { error: { code: "23505", message: "duplicate key" } };
              }
              checks.delete(key);
              checks.set(to, moved);
            }
            return { error: null };
          };
          const u: any = {
            eq: (col: string, val: unknown) => {
              where[col] = val;
              return u;
            },
            then: (resolve: any, reject: any) =>
              Promise.resolve(run()).then(resolve, reject),
          };
          return u;
        },
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
      const key = args.p_idempotency_key as string;
      if (name === "record_glass_pour") {
        if (!pours.has(key)) {
          pours.set(key, {
            idempotency_key: key,
            inventory_id: args.p_inventory_id,
            pours: args.p_pours,
            pour_ml: args.p_pour_ml,
          });
        }
        return { data: `pour-${key}`, error: null };
      }
      if (name !== "apply_stock_movement") return { data: null, error: null };
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

  /** The import's row becomes the till's, as the till's first copy does. */
  const adopt = (till: string, externalCheckId: string) => {
    const from = `r1|csv_import|${externalCheckId}`;
    const row = checks.get(from)!;
    checks.delete(from);
    checks.set(`r1|${till}|${externalCheckId}`, { ...row, source: till });
  };

  return {
    service: new PosHubService({
      getClient: () => client,
    } as unknown as DatabaseService),
    checks,
    stock,
    adopt,
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

describe("a check imported before the till sent anything (F-1238)", () => {
  it("takes no stock again when the till's copy of it arrives", async () => {
    const { service, stock, adopt } = makeDb();

    const imported = await service.ingest("r1", "csv_import", [theCheck]);
    expect(imported.storedUnder).toBe("csv_import");
    expect(stock["inv-caymus"]).toBe(10);
    adopt("generic_webhook", "c-1");

    const res = await service.ingest("r1", "generic_webhook", [theCheck]);

    expect(stock["inv-caymus"]).toBe(10);
    expect(res.stock).toMatchObject({ booked: 0, alreadyBooked: 1 });
  });

  it("the till's void of it returns what the import took", async () => {
    const { service, stock, adopt } = makeDb();

    await service.ingest("r1", "csv_import", [theCheck]);
    adopt("generic_webhook", "c-1");

    await service.ingest("r1", "generic_webhook", [
      { ...theCheck, voided: true },
    ]);

    expect(stock["inv-caymus"]).toBe(12);
  });

  it("the till's void of an imported glass returns it as a glass void does (B19)", async () => {
    const { service, stock, adopt } = makeDb({ saleUnit: "glass" });

    await service.ingest("r1", "csv_import", [theCheck]);
    adopt("generic_webhook", "c-1");
    const voided = { ...theCheck, voided: true };

    const res = await service.ingest("r1", "generic_webhook", [voided]);
    await service.ingest("r1", "generic_webhook", [voided]);

    // B19, unchanged: two glasses voided return two bottles, once.
    expect(stock["inv-caymus"]).toBe(14);
    expect(res.stock).toMatchObject({ booked: 1, failed: 0 });
  });

  it("an import row still standing beside the till's is left to itself", async () => {
    // Stored twice before F-1195: the till's row stands beside the import's,
    // so the import's row is not moved onto it and its stock stays its own.
    const { service, stock, checks } = makeDb();
    await service.ingest("r1", "csv_import", [theCheck]);
    checks.set("r1|generic_webhook|c-1", {
      id: "chk-till",
      restaurant_id: "r1",
      source: "generic_webhook",
      external_check_id: "c-1",
    });

    await service.ingest("r1", "generic_webhook", [theCheck]);
    const res = await service.ingest("r1", "generic_webhook", [theCheck]);

    expect([...checks.keys()].sort()).toEqual([
      "r1|csv_import|c-1",
      "r1|generic_webhook|c-1",
    ]);
    expect(stock["inv-caymus"]).toBe(8);
    expect(res.stock).toMatchObject({ booked: 0, alreadyBooked: 1 });
  });

  it("an unread import row moves nothing", async () => {
    const { service, stock, adopt } = makeDb({ checkReadError: "timeout" });
    await service.ingest("r1", "csv_import", [theCheck]);
    adopt("generic_webhook", "c-1");

    const res = await service.ingest("r1", "generic_webhook", [theCheck]);

    expect(stock["inv-caymus"]).toBe(10);
    expect(res.stock).toMatchObject({ booked: 0, failed: 1 });
  });
});

describe("the till's webhook after an import it never saw (F-1238)", () => {
  it("stores the check once and takes its stock once", async () => {
    const { service, checks, stock } = makeDb();

    await service.ingest("r1", "csv_import", [theCheck]);
    const res = await service.ingest("r1", "generic_webhook", [theCheck]);
    await service.ingest("r1", "generic_webhook", [theCheck]);

    expect(res.upserted).toBe(1);
    expect([...checks.keys()]).toEqual(["r1|generic_webhook|c-1"]);
    expect([...checks.values()][0]).toMatchObject({ total: 180, tip: 20 });
    expect(stock["inv-caymus"]).toBe(10);
    expect(res.stock).toMatchObject({ booked: 0, alreadyBooked: 1 });
  });

  it("a later file import lands on the till's row too", async () => {
    const { service, checks, stock } = makeDb();

    await service.ingest("r1", "csv_import", [theCheck]);
    await service.ingest("r1", "generic_webhook", [theCheck]);
    const again = await service.ingest("r1", "csv_import", [theCheck]);

    expect(again.storedUnder).toBe("generic_webhook");
    expect([...checks.keys()]).toEqual(["r1|generic_webhook|c-1"]);
    expect(stock["inv-caymus"]).toBe(10);
  });

  it("moves only this house's row", async () => {
    const { service, checks } = makeDb();
    checks.set("r2|csv_import|c-1", {
      id: "chk-r2",
      restaurant_id: "r2",
      source: "csv_import",
      external_check_id: "c-1",
    });

    await service.ingest("r1", "generic_webhook", [theCheck]);

    expect(checks.get("r2|csv_import|c-1")).toMatchObject({
      source: "csv_import",
    });
    expect(checks.has("r1|generic_webhook|c-1")).toBe(true);
  });

  it("a move that fails stores nothing and takes no stock", async () => {
    const { service, checks, stock } = makeDb({ moveError: "timeout" });
    await service.ingest("r1", "csv_import", [theCheck]);

    const res = await service.ingest("r1", "generic_webhook", [theCheck]);

    expect(res.upserted).toBe(0);
    expect(res.errors.join(" ")).toMatch(
      /c-1: not imported, could not tell whether a file import already holds this check/,
    );
    expect([...checks.keys()]).toEqual(["r1|csv_import|c-1"]);
    expect(stock["inv-caymus"]).toBe(10);
  });
});

/**
 * F-1324: a till reuses its check numbers. A file-imported check is the
 * till's only when it falls on the same house day and its total is within a
 * cent; otherwise both are kept, each with its own stock.
 */
describe("a till check that only shares a number with an imported one (F-1324)", () => {
  it("keeps both when the till's check is on another house day, and takes its stock", async () => {
    const { service, checks, stock } = makeDb();
    await service.ingest("r1", "csv_import", [theCheck]);

    const res = await service.ingest("r1", "generic_webhook", [
      {
        ...theCheck,
        openedAt: "2026-10-05T18:00:00Z",
        closedAt: "2026-10-05T19:00:00Z",
      },
    ]);

    expect([...checks.keys()].sort()).toEqual([
      "r1|csv_import|c-1",
      "r1|generic_webhook|c-1",
    ]);
    expect(checks.get("r1|csv_import|c-1")).toMatchObject({
      closed_at: "2026-09-02T19:00:00.000Z",
    });
    expect(stock["inv-caymus"]).toBe(8);
    expect(res.stock).toMatchObject({ booked: 1, alreadyBooked: 0 });
  });

  it("keeps both when the totals differ by more than a cent", async () => {
    const { service, checks } = makeDb();
    await service.ingest("r1", "csv_import", [theCheck]);

    await service.ingest("r1", "generic_webhook", [{ ...theCheck, total: 95 }]);

    expect([...checks.keys()].sort()).toEqual([
      "r1|csv_import|c-1",
      "r1|generic_webhook|c-1",
    ]);
  });

  it("still takes the row over when the totals differ by a cent", async () => {
    const { service, checks, stock } = makeDb();
    await service.ingest("r1", "csv_import", [theCheck]);

    await service.ingest("r1", "generic_webhook", [
      { ...theCheck, total: 180.01 },
    ]);

    expect([...checks.keys()]).toEqual(["r1|generic_webhook|c-1"]);
    expect(stock["inv-caymus"]).toBe(10);
  });

  it("reads the day on the house's clock, not UTC", async () => {
    // 23:30 and 00:30 UTC are two UTC days but one Los Angeles afternoon.
    const { service, checks } = makeDb({ timezone: "America/Los_Angeles" });
    await service.ingest("r1", "csv_import", [
      { ...theCheck, closedAt: "2026-09-02T23:30:00Z" },
    ]);

    await service.ingest("r1", "generic_webhook", [
      { ...theCheck, closedAt: "2026-09-03T00:30:00Z" },
    ]);

    expect([...checks.keys()]).toEqual(["r1|generic_webhook|c-1"]);
  });

  it("moves nothing in a house with no time zone", async () => {
    const { service, checks } = makeDb({ timezone: null });
    await service.ingest("r1", "csv_import", [theCheck]);

    await service.ingest("r1", "generic_webhook", [theCheck]);

    expect([...checks.keys()].sort()).toEqual([
      "r1|csv_import|c-1",
      "r1|generic_webhook|c-1",
    ]);
  });
});
