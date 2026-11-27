import { DocumentsController } from "./documents.controller";
import { verifiedCsv, type ExportRow } from "./documents-export";

/**
 * THE TOTAL ROW NEVER ADDS TWO MONIES (r109, DD-r109-8b). Two amounts are added
 * only when both papers state the same currency; a paper that states none is
 * added to nothing and its Total row says so with no figure.
 */
const row = (o: Partial<ExportRow> = {}): ExportRow => ({
  doc_number: "A-1", doc_date: "2026-11-01", doc_type: "invoice", vendor: "Acme",
  currency: "USD", subtotal: null, freight: null, tax: null, total: "10.40", ...o,
});
const totals = (csv: string) =>
  csv.trim().split("\r\n").filter((l) => l.startsWith("Total,")).map((l) => l.split(","));

describe("verified CSV Total rows by currency (r109)", () => {
  it("USD and TRY papers total apart; TRY is never added to USD", () => {
    const csv = verifiedCsv([
      row({ total: "10.40" }),
      row({ doc_number: "T-1", currency: "TRY", total: "1250.00" }),
      row({ doc_number: "A-2", total: "5.00" }),
    ]);
    const t = totals(csv);
    expect(t.map((l) => [l[4], l[8]])).toEqual([["USD", "15.40"], ["TRY", "1250.00"]]);
    expect(csv).not.toMatch(/1265\.40|1260\.40|1255\.00/);
  });

  it("the same money written two ways is one total", () => {
    const t = totals(verifiedCsv([row({ currency: "try", total: "1.00" }), row({ currency: " TRY ", total: "2.00" })]));
    expect(t.map((l) => [l[4], l[8]])).toEqual([["TRY", "3.00"]]);
  });

  it("a paper that states no currency is added to nothing, and its Total row says so with no figure", () => {
    const t = totals(verifiedCsv([row({ total: "10.40" }), row({ currency: null, total: "99.99" }), row({ currency: " ", total: "1.00" })]));
    expect(t[0].slice(4, 9)).toEqual(["USD", "", "", "", "10.40"]);
    expect(t[1].slice(4, 9)).toEqual(["", "", "", "", ""]);
    expect(t[1][9]).toBe("2 papers state no currency; not added up");
  });

  it("a figure no paper in that currency printed totals to empty, never 0.00", () => {
    const [usd] = totals(verifiedCsv([row({ freight: null, tax: "0.30" }), row({ freight: null, tax: null })]));
    expect(usd[6]).toBe("");
    expect(usd[7]).toBe("0.30");
  });

  it("the export of a house with one non-USD verified paper gives two totals, end to end", async () => {
    const chain: any = {
      from: () => chain, select: () => chain, eq: () => chain, order: () => chain, in: () => chain,
      range: () => Promise.resolve({
        data: [
          { id: "d1", doc_number: "A-1", currency: "USD", total: 40.5, provider_id: null, extracted: { vendorName: "Acme" } },
          { id: "d2", doc_number: "T-7", currency: "TRY", total: 1250, provider_id: null, extracted: { vendorName: "Bosphorus Wines" } },
        ],
        error: null,
      }),
    };
    const c = new DocumentsController(
      {} as any, { getClient: () => chain } as any, {} as any, {} as any, {} as any,
      {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any,
    );
    const out = await c.exportVerified({ userId: "u", restaurantId: "r1", role: "owner" } as any);
    expect(totals(out).map((l) => [l[4], l[8]])).toEqual([["USD", "40.50"], ["TRY", "1250.00"]]);
  });
});
