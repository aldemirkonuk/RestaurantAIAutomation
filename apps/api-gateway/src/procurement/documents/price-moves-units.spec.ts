import { DocumentsController } from "./documents.controller";

/** r106 fz: a price per 6 and a lot written from a per-case line are not per-bottle costs. */
type L = Record<string, unknown>;
function controllerWith(o: { lines: L[]; lots: L[]; srcDeliveries: L[]; srcLines: L[] }) {
  const db = {
    getClient: () => ({
      from: (table: string) => {
        const eqs: Record<string, unknown> = {};
        const b: any = {};
        for (const m of ["select", "order", "limit", "in", "not", "or"]) b[m] = () => b;
        b.eq = (k: string, v: unknown) => ((eqs[k] = v), b);
        const answer = () => {
          if (table === "procurement_documents") return { data: { id: "d1", currency: "USD" }, error: null };
          if (table === "restaurants") return { data: { currency: "USD" }, error: null };
          if (table === "inventory_lots") return { data: o.lots.filter((l) => l.inventory_id === eqs.inventory_id), error: null };
          if (table === "document_deliveries")
            return { data: eqs.document_id ? [] : o.srcDeliveries, error: null };
          return { data: eqs.document_id ? o.lines : o.srcLines, error: null };
        };
        b.maybeSingle = () => Promise.resolve(answer());
        b.then = (res: any, rej: any) => Promise.resolve(answer()).then(res, rej);
        return b;
      },
    }),
  };
  const Ctor = DocumentsController as any;
  return new Ctor({}, db, ...Array.from({ length: 10 }, () => ({}))) as DocumentsController;
}
const user = { userId: "u1", restaurantId: "rest-1" } as any;
const line = (o: L = {}) => ({ id: "l1", line_no: 1, description: "Albariño", uom: "bottle", unit_price: 10.5, price_base_qty: null, price_base_uom: null, inventory_id: "g1", ...o });
const lot = (cost: number) => ({ inventory_id: "g1", unit_cost: cost, received_at: "2026-11-01", delivery_id: "D0" });
const D0 = [{ document_id: "src", delivery_id: "D0" }];
const srcLine = (o: L = {}) => ({ document_id: "src", inventory_id: "g1", uom: "bottle", unit_price: 10, price_base_qty: null, price_base_uom: null, ...o });

describe("DocumentsController.priceMoves — units (r106 fz)", () => {
  it("a bottle line priced per 6 is divided by 6, not read as 500 percent up", async () => {
    const c = controllerWith({ lines: [line({ unit_price: 60, price_base_qty: 6, price_base_uom: "bottle" })], lots: [lot(10)], srcDeliveries: D0, srcLines: [srcLine()] });
    const out = await c.priceMoves("d1", user);
    expect(out.lines[0]).toMatchObject({ compared: true, moved: false, pct: 0 });
  });
  it("a price per case (base uom case) is not compared", async () => {
    const c = controllerWith({ lines: [line({ unit_price: 120, price_base_qty: 1, price_base_uom: "case" })], lots: [lot(10)], srcDeliveries: D0, srcLines: [srcLine()] });
    expect((await c.priceMoves("d1", user)).lines[0]).toMatchObject({ compared: false, reason: "unit_differs" });
  });
  it("a lot written from last month's per-case line is not compared with a per-bottle price", async () => {
    const c = controllerWith({ lines: [line()], lots: [lot(120)], srcDeliveries: D0, srcLines: [srcLine({ uom: "case", unit_price: 120 })] });
    expect((await c.priceMoves("d1", user)).lines[0]).toMatchObject({ compared: false, reason: "unit_differs" });
  });
  it("a lot written from a per-6 line is not compared either", async () => {
    const c = controllerWith({ lines: [line()], lots: [lot(60)], srcDeliveries: D0, srcLines: [srcLine({ unit_price: 60, price_base_qty: 6, price_base_uom: "bottle" })] });
    expect((await c.priceMoves("d1", user)).lines[0]).toMatchObject({ compared: false, reason: "unit_differs" });
  });
  it("a lot whose source paper cannot be found is not compared", async () => {
    const c = controllerWith({ lines: [line()], lots: [lot(10)], srcDeliveries: [], srcLines: [] });
    expect((await c.priceMoves("d1", user)).lines[0]).toMatchObject({ compared: false, reason: "unit_differs" });
  });
});
