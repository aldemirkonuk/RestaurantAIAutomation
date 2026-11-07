/**
 * QA round 7c B1 — an invoice line's printed price, as the cost of one bottle.
 * The seam tests that are red on origin/main are in
 * `delivery-stock.service.spec.ts`; this pins the rule itself.
 */

import {
  LotCostLine,
  perBottleLotCost,
  toLotCostPrecision,
} from "./lot-unit-cost";

const line = (over: Partial<LotCostLine> = {}): LotCostLine => ({
  unit_price: 264,
  uom: "case",
  pack_size: 12,
  price_base_qty: null,
  price_base_uom: null,
  ...over,
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
    // 2 cases @ 264 / case, pack 12, no base, no total (QA 8a): pack_size is read.
    expect(cost({})).toBe(22);
    // 12 şişe @ 142,00 / KS(12): a base of 12 bottles, with or without its unit.
    expect(cost({ uom: "bottle", unit_price: 142, price_base_qty: 12, price_base_uom: "bottle" })).toBe(11.8333);
    expect(cost({ uom: "bottle", unit_price: 142, price_base_qty: "12.000" })).toBe(11.8333);
    // A bottle line priced per one case of 12; a case line priced per 12 bottles.
    expect(cost({ uom: "bottle", price_base_qty: 1, price_base_uom: "case" })).toBe(22);
    expect(cost({ price_base_qty: 12, price_base_uom: "bottle" })).toBe(22);
    // PostgREST hands numeric columns over as strings.
    expect(cost({ unit_price: "264.0000", pack_size: "12" })).toBe(22);
  });

  it("leaves a per-bottle price and a per-keg keg price as printed, and says so", () => {
    const r = perBottleLotCost(line({ uom: "bottle", pack_size: 1, unit_price: 142.5 }));
    expect(r).toMatchObject({ ok: true, perBottle: 142.5, unitCost: 142.5 });
    expect(r.ok && r.basis).toMatch(/booked as-is/);
    expect(cost({ uom: "keg", pack_size: 1, unit_price: 300 })).toBe(300);
  });

  it("gives the column's two places, and the exact figure in the basis", () => {
    const r = perBottleLotCost(line({ uom: "bottle", unit_price: 142, price_base_qty: 12 }));
    expect(r).toMatchObject({ ok: true, unitCost: 11.83 });
    expect(r.ok && r.basis).toMatch(/= 11\.8333 per bottle/);
  });

  it.each([null, undefined, "", "abc", 0, -4])("a price of %p is no price, never 0", (unit_price) => {
    expect(perBottleLotCost(line({ unit_price }))).toEqual({ ok: false, kind: "no_price" });
  });

  it("refuses rather than guessing, and names why", () => {
    // The column's DEFAULT 1 on a case is "not stated", not "one bottle a case".
    expect(refusal({ pack_size: 1 })).toMatch(/does not state how many bottles a case holds/);
    // The QA probe's line 1: 142 per 12 cases, pack absent.
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
