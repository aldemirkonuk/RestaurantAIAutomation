import { DocumentsController } from "./documents.controller";
import { normalDocNumber, tieOutStatement, toCents } from "./statement-tieout";

/** A stand-in db that APPLIES eq / in and range, so a dropped house or vendor filter fails a test. */
type Row = Record<string, any>;
function controllerWith(tables: Record<string, Row[]>) {
  const reads: { table: string; f: [string, string, any][] }[] = [];
  const db = {
    getClient: () => ({
      from: (table: string) => {
        const f: [string, string, any][] = [];
        let range: [number, number] | null = null;
        const rows = () =>
          (tables[table] ?? []).filter((r) => f.every(([op, c, v]) => (op === "eq" ? r[c] === v : op === "in" ? v.includes(r[c]) : true)));
        const b: any = {};
        b.select = () => b;
        b.order = () => b;
        for (const op of ["eq", "in"]) b[op] = (c: string, v: any) => (f.push([op, c, v]), b);
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
const paper = (over: Row) => ({
  restaurant_id: R, provider_id: "p1", doc_type: "invoice", doc_date: "2026-11-03", currency: "USD", status: "verified", ...over,
});
const statement = (entries: Row[], over: Row = {}) => ({
  id: "st1", restaurant_id: R, doc_type: "statement", currency: "USD", provider_id: "p1", extracted: { statementEntries: entries }, ...over,
});

describe("GET /procurement/documents/:id/statement-tieout (r109 g5)", () => {
  it("two invoices of the same 312.40 pair by number only: one checked, one differs, one never received", async () => {
    const c = controllerWith({
      procurement_documents: [
        statement([
          { docNumber: "INV 101", docDate: "2026-11-02", amount: 312.4, kind: "invoice" },
          { docNumber: "inv102", docDate: "2026-11-06", amount: 312.4, kind: "invoice" },
          { docNumber: "0103", docDate: "2026-11-08", amount: 312.4, kind: "invoice" },
          { docNumber: null, docDate: "2026-11-09", amount: 500, kind: "payment" },
        ]),
        // 102 on file is 300.00: the amount alone would pair it with 101's paper.
        paper({ id: "d101", doc_number: "INV101", total: "312.40", doc_date: "2026-11-02" }),
        paper({ id: "d102", doc_number: "INV102", total: "300.00", status: "needs_review", doc_date: "2026-11-06" }),
        // 103 is on file as 312.40, but the statement prints 0103: leading zeros are kept.
        paper({ id: "d103", doc_number: "103", total: "312.40", doc_date: "2026-11-07" }),
      ],
    });
    const out: any = await c.statementTieout("st1", owner);
    expect(out.rows.map((r: any) => [r.docNumber, r.verdict, r.paperId, r.differsBy])).toEqual([
      ["INV 101", "checked_same", "d101", null],
      ["inv102", "amount_differs", "d102", "12.40"],
      ["0103", "never_received", null, null],
    ]);
    expect(out.paymentsIgnored).toBe(1);
    // 103 sits inside the span (2 to 8 Nov) and the statement does not list it by its number.
    expect(out.notOnStatement).toEqual([{ id: "d103", docNumber: "103", docDate: "2026-11-07", total: "312.40", kind: "invoice" }]);
  });

  it("a credit row matches a credit memo, never an invoice of the same number; unchecked says so", async () => {
    const c = controllerWith({
      procurement_documents: [
        statement([{ docNumber: "77", docDate: "2026-11-04", amount: 40, kind: "credit" }]),
        paper({ id: "inv77", doc_number: "77", total: "40.00" }),
        paper({ id: "cm77", doc_type: "credit_memo", doc_number: "77", total: "-40.00", status: "needs_review" }),
      ],
    });
    const out: any = await c.statementTieout("st1", owner);
    expect(out.rows).toEqual([expect.objectContaining({ kind: "credit", verdict: "on_file_not_checked", paperId: "cm77", amount: "40.00" })]);
  });

  it("a paper in another money is not compared, in words", async () => {
    const c = controllerWith({
      procurement_documents: [
        statement([{ docNumber: "9", docDate: "2026-11-04", amount: 100, kind: "invoice" }]),
        paper({ id: "d9", doc_number: "9", total: "3200.00", currency: "TRY" }),
      ],
    });
    const out: any = await c.statementTieout("st1", owner);
    expect(out.rows[0]).toMatchObject({ verdict: "not_compared", reason: "the paper is in TRY and the statement in USD", paperId: "d9" });
  });

  it("a statement with no vendor named compares nothing and reads no papers", async () => {
    const c = controllerWith({
      procurement_documents: [
        statement([{ docNumber: "9", docDate: "2026-11-04", amount: 100, kind: "invoice" }], { provider_id: null }),
        paper({ id: "d9", doc_number: "9", total: "100.00", provider_id: null }),
      ],
    });
    const out: any = await c.statementTieout("st1", owner);
    expect(out).toMatchObject({ notCompared: "vendor_unknown", notOnStatement: [] });
    expect(out.rows[0]).toMatchObject({ verdict: "not_compared", reason: "no vendor is named on this statement" });
    expect(c.reads).toHaveLength(1);
  });

  it("another house's paper is never matched, and another house's statement is a 404 in words", async () => {
    const c = controllerWith({
      procurement_documents: [
        statement([{ docNumber: "5", docDate: "2026-11-04", amount: 10, kind: "invoice" }]),
        paper({ id: "theirs", doc_number: "5", total: "10.00", restaurant_id: "rest-2" }),
        statement([], { id: "st2", restaurant_id: "rest-2" }),
      ],
    });
    const out: any = await c.statementTieout("st1", owner);
    expect(out.rows[0]).toMatchObject({ verdict: "never_received", paperId: null });
    const papers = c.reads.filter((r) => r.f.some(([, col, v]) => col === "provider_id" && v === "p1"));
    expect(papers.every((r) => r.f.some(([op, col, v]) => op === "eq" && col === "restaurant_id" && v === R))).toBe(true);
    await expect(c.statementTieout("st2", owner)).rejects.toMatchObject({
      status: 404,
      message: "This paper is not one of this house's, so nothing was tied out.",
    });
  });

  it("an invoice is not a statement: refused in words", async () => {
    const c = controllerWith({ procurement_documents: [paper({ id: "d1", doc_number: "1", total: "1" })] });
    await expect(c.statementTieout("d1", owner)).rejects.toMatchObject({ status: 409, message: expect.stringMatching(/read as invoice, not a vendor's statement/) });
  });

  it("refuses staff with a 403 in words before reading anything", async () => {
    const c = controllerWith({ procurement_documents: [statement([])] });
    await expect(c.statementTieout("st1", { ...owner, role: "staff" })).rejects.toMatchObject({
      status: 403,
      message: expect.stringMatching(/owner and managers of the house\. You are signed in as staff/),
    });
    expect(c.reads).toHaveLength(0);
  });

  it("reads the vendor's papers past one page", async () => {
    const many = Array.from({ length: 1200 }, (_, i) => paper({ id: `d${String(i).padStart(4, "0")}`, doc_number: `N${i}`, total: "1.00", doc_date: "2026-01-01" }));
    const c = controllerWith({
      procurement_documents: [statement([{ docNumber: "N1150", docDate: "2026-11-04", amount: 1, kind: "invoice" }]), ...many],
    });
    const out: any = await c.statementTieout("st1", owner);
    expect(out.rows[0]).toMatchObject({ verdict: "checked_same", paperId: "d1150" });
  });
});

describe("statement-tieout pure parts", () => {
  it("keeps leading zeros and drops case and inner spaces", () => {
    expect(normalDocNumber(" INV 00123 ")).toBe("inv00123");
    expect(normalDocNumber("0123")).not.toBe(normalDocNumber("123"));
    expect(normalDocNumber("  ")).toBeNull();
  });
  it("counts in exact cents", () => {
    expect(toCents(0.1 + 0.2)).toBe(30n);
    expect(toCents("312.40")).toBe(31240n);
    expect(toCents("abc")).toBeNull();
  });
  it("an unknown statement money compares nothing", () => {
    const out = tieOutStatement(
      [{ docNumber: "1", docDate: null, amount: 1, kind: "invoice" }],
      [{ id: "a", doc_type: "invoice", doc_number: "1", doc_date: null, total: 1, currency: "USD", status: "verified" }],
      { vendorNamed: true, currency: null },
    );
    expect(out.rows[0]).toMatchObject({ verdict: "not_compared", reason: "the statement's money is not known" });
  });
});
