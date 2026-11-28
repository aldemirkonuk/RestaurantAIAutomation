import {
  MIN_SPAN_DAYS,
  TillCostRead,
  TillSalesRead,
  cogsCoverageOf,
  tillFigures,
  withheldTillFigures,
} from "./cost-of-goods";

/**
 * Cost-math lane 3.1: the cost of goods is the cost the till's bottles carried
 * when they left their lots, divided by the till's net sales of the same items.
 * The invariant pinned here: an unknown cost is never 0, and a figure built on
 * one is withheld with "N of M", never printed smaller.
 */

const NOW = new Date("2026-11-11T12:00:00Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86400000).toISOString();

const item = (id: string, over: Partial<Record<string, unknown>> = {}) => ({
  inventory_id: id,
  bottles_out: 10,
  bottles_back: 0,
  cost: 100,
  settled_after_sale: 0,
  uncosted_out: 0,
  uncosted_back: 0,
  in_house: true,
  ...over,
});

const SALES: TillSalesRead = {
  items: [
    { inventory_id: "a", sales: 300, in_house: true },
    { inventory_id: "b", sales: 200, in_house: true },
  ],
  checks: 40,
  lines: 60,
  unmapped_lines: 5,
  unreadable_lines: 0,
};

const COST: TillCostRead = {
  items: [item("a", { cost: "120.000000" }), item("b", { cost: "80.500000", settled_after_sale: "0.500000" })],
  cost: "200.500000",
  settled_after_sale: "0.500000",
  rows: 30,
  rows_unstamped: 0,
  first_move_at: daysAgo(99),
};

const run = (over: Partial<Parameters<typeof tillFigures>[0]> = {}) =>
  tillFigures({
    sales: SALES,
    cost: COST,
    inventoryValue: 1000,
    labor: 0,
    now: NOW,
    windowDays: 365,
    ...over,
  });

describe("cost of goods is what the till sold", () => {
  it("prints the stamped cost of what sold and divides it by net sales of the same items", () => {
    const t = run();
    expect(t.cogs).toBe(200.5);
    expect(t.revenue).toBe(500);
    expect(t.grossMarginDollars).toBe(299.5);
    expect(t.cogsRatio).toBeCloseTo(0.401, 6);
    expect(t.grossMargin).toBeCloseTo(0.599, 6);
    expect(t.settledAfterSale).toBe(0.5);
    expect(t.basis.cogs).toContain("0.50 is late prices on these sales");
    expect(t.basis.revenue).toContain("5 lines naming no stocked item");
  });

  it("withholds, saying N of M, when one sold item has a bottle of unknown cost", () => {
    const t = run({
      cost: { ...COST, items: [item("a"), item("b", { uncosted_out: 2 })], rows_unstamped: 1 },
    });
    expect(t.cogs).toBeNull();
    expect(t.cogs).not.toBe(0);
    expect(t.grossMargin).toBeNull();
    expect(t.cogsRatio).toBeNull();
    expect(t.inventoryTurnover).toBeNull();
    expect(t.basis.cogs).toContain("cost known for 1 of 2 items sold");
    expect(t.basis.cogs).toContain("2 bottles");
    expect(t.basis.cogs).toContain("1 till movement carried no cost");
    expect(t.cogsCoverage).toMatchObject({ itemsMoved: 2, itemsCosted: 1, bottlesUncosted: 2 });
  });

  it("names a late price settled in the window on an earlier sale apart, out of cost and out of every ratio", () => {
    // The SQL lists such an item with 0 bottles and cost 0 (batch review
    // 2026-11-11, finding 1): its sale is not in this window's revenue.
    const t = run({
      cost: {
        ...COST,
        items: [
          ...COST.items!,
          item("c", { bottles_out: 0, cost: "0", settled_after_sale: "0", settled_on_earlier_sales: "4.000000" }),
        ],
        settled_on_earlier_sales: "4.000000",
      },
    });
    expect(t.cogs).toBe(200.5);
    expect(t.cogsRatio).toBeCloseTo(0.401, 6);
    expect(t.grossMarginDollars).toBe(299.5);
    expect(t.settledOnEarlierSales).toBe(4);
    expect(t.cogsCoverage).toMatchObject({ itemsMoved: 2, itemsCosted: 2 });
    expect(t.basis.cogs).toContain("2 items");
    expect(t.basis.cogs).toContain("4.00, are named apart");
    expect(t.basis.costDerived).toContain("settledOnEarlierSales");
  });

  it("keeps the earlier-sale settlement null when the read does not name it, never 0", () => {
    expect(run().settledOnEarlierSales).toBeNull();
    expect(run({ cost: { ...COST, settled_on_earlier_sales: "0.000000" } }).settledOnEarlierSales).toBe(0);
  });

  it("gives the exact cost of the costed items apart while cogs is withheld, and divides it by nothing", () => {
    // A bar house with one void naming no sale (batch review 2026-11-11,
    // finding 2): the total stays withheld, the known part is shown by name.
    const t = run({
      cost: {
        ...COST,
        items: [item("a", { cost: "120.000000" }), item("b", { bottles_back: 1, uncosted_back: 1, cost: "80.500000" })],
      },
    });
    expect(t.cogs).toBeNull();
    expect(t.costOfCostedItems).toEqual({ amount: 120, items: 1, of: 2 });
    expect(t.cogsRatio).toBeNull();
    expect(t.grossMargin).toBeNull();
    expect(t.grossMarginDollars).toBeNull();
    expect(t.daysInventoryOutstanding).toBeNull();
    expect(t.basis.cogs).toContain("1 bottle a void gave back named no sale");
    expect(t.basis.cogs).toContain("cost 120.00 (costOfCostedItems)");
    // None costed: nothing to give apart.
    const none = run({ cost: { ...COST, items: [item("a", { uncosted_out: 1 })] } });
    expect(none.costOfCostedItems).toBeNull();
    // Printed: the part is the whole, so it is not repeated.
    expect(run().costOfCostedItems).toBeNull();
  });

  it("withholds when a void gave a bottle back at an unknown cost", () => {
    const t = run({ cost: { ...COST, items: [item("a", { bottles_back: 1, uncosted_back: 1 })] } });
    expect(t.cogs).toBeNull();
    expect(t.cogsCoverage?.bottlesBack).toBe(1);
  });

  it("reads a field that is not a number as unknown, never as 0", () => {
    const t = run({ cost: { ...COST, items: [item("a", { uncosted_out: "x" })] } });
    expect(t.cogs).toBeNull();
    expect(cogsCoverageOf({ items: [item("a", { uncosted_out: "x" })] }).bottlesUncosted).toBe(10);
  });

  it("says the till moved nothing rather than printing $0", () => {
    const t = run({ cost: { items: [], cost: null, rows: 0, rows_unstamped: 0, first_move_at: null } });
    expect(t.cogs).toBeNull();
    expect(t.basis.cogs).toContain("moved no stocked item");
  });

  it("nulls each figure whose read failed, and says which", () => {
    const noCost = run({ cost: null });
    expect(noCost.cogs).toBeNull();
    expect(noCost.revenue).toBe(500);
    expect(noCost.basis.cogs).toContain("could not be read");
    const noSales = run({ sales: null });
    expect(noSales.revenue).toBeNull();
    expect(noSales.cogs).toBe(200.5);
    expect(noSales.grossMargin).toBeNull();
    expect(noSales.grossMarginDollars).toBeNull();
  });

  it("refuses net sales with an unreadable till line or no closed check", () => {
    expect(run({ sales: { ...SALES, unreadable_lines: 1 } }).revenue).toBeNull();
    expect(run({ sales: { ...SALES, checks: 0 } }).revenue).toBeNull();
  });

  it("leaves another house's item out of both totals", () => {
    const t = run({
      sales: { ...SALES, items: [...SALES.items!, { inventory_id: "z", sales: 999, in_house: false }] },
      cost: { ...COST, items: [...COST.items!, item("z", { in_house: false, uncosted_out: 5 })] },
    });
    expect(t.revenue).toBe(500);
    expect(t.cogs).toBe(200.5);
    expect(t.salesCoverage?.itemsNotInHouse).toBe(1);
    expect(t.cogsCoverage?.itemsNotInHouse).toBe(1);
  });

  it("annualises turnover, days of stock and GMROI over the span the till covers", () => {
    const t = run();
    expect(t.cogsWindow.spanDays).toBe(100);
    expect(t.inventoryTurnover).toBeCloseTo((200.5 * 365) / 100 / 1000, 9);
    expect(t.daysInventoryOutstanding).toBeCloseTo((1000 * 100) / 200.5, 9);
    expect(t.gmroi).toBeCloseTo((299.5 * 365) / 100 / 1000, 9);
  });

  it(`withholds the annual rates under ${MIN_SPAN_DAYS} days of till history, and when stock is not costed`, () => {
    const young = run({ cost: { ...COST, first_move_at: daysAgo(10) } });
    expect(young.cogs).toBe(200.5);
    expect(young.inventoryTurnover).toBeNull();
    expect(young.daysInventoryOutstanding).toBeNull();
    expect(young.gmroi).toBeNull();
    const unpriced = run({ inventoryValue: null });
    expect(unpriced.daysInventoryOutstanding).toBeNull();
  });

  it("adds the labour the caller passes to prime cost only", () => {
    expect(run({ labor: 100 }).primeCostRatio).toBeCloseTo(300.5 / 500, 9);
  });

  it("withholds every till figure for a caller who does not see sales", () => {
    const w = withheldTillFigures(365);
    for (const k of ["cogs", "revenue", "grossMargin", "cogsRatio", "daysInventoryOutstanding", "gmroi", "settledOnEarlierSales", "costOfCostedItems"] as const)
      expect(w[k]).toBeNull();
    expect(w.basis.cogs).toContain("owners and managers only");
  });
});
