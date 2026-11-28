import { DocumentsController } from "./documents.controller";
import {
  CLASSES,
  allocateSigned,
  classOf,
  foldPaper,
  purchasesByCategory,
  readPurchasesByCategory,
  RATE_NOT_PRINTED,
  type LineIn,
  type PaperIn,
  type PurchaseClass,
} from "./purchases-by-category";

/**
 * Verified purchases by category (r110 invoices-g4). The property that makes
 * the figure safe to put beside the books: every cent of a paper lands in one
 * class or in deposits, so they sum to the paper total to the cent.
 */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}
const money = (c: number) => (c / 100).toFixed(2);
const sumClasses = (c: Record<PurchaseClass, number>) =>
  CLASSES.reduce((a, k) => a + c[k], 0);

describe("allocateSigned — largest remainder", () => {
  it("one left-over cent goes to the largest remainder, ties to the earlier class", () => {
    expect(allocateSigned([1, 1, 1], 100)).toEqual([34, 33, 33]);
    expect(allocateSigned([1, 5], 10)).toEqual([2, 8]);
    expect(allocateSigned([1, 1, 1], -100)).toEqual([-34, -33, -33]);
  });
});

describe("foldPaper — classes + deposits = the paper total", () => {
  it("P1 holds to the cent over random lines, charges, rates and deposits", () => {
    const r = rng(2026);
    for (let t = 0; t < 400; t++) {
      const n = Math.floor(r() * 7);
      const lines: LineIn[] = Array.from({ length: n }, () => ({
        document_id: "p",
        line_total: money(Math.floor(r() * 90000) - (r() < 0.1 ? 3000 : 0)),
        deposit: r() < 0.3 ? money(Math.floor(r() * 600)) : null,
        vat_rate_percent: r() < 0.5 ? [1, 10, 20][Math.floor(r() * 3)] : null,
        cls: r() < 0.15 ? null : CLASSES[Math.floor(r() * 6)],
      }));
      const lineNet = lines.reduce((a, l) => a + Math.round(Number(l.line_total) * 100), 0);
      const deps = lines.reduce((a, l) => a + Math.round(Number(l.deposit ?? 0) * 100), 0);
      const charges = Math.floor(r() * 5000) - (r() < 0.2 ? 2000 : 0);
      const credit = r() < 0.2;
      const paper: PaperIn = {
        id: "p",
        doc_type: credit ? "credit_memo" : "invoice",
        currency: "USD",
        total: money(lineNet + deps + charges),
        tax: money(Math.max(0, charges)),
      };
      const f = foldPaper(paper, lines);
      const want = (credit ? -1 : 1) * (lineNet + deps + charges);
      expect(sumClasses(f.classes) + f.deposits).toBe(want);
      expect(f.total).toBe(want);
      CLASSES.forEach((k) => expect(Number.isInteger(f.classes[k])).toBe(true));
    }
  });

  it("freight follows value, not quantity: the wine carries most of it", () => {
    const f = foldPaper(
      { id: "p", doc_type: "invoice", currency: "USD", total: "1100.00", tax: null },
      [
        { document_id: "p", line_total: "900.00", cls: "Wine" },
        { document_id: "p", line_total: "100.00", cls: "N/A drinks" },
      ],
    );
    expect(f.classes.Wine).toBe(99000);
    expect(f.classes["N/A drinks"]).toBe(11000);
  });

  it("a paper with no printed total spreads its charges and tax less its discount", () => {
    const f = foldPaper(
      {
        id: "p",
        doc_type: "invoice",
        currency: "USD",
        total: null,
        freight: "10.00",
        tax: "5.00",
        discount_total: "3.00",
      },
      [{ document_id: "p", line_total: "100.00", deposit: "2.00", cls: "Beer" }],
    );
    expect(f.classes.Beer).toBe(11200);
    expect(f.deposits).toBe(200);
    expect(f.total).toBe(11400);
  });

  it("an unlinked line is Not classed, and VAT is summed per printed rate", () => {
    const f = foldPaper(
      { id: "p", doc_type: "invoice", currency: "TRY", total: "300.00", tax: null },
      [
        { document_id: "p", line_total: "100.00", cls: null, vat_rate_percent: 20 },
        { document_id: "p", line_total: "200.00", cls: "Food", vat_rate_percent: null },
      ],
    );
    expect(f.classes["Not classed"]).toBe(10000);
    expect(f.vat.get("20")).toBe(10000);
    expect(f.vat.get(RATE_NOT_PRINTED)).toBe(20000);
  });

  it("a credit memo is negative within its class", () => {
    const f = foldPaper(
      { id: "c", doc_type: "credit_memo", currency: "USD", total: "45.00", tax: null },
      [{ document_id: "c", line_total: "45.00", cls: "Spirits" }],
    );
    expect(f.classes.Spirits).toBe(-4500);
    expect(f.total).toBe(-4500);
  });
});

describe("purchasesByCategory — currencies", () => {
  it("mixed currencies give separate rows, never one sum; no currency is added to nothing", () => {
    const papers: PaperIn[] = [
      { id: "a", doc_type: "invoice", currency: "usd", total: "50.00", tax: null },
      { id: "b", doc_type: "invoice", currency: "TRY", total: "1000.00", tax: "200.00" },
      { id: "c", doc_type: "invoice", currency: null, total: "70.00", tax: null },
    ];
    const lines = new Map<string, LineIn[]>([
      ["a", [{ document_id: "a", line_total: "50.00", cls: "Wine" }]],
      ["b", [{ document_id: "b", line_total: "800.00", cls: "Wine" }]],
      ["c", [{ document_id: "c", line_total: "70.00", cls: "Wine" }]],
    ]);
    const out = purchasesByCategory(papers, lines);
    expect(out.currencies.map((c) => [c.currency, c.classes.Wine, c.total])).toEqual([
      ["TRY", 100000, 100000],
      ["USD", 5000, 5000],
    ]);
    expect(out.papersWithoutCurrency).toBe(1);
    expect(out.currencies[0].taxPrinted).toBe(20000);
  });
});

describe("classOf — the good's own kind, read at read time", () => {
  it.each([
    ["wine", null, "Wine"],
    ["whiskey", null, "Spirits"],
    ["liqueur", null, "Spirits"],
    ["sake", null, "Cider/Sake"],
    ["soft_drink", null, "N/A drinks"],
    ["food", null, "Food"],
    ["supply", null, "Other"],
    ["other", "gin", "Spirits"],
    ["other", null, "Other"],
    [null, null, "Not classed"],
  ])("%s / %s -> %s", (kind, bev, want) => {
    expect(classOf(kind, bev)).toBe(want);
  });
});

describe("readPurchasesByCategory — every hop names the house", () => {
  function fakeDb(t: Record<string, Record<string, unknown>[]>) {
    const seen: Array<{ table: string; eq: Record<string, unknown> }> = [];
    return {
      seen,
      db: {
        from(table: string) {
          const eq: Record<string, unknown> = {};
          seen.push({ table, eq });
          const q: any = {
            select: () => q,
            eq: (k: string, v: unknown) => ((eq[k] = v), q),
            in: () => q,
            order: () => q,
            range: async () => ({ data: t[table] ?? [], error: null }),
          };
          return q;
        },
      },
    };
  }

  it("reads papers, lines and goods with restaurant_id and classes a foreign link as no link", async () => {
    const { db, seen } = fakeDb({
      procurement_documents: [
        { id: "p1", doc_type: "invoice", currency: "USD", total: "30.00", tax: null, doc_date: "2026-11-10" },
        { id: "p2", doc_type: "invoice", currency: "USD", total: "99.00", tax: null, doc_date: "2026-10-01" },
        { id: "p3", doc_type: "invoice", currency: "USD", total: "5.00", tax: null, doc_date: null },
      ],
      procurement_document_lines: [
        { document_id: "p1", line_total: "20.00", inventory_id: "g1" },
        { document_id: "p1", line_total: "10.00", inventory_id: "g-other-house" },
      ],
      restaurant_inventory: [{ id: "g1", kind: "beer", beverage_id: null }],
    });
    const out = await readPurchasesByCategory(db, "house-a", "2026-11-01", "2026-11-30");
    const usd = out.currencies[0];
    expect(usd.papers).toBe(1);
    expect(usd.classes.Beer).toBe(2000);
    expect(usd.classes["Not classed"]).toBe(1000);
    expect(out.papersWithoutDate).toBe(1);
    for (const s of seen.filter((x) => x.table !== "beverages"))
      expect(s.eq.restaurant_id).toBe("house-a");
  });
});

describe("readPurchasesByCategory — only invoices and credit memos are purchases", () => {
  const rows = (docs: Record<string, unknown>[], lines: Record<string, unknown>[]) => {
    const t: Record<string, Record<string, unknown>[]> = {
      procurement_documents: docs,
      procurement_document_lines: lines,
      restaurant_inventory: [{ id: "g1", kind: "wine", beverage_id: null }],
    };
    const q = (table: string): any => {
      const r: any = {
        select: () => r,
        eq: () => r,
        in: () => r,
        order: () => r,
        range: async () => ({ data: t[table] ?? [], error: null }),
      };
      return r;
    };
    return { from: q };
  };
  const base = { currency: "USD", tax: null, doc_date: "2026-11-10" };

  it("a verified statement and packing slip leave the total unchanged and are counted by type", async () => {
    const docs = [
      { ...base, id: "inv", doc_type: "invoice", total: "300.00" },
      { ...base, id: "stm", doc_type: "statement", total: "300.00" },
      { ...base, id: "slip", doc_type: "packing_slip", total: "300.00" },
      { ...base, id: "dr", doc_type: "delivery_receipt", total: "300.00" },
      { ...base, id: "x", doc_type: null, total: "5.00" },
    ];
    const lines = ["inv", "stm", "slip", "dr"].map((id) => ({
      document_id: id,
      line_total: "300.00",
      inventory_id: "g1",
    }));
    const out = await readPurchasesByCategory(rows(docs, lines), "h", "2026-11-01", "2026-11-30");
    expect(out.currencies[0].total).toBe(30000);
    expect(out.currencies[0].classes.Wine).toBe(30000);
    expect(out.currencies[0].papers).toBe(1);
    expect(out.papersLeftOut).toEqual([
      { docType: "delivery_receipt", count: 1 },
      { docType: "not read", count: 1 },
      { docType: "packing_slip", count: 1 },
      { docType: "statement", count: 1 },
    ]);
  });
});

describe("foldPaper — a line with no total is not filed under a class", () => {
  it("the unknown line's money lands in Not classed and the lines are counted", () => {
    const paper: PaperIn = { id: "p", doc_type: "invoice", currency: "USD", total: "150.00", tax: null };
    const lines: LineIn[] = [
      { document_id: "p", line_total: "100.00", cls: "Wine" },
      { document_id: "p", line_total: null, cls: "Beer" },
    ];
    const f = foldPaper(paper, lines);
    expect(f.classes.Wine).toBe(10000);
    expect(f.classes.Beer).toBe(0);
    expect(f.classes["Not classed"]).toBe(5000);
    expect(f.total).toBe(15000);
    expect(f.linesWithoutTotal).toBe(1);
    const out = purchasesByCategory([paper], new Map([["p", lines]]));
    expect(out.currencies[0].linesWithoutTotal).toBe(1);
  });
});

describe("GET procurement/documents/purchases-by-category — the money gate", () => {
  const Ctor = DocumentsController as any;
  const as = (role: string) => ({ userId: "u1", restaurantId: "rest-1", role }) as any;

  it("staff get a 403 in words and no read", async () => {
    const db = { getClient: jest.fn() };
    const c = new Ctor({}, db, ...Array.from({ length: 10 }, () => ({})));
    await expect(c.purchasesByCategory(as("staff"), "2026-11-01", "2026-11-30")).rejects.toMatchObject({
      status: 403,
      message: expect.stringContaining("an owner or a manager"),
    });
    expect(db.getClient).not.toHaveBeenCalled();
  });

  it("a period that is not two dates is refused in words", async () => {
    const c = new Ctor({}, { getClient: jest.fn() }, ...Array.from({ length: 10 }, () => ({})));
    await expect(c.purchasesByCategory(as("owner"), "2026-11-30", "2026-11-01")).rejects.toMatchObject({
      status: 400,
    });
  });
});
