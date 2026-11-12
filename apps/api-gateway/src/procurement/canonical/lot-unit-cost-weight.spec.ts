import { perBottleLotCost, proposalPerBottle } from "./lot-unit-cost";

/**
 * R8: a weighed line is costed per ONE of the unit its house item is kept in
 * (ADR 0070), since that is what the lot's integer `qty` counts.
 * Invariant: unitCost × (the line's weight in the item's unit) = the paper's total.
 */
const cheese = (over: Record<string, unknown> = {}) => ({
  unit_price: 450,
  uom: "kg",
  qty_bottles: 3,
  line_total: 1350,
  ...over,
});

describe("a weighed line's lot cost (R8)", () => {
  it("3 kg @ 450 into a cheese kept in g is 0.45 a gram, and 3000 g make the paper's 1350", () => {
    const c = perBottleLotCost(cheese(), { uom: "g" });
    expect(c).toMatchObject({ ok: true, unitCost: 0.45, per: "g", bottles: 1000, priced: "kg" });
    if (c.ok) {
      expect(c.unitCost * 3000).toBeCloseTo(1350, 6);
      expect(c.basis).toBe("invoice price 450 per kg = 0.45 per g");
    }
  });

  it("into an item kept in kg it is the printed price", () => {
    expect(perBottleLotCost(cheese(), { uom: "kg" })).toMatchObject({ ok: true, unitCost: 450, per: "kg" });
  });

  it("into an item kept in mg it is per milligram", () => {
    expect(perBottleLotCost(cheese(), { uom: "mg" })).toMatchObject({ ok: true, unitCost: 0.00045, per: "mg" });
  });

  it("a price per 100 g, counted in kg, into an item kept in g", () => {
    const c = perBottleLotCost(
      { unit_price: 45, uom: "kg", qty_bottles: 3, line_total: 1350, price_base_qty: 100, price_base_uom: "g" },
      { uom: "g" },
    );
    expect(c).toMatchObject({ ok: true, unitCost: 0.45, per: "g", priced: "100 g" });
  });

  it("with no item unit it is refused, never costed per kg onto an unknown lot", () => {
    const c = perBottleLotCost(cheese());
    expect(c).toMatchObject({ ok: false, kind: "refused" });
    if (!c.ok && c.kind === "refused") expect(c.reason).toContain("states no unit");
  });

  it("into an item kept in bottles it is refused", () => {
    const c = perBottleLotCost(cheese(), { uom: "bottle" });
    expect(c).toMatchObject({ ok: false, kind: "refused" });
    if (!c.ok && c.kind === "refused") expect(c.reason).toContain("kept in bottles");
  });

  it("a weighed count priced per bottle is refused", () => {
    const c = perBottleLotCost(cheese({ price_base_uom: "bottle" }), { uom: "g" });
    expect(c).toMatchObject({ ok: false, kind: "refused" });
  });

  it("a total that contradicts the weight is refused (the unit was misread)", () => {
    const c = perBottleLotCost(cheese({ line_total: 450 }), { uom: "g" });
    expect(c).toMatchObject({ ok: false, kind: "refused" });
    if (!c.ok && c.kind === "refused") expect(c.reason).toContain("totals 450 for 3 kg");
  });

  it("a credit note's negative count and total still cost by magnitude", () => {
    expect(perBottleLotCost(cheese({ qty_bottles: -1, line_total: -450 }), { uom: "g" })).toMatchObject({ ok: true, unitCost: 0.45 });
  });

  it("a price that rounds to nothing per mg is refused, never booked at zero", () => {
    const c = perBottleLotCost(cheese({ unit_price: 0.4, line_total: 1.2 }), { uom: "mg" });
    expect(c).toMatchObject({ ok: false, kind: "refused" });
  });

  it("a container line into a container item costs exactly as before", () => {
    const line = { unit_price: 264, uom: "case", pack_size: 12, qty_bottles: 24, line_total: 528 };
    expect(perBottleLotCost(line, { uom: "bottle" })).toEqual(perBottleLotCost(line));
    expect(perBottleLotCost(line, { uom: null })).toEqual(perBottleLotCost(line));
  });

  it("an item kept by weight priced per piece is refused (a `3 each` cheese is not 3 grams)", () => {
    const c = perBottleLotCost({ unit_price: 450, uom: "each", qty_bottles: 3, line_total: 1350 }, { uom: "g" });
    expect(c).toMatchObject({ ok: false, kind: "refused" });
    if (!c.ok && c.kind === "refused") expect(c.reason).toContain("kept in g");
  });

  it("an accepted proposal on a weighed line is read per the item's unit", () => {
    expect(proposalPerBottle(400, cheese(), { uom: "g" })).toMatchObject({ ok: true, unitCost: 0.4, per: "g" });
  });
});
