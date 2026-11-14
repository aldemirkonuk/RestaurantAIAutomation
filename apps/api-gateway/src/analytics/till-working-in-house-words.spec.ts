import { TillCostRead, TillSalesRead, tillFigures, withheldTillFigures } from "./cost-of-goods";
import { EXPORT_CUTTINGS } from "../reports/exports/report-export-cuttings";
import { PAYLOADS } from "../reports/exports/__fixtures__/cutting-payloads";

/**
 * r11 (2026-11-12): the till's working is read by the house. /reports prints
 * it under "Show the working" and the report export prints it verbatim, so
 * it names each figure by its label on the page, never by its field name.
 *
 * A lira house read "grossMarginDollars, grossMargin, cogsRatio …",
 * "(tillStock)", "(costOfCostedItems)", "null", "$0", "ADR 0051" and
 * "Non-voided pos_checks.total" in its working and its downloads.
 */

/** Every code-shaped token in a sentence the house reads. Empty = clean. */
function codeIn(sentence: string): string[] {
  const found: string[] = [];
  const rules: Array<[string, RegExp]> = [
    ["camelCase", /\b[a-z]+[A-Z][A-Za-z]*\b/g],
    ["snake_case", /\b[a-z]+_[a-z_]+\b/g],
    ["null", /\bnull\b/g],
    ["dollar", /\$/g],
    ["Nd", /\b\d+d\b/g],
    ["ADR", /\bADR\b/g],
  ];
  for (const [name, re] of rules)
    for (const m of sentence.match(re) ?? []) found.push(`${name}: ${m}`);
  return found;
}

const NOW = new Date("2026-11-11T12:00:00Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86400000).toISOString();
const item = (id: string, over: Record<string, unknown> = {}) => ({
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
  settled_on_earlier_sales: "4.000000",
  rows: 30,
  rows_unstamped: 0,
  first_move_at: daysAgo(99),
};
const STOCK = {
  value: 1000,
  goodsOnHand: 4,
  goodsOnTill: 2,
  uncostedOnTill: 1,
  idleOnTill: 1,
  idleOnTillValue: 400,
  goodsOffTill: 2,
  offTillValue: 840,
};
const run = (over: Partial<Parameters<typeof tillFigures>[0]> = {}) =>
  tillFigures({ sales: SALES, cost: COST, tillStock: STOCK, labor: 0, now: NOW, windowDays: 365, ...over });

// Every branch of the three sentences.
const CASES: Record<string, ReturnType<typeof run>> = {
  "all costed, late prices both ways, stock in and out": run(),
  "a sold item of unknown cost, with the costed part apart": run({
    cost: {
      ...COST,
      items: [item("a", { cost: "120.000000" }), item("b", { bottles_back: 1, uncosted_back: 1, uncosted_out: 2 })],
      rows_unstamped: 1,
    },
  }),
  "the till moved no stocked item": run({ cost: { ...COST, items: [] } }),
  "the cost read failed": run({ cost: null }),
  "the cost total is not a number": run({ cost: { ...COST, cost: "x" } }),
  "the sales read failed and the stock base is unknown": run({ sales: null, tillStock: null }),
  "no closed check": run({ sales: { ...SALES, checks: 0 } }),
  "an unreadable till line": run({ sales: { ...SALES, unreadable_lines: 2 } }),
  "a line whose sales are not a number": run({
    sales: { ...SALES, items: [{ inventory_id: "a", sales: "x" as unknown as number, in_house: true }] },
  }),
  "a caller who does not see sales": withheldTillFigures(365),
};

describe("the till's working names no field, table, null, $ or Nd (r11)", () => {
  for (const [name, t] of Object.entries(CASES))
    it(`${name}: cogs, revenue and costDerived read in the house's words`, () => {
      for (const key of ["cogs", "revenue", "costDerived"] as const)
        expect([key, codeIn(t.basis[key])]).toEqual([key, []]);
    });

  it("names each figure by its label on the page", () => {
    const d = run().basis.costDerived;
    expect(d).toContain("Kept, kept of sales, cost of sales and prime cost divide");
    expect(d).toContain("Inventory turns, days of inventory and the return on stock");
    // The page labels it "Return on stock" (r28 gap 14); the working never says GMROI.
    expect(d).not.toMatch(/GMROI/);
    expect(d).toContain("the 2 goods the till does not reach, 840.00 at cost, are left out, since");
    expect(d).toContain("are each shown apart and feed no ratio");
    expect(run().basis.cogs).toContain("Cost of what the till sold (365 days)");
    expect(run().basis.revenue).toContain("Net till sales of stocked items (365 days)");
  });
});

describe("the export prints the till's working in the house's words (r11)", () => {
  it("through the till, with and without the house's zone", () => {
    for (const p of [PAYLOADS.till, { ...PAYLOADS.till, timezone: null }]) {
      const doc = EXPORT_CUTTINGS.till.write(p, { days: 30 });
      for (const line of doc.basis) expect([line, codeIn(line)]).toEqual([line, []]);
      expect(doc.basis[0]).toMatch(/^The total of every till check, voided ones left out, between /);
    }
  });

  it("the room and who served it say till checks, not pos_checks", () => {
    for (const id of ["seats", "service"] as const) {
      const doc = EXPORT_CUTTINGS[id].write(PAYLOADS[id], {});
      expect(doc.basis.join(" ")).not.toMatch(/pos_checks|Non-voided/);
    }
  });
});
