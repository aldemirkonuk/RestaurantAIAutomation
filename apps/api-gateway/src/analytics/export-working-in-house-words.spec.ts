import { AnalyticsService, forecastModelInWords } from "./analytics.service";
import { AdvancedAnalyticsService } from "./advanced-analytics.service";
import { COST_BASIS_LABEL, costBasisSentence } from "./inventory-cost";

/**
 * r12 (2026-11-12): the restock, menu engineering and forecast working is
 * read by the house. /reports prints it under "Show the working" and the
 * report export prints it verbatim, so no basis sentence names a field, a
 * table, a model code, an ADR or a "120d" window.
 *
 * The export read "menu_price_current − unit cost", "items[].marginPerBottle",
 * "skus[].inventoryValue", "serviceLevel 0.95, lead time 7d" and
 * "holt_winters fitted on 120 days".
 */

/** Every code-shaped token in a sentence the house reads. Empty = clean. */
function codeIn(sentence: string): string[] {
  const found: string[] = [];
  const rules: Array<[string, RegExp]> = [
    ["camelCase", /\b[a-z]+[A-Z][A-Za-z]*\b/g],
    ["snake_case", /\b[a-z]+_[a-z_]+\b/g],
    ["field path", /\w+\[\]\./g],
    ["dotted name", /\b[a-z_]+\.[a-z_]+\b/g],
    ["null", /\bnull\b/g],
    ["dollar", /\$/g],
    ["Nd", /\b\d+d\b/g],
    ["ADR", /\bADR\b/g],
  ];
  for (const [name, re] of rules)
    for (const m of sentence.match(re) ?? []) found.push(`${name}: ${m}`);
  return found;
}

/** Every basis value of a payload, flattened. */
const sentences = (basis: Record<string, unknown>): string[] =>
  Object.values(basis).filter((v): v is string => typeof v === "string");

type Rows = Record<string, any[]>;

function makeClient(rowsByTable: Rows) {
  const passthrough = [
    "select",
    "eq",
    "neq",
    "gt",
    "gte",
    "lt",
    "lte",
    "is",
    "or",
    "not",
    "order",
    "limit",
    "in",
  ];
  return {
    from: jest.fn((table: string) => {
      const builder: any = {};
      for (const m of passthrough) builder[m] = jest.fn(() => builder);
      builder.maybeSingle = jest.fn(() =>
        Promise.resolve({ data: null, error: null }),
      );
      builder.then = (resolve: any, reject: any) =>
        Promise.resolve({ data: rowsByTable[table] ?? [], error: null }).then(
          resolve,
          reject,
        );
      return builder;
    }),
  };
}

const RESTAURANT = "33333333-3333-3333-3333-333333333333";

const analytics = (rows: Rows) =>
  new AnalyticsService({ getClient: () => makeClient(rows) } as any);

const advanced = (rows: Rows) =>
  new AdvancedAnalyticsService(
    { getClient: () => makeClient(rows) } as any,
    { getDemandForecast: async () => ({}) } as any,
    {} as any,
    {} as any,
  );

/** A priced, on-hand inventory row. */
const STOCKED = {
  id: "inv-1",
  wine_name: "Invoiced Chablis",
  stock_live: 5,
  menu_price_current: 60,
  last_purchase_price: 20,
  threshold_min: 2,
  master_wine_id: "mw-1",
};

/** A priced row and an unpriced one, so both cost sentences are written. */
const PRICED = {
  id: "inv-1",
  wine_name: "Invoiced Chablis",
  stock_live: 5,
  menu_price_current: 60,
  last_purchase_price: 20,
  threshold_min: 2,
  master_wine_id: "mw-1",
};
const UNPRICED = { ...PRICED, id: "inv-2", wine_name: "Unpriced Rioja", last_purchase_price: null, master_wine_id: "mw-2" };

/** One consumption row per day for `n` days, ending today. */
const consumption = (n: number, qty: (i: number) => number) =>
  Array.from({ length: n }, (_, i) => ({
    inventory_id: "inv-1",
    consumption_type: "bottle",
    quantity: qty(i),
    volume_ml: null,
    created_at: new Date(Date.now() - (n - 1 - i) * 86400000).toISOString(),
    restaurant_inventory: { master_wine_id: "mw-1" },
  }));

describe("the export's restock, menu and forecast working is said in the house's words", () => {
  it("names each cost source without a table, column or field", () => {
    for (const label of Object.values(COST_BASIS_LABEL)) expect(codeIn(label)).toEqual([]);
    const partial = costBasisSentence({
      total: 3,
      unpriced: 1,
      complete: false,
      byBasis: { invoice_lot_wac: 0, invoice_lot_wac_partial: 0, last_purchase_price: 2, unknown: 1 },
    } as any);
    expect(partial).toBe(
      "item by item — the last price paid for 2 items; no recorded cost for 1 item; 1 of 3 items has no recorded cost, so a figure that needs every item priced is left blank",
    );
    expect(codeIn(partial)).toEqual([]);
  });

  it("says the forecast's model as the page does", () => {
    expect(forecastModelInWords("holt_winters")).toBe("Trend and weekly pattern");
    expect(forecastModelInWords("holt_linear")).toBe("Trend");
    expect(forecastModelInWords("ses")).toBe("Smoothed average");
    expect(codeIn(forecastModelInWords("some_new_model"))).toEqual([]);
  });

  it("restock: every sentence is clean", async () => {
    const out: any = await analytics({
      restaurant_inventory: [PRICED, UNPRICED],
      wine_consumption_log: consumption(90, (i) => 1 + (i % 3)),
    }).getInventoryScience(RESTAURANT);
    expect(out.basis.reorderScience).toContain("95 restocks in 100");
    expect(out.basis.reorderScience).toContain("7 days to arrive");
    for (const s of sentences(out.basis)) expect(codeIn(s)).toEqual([]);
  });

  it("menu engineering: every sentence is clean", async () => {
    const out: any = await advanced({
      restaurant_inventory: [PRICED, UNPRICED],
      wine_consumption_log: consumption(90, (i) => 1 + (i % 3)),
    }).getMenuEngineering(RESTAURANT);
    expect(out.basis.margin).toMatch(/^Menu price less what the bottle cost — item by item/);
    for (const s of sentences(out.basis)) expect(codeIn(s)).toEqual([]);
  });

  it("forecast: a fitted model is named in words, with its days", async () => {
    const out: any = await analytics({
      wine_consumption_log: consumption(120, (i) => 4 + (i % 7)),
    }).getDemandForecast(RESTAURANT);
    expect(out.model).toBe("holt_winters");
    expect(out.basis.model).toBe("Trend and weekly pattern, fitted on 120 days of history");
    for (const s of sentences(out.basis)) expect(codeIn(s)).toEqual([]);
  });

  it("forecast: nothing projected is said without null", async () => {
    const out: any = await analytics({ wine_consumption_log: [] }).getDemandForecast(RESTAURANT);
    for (const s of sentences(out.basis)) expect(codeIn(s)).toEqual([]);
  });

  it("weekday pattern and risk: every sentence is clean", async () => {
    const season: any = await advanced({
      wine_consumption_log: consumption(90, (i) => 1 + (i % 7)),
    }).getSeasonality(RESTAURANT);
    for (const s of sentences(season.basis)) expect(codeIn(s)).toEqual([]);
    const risk: any = await analytics({
      restaurant_inventory: [PRICED],
      wine_consumption_log: consumption(90, (i) => 1 + (i % 3)),
    }).getRiskProfile(RESTAURANT);
    for (const s of sentences(risk.basis)) expect(codeIn(s)).toEqual([]);
  });
});
