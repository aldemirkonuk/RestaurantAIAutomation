import { DocumentsController } from "./documents.controller";

/** A thenable fake db: one canned answer per table, every call chains. */
const HOUSE = { procurement_documents: { data: { id: "d1", currency: "USD" }, error: null }, restaurants: { data: { currency: "USD" }, error: null } };
type Call = { table: string; method: string; args: unknown[] };
function controllerWith(results: Record<string, { data: unknown; error: unknown }>, calls: Call[] = []) {
  results = { ...HOUSE, ...results };
  const db = {
    getClient: () => ({
      from: (table: string) => {
        const b: any = {};
        // A list answer is FILTERED, ORDERED and LIMITED as the real read would
        // be, so a test cannot pass on a fixture that happens to be pre-sorted
        // or pre-cut. A filter on a column the fixture rows do not carry is
        // ignored (the call is still recorded and asserted separately).
        const eqs: [string, unknown][] = [];
        const lts: [string, string][] = [];
        let ord: { col: string; asc: boolean } | null = null;
        let cap: number | null = null;
        const answer = () => {
          const r = results[table];
          if (!Array.isArray(r?.data)) return r;
          let rows = (r.data as Record<string, any>[]).filter(
            (row) =>
              eqs.every(([c, v]) => !(c in row) || row[c] === v) &&
              lts.every(([c, v]) => !(c in row) || String(row[c]) < v),
          );
          if (ord) {
            const { col, asc } = ord;
            rows = [...rows].sort((a, b) => (String(a[col]) < String(b[col]) ? -1 : String(a[col]) > String(b[col]) ? 1 : 0) * (asc ? 1 : -1));
          }
          return { ...r, data: cap == null ? rows : rows.slice(0, cap) };
        };
        const rec = (m: string, args: unknown[]) => calls.push({ table, method: m, args });
        for (const m of ["select", "in", "not"]) b[m] = (...args: unknown[]) => (rec(m, args), b);
        b.eq = (...args: unknown[]) => (rec("eq", args), eqs.push([args[0] as string, args[1]]), b);
        b.lt = (...args: unknown[]) => (rec("lt", args), lts.push([args[0] as string, String(args[1])]), b);
        b.order = (...args: unknown[]) => (rec("order", args), (ord = { col: args[0] as string, asc: (args[1] as any)?.ascending !== false }), b);
        b.limit = (...args: unknown[]) => (rec("limit", args), (cap = args[0] as number), b);
        b.maybeSingle = () => Promise.resolve(results[table]);
        b.then = (res: any, rej: any) => Promise.resolve(answer()).then(res, rej);
        return b;
      },
    }),
  };
  const Ctor = DocumentsController as any;
  return new Ctor({}, db, ...Array.from({ length: 10 }, () => ({}))) as DocumentsController;
}

const user = { userId: "u1", restaurantId: "rest-1" } as any;
const line = (over: Record<string, unknown>) => ({
  id: "l1",
  line_no: 1,
  description: "Albariño 2022",
  uom: "bottle",
  unit_price: 11.8,
  inventory_id: "g1",
  ...over,
});
const lot = (cost: number, at: string, good = "g1") => ({ inventory_id: good, unit_cost: cost, received_at: at });

describe("DocumentsController.priceMoves — a cost that jumped with no PO to catch it (r104 g4)", () => {
  it("says what moved, against the good's NEWEST invoiced lot", async () => {
    const c = controllerWith({
      procurement_document_lines: { data: [line({})], error: null },
      inventory_lots: { data: [lot(10, "2026-11-01"), lot(7, "2026-06-01")], error: null },
    });
    const out = await c.priceMoves("d1", user);
    expect(out.lines[0]).toMatchObject({ compared: true, moved: true, sentence: "was 10.00, now 11.80, up 18 percent" });
  });

  it("asks the lot table for this house's INVOICED lots, newest first (the fixture alone cannot prove it)", async () => {
    const calls: Call[] = [];
    const c = controllerWith(
      {
        procurement_document_lines: { data: [line({})], error: null },
        inventory_lots: { data: [lot(10, "2026-11-01")], error: null },
      },
      calls,
    );
    await c.priceMoves("d1", user);
    const lots = calls.filter((x) => x.table === "inventory_lots");
    expect(lots).toContainEqual({ table: "inventory_lots", method: "eq", args: ["restaurant_id", "rest-1"] });
    expect(lots).toContainEqual({ table: "inventory_lots", method: "eq", args: ["cost_provenance", "invoice"] });
    expect(lots).toContainEqual({ table: "inventory_lots", method: "order", args: ["received_at", { ascending: false }] });
  });

  it("finds the last cost of EVERY good, however many newer lots the others have (no shared row cap)", async () => {
    // 1,200 invoiced lots of the busy good, all newer than the one lot the rare
    // good has. One read capped at 1,000 rows across both goods never reaches it.
    const busy = Array.from({ length: 1200 }, (_, i) => lot(10, `2026-10-${String(1 + (i % 28)).padStart(2, "0")}T${String(i % 24).padStart(2, "0")}:00:00Z`, "g1"));
    const c = controllerWith({
      procurement_document_lines: {
        data: [line({}), line({ id: "l2", line_no: 2, inventory_id: "g2", unit_price: 20 })],
        error: null,
      },
      inventory_lots: { data: [...busy, lot(16, "2026-01-05T00:00:00Z", "g2")], error: null },
    });
    const out = await c.priceMoves("d1", user);
    expect(out.lines[0]).toMatchObject({ compared: true });
    expect(out.lines[1]).toMatchObject({ compared: true, moved: true, sentence: "was 16.00, now 20.00, up 25 percent" });
  });

  it("has no sentence when the good has no previous cost", async () => {
    const c = controllerWith({
      procurement_document_lines: { data: [line({})], error: null },
      inventory_lots: { data: [], error: null },
    });
    const out = await c.priceMoves("d1", user);
    expect(out.lines[0]).toEqual(expect.objectContaining({ compared: false, reason: "no_previous" }));
    expect((out.lines[0] as any).sentence).toBeUndefined();
  });
  it("carries both currency codes so the page can say why nothing was compared (r106)", async () => {
    const c = controllerWith({
      procurement_documents: { data: { id: "d1", currency: "TRY" }, error: null },
      procurement_document_lines: { data: [line({})], error: null },
      inventory_lots: { data: [], error: null },
    });
    expect(await c.priceMoves("d1", user)).toMatchObject({ paperCurrency: "TRY", houseCurrency: "USD" });
  });

  it("does not compare a line priced per case against a bottle cost", async () => {
    const c = controllerWith({
      procurement_document_lines: { data: [line({ uom: "case" })], error: null },
      inventory_lots: { data: [lot(10, "2026-11-01")], error: null },
    });
    const out = await c.priceMoves("d1", user);
    expect(out.lines[0]).toEqual(expect.objectContaining({ compared: false, reason: "unit_differs" }));
  });

  it("never reads a failed lot read as 'nothing moved'", async () => {
    const c = controllerWith({
      procurement_document_lines: { data: [line({})], error: null },
      inventory_lots: { data: null, error: { message: "boom" } },
    });
    await expect(c.priceMoves("d1", user)).rejects.toMatchObject({ status: 500 });
  });

  it("takes a house threshold", async () => {
    const c = controllerWith({
      procurement_document_lines: { data: [line({})], error: null },
      inventory_lots: { data: [lot(10, "2026-11-01")], error: null },
    });
    const out = await c.priceMoves("d1", user, "25");
    expect(out.lines[0]).toMatchObject({ compared: true, moved: false });
  });

  it("does not compare a TRY paper's price with a USD lot cost", async () => {
    const c = controllerWith({
      procurement_documents: { data: { id: "d1", currency: "TRY" }, error: null },
      procurement_document_lines: { data: [line({ unit_price: 12.5 })], error: null },
      inventory_lots: { data: [lot(10, "2026-11-01")], error: null },
    });
    const out = await c.priceMoves("d1", user);
    expect(out.lines[0]).toEqual(expect.objectContaining({ compared: false, reason: "currency_differs" }));
    expect((out.lines[0] as any).sentence).toBeUndefined();
  });

  it("compares nothing when a currency is unknown, and says so", async () => {
    const c = controllerWith({
      procurement_documents: { data: { id: "d1", currency: null }, error: null },
      procurement_document_lines: { data: [line({})], error: null },
      inventory_lots: { data: [lot(10, "2026-11-01")], error: null },
    });
    const out = await c.priceMoves("d1", user);
    expect(out.lines[0]).toEqual(expect.objectContaining({ compared: false, reason: "currency_unknown" }));
  });

  it("answers 404 in words for a paper that is not this house's", async () => {
    const c = controllerWith({
      procurement_documents: { data: null, error: null },
      procurement_document_lines: { data: [line({})], error: null },
    });
    await expect(c.priceMoves("foreign", user)).rejects.toMatchObject({ status: 404 });
    await expect(c.priceMoves("foreign", user)).rejects.toThrow(/not one of this house's/);
  });

  it("a failed house-currency read says it failed", async () => {
    const c = controllerWith({
      restaurants: { data: null, error: { message: "boom" } },
      procurement_document_lines: { data: [line({})], error: null },
    });
    await expect(c.priceMoves("d1", user)).rejects.toMatchObject({ status: 500 });
  });
});
