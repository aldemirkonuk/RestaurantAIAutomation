import { commonCostTaxBasis, lineTiesOut, paperCostTaxBasis } from "./paper-cost-tax-basis";

/**
 * r108 inventory-1: a paper says whether its prices hold tax only through its
 * own totals; anything it does not say is null, never the house's basis.
 */
describe("paperCostTaxBasis", () => {
  it("lines that sum to the total before tax are net", () => {
    expect(paperCostTaxBasis({ subtotal: 200, tax: 20, total: 220, lineTotals: [120, 80] })).toBe("net");
  });

  it("lines that sum to the total with tax are gross_cost", () => {
    expect(paperCostTaxBasis({ subtotal: "200.00", tax: "20.00", total: "220.00", lineTotals: ["132.00", "88.00"] })).toBe("gross_cost");
  });

  it("a cent of rounding per line still reads", () => {
    expect(paperCostTaxBasis({ subtotal: 100, tax: 18, total: 118, lineTotals: [33.33, 33.33, 33.33] })).toBe("net");
  });

  it("says nothing when the paper does not: no tax, a line with no total, no subtotal, or sums that meet neither", () => {
    expect(paperCostTaxBasis({ subtotal: 200, tax: 0, total: 200, lineTotals: [200] })).toBeNull();
    expect(paperCostTaxBasis({ subtotal: 200, tax: null, total: 220, lineTotals: [200] })).toBeNull();
    expect(paperCostTaxBasis({ subtotal: 200, tax: 20, total: 220, lineTotals: [120, null] })).toBeNull();
    expect(paperCostTaxBasis({ subtotal: null, tax: 20, total: 220, lineTotals: [220] })).toBeNull();
    expect(paperCostTaxBasis({ subtotal: 200, tax: 20, total: 220, lineTotals: [150] })).toBeNull();
    expect(paperCostTaxBasis({ subtotal: 200, tax: 20, total: 230, lineTotals: [200] })).toBeNull();
    expect(paperCostTaxBasis({ subtotal: 200, tax: 20, total: 220, lineTotals: [] })).toBeNull();
  });
});

describe("commonCostTaxBasis", () => {
  it("is the one basis every paper states, else null", () => {
    expect(commonCostTaxBasis(["net", "net"])).toBe("net");
    expect(commonCostTaxBasis(["net", "gross_cost"])).toBeNull();
    expect(commonCostTaxBasis(["net", null])).toBeNull();
    expect(commonCostTaxBasis([])).toBeNull();
  });
});

describe("lineTiesOut: the cost is the unit price, so quantity x price must be the line total", () => {
  it("ties when qty x price is the line total to the cent, by bottles or by qty", () => {
    expect(lineTiesOut({ unitPrice: 142.5, lineTotal: 1425, qtyBottles: 10 })).toBe(true);
    expect(lineTiesOut({ unitPrice: 14.25, lineTotal: 1425, qty: 100 })).toBe(true);
    expect(lineTiesOut({ unitPrice: 33.3333, lineTotal: 99.99, qty: 3 })).toBe(true);
  });
  it("does not tie when the unit price is net and the line total is gross (a KDV-dahil column)", () => {
    expect(lineTiesOut({ unitPrice: 142.5, lineTotal: 1710, qtyBottles: 10 })).toBe(false);
  });
  it("free goods come off the charged quantity", () => {
    expect(lineTiesOut({ unitPrice: 100, lineTotal: 1000, qtyBottles: 12, freeGoodsQty: 2 })).toBe(true);
  });
  it("a priced line with no total does not tie; an unpriced line is not a costed line", () => {
    expect(lineTiesOut({ unitPrice: 5, lineTotal: null, qty: 2 })).toBe(false);
    expect(lineTiesOut({ unitPrice: null, lineTotal: 50 })).toBe(true);
  });
});
