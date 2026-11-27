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
    expect(c.lines[2]).toEqual({ status: "linked", costPerServe: null, costPerServeExact: null, costBasis: "unknown" });
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

  it("never guesses a size: an ml line on an 'each' item is a unit mismatch", () => {
    const c = recipeCost([line(null, 10, { item: { uom: "each" } })], 1);
    expect(c.lines[0]).toEqual({ status: "linked", costPerServe: null, costPerServeExact: null, costBasis: "unit_mismatch" });
    expect(c.perServe).toBeNull();
  });

  it("says size_not_known only for a bottle whose size the shelf does not say", () => {
    expect(recipeCost([line(null, 700)], 1).lines[0].costBasis).toBe("size_not_known");
    expect(recipeCost([line(0, 700)], 1).lines[0].costBasis).toBe("size_not_known");
  });

  it("does not price a case per bottle: its bottle count is not recorded (pack_size_not_known)", () => {
    const c = recipeCost([line(700, 8400, { item: { uom: "case", bottle_size_ml: 700 } })], 1);
    expect(c.lines[0].costBasis).toBe("pack_size_not_known");
  });

  it.each([
    ["ml on a kg item", "ml10", "kg", "unit_mismatch"],
    ["g on a bottle item", "mg", "bottle", "unit_mismatch"],
    ["g on an ml item", "mg", "ml", "unit_mismatch"],
    ["a piece of a bottle item", "each_milli", "bottle", "unit_mismatch"],
    ["a piece of a case", "each_milli", "case", "unit_mismatch"],
    ["g of a pack", "mg", "pack", "pack_size_not_known"],
    ["ml of a glass", "ml10", "glass", "pack_size_not_known"],
  ] as const)("names the reason for %s", (_n, baseUnit, uom, why) => {
    const c = recipeCost([line(700, 100, { baseUnit, item: { uom, bottle_size_ml: 700 } })], 1);
    expect(c.lines[0]).toMatchObject({ status: "linked", costPerServe: null, costBasis: why });
  });

  it("rounds each line on its own: equal costs read the same, each within half a cent", () => {
    // Three lines of 1/3 each: the total is 1.00, each line reads 0.33. A
    // column that does not add up by a cent is rounding; one third reading
    // 0.34 beside two reading 0.33 would be a wrong price.
    const third = (n: number) => line(null, null, { qtyBase: 10, item: { uom: "ml" }, lot: { has_invoice_cost: true, wac: n } });
    const c = recipeCost([third(1 / 3), third(1 / 3), third(1 / 3)], 1);
    expect(c.perServe).toBe(1);
    expect(c.lines.map((l) => l.costPerServe)).toEqual([0.33, 0.33, 0.33]);
    for (const l of c.lines) expect(Math.abs((l.costPerServe as number) - (l.costPerServeExact as number))).toBeLessThanOrEqual(0.005);
  });

  it("keeps six places: a total of many small lines is not a sum of roundings", () => {
    // 7 lines at 0.004 each: each reads 0.00 (its exact cost says it is not
    // free), the total 0.03. No line is handed a cent it does not cost.
    const tiny = () => line(null, null, { qtyBase: 10, item: { uom: "ml" }, lot: { has_invoice_cost: true, wac: 0.004 } });
    const c = recipeCost(Array.from({ length: 7 }, tiny), 1);
    expect(c.perServeExact).toBe(0.028);
    expect(c.perServe).toBe(0.03);
    expect(c.lines.map((l) => l.costPerServeExact)).toEqual(Array(7).fill(0.004));
    expect(c.lines.map((l) => l.costPerServe)).toEqual(Array(7).fill(0));
  });

  it("reads the same cost the same way whichever amount and price it came from", () => {
    // 0.125 a serve from 10 ml at 0.0125/ml and from 1 ml at 0.125/ml: both
    // sit on a half cent, and both must land on the same side of it.
    const a = line(null, null, { qtyBase: 100, item: { uom: "ml" }, lot: { has_invoice_cost: true, wac: 0.0125 } });
    const b = line(null, null, { qtyBase: 10, item: { uom: "ml" }, lot: { has_invoice_cost: true, wac: 0.125 } });
    const c = recipeCost([a, b], 1);
    expect(c.lines[0].costPerServeExact).toBe(c.lines[1].costPerServeExact);
    expect(c.lines[0].costPerServe).toBe(c.lines[1].costPerServe);
  });

  it("counts lines priced from part of the stock, and still prices them", () => {
    const part = line(700, 700, { lot: { has_invoice_cost: true, wac: 700, wac_qty: 1, live_qty: 3 } });
    const c = recipeCost([part, line(1000, 500)], 1);
    expect(c.complete).toBe(true);
    expect(c.partial).toBe(1);
    expect(c.lines[0].costBasis).toBe("invoice_lot_wac_partial");
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
});
