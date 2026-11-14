// QA round 7c B1: the rule itself. The seam tests are in delivery-stock.service.spec.ts.
import { LotCostLine, perBottleLotCost, proposalPerBottle, toLotCostPrecision } from "./lot-unit-cost";

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
    expect(cost({ uom: "bottle", unit_price: 142, price_base_qty: 12, price_base_uom: "bottle" })).toBeCloseTo(142 / 12, 12);
    expect(cost({ uom: "bottle", unit_price: 142, price_base_qty: "12.000" })).toBeCloseTo(142 / 12, 12);
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
    // Six places keep 0.04 / 12 = 0.003333 (#839); only a price under half a
    // millionth a bottle rounds to nothing.
    expect(refusal({ uom: "bottle", unit_price: 0.0001, price_base_qty: 1000 })).toMatch(/rounds to 0\.00, and a lot is never booked at a cost of nothing/);
  });

  it("refuses an unmapped unit kept as each, and a line total that contradicts the price (D1, QA 9a)", () => {
    const kutu = { uom: "each", qty_bottles: 2, line_total: 528, printed: { uom: "kutu" } };
    expect(refusal(kutu)).toMatch(/prints its unit as "kutu"/);
    expect(cost({ ...kutu, printed: { uom: "adet" } })).toBe(264);
    expect(refusal({ price_base_qty: 12, printed: { priceBaseUom: "magnum" } })).toMatch(/per "magnum"/);
    // 24 bottles @ 264 cannot total 528: the price was per case.
    for (const pack_size of [12, 1])
      expect(refusal({ uom: "bottle", pack_size, qty_bottles: 24, line_total: 528 })).toMatch(/totals 528 for 24 counted, but 264\.00 each makes 6336\.00,/);
    // Totals that agree, to the cent, pass.
    expect(cost({ qty_bottles: 24, line_total: "528.00" })).toBe(22);
    expect(cost({ uom: "bottle", unit_price: 142, price_base_qty: 12, qty_bottles: 12, line_total: 142 })).toBeCloseTo(142 / 12, 12);
  });

  it("QA 10a (2): a bare price on a bottle row whose bottles come in cases is decided by its total, or refused", () => {
    const row = { uom: "bottle", pack_size: 12, qty_bottles: 24 };
    expect(refusal(row)).toMatch(/bottles that come 12 to a case and prints 264 .* a bottle's price or a case's is not known/);
    expect(refusal({ ...row, uom: "each" })).toMatch(/eachs that come 12/);
    // A total that contradicts the bottle reading is refused by the QA 9a check.
    expect(refusal({ ...row, line_total: 528 })).toMatch(/totals 528/);
    expect(refusal({ ...row, line_total: 528, qty_bottles: null })).toMatch(/not known/);
    // The total bears the bottle reading out (a credit note's signs too), or the paper printed its base.
    expect(cost({ ...row, line_total: 6336 })).toBe(264);
    expect(cost({ ...row, line_total: -6336, qty_bottles: -24 })).toBe(264);
    expect(cost({ ...row, price_base_uom: "bottle" })).toBe(264);
    expect(cost({ ...row, pack_size: 1 })).toBe(264);
  });

  it("QA 10a (3)+(4): a piece or bottle glyph on an each line costs; a credit note's total is checked by magnitude", () => {
    for (const uom of ["pcs", "btl.", "Stk", "şişe"])
      expect(cost({ uom: "each", pack_size: 1, unit_price: 22, qty_bottles: 24, line_total: 528, printed: { uom } })).toBe(22);
    expect(refusal({ uom: "each", pack_size: 1, printed: { uom: "kutu" } })).toMatch(/"kutu"/);
    // Credit note filed as an invoice: count and total negative, price positive.
    expect(refusal({ uom: "bottle", pack_size: 1, qty_bottles: -24, line_total: -528 })).toMatch(/totals -528 for -24 counted, but 264\.00 each makes -6336\.00,/);
    expect(refusal({ uom: "bottle", pack_size: 1, qty_bottles: 24, line_total: -528 })).toMatch(/totals -528/);
    expect(cost({ qty_bottles: -24, line_total: -528 })).toBe(22);
    expect(refusal({ uom: "bottle", pack_size: 1, qty_bottles: 24, line_total: 0 })).toMatch(/totals 0 for 24/);
  });

  it("QA 12b C: a proposal is read in the base its line's own facts settle, total included", () => {
    const row = line({ uom: "bottle", pack_size: 12, qty_bottles: 24, line_total: 6336 });
    const r = proposalPerBottle(250, row);
    expect(r.ok && [r.unitCost, r.basis]).toEqual([250, "invoice price 250 per bottle; booked as-is"]);
    expect(proposalPerBottle(240, line()).ok && (proposalPerBottle(240, line()) as { unitCost: number }).unitCost).toBe(20);
    expect(proposalPerBottle(250, { ...row, line_total: null })).toMatchObject({ kind: "refused", reason: expect.stringMatching(/prints 264 for one/) });
    expect(proposalPerBottle(240, line({ unit_price: null })).ok).toBe(true);
    expect(proposalPerBottle(0, line())).toEqual({ ok: false, kind: "no_price" });
  });

  it("rounds half away from zero to six places, as numeric(14,6) does", () => {
    expect([1.0000005, 142 / 12, 11.8333335, 22, 0.035].map(toLotCostPrecision)).toEqual([1.000001, 11.833333, 11.833334, 22, 0.035]);
  });

  // cost-math R7 (2026-11-11). Red before: four places then two, so 100 per
  // case of 12 posted 8.33 and its twelve bottles came to 99.96.
  it("R7: a case price becomes a per-bottle cost to six places that adds back to the case", () => {
    const r = perBottleLotCost(line({ unit_price: 100, qty_bottles: 24, line_total: 200 }));
    expect(r.ok && r.unitCost).toBe(8.333333);
    expect(r.ok && Math.round(r.unitCost * 12 * 100)).toBe(10000);
    expect(r.ok && r.basis).toBe("invoice price 100 per case of 12 = 8.333333 per bottle");
    const p = proposalPerBottle(100, line());
    expect(p.ok && p.unitCost).toBe(8.333333);
    // 142 / KS(12): the posted cost is 11.833333, not the four-place 11.8333.
    const k = perBottleLotCost(line({ uom: "bottle", unit_price: 142, price_base_qty: 12, pack_size: 1 }));
    expect(k.ok && k.unitCost).toBe(11.833333);
  });

  it("R7: the rows #1079 and a UBL-TR reader write for a ₺1,800 case of 6", () => {
    // #1079 sets the pack on the review card: 2 cases, 6 a case, 12 bottles.
    const set = { unit_price: 1800, uom: "case", pack_size: 6, qty_bottles: 12, line_total: 3600 };
    const r = perBottleLotCost(set);
    expect(r.ok && [r.unitCost, r.basis]).toEqual([300, "invoice price 1800 per case of 6 = 300.00 per bottle"]);
    // The e-Fatura reader never states a pack (pack_size 1): refused by name, never 1,800 a bottle.
    expect(perBottleLotCost({ ...set, pack_size: 1, qty_bottles: 2 })).toMatchObject({
      ok: false,
      kind: "refused",
      reason: expect.stringMatching(/does not state how many bottles a case holds/),
    });
    // An e-Fatura code kept in printed.uom (#1080) is never a bottle. Since
    // r36 R4 a stored `each` row whose glyph is a weight is read as that
    // weight, so with no item unit it is refused as a weighed line.
    expect(perBottleLotCost({ unit_price: 120, uom: "each", pack_size: 1, qty_bottles: 3, line_total: 360, printed: { uom: "KGM", qty: "3 KGM" } })).toMatchObject({
      ok: false,
      reason: expect.stringMatching(/weighed in kg, and the item it books into states no unit/),
    });
    // An unmapped glyph is still refused by name.
    expect(perBottleLotCost({ unit_price: 120, uom: "each", pack_size: 1, qty_bottles: 3, line_total: 360, printed: { uom: "kutu" } })).toMatchObject({
      ok: false,
      reason: expect.stringMatching(/prints its unit as "kutu"/),
    });
  });
});
