import { DocumentsController } from "./documents.controller";
import { CHANGES_PAGE, toMicro } from "./sealed-changes";

/** A stand-in db that APPLIES eq / in / neq / range, so a dropped filter or a stopped page fails a test. */
type Row = Record<string, any>;
function controllerWith(tables: Record<string, Row[]>) {
  const reads: { table: string; f: [string, string, any][] }[] = [];
  const db = {
    getClient: () => ({
      from: (table: string) => {
        const f: [string, string, any][] = [];
        let range: [number, number] | null = null;
        const rows = () =>
          (tables[table] ?? []).filter((r) =>
            f.every(([op, c, v]) => (op === "eq" ? r[c] === v : op === "neq" ? r[c] !== v : op === "in" ? v.includes(r[c]) : true)),
          );
        const b: any = {};
        b.select = () => b;
        b.order = () => b;
        for (const op of ["eq", "neq", "in"]) b[op] = (c: string, v: any) => (f.push([op, c, v]), b);
        b.range = (a: number, z: number) => ((range = [a, z]), b);
        b.maybeSingle = () => (reads.push({ table, f }), Promise.resolve({ data: rows()[0] ?? null, error: null }));
        b.then = (res: any, rej: any) => {
          reads.push({ table, f });
          const all = rows();
          return Promise.resolve({ data: range ? all.slice(range[0], range[1] + 1) : all, error: null }).then(res, rej);
        };
        return b;
      },
    }),
  };
  const Ctor = DocumentsController as any;
  const c = new Ctor({}, db, ...Array.from({ length: 10 }, () => ({}))) as DocumentsController;
  return Object.assign(c, { reads });
}

const R = "rest-1";
const owner = { userId: "u1", restaurantId: R, role: "owner" } as any;
const SEAL = "2026-11-20T10:00:00.123456+00:00";
const base = (over: Record<string, Row[]> = {}) => ({
  restaurants: [{ id: R, currency: "USD" }],
  procurement_documents: [{ id: "d1", restaurant_id: R, status: "verified" }],
  procurement_document_links: [{ document_id: "d1", order_id: "o1", restaurant_id: R }],
  ...over,
});
const reval = (qty: number, prior: string | null, next: string, over: Row = {}) => ({
  restaurant_id: R, source_order_id: "o1", qty_at_revaluation: qty, prior_unit_cost: prior, new_unit_cost: next, created_at: SEAL, ...over,
});
const rest = (i: number, prior: string | null, next: string, over: Row = {}) => ({
  restaurant_id: R, source_order_id: "o1", consumption_id: `s${i}`, prior_cost_at_sale: prior, new_cost_at_sale: next, created_at: SEAL, ...over,
});

describe("GET /procurement/documents/:id/changes — what sealing changed (r108 g17)", () => {
  it("sums 2,345 restatement rows exactly, past the first page", async () => {
    const rows = Array.from({ length: 2345 }, (_, i) => rest(i, "10.0000", "9.8766"));
    const c = controllerWith(base({ wine_consumption_cost_restatements: rows }));
    const out = await c.sealedChanges("d1", owner);
    expect(rows.length).toBeGreaterThan(2 * CHANGES_PAGE);
    expect(out).toMatchObject({ currency: "USD", sales: 2345, salesCostDelta: "-289.373", notKnown: 0 });
  });

  it("keeps 100.00 / 3 within the DD-r108-20 tolerance", async () => {
    // Three bottles were 30.00 each (90.00); the paper says 100.00 for the three.
    const c = controllerWith(base({ inventory_lot_revaluations: [reval(3, "30", "33.333333")] }));
    const out = await c.sealedChanges("d1", owner);
    expect(out.bottles).toBe(3);
    const off = toMicro(out.stockValueDelta) - toMicro("10.00");
    expect(Number(off < 0n ? -off : off)).toBeLessThanOrEqual(3 * 0.5);
  });

  it("counts a prior cost that was not known and leaves it out of the figure", async () => {
    const c = controllerWith(
      base({
        inventory_lot_revaluations: [reval(6, null, "20"), reval(2, "10", "12")],
        wine_consumption_cost_restatements: [rest(1, null, "15"), rest(2, "8.40", "8.00")],
      }),
    );
    const out = await c.sealedChanges("d1", owner);
    expect(out).toMatchObject({ stockValueDelta: "4.00", bottles: 2, salesCostDelta: "-0.40", sales: 1, notKnown: 2 });
  });

  it("never reads another house's rows, on every table", async () => {
    const c = controllerWith(
      base({
        procurement_document_links: [
          { document_id: "d1", order_id: "o1", restaurant_id: R },
          { document_id: "d1", order_id: "o9", restaurant_id: "other" },
        ],
        inventory_lot_revaluations: [reval(2, "10", "12"), reval(5, "10", "99", { restaurant_id: "other" })],
        wine_consumption_cost_restatements: [rest(1, "8", "9"), rest(2, "1", "50", { restaurant_id: "other" })],
      }),
    );
    const out = await c.sealedChanges("d1", owner);
    expect(out).toMatchObject({ orders: ["o1"], stockValueDelta: "4.00", salesCostDelta: "1.00" });
    // document_deliveries has no house column: it is read by the id of a paper already proved to be this house's.
    for (const r of c.reads.filter((x) => x.table !== "restaurants" && x.table !== "document_deliveries"))
      expect(r.f).toContainEqual(["eq", "restaurant_id", R]);
    expect(c.reads.find((x) => x.table === "document_deliveries")?.f).toContainEqual(["eq", "document_id", "d1"]);
  });

  it("one verify of three goods is one total, however many stamps its items carry (no 'seal' and 'corrections')", async () => {
    // finalise_delivery_cost runs once per item, each in its own transaction: three goods, three stamps.
    const c = controllerWith(
      base({
        inventory_lot_revaluations: [
          reval(12, "10", "10.50", { created_at: "2026-11-20T10:00:00.100+00:00" }),
          reval(6, "20", "21", { created_at: "2026-11-20T10:00:00.480+00:00" }),
          reval(12, "5", "6", { created_at: "2026-11-20T10:00:01.020+00:00" }),
        ],
        wine_consumption_cost_restatements: [
          rest(1, "10", "11", { created_at: "2026-11-20T10:00:00.700+00:00" }),
          rest(2, "10", "10.50", { created_at: "2026-11-20T10:00:01.300+00:00" }),
        ],
      }),
    );
    const out = await c.sealedChanges("d1", owner);
    expect(out).toMatchObject({ stockValueDelta: "24.00", bottles: 30, salesCostDelta: "1.50", sales: 2 });
    expect(out).not.toHaveProperty("events");
  });

  describe("a door delivery with no order (the canonical path)", () => {
    const door = (over: Record<string, Row[]> = {}) =>
      base({
        procurement_document_links: [],
        document_deliveries: [{ document_id: "d1", delivery_id: "del1" }],
        inventory_lots: [
          { id: "L1", restaurant_id: R, delivery_id: "del1" },
          { id: "L2", restaurant_id: R, delivery_id: "del1" },
          { id: "LX", restaurant_id: "other-house", delivery_id: "del1" },
        ],
        ...over,
      });
    const lotReval = (lot: string, qty: number, prior: string | null, next: string, over: Row = {}) =>
      ({ id: `rv-${lot}-${next}`, restaurant_id: R, lot_id: lot, source_order_id: null, qty_at_revaluation: qty, prior_unit_cost: prior, new_unit_cost: next, created_at: SEAL, ...over });
    const settle = (i: number, prior: string | null, difference: string, over: Row = {}) =>
      ({ id: `st${i}`, restaurant_id: R, lot_id: "L1", txn_id: `t${i}`, prior_total: prior, difference, ...over });

    it("reads the lots' revaluations and the settlements of the sales made from them, not 'no order, no change'", async () => {
      const c = controllerWith(
        door({
          inventory_lot_revaluations: [
            lotReval("L1", 12, "10", "10.50"),
            lotReval("L2", 6, "20", "21", { created_at: "2026-11-20T10:00:01+00:00" }),
            lotReval("LX", 99, "1", "9"), // another house's lot: never read
          ],
          inventory_lot_draw_settlements: [settle(1, "10.00", "1.50"), settle(2, "20.00", "-0.50"), settle(3, "5.00", "9", { restaurant_id: "other-house" })],
        }),
      );
      const out = await c.sealedChanges("d1", owner);
      expect(out).toMatchObject({ orders: [], deliveries: 1, stockValueDelta: "12.00", bottles: 18, salesCostDelta: "1.00", sales: 2, notKnown: 0 });
    });

    it("counts a settlement with no prior as not known, never as a change of its whole cost", async () => {
      const c = controllerWith(door({ inventory_lot_draw_settlements: [settle(1, null, "40.00"), settle(2, "10.00", "2.00")] }));
      const out = await c.sealedChanges("d1", owner);
      expect(out).toMatchObject({ salesCostDelta: "2.00", sales: 1, notKnown: 1 });
    });

    it("counts a revaluation reached by both its order and its lot once", async () => {
      const both = { ...lotReval("L1", 4, "10", "11"), source_order_id: "o1" };
      const c = controllerWith(
        door({ procurement_document_links: [{ document_id: "d1", order_id: "o1", restaurant_id: R }], inventory_lot_revaluations: [both] }),
      );
      expect(await c.sealedChanges("d1", owner)).toMatchObject({ stockValueDelta: "4.00", bottles: 4 });
    });

    it("reads nothing off lots when the paper has neither order nor delivery", async () => {
      const c = controllerWith(base({ procurement_document_links: [] }));
      expect(await c.sealedChanges("d1", owner)).toMatchObject({ orders: [], deliveries: 0, bottles: 0, sales: 0 });
      expect(c.reads.map((r) => r.table)).not.toContain("inventory_lots");
    });
  });

  it("says how many other papers share the order's figures", async () => {
    const c = controllerWith(
      base({
        procurement_document_links: [
          { document_id: "d1", order_id: "o1", restaurant_id: R },
          { document_id: "d2", order_id: "o1", restaurant_id: R },
        ],
      }),
    );
    expect(await c.sealedChanges("d1", owner)).toMatchObject({ otherPapers: 1, stockValueDelta: "0.00" });
  });

  it("a paper linked to no order changed nothing, and reads no receipt", async () => {
    const c = controllerWith(base({ procurement_document_links: [] }));
    expect(await c.sealedChanges("d1", owner)).toMatchObject({ orders: [], sales: 0, bottles: 0 });
    expect(c.reads.map((r) => r.table)).not.toContain("inventory_lot_revaluations");
  });

  it("refuses staff in words with a 403 before reading anything", async () => {
    const c = controllerWith(base());
    const staff = { ...owner, role: "staff" };
    await expect(c.sealedChanges("d1", staff)).rejects.toMatchObject({ status: 403 });
    await expect(c.sealedChanges("d1", staff)).rejects.toThrow(/owner or a manager reads it. You are signed in as staff/);
    expect(c.reads).toEqual([]);
  });

  it("answers 404 in words for another house's paper", async () => {
    const c = controllerWith(base({ procurement_documents: [{ id: "d1", restaurant_id: "other", status: "verified" }] }));
    await expect(c.sealedChanges("d1", owner)).rejects.toMatchObject({ status: 404 });
  });
});

describe("GET :id/changes — the sales it settled, by table (r109 g3)", () => {
  const sale = (i: number, over: Row = {}) => ({
    id: `s${i}`, restaurant_id: R, wine_name: "House Red", quantity: 2, volume_ml: 300, consumption_type: "glass",
    recorded_at: `2026-11-21T20:${String(i % 60).padStart(2, "0")}:00+00:00`, notes: `pos:square:chk${i}:L:1`, ...over,
  });
  const check = (i: number, over: Row = {}) => ({
    id: `c${i}`, restaurant_id: R, source: "square", external_check_id: `chk${i}`, table_id: "t4", table_ref: "4", ...over,
  });
  const tables = [{ id: "t4", restaurant_id: R, label: "4" }, { id: "tb", restaurant_id: R, label: "Bar" }];

  it("names every one of 1,200 restated sales, paging each read past 1000, newest first", async () => {
    const n = 1200;
    const c = controllerWith(
      base({
        wine_consumption_cost_restatements: Array.from({ length: n }, (_, i) => rest(i, "3.1000", "2.9000", { id: `r${i}` })),
        wine_consumption_log: Array.from({ length: n }, (_, i) => sale(i)),
        pos_checks: Array.from({ length: n }, (_, i) => check(i)),
        restaurant_tables: tables,
      }),
    );
    const out: any = await c.sealedChanges("d1", owner);
    expect(n).toBeGreaterThan(CHANGES_PAGE);
    expect(out.salesList).toHaveLength(n);
    expect(out.salesUnnamed).toBe(0);
    expect(out.salesList[0]).toMatchObject({ table: "Table 4", wine: "House Red", quantity: 2, before: "3.10", after: "2.90", voided: false });
    const at = out.salesList.map((x: any) => x.at);
    expect([...at].sort().reverse()).toEqual(at);
    for (const t of ["wine_consumption_log", "pos_checks", "restaurant_tables"])
      expect(c.reads.filter((r) => r.table === t).every((r) => r.f.some(([op, col, v]) => op === "eq" && col === "restaurant_id" && v === R))).toBe(true);
  });

  it("another house's check gives no table; the till's word and no word fall back in order", async () => {
    const c = controllerWith(
      base({
        wine_consumption_cost_restatements: [1, 2, 3, 4].map((i) => rest(i, "3.1000", "2.9000", { id: `r${i}` })),
        wine_consumption_log: [sale(1), sale(2), sale(3), sale(4)],
        pos_checks: [
          check(1, { restaurant_id: "rest-2", table_id: "tb" }),
          check(2, { table_id: null, table_ref: "booth" }),
          check(3, { table_id: null, table_ref: null }),
          check(4, { table_id: "tb" }),
        ],
        restaurant_tables: tables,
      }),
    );
    const out: any = await c.sealedChanges("d1", owner);
    const by = Object.fromEntries(out.salesList.map((x: any) => [x.id, x.table]));
    expect(by).toEqual({ s1: "no table", s2: "Table booth", s3: "no table", s4: "Bar" });
  });

  it("a sale restated twice shows its latest event; a voided sale says so; a missing row is counted, not named", async () => {
    const c = controllerWith(
      base({
        wine_consumption_cost_restatements: [
          rest(1, "3.1000", "3.0000", { id: "a", created_at: "2026-11-20T10:00:00+00:00" }),
          rest(1, "3.0000", "2.9000", { id: "b", created_at: "2026-11-22T10:00:00+00:00" }),
          rest(2, "1.5000", "1.4000", { id: "c" }),
          rest(9, "1.0000", "0.9000", { id: "d" }),
        ],
        wine_consumption_log: [sale(1), sale(2, { quantity: 0, volume_ml: 0 }), sale(9, { restaurant_id: "rest-2" })],
        pos_checks: [check(1), check(2)],
        restaurant_tables: tables,
      }),
    );
    const out: any = await c.sealedChanges("d1", owner);
    expect(out.salesList.map((x: any) => x.id).sort()).toEqual(["s1", "s2"]);
    expect(out.salesList.find((x: any) => x.id === "s1")).toMatchObject({ before: "3.00", after: "2.90" });
    expect(out.salesList.find((x: any) => x.id === "s2")).toMatchObject({ voided: true });
    expect(out.salesUnnamed).toBe(1);
  });

  it("staff read no sales at all", async () => {
    const c = controllerWith(base({ wine_consumption_cost_restatements: [rest(1, "3.1", "2.9")], wine_consumption_log: [sale(1)] }));
    await expect(c.sealedChanges("d1", { ...owner, role: "staff" })).rejects.toMatchObject({ status: 403 });
    expect(c.reads.some((r) => r.table === "wine_consumption_log")).toBe(false);
  });
});

describe("toMicro", () => {
  it("parses decimal text exactly past 2^53 and rounds at the 7th place", () => {
    expect(toMicro("123456789012.345678")).toBe(123456789012345678n);
    expect(toMicro("0.0000005")).toBe(1n);
    expect(toMicro("-0.0000005")).toBe(-1n);
    expect(toMicro(8.4)).toBe(8400000n);
  });
});
