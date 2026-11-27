import { DocumentsController } from "./documents.controller";

// r108 g14. The stand-in db APPLIES the filters, so a dropped filter changes the answer.
type Row = Record<string, any>;
type SimPaper = Row & { procurement_document_lines: Row[] };
const LN = "procurement_document_lines.";
const hit = (r: Row, op: string, col: string, v: any) => {
  const x = r[col];
  return op === "eq" ? x === v
    : op === "neq" ? x !== v && x != null // SQL `<>`: a NULL never matches
    : op === "in" ? v.includes(x)
    : op === "gt" ? Number(x) > Number(v)
    : op === "gte" ? String(x) >= String(v)
    : op === "ilike" ? String(x).toLowerCase() === String(v).toLowerCase()
    : op === "notin" ? !v.includes(x)
    : true;
};
function applyPapers(papers: SimPaper[], f: [string, string, any][], limit: number) {
  return papers
    .filter((p) => f.every(([op, c, v]) => (c.startsWith(LN) ? true : hit(p, op, c, v))))
    .map((p) => ({
      ...p,
      procurement_document_lines: p.procurement_document_lines.filter((l) =>
        f.every(([op, c, v]) => !c.startsWith(LN) || hit(l, op, c.slice(LN.length), v)),
      ),
    }))
    .filter((p) => p.procurement_document_lines.length > 0)
    .sort((a, b) => b.verified_at.localeCompare(a.verified_at))
    .slice(0, limit);
}

function controllerWith(res: Row) {
  const base: Row = {
    procurement_documents: { data: { id: "d1", currency: "USD", provider_id: "vA" }, error: null },
    providers: { data: [{ id: "vB", name: "Bravo Wines", company_name: null }], error: null },
    ...res,
  };
  const calls: { table: string; f: [string, string, any][]; limit: number }[] = [];
  const db = {
    getClient: () => ({
      from: (table: string) => {
        const f: [string, string, any][] = [];
        let limit = Infinity;
        const b: any = {};
        b.select = () => b;
        b.order = () => b;
        for (const op of ["eq", "neq", "ilike", "in", "gt", "gte"]) b[op] = (c: string, v: unknown) => (f.push([op, c, v]), b);
        b.not = (c: string, op: string, v: string) => (f.push(["not" + op, c, typeof v === "string" ? v.replace(/[()]/g, "").split(",") : v]), b);
        b.limit = (n: number) => ((limit = n), b);
        b.maybeSingle = () => Promise.resolve(base[table]);
        b.then = (rs: any, rj: any) => {
          calls.push({ table, f, limit });
          const out =
            table === "procurement_documents"
              ? { data: applyPapers(base.papers ?? [], f, limit), error: null }
              : base[table];
          return Promise.resolve(out).then(rs, rj);
        };
        return b;
      },
    }),
  };
  const c = new (DocumentsController as any)({}, db, ...Array.from({ length: 10 }, () => ({}))) as DocumentsController;
  return Object.assign(c, { calls });
}

const owner = { userId: "u1", restaurantId: "rest-1", role: "owner" } as any;
const day = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();
const mine = (over: Row = {}) => ({
  id: "l1", line_no: 1, description: "Albariño 2022", uom: "bottle", inventory_id: "g1",
  line_total: 10.2, qty: 1, pack_size: 1, qty_bottles: 1, format_ml: 750, ...over,
});
let n = 0;
const paper = (cost: number, ago: number, over: Row = {}, l: Row = {}): SimPaper => ({
  id: `p${++n}`, restaurant_id: "rest-1", status: "verified", currency: "USD", doc_type: "invoice",
  provider_id: "vB", verified_at: day(ago), doc_date: null,
  procurement_document_lines: [{ inventory_id: "g1", restaurant_id: "rest-1", line_total: cost, qty_bottles: 1, format_ml: 750, ...l }],
  ...over,
});
const run = (lines: Row[], papers: SimPaper[], extra: Row = {}) =>
  controllerWith({ procurement_document_lines: { data: lines, error: null }, papers, ...extra });

describe("DocumentsController.vendorPrices", () => {
  it("names a cheaper price from another vendor, newest first", async () => {
    const c = run([mine()], [paper(9.4, 20, { doc_date: "2026-11-03" }), paper(8, 100)]);
    const out: any = await c.vendorPrices("d1", owner);
    expect(out.lines[0]).toMatchObject({ compared: true, cheaper: true, thisPaper: 10.2 });
    expect(out.lines[0].sentence).toBe("Bought for 9.40 a bottle from Bravo Wines on 3 Nov (this paper 10.20)");
  });

  it("leaves the same vendor out, even when it is the only paper", async () => {
    const c = run([mine()], [paper(9.4, 20, { provider_id: "vA" })]);
    const out: any = await c.vendorPrices("d1", owner);
    expect(out.lines[0]).toMatchObject({ compared: false, reason: "no_other_vendor" });
  });

  it("leaves a paper in another currency out", async () => {
    const c = run([mine()], [paper(9.4, 20, { currency: "TRY" })]);
    const out: any = await c.vendorPrices("d1", owner);
    expect(out.lines[0]).toMatchObject({ compared: false, reason: "no_other_vendor" });
  });

  it("leaves a paper older than 180 days out", async () => {
    const c = run([mine()], [paper(9.4, 181)]);
    expect((await c.vendorPrices("d1", owner) as any).lines[0].reason).toBe("no_other_vendor");
    const c2 = run([mine()], [paper(9.4, 179)]);
    expect((await c2.vendorPrices("d1", owner) as any).lines[0].compared).toBe(true);
  });

  it("never reads another house's lines or papers", async () => {
    const c = run([mine()], [paper(9.4, 20, { restaurant_id: "rest-2" })]);
    expect((await c.vendorPrices("d1", owner) as any).lines[0].reason).toBe("no_other_vendor");
    const filters = c.calls.filter((x) => x.table === "procurement_documents").flatMap((x) => x.f);
    expect(filters).toEqual(expect.arrayContaining([["eq", "restaurant_id", "rest-1"], ["eq", "procurement_document_lines.restaurant_id", "rest-1"]]));
    const lineRead = c.calls.find((x) => x.table === "procurement_document_lines");
    expect(lineRead?.f).toEqual(expect.arrayContaining([["eq", "restaurant_id", "rest-1"]]));
  });

  it("never reads this paper against itself", async () => {
    const c = run([mine()], [paper(9.4, 20, { id: "d1" })]);
    expect((await c.vendorPrices("d1", owner) as any).lines[0].reason).toBe("no_other_vendor");
  });

  it("does not show an equal price, nor a higher one", async () => {
    const eq: any = await run([mine()], [paper(10.2, 20)]).vendorPrices("d1", owner);
    expect(eq.lines[0]).toMatchObject({ compared: true, cheaper: false, sentence: null });
    const hi: any = await run([mine()], [paper(11, 20)]).vendorPrices("d1", owner);
    expect(hi.lines[0]).toMatchObject({ cheaper: false, sentence: null });
  });

  it("counts a case by its pack size, and does not compare a case with none", async () => {
    const caseLine = mine({ uom: "case", qty: 1, pack_size: 12, qty_bottles: 0, line_total: 120 });
    const ok: any = await run([caseLine], [paper(9, 20)]).vendorPrices("d1", owner);
    expect(ok.lines[0]).toMatchObject({ compared: true, thisPaper: 10, cheaper: true });
    const noPack: any = await run([{ ...caseLine, pack_size: null }], [paper(9, 20)]).vendorPrices("d1", owner);
    expect(noPack.lines[0]).toMatchObject({ compared: false, reason: "unit_differs" });
  });

  it("reads past the first window: a good it did not reach is read on its own", async () => {
    const filler = Array.from({ length: 200 }, (_, i) => paper(9, 10 + i / 100, {}, { inventory_id: "g-other" }));
    const c = run([mine({ id: "l1" }), mine({ id: "l2", line_no: 2, inventory_id: "g2" })], [
      ...filler,
      paper(5, 150, {}, { inventory_id: "g2" }),
    ]);
    const out: any = await c.vendorPrices("d1", owner);
    expect(out.lines[1]).toMatchObject({ compared: true, cheaper: true });
    expect(c.calls.filter((x) => x.table === "procurement_documents" && x.limit === 1).length).toBe(1);
  });

  it("says nothing was compared when this paper has no vendor", async () => {
    const c = run([mine()], [paper(9, 20)], {
      procurement_documents: { data: { id: "d1", currency: "USD", provider_id: null }, error: null },
    });
    expect(await c.vendorPrices("d1", owner)).toMatchObject({ notCompared: "vendor_unknown", lines: [] });
  });

  it("refuses staff with a 403 in words, before reading anything", async () => {
    const c = run([mine()], [paper(9, 20)]);
    await expect(c.vendorPrices("d1", { ...owner, role: "staff" })).rejects.toMatchObject({
      status: 403,
      message: expect.stringMatching(/owner and managers/),
    });
    expect(c.calls).toHaveLength(0);
  });

  it("is a 404 for a paper that is not this house's", async () => {
    const c = run([mine()], [], { procurement_documents: { data: null, error: null } });
    await expect(c.vendorPrices("d1", owner)).rejects.toMatchObject({ status: 404 });
  });
});
