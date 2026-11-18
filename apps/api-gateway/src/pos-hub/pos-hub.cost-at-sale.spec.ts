/**
 * The cost a sale keeps (r57 table side, D4).
 *
 *  C1 A line's consumption row keeps what it cost when it sold: bottle cost x
 *     the share poured, with its basis, source lot and source order.
 *  C2 A later invoice (the lot re-priced) moves no closed check: the margin
 *     reader reads the row, not the lot.
 *  C3 No recorded cost: the row keeps none ("cost not kept"), counted on the
 *     import, never a cost of 0. A failed cost read says so and books the same.
 *  C4 A void zeroes the row's cost with the rest of it.
 *  C5 A margin read that fails throws; it never reads as an empty check.
 */
import { Logger } from "@nestjs/common";
import { PosHubService } from "./pos-hub.service";
import { DatabaseService } from "../database/database.service";

type Row = Record<string, any>;

function makeDb(opts: { lots?: Row[]; lastPrice?: number | null; lotsError?: boolean; logReadError?: boolean }) {
  const consumption = new Map<string, Row>();
  const state = { lots: opts.lots ?? [] };
  const client: any = {
    from(table: string) {
      const filters: Row = {};
      let patch: Row | null = null;
      let like: string | null = null;
      const q: any = {
        select: () => q,
        eq: (k: string, v: any) => {
          filters[k] = v;
          return q;
        },
        like: (_k: string, v: string) => {
          like = v;
          return q;
        },
        in: () => q,
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
        then: (res: any, rej: any) => {
          if (table === "wine_consumption_log" && patch) {
            const hit = consumption.get(filters.notes);
            if (hit) Object.assign(hit, patch);
          }
          if (table === "wine_consumption_log" && !patch && like !== null) {
            if (opts.logReadError)
              return Promise.resolve({ data: null, error: { message: "boom" } }).then(res, rej);
            // % matches anything; the escapes are not exercised here
            const re = new RegExp("^" + like.replace(/\\(.)/g, "$1").replace(/%/g, ".*") + "$");
            const data = [...consumption.values()].filter((r) => re.test(r.notes));
            return Promise.resolve({ data, error: null }).then(res, rej);
          }
          if (table === "inventory_lots")
            return Promise.resolve(
              opts.lotsError
                ? { data: null, error: { message: "lots down" } }
                : { data: state.lots, error: null },
            ).then(res, rej);
          return Promise.resolve({ error: null }).then(res, rej);
        },
      };
      if (table === "pos_item_mappings")
        q.in = async () => ({
          data: [{ external_item_id: "item-1", item_name: "House Red", is_wine: true, inventory_id: "inv-1", sale_unit: "glass" }],
          error: null,
        });
      if (table === "restaurant_inventory")
        q.in = async () => ({
          data: [{ id: "inv-1", bottle_size_ml: 750, pour_size_ml: 150, menu_price_current: 90, last_purchase_price: opts.lastPrice ?? null }],
          error: null,
        });
      if (table === "inventory_lot_rollup")
        q.in = async () => {
          const costed = state.lots.filter((l) => l.unit_cost != null && l.qty > 0);
          const qty = costed.reduce((a, l) => a + l.qty, 0);
          const wac = qty ? costed.reduce((a, l) => a + l.qty * l.unit_cost, 0) / qty : null;
          return { data: [{ inventory_id: "inv-1", live_qty: qty, wac, has_invoice_cost: costed.length > 0, wac_qty: qty }], error: null };
        };
      if (table === "restaurant_tables")
        q.eq = () => ({ eq: async () => ({ data: [], error: null }) });
      return q;
    },
    rpc: async () => ({ data: "tx-1", error: null }),
  };
  return { db: { getClient: () => client } as unknown as DatabaseService, consumption, state };
}

const check = (over: Row = {}) => ({
  externalCheckId: "chk-1",
  openedAt: "2026-09-02T18:00:00Z",
  closedAt: "2026-09-02T19:00:00Z",
  items: [{ name: "House Red", externalItemId: "item-1", qty: 2, price: 12 }],
  ...over,
});
const KEY = "pos:generic_webhook:chk-1:item-1||12.0000:#0";
const lot = (over: Row = {}) => ({
  id: "lot-1", inventory_id: "inv-1", qty: 6, unit_cost: 30, cost_provenance: "invoice",
  source_order_id: "ord-1", received_at: "2026-08-01", stock_state: "live", ...over,
});

describe("cost at sale (C1-C5)", () => {
  let errorSpy: jest.SpyInstance;
  beforeEach(() => {
    errorSpy = jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
  });
  afterEach(() => errorSpy.mockRestore());

  it("C1 the row keeps the cost of the pours, its basis, lot and order", async () => {
    const { db, consumption } = makeDb({ lots: [lot()] });
    const out: any = await new PosHubService(db).ingest("r1", "generic_webhook", [check()]);
    // 2 glasses x 150ml of a 750ml bottle costing 30 = 12
    expect(consumption.get(KEY)).toMatchObject({
      cost_at_sale: 12,
      cost_basis: "invoice_lot_wac",
      cost_source_lot_id: "lot-1",
      cost_source_order_id: "ord-1",
    });
    expect(JSON.stringify(out)).toContain('"costNotKept":0');
  });

  it("C2 a re-priced lot moves neither the row nor the check's margin", async () => {
    const { db, state } = makeDb({ lots: [lot()] });
    const svc = new PosHubService(db);
    await svc.ingest("r1", "generic_webhook", [check()]);
    const before = await svc.getCheckMargin("r1", "chk-1");
    expect(before).toMatchObject({ revenue: 24, cost: 12, margin: 12 });
    state.lots = [lot({ unit_cost: 60 })];
    const after = await svc.getCheckMargin("r1", "chk-1");
    expect(after).toEqual(before);
    // and a replay of the same check under the new price books nothing new
    await svc.ingest("r1", "generic_webhook", [check()]);
    expect((await svc.getCheckMargin("r1", "chk-1")).cost).toBe(12);
  });

  it("C3 no recorded cost keeps none, said in words and counted; never 0", async () => {
    const { db, consumption } = makeDb({ lots: [], lastPrice: null });
    const svc = new PosHubService(db);
    const out: any = await svc.ingest("r1", "generic_webhook", [check()]);
    expect(consumption.get(KEY)).toMatchObject({ cost_at_sale: null, cost_basis: null });
    expect(JSON.stringify(out)).toContain('"costNotKept":1');
    const m = await svc.getCheckMargin("r1", "chk-1");
    expect(m.lines[0]).toMatchObject({ costKept: false, costNote: "cost not kept" });
    expect(m.margin).toBeNull();
    expect(m.sentence).toMatch(/not kept for 1 of 1 line/);
  });

  it("C3 a failed cost read is logged, books the row without a cost, and still moves the sale", async () => {
    const { db, consumption } = makeDb({ lots: [lot()], lotsError: true });
    const out: any = await new PosHubService(db).ingest("r1", "generic_webhook", [check()]);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("sale cost lookup failed"));
    expect(consumption.get(KEY)).toMatchObject({ quantity: 2, cost_at_sale: null });
    expect(JSON.stringify(out)).toContain('"costNotKept":1');
  });

  it("C3 a row booked before costs were kept reads as cost not kept, not as today's lot cost", async () => {
    const { db, consumption } = makeDb({ lots: [lot()] });
    const svc = new PosHubService(db);
    await svc.ingest("r1", "generic_webhook", [check()]);
    const row = consumption.get(KEY)!;
    delete row.cost_at_sale;
    delete row.cost_basis;
    const m = await svc.getCheckMargin("r1", "chk-1");
    expect(m.cost).toBe(0);
    expect(m.lines[0].costNote).toBe("cost not kept");
  });

  it("C4 a void zeroes the cost with the row", async () => {
    const { db, consumption } = makeDb({ lots: [lot()] });
    const svc = new PosHubService(db);
    await svc.ingest("r1", "generic_webhook", [check()]);
    await svc.ingest("r1", "generic_webhook", [check({ voided: true })]);
    expect(consumption.get(KEY)).toMatchObject({ quantity: 0, cost_at_sale: 0 });
    const m = await svc.getCheckMargin("r1", "chk-1");
    expect(m.voidedLines).toBe(1);
    expect(m.lines).toHaveLength(0);
  });

  it("C5 a margin read that fails throws instead of reading as an empty check", async () => {
    const { db } = makeDb({ lots: [lot()], logReadError: true });
    await expect(new PosHubService(db).getCheckMargin("r1", "chk-1")).rejects.toThrow(/could not be read/);
  });

  it("C5 another check's rows are not this check's", async () => {
    const { db } = makeDb({ lots: [lot()] });
    const svc = new PosHubService(db);
    await svc.ingest("r1", "generic_webhook", [check({ externalCheckId: "chk-10" })]);
    expect((await svc.getCheckMargin("r1", "chk-1")).lines).toHaveLength(0);
    expect((await svc.getCheckMargin("r1", "chk-10")).lines).toHaveLength(1);
  });
});
