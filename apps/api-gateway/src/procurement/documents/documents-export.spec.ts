import { HttpException } from "@nestjs/common";
import { DocumentsController } from "./documents.controller";
import { formatCents, toCents, verifiedCsv, verifiedLinesCsv, type ExportRow } from "./documents-export";

const row = (o: Partial<ExportRow> = {}): ExportRow => ({
  doc_number: "A-1", doc_date: "2026-11-01", doc_type: "invoice", vendor: "Acme",
  currency: "USD", subtotal: "10.10", freight: null, tax: "0.30", total: "10.40", ...o,
});

describe("verified papers CSV: exact decimals (r106 g5)", () => {
  it("a seeded property: the totals row is the exact cent-sum of the rows, whatever the floats", () => {
    let seed = 12345;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    for (let run = 0; run < 200; run++) {
      const rows = Array.from({ length: 1 + Math.floor(rnd() * 30) }, () =>
        row({ total: (Math.floor(rnd() * 1_000_000) / 100).toFixed(2), subtotal: null, tax: null }),
      );
      const expected = rows.reduce((a, r) => a + (toCents(r.total) ?? 0), 0);
      const csv = verifiedCsv(rows).trim().split("\r\n");
      const totalLine = csv[csv.length - 1].split(",");
      expect(totalLine[0]).toBe("Total");
      expect(totalLine[8]).toBe(formatCents(expected));
      const summed = csv.slice(1, -1).reduce((a, l) => a + (toCents(l.split(",")[8]) ?? 0), 0);
      expect(summed).toBe(expected);
    }
  });
  it("0.1 + 0.2 style floats do not leak: 10.10 + 0.30 is 10.40", () => {
    expect(formatCents((toCents("10.10") ?? 0) + (toCents("0.30") ?? 0))).toBe("10.40");
  });
  it("an unprinted figure is empty, never 0; currencies never share a total; basis says not stated", () => {
    const csv = verifiedCsv([row({ freight: null }), row({ currency: "TRY", total: "5.00" })]);
    expect(csv).toContain("A-1,2026-11-01,invoice,Acme,USD,10.10,,0.30,10.40,not stated");
    expect(csv.match(/^Total,/gm)?.length).toBe(2);
  });
  it("a vendor name cannot open as a formula", () => {
    expect(verifiedCsv([row({ vendor: "=HYPERLINK(1)" })])).toContain("'=HYPERLINK(1)");
  });
});

describe("DocumentsController.exportVerified (r106 g5)", () => {
  const calls: [string, unknown][] = [];
  let result: any;
  const chain: any = {
    from: jest.fn(() => chain),
    select: jest.fn(() => chain),
    eq: jest.fn((k: string, v: unknown) => (calls.push([k, v]), chain)),
    order: jest.fn(() => chain),
    in: jest.fn(() => chain),
    range: jest.fn(() => Promise.resolve(result)),
  };
  const ctrl = () =>
    new DocumentsController(
      {} as any, { getClient: () => chain } as any, {} as any, {} as any, {} as any,
      {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any,
    );
  beforeEach(() => { calls.length = 0; result = { data: [], error: null }; });

  it("a waiter is refused in words and nothing is read", async () => {
    await expect(ctrl().exportVerified({ userId: "u", restaurantId: "r1", role: "waiter" } as any)).rejects.toThrow(HttpException);
    expect(chain.from).not.toHaveBeenCalledWith("procurement_documents");
  });
  it("a manager gets only their own house's verified papers", async () => {
    result = { data: [{ id: "d1", doc_number: "A-1", currency: "USD", total: "1.05", provider_id: null, extracted: { vendorName: "Acme" } }], error: null };
    const out = await ctrl().exportVerified({ userId: "u", restaurantId: "r1", role: "manager" } as any);
    expect(calls).toEqual(expect.arrayContaining([["restaurant_id", "r1"], ["status", "verified"]]));
    expect(out).toContain("A-1");
    expect(out).toContain("1.05");
  });
  it("a failed read throws a 500 in words, never an empty file", async () => {
    result = { data: null, error: { message: "boom" } };
    await expect(ctrl().exportVerified({ userId: "u", restaurantId: "r1", role: "manager" } as any)).rejects.toThrow(/no file was made/);
  });
});

describe("the verified papers, one row per line (r110 g4, ?lines=1)", () => {
  const paper = (o: Partial<Parameters<typeof verifiedLinesCsv>[0][number]> = {}) => ({
    doc_number: "A-1", doc_date: "2026-11-02", doc_type: "invoice", vendor: "Acme",
    currency: "USD", subtotal: null, freight: null, tax: "3.00", total: null,
    lines: [
      { line_no: 1, description: "Rioja", line_total: "20.00", deposit: "0.10", vat_rate_percent: 20, cls: "Wine" },
      { line_no: 2, description: "Water", line_total: "10.00", vat_rate_percent: null, cls: null },
    ],
    ...o,
  });
  const rowsOf = (csv: string) => csv.trim().split("\r\n").map((l) => l.split(","));

  it("gives each line its category, printed rate, net, tax share and deposit", () => {
    const [head, a, b, total] = rowsOf(verifiedLinesCsv([paper()]));
    expect(head.slice(7)).toEqual(["Category", "VAT rate", "Net", "Tax share", "Deposit"]);
    expect(a.slice(5)).toEqual(["1", "Rioja", "Wine", "20%", "20.00", "2.00", "0.10"]);
    expect(b.slice(7)).toEqual(["Not classed", "rate not printed", "10.00", "1.00", ""]);
    // the tax shares sum to the paper's tax to the cent
    expect(total).toEqual(["Total", "", "", "", "USD", "", "", "", "", "30.00", "3.00", "0.10"]);
  });

  it("a credit memo is negative, and two currencies are two Total rows", () => {
    const csv = verifiedLinesCsv([
      paper({ doc_type: "credit_memo", tax: null, lines: [{ line_no: 1, line_total: "5.00", cls: "Beer" }] }),
      paper({ currency: "TRY", tax: null, lines: [{ line_no: 1, line_total: "100.00", cls: "Food" }] }),
      paper({ currency: null, tax: null }),
    ]);
    const rows = rowsOf(csv);
    expect(rows[1][9]).toBe("-5.00");
    expect(rows.filter((r) => r[0] === "Total").map((r) => [r[4], r[9]])).toEqual([
      ["USD", "-5.00"],
      ["TRY", "100.00"],
      ["", ""],
    ]);
    expect(csv).toContain("1 paper states no currency; not added up");
  });
});
