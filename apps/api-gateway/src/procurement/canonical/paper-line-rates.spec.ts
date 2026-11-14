/**
 * r35, ADR 0359 C3 continued: a paper that prints a tax rate beside each line
 * is costed line by line, once those rates make the tax the paper prints.
 *
 * Fixtures are SYNTHETIC. Worked numbers are in each test's name.
 */
import { landDelivery, PaperHeaderRow, PaperLine } from "./paper-landed-cost";
import { paperTaxFacts, PaperTaxLine, snapshotLineRates } from "./paper-tax-facts";
import { HouseTax } from "../landed-cost";

const A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

const at = (total: number, rate: number | null, lineNo = 1, qty = 10): PaperTaxLine => ({
  kind: "value",
  printedTotal: total,
  printedRatePercent: rate,
  input: {
    line_no: lineNo,
    allowance: null,
    deposit: null,
    price_tax_basis: null,
    vat_rate_percent: null,
    item_key: A,
    qty,
    uom: "bottle",
    pack_size: 1,
    price_base_qty: 1,
    unit_price: total / qty,
    line_total: total,
    listed_bottles: qty,
    stocked: true,
  },
});

describe("paperTaxFacts — each line's own printed rate", () => {
  it("a till receipt 110 at %10 + 120 at %20 = 230, tax 30, no bases: tax inside, each line at its own rate", () => {
    const f = paperTaxFacts({ tax: 30, total: 230 }, [at(110, 10, 1), at(120, 20, 2)]);
    expect(f).toMatchObject({ basis: "includes_tax", ratePercent: null, lineRates: [10, 20] });
    expect(f.said).toMatch(
      /read as including tax, since its lines add up to its total of 230.00 and the rates printed beside them make its tax of 30.00 only with the tax inside \(before tax they would make 35.00\)/,
    );
    expect(f.said).toMatch(/Each line is at the rate printed beside it \(10 % on 1 line, 20 % on 1 line\), which makes its tax of 30.00/);
  });

  it("a pre-tax total in the total box (100 at %10 + 100 at %20 = 200, tax 30) is not read as tax inside", () => {
    const f = paperTaxFacts({ tax: 30, total: 200 }, [at(100, 10, 1), at(100, 20, 2)]);
    expect(f.basis).toBeNull();
    expect(f.lineRates).toBeNull();
    expect(f.said).toMatch(/make its tax of 30.00 only if its prices are before tax, while its lines add up to its total, so neither reading is used/);
  });

  it("an invoice before tax, 600 at %20 + 400 at %1, tax 124, total 1124: each line keeps its own rate", () => {
    const f = paperTaxFacts(
      { tax: 124, total: 1124, tax_breakdown: [{ rate: 20, taxableBase: 600, amount: 120 }, { rate: 1, taxableBase: 400, amount: 4 }] },
      [at(600, 20, 1), at(400, 1, 2)],
    );
    expect(f).toMatchObject({ basis: "excludes_tax", ratePercent: null, lineRates: [20, 1] });
    expect(f.said).toMatch(/its lines of 1000.00 and its tax of 124.00 add up to its total of 1124.00/);
    expect(f.said).not.toMatch(/not which line carries which/);
  });

  it("one rate on every line with freight 50: the freight takes it too (1050 × 20 % = 210)", () => {
    const f = paperTaxFacts({ tax: 210, total: 1260, freight: 50 }, [at(600, 20, 1), at(400, 20, 2)]);
    expect(f).toMatchObject({ basis: "excludes_tax", ratePercent: 20, lineRates: [20, 20] });
    expect(f.said).toMatch(/Every line prints 20 % beside it, which makes its tax of 210.00/);
  });

  it("rates beside the lines that do not make the tax (20 % + 1 % make 124, it prints 160) are not used", () => {
    const f = paperTaxFacts({ tax: 160, total: 1160 }, [at(600, 20, 1), at(400, 1, 2)]);
    expect(f).toMatchObject({ basis: "excludes_tax", ratePercent: null, lineRates: null });
    expect(f.said).toMatch(/The rates beside its lines make tax of 124.00, not the 160.00 it prints, so none is used/);
  });

  it("the paper-wide reading still runs when the lines' rates fail: one printed rate that makes the tax is kept", () => {
    const f = paperTaxFacts(
      { tax: 200, total: 1200, tax_breakdown: [{ rate: 20 }] },
      [at(600, 10, 1), at(400, 10, 2)],
    );
    expect(f).toMatchObject({ basis: "excludes_tax", ratePercent: 20, lineRates: null });
    expect(f.said).toMatch(/Every line is at 20 %, the one rate it prints/);
    expect(f.said).toMatch(/The rates beside its lines make tax of 100.00, not the 200.00 it prints/);
  });

  it("a line with no rate beside it keeps the others' rates off every line, and names the line", () => {
    const f = paperTaxFacts({ tax: 124, total: 1124 }, [at(600, 20, 1), at(400, null, 2)]);
    expect(f.lineRates).toBeNull();
    expect(f.said).toMatch(/Line 2 prints no tax rate beside it/);
  });

  it("several rates with a freight or a discount on the paper: the charges' rate is not said, so none is used", () => {
    const freight = paperTaxFacts({ tax: 124, total: 1174, freight: 50 }, [at(600, 20, 1), at(400, 1, 2)]);
    expect(freight.lineRates).toBeNull();
    expect(freight.said).toMatch(/Its lines print 2 tax rates, and it does not say which rate its charges or discount carry/);
    const discount = paperTaxFacts({ tax: 124, total: 1094, discount_total: 30 }, [at(600, 20, 1), at(400, 1, 2)]);
    expect(discount.lineRates).toBeNull();
  });

  it("a printed tax row that disagrees with the lines at its rate keeps every rate off", () => {
    const amount = paperTaxFacts(
      { tax: 124, total: 1124, tax_breakdown: [{ rate: 20, amount: 120 }, { rate: 1, amount: 24 }] },
      [at(600, 20, 1), at(400, 1, 2)],
    );
    expect(amount.lineRates).toBeNull();
    expect(amount.said).toMatch(/Its lines at 1 % make tax of 4.00, but its tax row for 1 % prints 24.00/);
    const base = paperTaxFacts(
      { tax: 124, total: 1124, tax_breakdown: [{ rate: 20, taxableBase: 500 }, { rate: 1, taxableBase: 400 }] },
      [at(600, 20, 1), at(400, 1, 2)],
    );
    expect(base.lineRates).toBeNull();
    expect(base.said).toMatch(/Its lines at 1 % come to 400.00 before tax|Its lines at 20 % come to 600.00 before tax, but its tax row for 20 % prints a base of 500.00/);
    const stray = paperTaxFacts(
      { tax: 124, total: 1124, tax_breakdown: [{ rate: 20, amount: 120 }, { rate: 10, amount: 4 }] },
      [at(600, 20, 1), at(400, 1, 2)],
    );
    expect(stray.lineRates).toBeNull();
    expect(stray.said).toMatch(/A line prints 1 %, a rate its tax rows do not print/);
  });

  it("a per-rate row that agrees, base and amount, keeps the rates (tax inside: 110 at %10 is 100 + 10)", () => {
    const f = paperTaxFacts(
      { tax: 30, total: 230, tax_breakdown: [{ rate: 10, amount: 10 }, { rate: 20, taxableBase: 100, amount: 20 }] },
      [at(110, 10, 1), at(120, 20, 2)],
    );
    expect(f).toMatchObject({ basis: "includes_tax", lineRates: [10, 20] });
  });

  it("at 1 % on a small paper the two readings cannot be told apart (101 holds 1.00, before tax makes 1.01): nothing is read", () => {
    const f = paperTaxFacts({ tax: 1, total: 101 }, [at(101, 1, 1)]);
    expect(f.basis).toBeNull();
    expect(f.lineRates).toBeNull();
  });

  it("a deposit or unpriced line on the paper keeps every line's own rate off", () => {
    const deposit: PaperTaxLine = { ...at(0, 0, 3), kind: "not_stocked" };
    expect(paperTaxFacts({ tax: 124, total: 1124 }, [at(600, 20, 1), at(400, 1, 2), deposit]).lineRates).toBeNull();
  });

  it("no rate beside any line: the reading is exactly what it was", () => {
    const f = paperTaxFacts({ tax: 30, total: 230 }, [at(110, null, 1), at(120, null, 2)]);
    expect(f).toMatchObject({ basis: null, ratePercent: null, lineRates: null });
    expect(f.said).toMatch(/it prints no base for its tax, so its total could be before tax\.$/);
  });
});

describe("snapshotLineRates", () => {
  it("keeps each line's printed rate by its number, and drops what is not a rate", () => {
    const m = snapshotLineRates({
      lines: [
        { lineNo: 1, vatRatePercent: 10 },
        { lineNo: 2, vatRatePercent: "20" },
        { lineNo: 3, vatRatePercent: 120 },
        { lineNo: 4, vatRatePercent: -1 },
        { lineNo: 5 },
        { vatRatePercent: 8 },
        { lineNo: 7, vatRatePercent: 0 },
      ],
    });
    expect([...m.entries()]).toEqual([
      [1, 10],
      [2, 20],
      [7, 0],
    ]);
    expect(snapshotLineRates(null).size).toBe(0);
    expect(snapshotLineRates({ lines: "x" }).size).toBe(0);
  });
});

describe("landDelivery — each line's own rate reaches its lot", () => {
  const reclaims: HouseTax = { tax_basis: "prices_include_tax", reclaims_input_tax: true };
  const keeps: HouseTax = { tax_basis: "prices_exclude_tax", reclaims_input_tax: false };
  const line = (lineNo: number, item: string, unitPrice: number, qty = 10): PaperLine => ({
    row: {
      document_id: "inv-1",
      line_no: lineNo,
      inventory_id: item,
      qty_bottles: qty,
      unit_price: unitPrice,
      uom: "bottle",
      pack_size: 1,
      line_total: unitPrice * qty,
    } as never,
    cost: { ok: true, unitCost: unitPrice, basis: "SYNTHETIC per bottle" } as never,
  });
  const run = (paper: Partial<PaperHeaderRow>, house: HouseTax, lines: PaperLine[]) =>
    landDelivery({
      papers: [{ id: "inv-1", doc_number: "SYN-1", currency: "TRY", ...paper }],
      lines,
      booked: new Map([
        [A, 10],
        [B, 10],
      ]),
      houseCurrency: "TRY",
      houseTax: house,
    });
  const rates = (a: number, b: number) => [
    { lineNo: 1, vatRatePercent: a },
    { lineNo: 2, vatRatePercent: b },
  ];

  it("a till receipt 10 × 11 at %10 + 10 × 12 at %20 costs a reclaiming house 10 and 10 a bottle, stamped net", () => {
    const r = run({ tax: 30, total: 230, extracted_lines: rates(10, 20) }, reclaims, [line(1, A, 11), line(2, B, 12)]);
    expect(r.byItem.get(A)).toMatchObject({ unitCost: 10, costTaxBasis: "net" });
    expect(r.byItem.get(B)).toMatchObject({ unitCost: 10, costTaxBasis: "net" });
    expect(r.papers[0].taxSaid).toMatch(/Each line is at the rate printed beside it/);
  });

  it("without the rates beside its lines, the same receipt is costed as printed, 11 and 12, unstamped", () => {
    const r = run({ tax: 30, total: 230 }, reclaims, [line(1, A, 11), line(2, B, 12)]);
    expect(r.byItem.get(A)).toMatchObject({ unitCost: 11, costTaxBasis: null });
    expect(r.byItem.get(B)).toMatchObject({ unitCost: 12, costTaxBasis: null });
  });

  it("an invoice before tax, 10 × 60 at %20 + 10 × 40 at %1, costs a house that keeps its tax 72 and 40.40, stamped gross_cost", () => {
    const r = run({ tax: 124, total: 1124, extracted_lines: rates(20, 1) }, keeps, [line(1, A, 60), line(2, B, 40)]);
    expect(r.byItem.get(A)).toMatchObject({ unitCost: 72, costTaxBasis: "gross_cost" });
    expect(r.byItem.get(B)).toMatchObject({ unitCost: 40.4, costTaxBasis: "gross_cost" });
  });

  it("rates on another paper's lines are not this paper's: they are read by document and line", () => {
    const r = landDelivery({
      papers: [
        { id: "inv-1", doc_number: "SYN-1", currency: "TRY", tax: 30, total: 230 },
        { id: "inv-2", doc_number: "SYN-2", currency: "TRY", extracted_lines: rates(10, 20) },
      ],
      lines: [line(1, A, 11), line(2, B, 12)],
      booked: new Map([
        [A, 10],
        [B, 10],
      ]),
      houseCurrency: "TRY",
      houseTax: reclaims,
    });
    expect(r.byItem.get(A)).toMatchObject({ unitCost: 11, costTaxBasis: null });
  });
});
