import {
  CostedLine,
  HouseTax,
  LandedCostHeader,
  LandedCostLineInput,
  landedCost,
} from "./landed-cost";

/**
 * r34 walk w2 F5: a line whose tax could not be worked out said "its tax could
 * not be added, since ..., so it is costed as printed and what its cost holds
 * is not stated" — which never said what the cost IS. It now names it: the
 * printed amount, why, and the tax step left undone. SYNTHETIC numbers.
 */

const HEADER: LandedCostHeader = {
  subtotal: null,
  discount_total: null,
  freight: null,
  fuel_surcharge: null,
  split_case_fee: null,
  delivery_fee: null,
  other_charges: null,
  deposit_total: null,
  tax: null,
  charges_tax_basis: null,
  charges_vat_rate_percent: null,
};
const PAYS: HouseTax = { tax_basis: "prices_include_tax", reclaims_input_tax: false };
const RECLAIMS: HouseTax = { tax_basis: "prices_include_tax", reclaims_input_tax: true };

const line = (o: Partial<LandedCostLineInput>): LandedCostLineInput => ({
  line_no: 1,
  qty: 10,
  uom: "bottle",
  pack_size: 1,
  price_base_qty: null,
  unit_price: 11.8,
  line_total: 118,
  allowance: null,
  deposit: null,
  price_tax_basis: "includes_tax",
  vat_rate_percent: 18,
  listed_bottles: 10,
  accepted_bottles: 10,
  ...o,
});

const basisOf = (house: HouseTax, o: Partial<LandedCostLineInput>) => {
  const l = landedCost({ header: HEADER, lines: [line(o)], house }).lines[0] as CostedLine;
  expect(l.status).toBe("costed");
  expect(l.cost_value).toBeCloseTo(118, 6);
  expect(l.cost_tax_basis).toBeNull();
  return l.basis;
};

describe("a cost that is the printed amount says so (r34 w2 F5)", () => {
  it("[REVERT-FAILS] a house that pays the tax, no rate printed: the printed amount, and the tax not added", () => {
    const said = basisOf(PAYS, { price_tax_basis: "excludes_tax", vat_rate_percent: null });
    expect(said).toContain(
      "For cost, the printed amount is used, since the paper prints no tax rate for it, so the tax the house pays on it is not added: 118.00.",
    );
    expect(said).not.toMatch(/could not be added|what its cost holds/);
  });

  it("[REVERT-FAILS] a house that pays the tax, no basis printed: says the paper does not say", () => {
    expect(basisOf(PAYS, { price_tax_basis: null })).toContain(
      "For cost, the printed amount is used, since the paper does not say whether its price includes tax, so the tax the house pays on it is not added: 118.00.",
    );
  });

  it("[REVERT-FAILS] a house that reclaims the tax, no rate printed: the tax it reclaims is not taken out", () => {
    const said = basisOf(RECLAIMS, { vat_rate_percent: null });
    expect(said).toContain(
      "For cost, the printed amount is used, since the paper prints no tax rate for it, so the tax the house reclaims is not taken out of it: 118.00.",
    );
    expect(said).not.toMatch(/could not be taken out|what its cost holds/);
  });

  it("a line whose tax is worked out keeps its own sentence", () => {
    const l = landedCost({ header: HEADER, lines: [line({})], house: RECLAIMS }).lines[0] as CostedLine;
    expect(l.basis).toContain("of tax inside its price is taken out, since the house reclaims it");
    expect(l.basis).not.toContain("the printed amount is used");
  });
});
