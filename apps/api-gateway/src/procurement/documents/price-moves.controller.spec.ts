import { DocumentsController } from "./documents.controller";

/** A stand-in db that APPLIES the filters (r108 g15). */
type Row = Record<string, any>;
type SimPaper = Row & { procurement_document_lines: Row[] };
type Sim = Record<string, any> & { papers?: SimPaper[]; papersError?: unknown };
const HOUSE: Sim = {
  procurement_documents: { data: { id: "d1", currency: "USD" }, error: null },
  restaurants: { data: { currency: "USD" }, error: null },
};
const LN = "procurement_document_lines.";
const hit = (r: Row, op: string, col: string, v: any) => {
  const x = r[col];
  return op === "eq" ? x === v : op === "neq" ? x !== v : op === "in" ? v.includes(x) : op === "gt" ? Number(x) > Number(v)
    : op === "ilike" ? String(x).toLowerCase() === String(v).toLowerCase() : op === "notin" ? !v.includes(x)
    : op === "lt" ? String(x) < String(v)
    // `or("doc_date.is.null,doc_date.lte.X")`: an undated paper stays, a dated one must not be later.
    : op === "or" ? (() => { const lte = /lte\.(.+)$/.exec(String(v))?.[1]; return x == null || (lte !== undefined && String(x) <= lte); })() : true;
};
function applyPapers(papers: SimPaper[], f: [string, string, any][], limit: number, orders: string[]) {
  return papers
    .filter((p) => f.every(([op, c, v]) => c.startsWith(LN) || hit(p, op, op === "or" ? "doc_date" : c, v)))
    .map((p) => ({
      ...p,
      procurement_document_lines: p.procurement_document_lines.filter((l) =>
        f.every(([op, c, v]) => !c.startsWith(LN) || hit(l, op, c.slice(LN.length), v)),
      ),
    }))
    .filter((p) => p.procurement_document_lines.length > 0)
    // doc_date desc (undated last), then verified_at desc: the controller's own order.
    // Honours the order the controller asked for, never one of its own.
    .sort((a, b) => (orders.includes("doc_date") ? (b.doc_date ?? "").localeCompare(a.doc_date ?? "") : 0) || b.verified_at.localeCompare(a.verified_at))
    .slice(0, limit);
}

function controllerWith(results: Sim) {
  results = { ...HOUSE, ...results };
  const calls: { table: string; f: [string, string, any][]; limit: number }[] = [];
  const db = {
    getClient: () => ({
      from: (table: string) => {
        const f: [string, string, any][] = [];
        let limit = Infinity;
        const orders: string[] = [];
        const b: any = {};
        b.select = () => b;
        b.order = (c: string) => (orders.push(c), b);
        for (const op of ["eq", "neq", "ilike", "in", "gt", "lt", "or"]) b[op] = (c: string, v?: unknown) => (f.push(op === "or" ? [op, "", c] : [op, c, v]), b);
        b.not = (c: string, op: string, v: string) => (f.push(["not" + op, c, v.replace(/[()]/g, "").split(",")]), b);
        b.limit = (n: number) => ((limit = n), b);
        b.maybeSingle = () => Promise.resolve((results as any)[table]);
        b.then = (res: any, rej: any) => {
          calls.push({ table, f, limit });
          const out =
            table === "procurement_documents"
              ? results.papersError
                ? { data: null, error: results.papersError }
                : { data: applyPapers(results.papers ?? [], f, limit, orders), error: null }
              : (results as any)[table];
          return Promise.resolve(out).then(res, rej);
        };
        return b;
      },
    }),
  };
  const Ctor = DocumentsController as any;
  const c = new Ctor({}, db, ...Array.from({ length: 10 }, () => ({}))) as DocumentsController;
  return Object.assign(c, { calls });
}

const user = { userId: "u1", restaurantId: "rest-1" } as any;
const line = (over: Record<string, unknown> & { price?: number | string }) => {
  const { price = 11.8, ...rest } = over;
  return {
    id: "l1",
    line_no: 1,
    description: "Albariño 2022",
    uom: "bottle",
    unit_price: price,
    inventory_id: "g1",
    line_total: price,
    qty: 1,
    pack_size: 1,
    qty_bottles: 1,
    format_ml: 750,
    ...rest,
  };
};
let n = 0;
const earlier = (cost: number | string, at: string, good = "g1", over: Row = {}, l: Row = {}): SimPaper => ({
  id: `p${++n}`,
  restaurant_id: "rest-1",
  status: "verified",
  currency: "USD",
  doc_type: "invoice",
  verified_at: at,
  procurement_document_lines: [{ inventory_id: good, restaurant_id: "rest-1", line_total: cost, qty_bottles: 1, format_ml: 750, ...l }],
  ...over,
});

describe("DocumentsController.priceMoves — a price that jumped with no PO to catch it (r104 g4, r108 g15)", () => {
  it("says what moved, against the good's NEWEST other verified paper", async () => {
    const c = controllerWith({
      procurement_document_lines: { data: [line({})], error: null },
      papers: [earlier(10, "2026-11-01"), earlier(7, "2026-06-01")],
    });
    const out = await c.priceMoves("d1", user);
    expect(out.lines[0]).toMatchObject({ compared: true, moved: true, sentence: "was 10.00, now 11.80, up 18 percent" });
  });

  it("opening an OLD verified paper never compares it with a later one (history is not reversed)", async () => {
    const c = controllerWith({
      procurement_documents: { data: { id: "d1", currency: "USD", status: "verified", doc_date: "2026-11-01", verified_at: "2026-11-01T10:00:00Z" }, error: null },
      procurement_document_lines: { data: [line({ price: 5 })], error: null },
      papers: [earlier(7, "2026-11-20T10:00:00Z", "g1", { doc_date: "2026-11-20" })],
    });
    const out = await c.priceMoves("d1", user);
    expect(out.lines[0]).toEqual(expect.objectContaining({ compared: false, reason: "no_previous" }));
  });

  it("compares a verified paper with the one verified BEFORE it, not the newest of all", async () => {
    const c = controllerWith({
      procurement_documents: { data: { id: "d1", currency: "USD", status: "verified", doc_date: "2026-11-10", verified_at: "2026-11-10T10:00:00Z" }, error: null },
      procurement_document_lines: { data: [line({ price: 12 })], error: null },
      papers: [
        earlier(10, "2026-11-01T10:00:00Z", "g1", { doc_date: "2026-11-01" }),
        earlier(99, "2026-11-20T10:00:00Z", "g1", { doc_date: "2026-11-20" }),
      ],
    });
    const out = await c.priceMoves("d1", user);
    expect(out.lines[0]).toMatchObject({ compared: true, sentence: "was 10.00, now 12.00, up 20 percent" });
  });

  it("orders by the date on the paper, so a paper verified late for an old delivery is not 'the last'", async () => {
    const c = controllerWith({
      procurement_documents: { data: { id: "d1", currency: "USD", status: "draft", doc_date: "2026-11-25", verified_at: null }, error: null },
      procurement_document_lines: { data: [line({ price: 12 })], error: null },
      papers: [
        earlier(10, "2026-11-22T10:00:00Z", "g1", { doc_date: "2026-11-20" }),
        earlier(3, "2026-11-24T10:00:00Z", "g1", { doc_date: "2026-10-01" }), // verified last, delivered long ago
      ],
    });
    const out = await c.priceMoves("d1", user);
    expect(out.lines[0]).toMatchObject({ compared: true, sentence: "was 10.00, now 12.00, up 20 percent" });
  });

  it("has no sentence when the good has no previous cost", async () => {
    const c = controllerWith({
      procurement_document_lines: { data: [line({})], error: null },
      papers: [],
    });
    const out = await c.priceMoves("d1", user);
    expect(out.lines[0]).toEqual(expect.objectContaining({ compared: false, reason: "no_previous" }));
    expect((out.lines[0] as any).sentence).toBeUndefined();
  });
  it("carries both currency codes so the page can say why nothing was compared (r106)", async () => {
    const c = controllerWith({
      procurement_documents: { data: { id: "d1", currency: "TRY" }, error: null },
      procurement_document_lines: { data: [line({})], error: null },
      papers: [],
    });
    expect(await c.priceMoves("d1", user)).toMatchObject({ paperCurrency: "TRY", houseCurrency: "USD" });
  });

  it("does not compare a line it cannot count in bottles (a keg)", async () => {
    const c = controllerWith({
      procurement_document_lines: { data: [line({ uom: "keg", qty_bottles: 0 })], error: null },
      papers: [earlier(10, "2026-11-01")],
    });
    const out = await c.priceMoves("d1", user);
    expect(out.lines[0]).toEqual(expect.objectContaining({ compared: false, reason: "unit_differs" }));
  });

  it("does not compare a case with no pack size as if it were one bottle", async () => {
    const c = controllerWith({
      procurement_document_lines: { data: [line({ uom: "case", price: 120, qty: 1, qty_bottles: 0, pack_size: null })], error: null },
      papers: [earlier(10, "2026-11-01")],
    });
    const out = await c.priceMoves("d1", user);
    expect(out.lines[0]).toEqual(expect.objectContaining({ compared: false, reason: "unit_differs" }));
  });

  it("never reads a failed lot read as 'nothing moved'", async () => {
    const c = controllerWith({
      procurement_document_lines: { data: [line({})], error: null },
      papersError: { message: "boom" },
    });
    await expect(c.priceMoves("d1", user)).rejects.toMatchObject({ status: 500 });
  });

  it("takes a house threshold", async () => {
    const c = controllerWith({
      procurement_document_lines: { data: [line({})], error: null },
      papers: [earlier(10, "2026-11-01")],
    });
    const out = await c.priceMoves("d1", user, "25");
    expect(out.lines[0]).toMatchObject({ compared: true, moved: false });
  });

  it("does not compare a TRY paper's price with a USD lot cost", async () => {
    const c = controllerWith({
      procurement_documents: { data: { id: "d1", currency: "TRY" }, error: null },
      procurement_document_lines: { data: [line({ price: 12.5 })], error: null },
      papers: [earlier(10, "2026-11-01")],
    });
    const out = await c.priceMoves("d1", user);
    expect(out.lines[0]).toEqual(expect.objectContaining({ compared: false, reason: "currency_differs" }));
    expect((out.lines[0] as any).sentence).toBeUndefined();
  });

  it("compares nothing when a currency is unknown, and says so", async () => {
    const c = controllerWith({
      procurement_documents: { data: { id: "d1", currency: null }, error: null },
      procurement_document_lines: { data: [line({})], error: null },
      papers: [earlier(10, "2026-11-01")],
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

describe("DocumentsController.priceMoves at the exact threshold, through the paper read (r108, DD-r108-23)", () => {
  // A line total arrives as a number or, from some drivers, as its decimal
  // string; both must land on the same exact verdict.
  it.each([
    [1, "1.1"],
    [2, "2.2"],
    [3, "3.3"],
    [20, "22"],
    ["1.000000", 1.1],
    ["3.000000", 3.3],
  ])("an earlier paper at %s and a line at %s is not moved (exactly 10 percent)", async (cost, price) => {
    const c = controllerWith({
      procurement_document_lines: { data: [line({ price })], error: null },
      papers: [earlier(cost, "2026-11-01")],
    });
    const out = await c.priceMoves("d1", user);
    expect(out.lines[0]).toMatchObject({ compared: true, moved: false });
    expect((out.lines[0] as any).sentence ?? null).toBeNull();
  });

  it.each([
    [1, 1.11, "was 1.00, now 1.11, up 11 percent"],
    [20, 22.01, "was 20.00, now 22.01, up 10.1 percent"],
    [3, 2.69, "was 3.00, now 2.69, down 10.3 percent"],
  ])("an earlier paper at %s and a line at %s is moved: %s", async (cost, price, sentence) => {
    const c = controllerWith({
      procurement_document_lines: { data: [line({ price })], error: null },
      papers: [earlier(cost, "2026-11-01")],
    });
    const out = await c.priceMoves("d1", user);
    expect(out.lines[0]).toMatchObject({ compared: true, moved: true, sentence });
  });
});

describe("DocumentsController.priceMoves reads the good's last OTHER paper, never capped (r108 g15)", () => {
  it("finds a quarterly good's last paper under 1,200 newer papers of a daily good", async () => {
    const daily = Array.from({ length: 1200 }, (_, i) => earlier(5, `2026-11-20 ${1e5 + i}`, "daily"));
    const c = controllerWith({
      procurement_document_lines: { data: [line({ inventory_id: "quarterly", price: 30 }), line({ id: "l2", inventory_id: "daily", price: 5 })], error: null },
      papers: [...daily, earlier(24, "2026-08-01", "quarterly")],
    });
    const out = await c.priceMoves("d1", user);
    expect(out.lines[0]).toMatchObject({ compared: true, moved: true, sentence: "was 24.00, now 30.00, up 25 percent" });
    expect(out.lines[1]).toMatchObject({ compared: true, moved: false });
  });

  it("never compares a paper with its own line", async () => {
    const c = controllerWith({
      procurement_document_lines: { data: [line({ price: 11.8 })], error: null },
      // d1 is this paper itself.
      papers: [earlier(11.8, "2026-11-20", "g1", { id: "d1" }), earlier(10, "2026-11-01")],
    });
    const out = await c.priceMoves("d1", user);
    expect(out.lines[0]).toMatchObject({ compared: true, moved: true, sentence: "was 10.00, now 11.80, up 18 percent" });
  });

  it("filters by the house on both the papers and their lines", async () => {
    const c = controllerWith({
      procurement_document_lines: { data: [line({})], error: null },
      papers: [
        earlier(10, "2026-11-01"),
        earlier(1, "2026-11-10", "g1", { restaurant_id: "other" }),
        earlier(1, "2026-11-11", "g1", {}, { restaurant_id: "other" }),
      ],
    });
    const out = await c.priceMoves("d1", user);
    expect(out.lines[0]).toMatchObject({ sentence: "was 10.00, now 11.80, up 18 percent" });
    for (const r of c.calls.filter((x) => x.table === "procurement_documents")) {
      expect(r.f).toContainEqual(["eq", "restaurant_id", "rest-1"]);
      expect(r.f).toContainEqual(["eq", "procurement_document_lines.restaurant_id", "rest-1"]);
    }
  });

  it("compares a case line per bottle through its pack size", async () => {
    const c = controllerWith({
      // 12 at 132.00 is 11.00 a bottle.
      procurement_document_lines: { data: [line({ uom: "case", qty: 1, pack_size: 12, qty_bottles: 0, line_total: 132 })], error: null },
      papers: [earlier(10, "2026-11-01")],
    });
    const out = await c.priceMoves("d1", user);
    expect(out.lines[0]).toMatchObject({ compared: true, moved: false, pct: 10 });
  });


  it("skips other money, unverified, credit memo", async () => {
    const c = controllerWith({
      procurement_document_lines: { data: [line({})], error: null },
      papers: [
        earlier(1, "2026-11-12", "g1", { currency: "EUR" }),
        earlier(1, "2026-11-11", "g1", { status: "needs_review" }),
        earlier(1, "2026-11-10", "g1", { doc_type: "credit_memo" }),
        earlier(10, "2026-11-01"),
      ],
    });
    const out = await c.priceMoves("d1", user);
    expect(out.lines[0]).toMatchObject({ sentence: "was 10.00, now 11.80, up 18 percent" });
  });

  it("does not compare 375 ml with 750 ml", async () => {
    const c = controllerWith({
      procurement_document_lines: { data: [line({ format_ml: 375 })], error: null },
      papers: [earlier(10, "2026-11-01")],
    });
    const out = await c.priceMoves("d1", user);
    expect(out.lines[0]).toMatchObject({ compared: false, reason: "unit_differs" });
  });

});
