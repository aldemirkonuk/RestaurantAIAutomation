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

function makeDb(opts: { checkReadError?: string; saleUnit?: string } = {}) {
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
    // Stored twice before F-1195: each copy took its own stock. A re-send of
    // the till's copy reads only the till's keys, so it moves nothing and
    // returns nothing the import's row took.
    const { service, stock, checks } = makeDb();
    await service.ingest("r1", "csv_import", [theCheck]);
    await service.ingest("r1", "generic_webhook", [theCheck]);
    expect(checks.size).toBe(2);
    expect(stock["inv-caymus"]).toBe(8);

    const res = await service.ingest("r1", "generic_webhook", [theCheck]);

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
