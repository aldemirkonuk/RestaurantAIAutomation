import { HttpException } from "@nestjs/common";
import { DocumentsController } from "./documents.controller";
import { formatCents, toCents, verifiedCsv, type ExportRow } from "./documents-export";

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
  it("a column only some papers printed totals the ones that did and says how many did not", () => {
    // 9 TRY papers print tax, 1 is tax-inclusive and prints none; every paper prints a total.
    const papers = Array.from({ length: 10 }, (_, i) =>
      row({ currency: "TRY", doc_number: `T-${i}`, subtotal: null, freight: null, tax: i === 9 ? null : "1.00", total: "10.00" }),
    );
    const total = verifiedCsv(papers).trim().split("\r\n").pop()!;
    expect(total).toBe("Total,,,,TRY,,,9.00,100.00,1 of 10 papers prints no tax; not in this total");
  });
  it("an unread total is said too, and a column nobody or everybody printed needs no word", () => {
    const papers = [row({ total: null }), row({ total: "5.00" }), row({ total: "6.00" })];
    const total = verifiedCsv(papers).trim().split("\r\n").pop()!;
    expect(total).toBe("Total,,,,USD,30.30,,0.90,11.00,1 of 3 papers prints no total; not in this total");
    // freight printed by none: empty, no note for it
    expect(total).not.toContain("freight");
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
