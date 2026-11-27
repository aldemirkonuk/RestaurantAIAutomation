import { commonCostTaxBasis, paperCostTaxBasis } from "./paper-cost-tax-basis";

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
