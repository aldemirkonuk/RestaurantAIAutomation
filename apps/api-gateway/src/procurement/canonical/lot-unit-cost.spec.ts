// QA round 7c B1: the rule itself. The seam tests are in delivery-stock.service.spec.ts.
import { LotCostLine, perBottleLotCost, toLotCostPrecision } from "./lot-unit-cost";

const line = (over: Partial<LotCostLine> = {}): LotCostLine => ({
  unit_price: 264, uom: "case", pack_size: 12, price_base_qty: null, price_base_uom: null, ...over,
});
const cost = (over: Partial<LotCostLine>) => {
  const r = perBottleLotCost(line(over));
  return r.ok ? r.perBottle : r;
};
const refusal = (over: Partial<LotCostLine>) => {
  const r = perBottleLotCost(line(over));
  return !r.ok && r.kind === "refused" ? r.reason : `not refused: ${JSON.stringify(r)}`;
};

describe("perBottleLotCost", () => {
  it("converts every arrangement of the printed price base to one bottle", () => {
    // QA 8a: 2 cases @ 264 / case, pack 12, no base, no total.
    expect(cost({})).toBe(22);
    // 12 şişe @ 142,00 / KS(12), with or without the base unit.
    expect(cost({ uom: "bottle", unit_price: 142, price_base_qty: 12, price_base_uom: "bottle" })).toBe(11.8333);
    expect(cost({ uom: "bottle", unit_price: 142, price_base_qty: "12.000" })).toBe(11.8333);
    expect(cost({ uom: "bottle", price_base_qty: 1, price_base_uom: "case" })).toBe(22);
    expect(cost({ price_base_qty: 12, price_base_uom: "bottle" })).toBe(22);
    expect(cost({ unit_price: "264.0000", pack_size: "12" })).toBe(22);
  });

  it("leaves a per-bottle price and a per-keg keg price as printed, and says so", () => {
    const r = perBottleLotCost(line({ uom: "bottle", pack_size: 1, unit_price: 142.5 }));
    expect(r).toMatchObject({ ok: true, perBottle: 142.5, unitCost: 142.5 });
    expect(r.ok && r.basis).toMatch(/booked as-is/);
    expect(cost({ uom: "keg", pack_size: 1, unit_price: 300 })).toBe(300);
  });

  it.each([null, undefined, "", "abc", 0, -4])("a price of %p is no price, never 0", (unit_price) => {
    expect(perBottleLotCost(line({ unit_price }))).toEqual({ ok: false, kind: "no_price" });
  });

  it("refuses rather than guessing, and names why", () => {
    expect(refusal({ pack_size: 1 })).toMatch(/does not state how many bottles a case holds/);
    expect(refusal({ uom: "bottle", pack_size: undefined, unit_price: 142, price_base_qty: 12, price_base_uom: "case" })).toMatch(/12 cases/);
    expect(refusal({ uom: "keg", price_base_uom: "bottle" })).toMatch(/keg is not a number of bottles/);
    expect(refusal({ uom: "bottle", price_base_uom: "liter" })).toMatch(/liter is not a number of bottles/);
    expect(refusal({ uom: null })).toMatch(/null/);
    expect(refusal({ uom: "crate" })).toMatch(/crate/);
    expect(refusal({ price_base_uom: "dozen" })).toMatch(/dozen/);
    for (const price_base_qty of [0, -12, "twelve"])
      expect(refusal({ price_base_qty })).toMatch(/cannot be divided/);
    expect(refusal({ uom: "bottle", unit_price: 0.04, price_base_qty: 12 })).toMatch(/cost of nothing/);
  });

  it("rounds half away from zero, as Postgres numeric does", () => {
    expect([1.005, 11.8333, 11.835, 22].map(toLotCostPrecision)).toEqual([1.01, 11.83, 11.84, 22]);
  });
});
