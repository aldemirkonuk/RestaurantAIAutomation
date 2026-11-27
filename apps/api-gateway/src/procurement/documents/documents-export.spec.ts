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
      expect(totalLine[0]).toBe("Total invoice");
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
    expect(csv.match(/^Total invoice,/gm)?.length).toBe(2);
  });
  it("papers of different types are never added into one total (r106 fz)", () => {
    const csv = verifiedCsv([
      row({ doc_number: "I-1", doc_type: "invoice", total: "1000.00" }),
      row({ doc_number: "P-1", doc_type: "packing_slip", total: "1000.00" }),
      row({ doc_number: "S-1", doc_type: "statement", total: "1000.00" }),
      row({ doc_number: "C-1", doc_type: "credit_memo", total: "200.00" }),
    ]);
    const totals = csv.split("\r\n").filter((l) => l.startsWith("Total "));
    expect(totals.map((l) => l.split(",")[0])).toEqual(["Total invoice", "Total packing_slip", "Total statement", "Total credit_memo"]);
    expect(totals.map((l) => l.split(",")[8])).toEqual(["1000.00", "1000.00", "1000.00", "200.00"]);
    expect(csv).not.toContain("3200.00");
  });
  it("a column no paper printed totals empty, and one some left out says how many (r106 fz)", () => {
    const none = verifiedCsv([row({ freight: null }), row({ freight: null })]).split("\r\n").find((l) => l.startsWith("Total "))!.split(",");
    expect(none[6]).toBe("");
    const some = verifiedCsv([row({ total: "5.00" }), row({ total: null }), row({ total: "7.00" })]).split("\r\n").find((l) => l.startsWith("Total "))!.split(",");
    expect(some[8]).toBe("12.00");
    expect(some[9]).toBe("1 of 3 papers printed no total");
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
    or: jest.fn(() => chain),
    limit: jest.fn(() => Promise.resolve(result)),
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
  it("pages by (created_at, id) with the raw timestamp, never an offset or a Date (r106 fz)", async () => {
    const mk = (i: number) => ({ id: `d${String(i).padStart(4, "0")}`, created_at: "2026-11-01T10:00:00.123456+00:00", currency: "USD", total: "1.00", provider_id: null, extracted: {} });
    const pages = [Array.from({ length: 1000 }, (_, i) => mk(i)), [mk(1000)]];
    chain.limit.mockImplementation(() => Promise.resolve({ data: pages.shift(), error: null }));
    chain.or.mockClear(); chain.order.mockClear();
    await ctrl().exportVerified({ userId: "u", restaurantId: "r1", role: "manager" } as any);
    expect(chain.order).toHaveBeenCalledWith("id", { ascending: true });
    expect(chain.or).toHaveBeenCalledTimes(1);
    expect(chain.or.mock.calls[0][0]).toBe(
      'created_at.gt."2026-11-01T10:00:00.123456+00:00",and(created_at.eq."2026-11-01T10:00:00.123456+00:00",id.gt."d0999")',
    );
    chain.limit.mockImplementation(() => Promise.resolve(result));
  });
  it("a failed read throws a 500 in words, never an empty file", async () => {
    result = { data: null, error: { message: "boom" } };
    await expect(ctrl().exportVerified({ userId: "u", restaurantId: "r1", role: "manager" } as any)).rejects.toThrow(/no file was made/);
  });
});
