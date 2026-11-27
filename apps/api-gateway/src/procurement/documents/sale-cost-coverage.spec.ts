import { DocumentsController } from "./documents.controller";
import { CHANGES_PAGE } from "./sealed-changes";

/** A stand-in db that APPLIES eq / in / gte / range, so a dropped filter or a stopped page fails a test. */
type Row = Record<string, any>;
function controllerWith(tables: Record<string, Row[]>) {
  const reads: { table: string; f: [string, string, any][]; range: [number, number] | null }[] = [];
  const db = {
    getClient: () => ({
      from: (table: string) => {
        const f: [string, string, any][] = [];
        let range: [number, number] | null = null;
        const rows = () =>
          (tables[table] ?? []).filter((r) =>
            f.every(([op, c, v]) => (op === "eq" ? r[c] === v : op === "in" ? v.includes(r[c]) : op === "gte" ? r[c] >= v : true)),
          );
        const b: any = {};
        b.select = () => b;
        b.order = () => b;
        for (const op of ["eq", "in", "gte"]) b[op] = (c: string, v: any) => (f.push([op, c, v]), b);
        b.range = (a: number, z: number) => ((range = [a, z]), b);
        b.maybeSingle = () => (reads.push({ table, f, range }), Promise.resolve({ data: rows()[0] ?? null, error: null }));
        b.then = (res: any, rej: any) => {
          reads.push({ table, f, range });
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
const recent = () => new Date(Date.now() - 2 * 86_400_000).toISOString();
const sale = (cost: string | null, basis: string | null, over: Row = {}) => ({
  id: `s${Math.random()}`, restaurant_id: R, cost_at_sale: cost, cost_basis: basis, cost_source_order_id: null,
  quantity: 1, volume_ml: 150, recorded_at: recent(), ...over,
});
const base = (over: Record<string, Row[]> = {}) => ({
  restaurants: [{ id: R, currency: "USD" }],
  procurement_orders: [
    { id: "o1", restaurant_id: R, provider_id: "p1", delivered_at: "2026-11-24T09:00:00Z", currency: "USD" },
    { id: "o2", restaurant_id: R, provider_id: "p2", delivered_at: "2026-11-25T09:00:00Z", currency: "USD" },
  ],
  providers: [{ id: "p1", name: "Vinoteca" }, { id: "p2", name: "Anfora" }],
  procurement_document_links: [{ restaurant_id: R, order_id: "o1", document_id: "d1" }],
  procurement_documents: [{ id: "d1", restaurant_id: R, status: "needs_review" }],
  ...over,
});

describe("GET /procurement/documents/sale-cost-coverage (r109 g2)", () => {
  it("sums 2,300 rows by basis exactly, past two pages", async () => {
    const rows = [
      ...Array.from({ length: 1000 }, () => sale("1.0102", "invoice_lot_wac")),
      ...Array.from({ length: 700 }, () => sale("0.3333", "invoice_restated")),
      ...Array.from({ length: 300 }, () => sale("0.2", "invoice_lot_wac_partial")),
      ...Array.from({ length: 200 }, () => sale("0.5", "last_purchase_price", { cost_source_order_id: "o1" })),
      ...Array.from({ length: 100 }, () => sale("0.25", "last_purchase_price", { cost_source_order_id: "o2" })),
    ];
    expect(rows.length).toBeGreaterThan(2 * CHANGES_PAGE);
    const c = controllerWith(base({ wine_consumption_log: rows }));
    const out: any = await c.saleCostCoverage(owner, "30");
    expect(out).toMatchObject({
      days: 30, currency: "USD", sales: 2300, notKept: 0,
      checked: "1243.51", partial: "60.00", estimate: "125.00", other: "0.00", total: "1428.51",
      food: "Food costs are not drawn yet.",
    });
    expect(out.estimateDeliveries).toEqual([
      { orderId: "o1", cost: "100.00", sales: 200, vendor: "Vinoteca", deliveredAt: "2026-11-24T09:00:00Z", paper: { state: "in_review", documentId: "d1" } },
      { orderId: "o2", cost: "25.00", sales: 100, vendor: "Anfora", deliveredAt: "2026-11-25T09:00:00Z", paper: { state: "none", documentId: null } },
    ]);
    const pages = c.reads.filter((r) => r.table === "wine_consumption_log");
    expect(pages.length).toBe(3);
    expect(pages.every((r) => r.f.some(([op, col, v]) => op === "eq" && col === "restaurant_id" && v === R))).toBe(true);
  });

  it("counts a null cost as not kept, never as 0, and leaves a voided line out", async () => {
    const c = controllerWith(
      base({
        wine_consumption_log: [
          sale("2.50", "invoice_lot_wac"),
          sale(null, null),
          sale("0", "last_purchase_price", { quantity: 0, volume_ml: 0, cost_source_order_id: "o1" }),
        ],
      }),
    );
    const out: any = await c.saleCostCoverage(owner, "7");
    expect(out).toMatchObject({ days: 7, sales: 1, notKept: 1, voided: 1, total: "2.50", estimate: "0.00" });
    expect(out.estimateDeliveries).toEqual([]);
  });

  it("reads only the window and only this house", async () => {
    const c = controllerWith(
      base({
        wine_consumption_log: [
          sale("1", "invoice_lot_wac"),
          sale("5", "invoice_lot_wac", { recorded_at: "2020-01-01T00:00:00Z" }),
          sale("7", "invoice_lot_wac", { restaurant_id: "rest-2" }),
        ],
      }),
    );
    expect(await c.saleCostCoverage(owner, "7")).toMatchObject({ total: "1.00", sales: 1 });
  });

  it("refuses a house whose costs came in two currencies, in words, and converts nothing", async () => {
    const c = controllerWith(
      base({
        procurement_orders: [{ id: "o1", restaurant_id: R, provider_id: "p1", delivered_at: null, currency: "TRY" }],
        wine_consumption_log: [sale("1", "last_purchase_price", { cost_source_order_id: "o1" })],
      }),
    );
    await expect(c.saleCostCoverage(owner, "7")).rejects.toMatchObject({
      status: 409,
      message: expect.stringMatching(/USD and TRY, and nothing here converts one into the other/),
    });
  });

  it("a delivery whose paper is checked says so; a sale with no delivery is its own row", async () => {
    const c = controllerWith(
      base({
        procurement_documents: [{ id: "d1", restaurant_id: R, status: "verified" }],
        wine_consumption_log: [
          sale("1", "last_purchase_price", { cost_source_order_id: "o1" }),
          sale("2", "last_purchase_price"),
        ],
      }),
    );
    const out: any = await c.saleCostCoverage(owner, "7");
    expect(out.estimateDeliveries).toEqual([
      expect.objectContaining({ orderId: null, cost: "2.00", vendor: null, paper: { state: "none", documentId: null } }),
      expect.objectContaining({ orderId: "o1", cost: "1.00", paper: { state: "checked", documentId: "d1" } }),
    ]);
  });

  it("refuses staff in words with a 403 before reading anything", async () => {
    const c = controllerWith(base({ wine_consumption_log: [sale("1", "invoice_lot_wac")] }));
    await expect(c.saleCostCoverage({ ...owner, role: "staff" }, "7")).rejects.toMatchObject({
      status: 403,
      message: expect.stringMatching(/an owner or a manager reads it\. You are signed in as staff/),
    });
    expect(c.reads).toHaveLength(0);
  });
});
