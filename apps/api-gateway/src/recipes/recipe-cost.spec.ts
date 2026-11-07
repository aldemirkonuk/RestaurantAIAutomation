import { CostLineInput, recipeCost } from "./recipe-cost";

// A Negroni: 30 ml each of gin (700 ml, WAC 700), Campari (1 L, 500) and
// sweet vermouth (750 ml, 300). Per ml: 1.00, 0.50, 0.40 -> 30 + 15 + 12 = 57.
const lot = (wac: number) => ({ has_invoice_cost: true, wac, wac_qty: 2, live_qty: 2 });
const line = (size: number | null, wac: number | null, over: Partial<CostLineInput> = {}): CostLineInput => ({
  role: "stocked",
  inventoryId: "i",
  qtyBase: 300,
  baseUnit: "ml10",
  item: { uom: "bottle", bottle_size_ml: size },
  lot: wac == null ? null : lot(wac),
  ...over,
});
const negroni = (vermouth: CostLineInput = line(750, 300)) => [line(700, 700), line(1000, 500), vermouth];

describe("recipeCost (ADR 0360, F7)", () => {
  it("prices a Negroni at 57.00 a serve, 3 of 3", () => {
    const c = recipeCost(negroni(), 1);
    expect(c.perServe).toBe(57);
    expect([c.priced, c.of, c.complete]).toEqual([3, 3, true]);
    expect(c.lines.map((l) => l.costPerServe)).toEqual([30, 15, 12]);
    expect(c.lines[0].costBasis).toBe("invoice_lot_wac");
  });

  it("gives no total when the vermouth has no recorded cost: 2 of 3", () => {
    const c = recipeCost(negroni(line(750, null)), 1);
    expect(c.perServe).toBeNull();
    expect([c.priced, c.of, c.complete]).toEqual([2, 3, false]);
    expect(c.lines[2]).toEqual({ status: "linked", costPerServe: null, costBasis: "unknown" });
  });

  it("treats an unlinked vermouth the same way and says not_linked", () => {
    const c = recipeCost(negroni(line(750, 300, { inventoryId: null, item: null, lot: null })), 1);
    expect(c.perServe).toBeNull();
    expect([c.priced, c.of]).toEqual([2, 3]);
    expect(c.lines[2].status).toBe("not_linked");
  });

  it("halves the cost when the recipe yields two serves", () => {
    expect(recipeCost(negroni(), 2).perServe).toBe(28.5);
  });

  it("never guesses a size: an ml line on an 'each' item is size_not_known", () => {
    const c = recipeCost([line(null, 10, { item: { uom: "each" } })], 1);
    expect(c.lines[0]).toEqual({ status: "linked", costPerServe: null, costBasis: "size_not_known" });
    expect(c.perServe).toBeNull();
  });

  it("does not price a case per bottle: its bottle count is not recorded", () => {
    const c = recipeCost([line(700, 8400, { item: { uom: "case", bottle_size_ml: 700 } })], 1);
    expect(c.lines[0].costBasis).toBe("size_not_known");
  });

  it("leaves untracked lines out of priced/of and counts the same item twice", () => {
    const garnish: CostLineInput = { role: "untracked", inventoryId: null, qtyBase: 1000, baseUnit: "each_milli", item: null, lot: null };
    const c = recipeCost([line(700, 700), line(700, 700, { qtyBase: 100 }), garnish], 1);
    expect([c.priced, c.of, c.perServe]).toEqual([2, 2, 40]);
    expect(c.lines[2].status).toBe("untracked");
  });

  it("prices weight and count lines in their own base units", () => {
    const sugar = line(null, 40, { baseUnit: "mg", qtyBase: 5000, item: { uom: "kg" } });
    const egg = line(null, 6, { baseUnit: "each_milli", qtyBase: 1000, item: { uom: "each" } });
    const c = recipeCost([sugar, egg], 1);
    expect(c.lines.map((l) => l.costPerServe)).toEqual([0.2, 6]);
    expect(c.perServe).toBe(6.2);
  });

  it("has no total for a recipe of untracked lines only (unknown is not 0)", () => {
    const c = recipeCost([{ role: "untracked", inventoryId: null, qtyBase: 10, baseUnit: "ml10", item: null, lot: null }], 1);
    expect([c.perServe, c.of, c.complete]).toEqual([null, 0, false]);
  });

  describe("a cost agreed at delivery is a known cost (QA round 15)", () => {
    const agreed = (wac: number) => ({ has_invoice_cost: false, wac: null, has_agreed_cost: true, agreed_wac: wac });

    it("reads a final 'manual' lot at 20 as agreed_lot_wac, not unknown", () => {
      const c = recipeCost([line(1000, null, { lot: agreed(20), qtyBase: 10000 })], 1);
      expect(c.lines[0]).toEqual({ status: "linked", costPerServe: 20, costBasis: "agreed_lot_wac" });
      expect([c.perServe, c.complete]).toEqual([20, true]);
    });

    it("keeps a six-place agreed cost until the per-serve math (10.0049, not 10.00)", () => {
      // 10 bottles of 1000 ml: 10 x 10.0049 = 100.049 -> 100.05; a cent-rounded 10.00 would give 100.00.
      const c = recipeCost([line(1000, null, { lot: agreed(10.0049), qtyBase: 100000 })], 1);
      expect(c.lines[0].costPerServe).toBe(100.05);
    });

    it("leaves an item with no invoice and no agreed cost unknown", () => {
      const none = { has_invoice_cost: false, wac: null, has_agreed_cost: false, agreed_wac: null };
      const c = recipeCost([line(1000, null, { lot: none })], 1);
      expect(c.lines[0]).toEqual({ status: "linked", costPerServe: null, costBasis: "unknown" });
      expect(c.perServe).toBeNull();
    });
  });
});
