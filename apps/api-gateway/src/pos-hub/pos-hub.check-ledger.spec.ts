import { PosHubService } from "./pos-hub.service";
import { DatabaseService } from "../database/database.service";

/**
 * A CHECK IS COMPARED WITH WHAT IT ALREADY MOVED (sim wave 8).
 *
 * F-393: a check that first arrives voided (a nightly export holding a check
 *   voided during service) returned bottles nobody took: Caymus 12 -> 14.
 * F-394: a split check's 0.5 + 0.5 took 2 bottles, and 1/3 x 3 took none,
 *   because each check's quantity was rounded on its own.
 * F-395: a check re-sent after a line came off it moved every later line to
 *   a new key (the key carries the line's position), so the removed line was
 *   never returned and the shifted one was taken twice: Caymus 12 -> 10 -> 8.
 *
 * The database below keeps stock the way the real RPCs do: in sealed bottles
 * plus open ml, idempotent on the key (apply_stock_movement against
 * inventory_transactions, record_glass_pour against pour_events), and it
 * answers the ledger read from the rows it actually wrote. The assertions are
 * on the resulting stock, not on the arguments sent.
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
  {
    external_item_id: "sancerre",
    item_name: "Sancerre",
    is_wine: true,
    inventory_id: "inv-sancerre",
    sale_unit: "bottle",
  },
  {
    external_item_id: "house",
    item_name: "House red",
    is_wine: true,
    inventory_id: "inv-house",
    sale_unit: "bottle",
  },
];

function makeDb(
  opts: {
    ledgerError?: string;
    houseBottleMl?: number | null;
    consumptionFailures?: number;
  } = {},
) {
  const stock: Record<string, { sealed: number; openMl: number; ml: number }> =
    {
      "inv-caymus": { sealed: 12, openMl: 0, ml: 750 },
      "inv-sancerre": { sealed: 12, openMl: 0, ml: 750 },
      "inv-house": { sealed: 12, openMl: 0, ml: 750 },
    };
  const tx = new Map<string, Row>();
  const pours = new Map<string, Row>();
  const queued: Row[] = [];
  // wine_consumption_log, unique on notes (the key) like the partial index.
  const consumption = new Map<string, Row>();
  let consumptionFailures = opts.consumptionFailures ?? 0;

  const client: any = {
    from(table: string) {
      const q: any = {
        select: () => q,
        // F-1238: the till's copy takes over an imported row; none here.
        update: () => q,
        eq: () => q,
        in: () => q,
        like: async (_col: string, pattern: string) => {
          if (opts.ledgerError) {
            return { data: null, error: { message: opts.ledgerError } };
          }
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
        upsert: async () => ({ error: null }),
        insert: async (row: Row) => {
          if (table === "pos_unresolved_lines") queued.push(row);
          if (table === "wine_consumption_log") {
            if (consumptionFailures > 0) {
              consumptionFailures--;
              return { error: { code: "57014", message: "statement timeout" } };
            }
            if (consumption.has(row.notes)) {
              return { error: { code: "23505", message: "duplicate key" } };
            }
            consumption.set(row.notes, row);
          }
          return { error: null };
        },
      };
      if (table === "pos_item_mappings") {
        q.in = async () => ({ data: MAPPINGS, error: null });
      }
      if (table === "restaurant_inventory") {
        q.in = async () => ({
          data: [
            { id: "inv-caymus", bottle_size_ml: 750, pour_size_ml: 150 },
            { id: "inv-sancerre", bottle_size_ml: 750, pour_size_ml: 150 },
            {
              id: "inv-house",
              bottle_size_ml:
                opts.houseBottleMl === undefined ? 750 : opts.houseBottleMl,
              pour_size_ml: 150,
            },
          ],
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
      const item = stock[args.p_inventory_id];
      if (name === "apply_stock_movement") {
        if (tx.has(key)) return { data: tx.get(key)!.id, error: null };
        const delta = Number(args.p_delta);
        if (!Number.isInteger(delta)) {
          return { data: null, error: { message: "integer expected" } };
        }
        item.sealed += delta;
        const id = `tx-${tx.size + 1}`;
        tx.set(key, {
          id,
          idempotency_key: key,
          inventory_id: args.p_inventory_id,
          quantity_change: delta,
        });
        return { data: id, error: null };
      }
      if (name === "record_glass_pour") {
        if (pours.has(key)) return { data: { idempotent: true }, error: null };
        if (
          !Number.isInteger(args.p_pours) ||
          !Number.isInteger(args.p_pour_ml)
        ) {
          return { data: null, error: { message: "integer expected" } };
        }
        let need = args.p_pours * args.p_pour_ml;
        const take = Math.min(item.openMl, need);
        item.openMl -= take;
        need -= take;
        while (need > 0) {
          item.sealed -= 1;
          item.openMl += item.ml;
          const t = Math.min(item.openMl, need);
          item.openMl -= t;
          need -= t;
        }
        pours.set(key, {
          idempotency_key: key,
          inventory_id: args.p_inventory_id,
          pours: args.p_pours,
          pour_ml: args.p_pour_ml,
        });
        return { data: {}, error: null };
      }
      return { data: null, error: null };
    },
  };

  return {
    service: new PosHubService({
      getClient: () => client,
    } as unknown as DatabaseService),
    stock,
    queued,
    consumption,
  };
}

const line = (item: string, qty: number) => {
  const m = MAPPINGS.find((x) => x.external_item_id === item)!;
  return { name: m.item_name, externalItemId: item, qty, price: 90 };
};

const check = (id: string, items: Row[], over: Row = {}) => ({
  externalCheckId: id,
  openedAt: "2026-09-02T18:00:00Z",
  closedAt: "2026-09-02T19:00:00Z",
  items,
  ...over,
});

describe("a check that first arrives voided (F-393)", () => {
  it("returns nothing it never took, and says so", async () => {
    const { service, stock } = makeDb();

    const res = await service.ingest("r1", "generic_webhook", [
      check("c-1", [line("caymus", 1)], { voided: true }),
    ]);

    expect(stock["inv-caymus"].sealed).toBe(12);
    expect(res.stock).toMatchObject({ lines: 1, booked: 0, notStock: 1 });
    expect(res.errors).toEqual([
      expect.stringContaining(
        '"Caymus Cabernet" was voided on 1 line before this hub booked its sale',
      ),
    ]);
  });

  it("still returns what a sale took when the void follows it", async () => {
    const { service, stock } = makeDb();

    await service.ingest("r1", "generic_webhook", [
      check("c-1", [line("caymus", 2)]),
    ]);
    await service.ingest("r1", "generic_webhook", [
      check("c-1", [line("caymus", 2)], { voided: true }),
    ]);
    await service.ingest("r1", "generic_webhook", [
      check("c-1", [line("caymus", 2)], { voided: true }),
    ]);

    expect(stock["inv-caymus"].sealed).toBe(12);
  });
});

describe("a split check's part of a bottle (F-394)", () => {
  it("two halves of one bottle take one bottle, not two", async () => {
    const { service, stock } = makeDb();

    await service.ingest("r1", "generic_webhook", [
      check("c-a", [line("caymus", 0.5)]),
      check("c-b", [line("caymus", 0.5)]),
    ]);

    expect(stock["inv-caymus"]).toMatchObject({ sealed: 11, openMl: 0 });
  });

  it("three thirds of one bottle take one bottle, not none", async () => {
    const { service, stock } = makeDb();

    const res = await service.ingest("r1", "generic_webhook", [
      check("c-a", [line("caymus", 1 / 3)]),
      check("c-b", [line("caymus", 1 / 3)]),
      check("c-c", [line("caymus", 1 / 3)]),
    ]);

    expect(stock["inv-caymus"]).toMatchObject({ sealed: 11, openMl: 0 });
    expect(res.stock.booked).toBe(3);
  });

  it("a part with no bottle size is queued, never guessed", async () => {
    const { service, stock, queued } = makeDb({ houseBottleMl: null });

    await service.ingest("r1", "generic_webhook", [
      check("c-a", [line("house", 0.5)]),
    ]);

    expect(stock["inv-house"]).toMatchObject({ sealed: 12, openMl: 0 });
    expect(queued).toHaveLength(1);
    expect(queued[0].reason).toBe("no_sale_volume");
  });
});

describe("a closed check re-sent with different lines (F-395)", () => {
  it("returns a removed line and does not take a shifted one twice", async () => {
    const { service, stock } = makeDb();

    await service.ingest("r1", "generic_webhook", [
      check("c-1", [line("sancerre", 1), line("caymus", 2)]),
    ]);
    expect(stock["inv-caymus"].sealed).toBe(10);
    expect(stock["inv-sancerre"].sealed).toBe(11);

    // The Sancerre came off the check; the Caymus is now line 0.
    await service.ingest("r1", "generic_webhook", [
      check("c-1", [line("caymus", 2)]),
    ]);

    expect(stock["inv-caymus"].sealed).toBe(10);
    expect(stock["inv-sancerre"].sealed).toBe(12);
  });

  it("follows a quantity corrected down, up and down again", async () => {
    const { service, stock } = makeDb();
    const send = (qty: number) =>
      service.ingest("r1", "generic_webhook", [
        check("c-1", [line("caymus", qty)]),
      ]);

    await send(2);
    await send(1);
    expect(stock["inv-caymus"].sealed).toBe(11);
    const replay = await send(1);
    expect(stock["inv-caymus"].sealed).toBe(11);
    expect(replay.stock).toMatchObject({ booked: 0, alreadyBooked: 1 });
    await send(2);
    expect(stock["inv-caymus"].sealed).toBe(10);
    await send(1);
    expect(stock["inv-caymus"].sealed).toBe(11);
  });

  it("a void after a correction returns what the check holds, not what it first took", async () => {
    const { service, stock } = makeDb();

    await service.ingest("r1", "generic_webhook", [
      check("c-1", [line("caymus", 2)]),
    ]);
    await service.ingest("r1", "generic_webhook", [
      check("c-1", [line("caymus", 1), line("sancerre", 1)]),
    ]);
    await service.ingest("r1", "generic_webhook", [
      check("c-1", [line("caymus", 1), line("sancerre", 1)], { voided: true }),
    ]);

    expect(stock["inv-caymus"].sealed).toBe(12);
    expect(stock["inv-sancerre"].sealed).toBe(12);
  });

  it("moves nothing when it cannot read what the check already moved", async () => {
    const { service, stock } = makeDb({ ledgerError: "statement timeout" });

    const res = await service.ingest("r1", "generic_webhook", [
      check("c-1", [line("caymus", 1)], { voided: true }),
    ]);

    expect(stock["inv-caymus"].sealed).toBe(12);
    expect(res.stock.failed).toBe(1);
    expect(res.errors).toEqual([
      expect.stringContaining(
        "could not read what earlier imports of this check moved, so nothing was moved: statement timeout",
      ),
    ]);
  });
});

describe("a replayed check repairs a consumption row that failed (F-395 audit)", () => {
  it("writes the missing row on the replay of an unchanged bottle check", async () => {
    const { service, stock, consumption } = makeDb({ consumptionFailures: 1 });
    const send = () =>
      service.ingest("r1", "generic_webhook", [
        check("c-1", [line("caymus", 2)]),
      ]);

    await send();
    expect(consumption.size).toBe(0);
    await send();

    expect(stock["inv-caymus"].sealed).toBe(10);
    expect(consumption.size).toBe(1);
    expect([...consumption.values()][0]).toMatchObject({ quantity: 2 });
    await send();
    expect(consumption.size).toBe(1);
  });

  it("writes the missing row on the replay of an unchanged part of a bottle", async () => {
    const { service, stock, consumption } = makeDb({ consumptionFailures: 1 });
    const send = () =>
      service.ingest("r1", "generic_webhook", [
        check("c-1", [line("caymus", 0.5)]),
      ]);

    await send();
    await send();

    expect(stock["inv-caymus"]).toMatchObject({ sealed: 11, openMl: 375 });
    expect(consumption.size).toBe(1);
  });

  it("never writes a sale's missing row when the check comes back voided", async () => {
    const { service, stock, consumption } = makeDb({ consumptionFailures: 1 });

    await service.ingest("r1", "generic_webhook", [
      check("c-1", [line("caymus", 2)]),
    ]);
    const voided = () =>
      service.ingest("r1", "generic_webhook", [
        check("c-1", [line("caymus", 2)], { voided: true }),
      ]);
    await voided();
    await voided();

    expect(stock["inv-caymus"].sealed).toBe(12);
    expect(consumption.size).toBe(0);
  });

  it("does not write a line a correction added again under its own key", async () => {
    const { service, consumption } = makeDb();
    const first = [line("caymus", 1)];
    const corrected = [line("caymus", 1), line("sancerre", 1)];

    await service.ingest("r1", "generic_webhook", [check("c-1", first)]);
    await service.ingest("r1", "generic_webhook", [check("c-1", corrected)]);
    await service.ingest("r1", "generic_webhook", [check("c-1", corrected)]);

    const sancerre = [...consumption.values()].filter(
      (r) => r.inventory_id === "inv-sancerre",
    );
    expect(sancerre).toHaveLength(1);
  });
});
