/**
 * Table-side decisions D2, D3 and D5 (r57), through the ingest.
 *
 *  L1 (D2) A closed check re-sent with an earlier line removed books nothing
 *     new: the later lines keep their keys. Identical lines are told apart. A
 *     provider's line id is the key.
 *  L2 (D3) A fractional quantity keeps its fraction: 0.5 of a glass draws half
 *     the pour, 2.5 draws two pours and one half, 0.5 of a bottle draws half
 *     its millilitres. The log row carries the exact volume and revenue.
 *  L3 (D5) An absent price books the menu price for a bottle and no revenue
 *     for a pour, and the import counts it; a rung zero and a comp flag book
 *     nothing; neither is counted as unsent.
 *  L4 A voided fraction is not returned as a whole bottle; the line says so.
 */
import { Logger } from "@nestjs/common";
import { PosHubService } from "./pos-hub.service";
import { DatabaseService } from "../database/database.service";

type Row = Record<string, any>;

function makeDb(opts: { unit?: string; menu?: number } = {}) {
  const consumption = new Map<string, Row>();
  const rpcs: Array<{ fn: string; args: Row }> = [];
  const seenKeys = new Set<string>();
  const client: any = {
    from(table: string) {
      let patch: Row | null = null;
      const q: any = {
        select: () => q,
        eq: () => q,
        upsert: async () => ({ error: null }),
        update: (p: Row) => {
          patch = p;
          return q;
        },
        insert: async (row: Row) => {
          if (table !== "wine_consumption_log") return { error: null };
          if (consumption.has(row.notes))
            return { error: { code: "23505", message: "duplicate" } };
          consumption.set(row.notes, { ...row });
          return { error: null };
        },
        then: (res: any, rej: any) =>
          Promise.resolve({ error: null }).then(res, rej),
      };
      if (table === "pos_item_mappings")
        q.in = async () => ({
          data: [
            {
              external_item_id: "wine-1",
              item_name: "House Red",
              is_wine: true,
              inventory_id: "inv-1",
              sale_unit: opts.unit ?? "glass",
            },
          ],
          error: null,
        });
      else if (table === "restaurant_inventory")
        q.in = async () => ({
          data: [
            {
              id: "inv-1",
              bottle_size_ml: 750,
              pour_size_ml: 150,
              menu_price_current: opts.menu ?? 90,
            },
          ],
          error: null,
        });
      else q.in = () => q;
      if (table === "restaurant_tables")
        q.eq = () => ({ eq: async () => ({ data: [], error: null }) });
      return q;
    },
    rpc: async (fn: string, args: Row) => {
      const key = args.p_idempotency_key as string;
      const fresh = !seenKeys.has(`${fn}:${key}`);
      seenKeys.add(`${fn}:${key}`);
      if (fresh) rpcs.push({ fn, args });
      return { data: "tx", error: null };
    },
  };
  return {
    db: { getClient: () => client } as unknown as DatabaseService,
    consumption,
    rpcs,
  };
}

const line = (over: Row = {}) => ({
  name: "House Red",
  externalItemId: "wine-1",
  qty: 1,
  price: 12,
  ...over,
});
const check = (items: Row[], over: Row = {}) => ({
  externalCheckId: "chk-1",
  openedAt: "2026-09-02T18:00:00Z",
  closedAt: "2026-09-02T19:00:00Z",
  items,
  ...over,
});
const ingest = (db: DatabaseService, c: any) =>
  new PosHubService(db).ingest("r1", "generic_webhook", [c]);

describe("line identity (L1, D2)", () => {
  let errorSpy: jest.SpyInstance;
  beforeEach(() => {
    errorSpy = jest.spyOn(Logger.prototype, "error").mockImplementation();
  });
  afterEach(() => errorSpy.mockRestore());

  it("a re-send with an earlier line removed books nothing new", async () => {
    const { db, rpcs } = makeDb();
    const a = line({ price: 12 });
    const b = line({ price: 14 });
    const c = line({ price: 16 });
    await ingest(db, check([a, b, c]));
    expect(rpcs).toHaveLength(3);
    await ingest(db, check([b, c]));
    expect(rpcs).toHaveLength(3);
  });

  it("two identical lines both book, under different keys", async () => {
    const { db, rpcs } = makeDb();
    await ingest(db, check([line(), line()]));
    expect(rpcs).toHaveLength(2);
    expect(new Set(rpcs.map((r) => r.args.p_idempotency_key)).size).toBe(2);
  });

  it("a provider line id is the key", async () => {
    const { db, rpcs } = makeDb();
    await ingest(db, check([line({ lineId: "L-77" })]));
    expect(rpcs[0].args.p_idempotency_key).toBe(
      "pos:generic_webhook:chk-1:L:L-77",
    );
  });
});

describe("fractional quantity (L2, D3)", () => {
  it("half a glass draws half the pour", async () => {
    const { db, rpcs, consumption } = makeDb();
    await ingest(db, check([line({ qty: 0.5 })]));
    expect(rpcs).toHaveLength(1);
    expect(rpcs[0].fn).toBe("record_glass_pour");
    expect(rpcs[0].args.p_pours).toBe(1);
    expect(rpcs[0].args.p_pour_ml).toBe(75);
    const row = [...consumption.values()][0];
    expect(row.volume_ml).toBe(75);
    expect(row.quantity).toBe(1);
    expect(row.total_revenue).toBe(6);
  });

  it("two and a half glasses draw two pours and a half pour", async () => {
    const { db, rpcs, consumption } = makeDb();
    await ingest(db, check([line({ qty: 2.5 })]));
    expect(rpcs.map((r) => [r.args.p_pours, r.args.p_pour_ml])).toEqual([
      [2, 150],
      [1, 75],
    ]);
    const keys = rpcs.map((r) => r.args.p_idempotency_key);
    expect(keys[1]).toBe(`${keys[0]}:frac`);
    const vol = [...consumption.values()].reduce((n, r) => n + r.volume_ml, 0);
    expect(vol).toBe(375);
  });

  it("half a bottle draws half its millilitres", async () => {
    const { db, rpcs } = makeDb({ unit: "bottle" });
    await ingest(db, check([line({ qty: 0.5, price: 60 })]));
    expect(rpcs).toHaveLength(1);
    expect(rpcs[0].fn).toBe("record_glass_pour");
    expect(rpcs[0].args.p_pour_ml).toBe(375);
  });

  it("a whole quantity is as before: one write", async () => {
    const { db, rpcs } = makeDb();
    await ingest(db, check([line({ qty: 3 })]));
    expect(rpcs).toHaveLength(1);
    expect(rpcs[0].args.p_pours).toBe(3);
  });
});

describe("absent price (L3, D5)", () => {
  it("a bottle with no price books the menu price and is counted", async () => {
    const { db, consumption } = makeDb({ unit: "bottle", menu: 80 });
    const res = await ingest(db, check([line({ price: null })]));
    expect([...consumption.values()][0].unit_price).toBe(80);
    expect(res.stock.priceNotSent).toBe(1);
  });

  it("a pour with no price books no revenue and is counted", async () => {
    const { db, consumption } = makeDb();
    const res = await ingest(db, check([line({ price: null })]));
    const row = [...consumption.values()][0];
    expect(row.unit_price).toBeNull();
    expect(row.total_revenue).toBeNull();
    expect(res.stock.priceNotSent).toBe(1);
  });

  it("a rung zero and a comp flag book nothing and are not unsent", async () => {
    const { db, consumption } = makeDb({ unit: "bottle", menu: 80 });
    const zero = await ingest(db, check([line({ price: 0 })]));
    const comp = await ingest(
      db,
      check([line({ price: null, comped: true })], {
        externalCheckId: "chk-2",
      }),
    );
    for (const r of consumption.values()) expect(r.unit_price).toBe(0);
    expect(zero.stock.priceNotSent).toBe(0);
    expect(comp.stock.priceNotSent).toBe(0);
  });
});

describe("a voided fraction (L4)", () => {
  it("is not returned as a whole bottle, and the line says so", async () => {
    const { db, rpcs } = makeDb({ unit: "bottle" });
    const res = await ingest(
      db,
      check([line({ qty: 0.5, price: 60 })], { voided: true }),
    );
    expect(rpcs.filter((r) => r.fn === "apply_stock_movement")).toHaveLength(0);
    expect(res.stock.failed).toBe(1);
    expect(res.errors.join(" ")).toMatch(/fractional quantity/);
  });
});
