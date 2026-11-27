/**
 * r39 walk-w2 I1: "Landed cost 0.01 a gram" / "0.00 a milliliter". The
 * per-unit sentence printed two places, so a cheap good read as nothing. One
 * rule now says every per-unit cost: at least two places, enough for three
 * significant figures, never more than the six the lot keeps. Every fixture is
 * SYNTHETIC.
 */
import {
  LandedCostHeader,
  LandedCostLineInput,
  HouseTax,
  landedCost,
  perUnitCost,
} from "./landed-cost";

const NO_HEADER: LandedCostHeader = {
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
const UNSET: HouseTax = { tax_basis: "unset", reclaims_input_tax: null };

const line = (o: Partial<LandedCostLineInput>): LandedCostLineInput => ({
  line_no: 1,
  qty: 1000,
  uom: "bottle",
  pack_size: 1,
  price_base_qty: null,
  unit_price: 0.035,
  line_total: 35,
  allowance: null,
  deposit: null,
  price_tax_basis: null,
  vat_rate_percent: null,
  listed_bottles: 1000,
  accepted_bottles: 1000,
  ...o,
});

const run = (o: Partial<LandedCostLineInput>) => {
  const r = landedCost({ header: NO_HEADER, lines: [line({ item_key: "x", ...o })], house: UNSET });
  const l = r.lines[0];
  const i = r.items[0];
  if (l.status !== "costed" || i.status !== "costed") throw new Error("not costed");
  return { line: l.basis, item: i.basis };
};

describe("perUnitCost: one rule for a per-unit cost in words", () => {
  it.each([
    [0.035, "0.035"],
    [0.0058124, "0.00581"],
    [0.0185, "0.0185"],
    [0.45, "0.45"],
    [0.01, "0.01"],
    [0.000001, "0.000001"],
    [18.5, "18.50"],
    [9.230769, "9.23"],
    [123.456, "123.46"],
    [0, "0.00"],
    [-0.035, "-0.035"],
  ])("%p reads %p", (n, said) => {
    expect(perUnitCost(n)).toBe(said);
  });

  it("a cost too small for six places says so instead of reading as nothing", () => {
    expect(perUnitCost(0.0000004)).toBe("under 0.000001");
  });
});

describe("landedCost: a cheap good's sentence keeps its places", () => {
  it("35 for 1000 g reads 0.035 a gram, not 0.04", () => {
    const s = run({ unit: "g" });
    expect(s.line).toContain("Landed cost 0.035 a gram.");
    expect(s.item).toContain("0.035 a gram.");
  });

  it("29.06 for 5000 ml reads 0.00581 a milliliter, not 0.01", () => {
    const s = run({ unit: "ml", qty: 5000, unit_price: 0.005812, line_total: 29.06, listed_bottles: 5000, accepted_bottles: 5000 });
    expect(s.line).toContain("Landed cost 0.00581 a milliliter.");
    expect(s.item).toContain("0.00581 a milliliter.");
  });

  it("a bottle still reads two places", () => {
    const s = run({ qty: 12, unit_price: 18.5, line_total: 222, listed_bottles: 12, accepted_bottles: 12 });
    expect(s.line).toContain("Landed cost 18.50 a bottle.");
  });
});
