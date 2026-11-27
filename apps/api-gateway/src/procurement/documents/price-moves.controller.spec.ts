import { DocumentsController } from "./documents.controller";

/**
 * A small stand-in for the database (r108 g15): papers with their lines, and
 * the filters the read applies are APPLIED, so a dropped filter changes the
 * answer instead of passing silently.
 */
interface SimLine {
  inventory_id: string;
  restaurant_id: string;
  line_total: number | string | null;
  qty_bottles: number | string | null;
  qty?: number;
  pack_size?: number;
  uom?: string;
  format_ml?: number | null;
}
interface SimPaper {
  id: string;
  restaurant_id: string;
  status: string;
  currency: string;
  doc_type: string;
  verified_at: string;
  procurement_document_lines: SimLine[];
}
interface Sim {
  procurement_documents?: { data: unknown; error: unknown };
  restaurants?: { data: unknown; error: unknown };
  procurement_document_lines?: { data: unknown; error: unknown };
  papers?: SimPaper[];
  papersError?: unknown;
}
const HOUSE: Sim = {
  procurement_documents: { data: { id: "d1", currency: "USD" }, error: null },
  restaurants: { data: { currency: "USD" }, error: null },
};

function applyPapers(papers: SimPaper[], f: [string, string, unknown][], limit: number) {
  const top = (p: SimPaper) =>
    f.every(([op, col, v]) => {
      if (col.includes(".")) return true;
      const x = (p as any)[col];
      if (op === "eq") return x === v;
      if (op === "neq") return x !== v;
      if (op === "ilike") return String(x).toLowerCase() === String(v).toLowerCase();
      if (op === "notin") return !(v as string[]).includes(x);
      return true;
    });
  const sub = (l: SimLine) =>
    f.every(([op, col, v]) => {
      if (!col.startsWith("procurement_document_lines.")) return true;
      const x = (l as any)[col.split(".")[1]];
      if (op === "eq") return x === v;
      if (op === "in") return (v as string[]).includes(x);
      if (op === "gt") return Number(x) > Number(v);
      return true;
    });
  return papers
    .filter(top)
    .map((p) => ({ ...p, procurement_document_lines: p.procurement_document_lines.filter(sub) }))
    .filter((p) => p.procurement_document_lines.length > 0)
    .sort((a, b) => b.verified_at.localeCompare(a.verified_at))
    .slice(0, limit);
}

function controllerWith(results: Sim) {
  results = { ...HOUSE, ...results };
  const calls: { table: string; f: [string, string, unknown][]; limit: number }[] = [];
  const db = {
    getClient: () => ({
      from: (table: string) => {
        const f: [string, string, unknown][] = [];
        let limit = Infinity;
        const b: any = {};
        b.select = () => b;
        b.order = () => b;
        for (const op of ["eq", "neq", "ilike", "in", "gt"]) b[op] = (c: string, v: unknown) => (f.push([op, c, v]), b);
        b.not = (c: string, op: string, v: string) => (f.push(["not" + op, c, v.replace(/[()]/g, "").split(",")]), b);
        b.limit = (n: number) => ((limit = n), b);
        b.maybeSingle = () => Promise.resolve((results as any)[table]);
        b.then = (res: any, rej: any) => {
          calls.push({ table, f, limit });
          const out =
            table === "procurement_documents"
              ? results.papersError
                ? { data: null, error: results.papersError }
                : { data: applyPapers(results.papers ?? [], f, limit), error: null }
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
/** This paper's line; `price` is the printed price of ONE bottle. */
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
/** An earlier verified paper of this house carrying one bottle of a good. */
const earlier = (cost: number | string, at: string, good = "g1", over: Partial<SimPaper> = {}, l: Partial<SimLine> = {}): SimPaper => ({
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
    const daily = Array.from({ length: 1200 }, (_, i) =>
      earlier(5, `2026-11-${String(10 + (i % 18)).padStart(2, "0")}T${String(i % 24).padStart(2, "0")}:00:00Z`, "daily"),
    );
    const c = controllerWith({
      procurement_document_lines: {
        data: [line({ id: "lq", inventory_id: "quarterly", price: 30 }), line({ id: "ld", line_no: 2, inventory_id: "daily", price: 5 })],
        error: null,
      },
      papers: [...daily, earlier(24, "2026-08-01T00:00:00Z", "quarterly")],
    });
    const out = await c.priceMoves("d1", user);
    expect(out.lines[0]).toMatchObject({ compared: true, moved: true, sentence: "was 24.00, now 30.00, up 25 percent" });
    expect(out.lines[1]).toMatchObject({ compared: true, moved: false });
  });

  it("never compares a paper with its own line", async () => {
    const c = controllerWith({
      procurement_document_lines: { data: [line({ price: 11.8 })], error: null },
      // d1 is this paper: verified, newest, same good. It must not be the comparison.
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
    const reads = c.calls.filter((x) => x.table === "procurement_documents");
    expect(reads.length).toBeGreaterThan(0);
    for (const r of reads) {
      expect(r.f).toContainEqual(["eq", "restaurant_id", "rest-1"]);
      expect(r.f).toContainEqual(["eq", "procurement_document_lines.restaurant_id", "rest-1"]);
    }
  });

  it("compares a case line per bottle through its pack size", async () => {
    const c = controllerWith({
      // A case of 12 at 132.00 is 11.00 a bottle; qty_bottles left at 0 by the reader.
      procurement_document_lines: { data: [line({ uom: "case", qty: 1, pack_size: 12, qty_bottles: 0, line_total: 132 })], error: null },
      papers: [earlier(10, "2026-11-01")],
    });
    const out = await c.priceMoves("d1", user);
    expect(out.lines[0]).toMatchObject({ compared: true, moved: false, pct: 10 });
  });

  it("compares a case earlier paper per bottle too (6 at 66.00 is 11.00)", async () => {
    const c = controllerWith({
      procurement_document_lines: { data: [line({ price: 13.2 })], error: null },
      papers: [earlier(66, "2026-11-01", "g1", {}, { qty_bottles: 6 })],
    });
    const out = await c.priceMoves("d1", user);
    expect(out.lines[0]).toMatchObject({ compared: true, moved: true, sentence: "was 11.00, now 13.20, up 20 percent" });
  });

  it("skips an earlier paper in another money, an unverified one, and a credit memo", async () => {
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

  it("does not compare a 375 ml line with a 750 ml earlier bottle", async () => {
    const c = controllerWith({
      procurement_document_lines: { data: [line({ format_ml: 375 })], error: null },
      papers: [earlier(10, "2026-11-01")],
    });
    const out = await c.priceMoves("d1", user);
    expect(out.lines[0]).toMatchObject({ compared: false, reason: "unit_differs" });
  });

  it("a line with no printed total is not a price", async () => {
    const c = controllerWith({
      procurement_document_lines: { data: [line({ line_total: null })], error: null },
      papers: [earlier(10, "2026-11-01")],
    });
    const out = await c.priceMoves("d1", user);
    expect(out.lines[0]).toMatchObject({ compared: false, reason: "no_price" });
  });
});
