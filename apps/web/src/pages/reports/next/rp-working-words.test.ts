import { describe, expect, it } from 'vitest';
import { workingInHouseWords, workingLines } from './rp-working-words';

/**
 * The working lines as the gateway writes them today (analytics.service.ts,
 * advanced-analytics.service.ts, goals.service.ts, inventory-cost.ts,
 * consumption-units.ts, table-analytics.service.ts) and as two registers write
 * them on the page (rp-registers-house.tsx). Copied, with their numbers filled.
 */
const SERVER_LINES = [
  // financial
  'delivered procurement_orders (trailing 365d) — 14 orders summed',
  'delivered procurement_orders (trailing 365d) — null: no delivered order was returned for this window, which is either no purchasing or a read that failed, and $0 would claim the first',
  'unit_price × on-hand qty (POS-revenue proxy) — 72 inventory rows valued',
  'on-hand qty × unit cost — per row — invoiced lot WAC (inventory_lot_rollup.wac) (60); restaurant_inventory.last_purchase_price (10); no recorded cost (2); 2 of 72 row(s) have no recorded cost, so any figure needing a complete valuation is null',
  'on-hand qty × unit cost — per row — invoiced lot WAC covering only part of the on-hand quantity (inventory_lot_rollup.wac) (3); every row in scope has a recorded cost',
  'on-hand qty > 0 with zero wine_consumption_log movement in 90d; null when the restaurant records no movement at all, or when any idle row has no recorded cost',
  'inventoryValue, grossMarginDollars, grossMargin, cogsRatio, primeCostRatio, inventoryTurnover, daysInventoryOutstanding, gmroi and deadStockCapital are null unless every on-hand row carries a recorded cost (ADR 0051); inventoryTurnover and daysInventoryOutstanding are null again when cogs is null, and the three ratios again when revenue is null, because a ratio over an absent denominator is not a ratio',
  // menu engineering
  "bottles/day over 90d — bottles by each line's own mode: a bottle line is its quantity, a glass line is its millilitres over the item's stated bottle size; every glass line's item states its bottle size; 2 lines across 1 item carry no bottle figure (no bottle or glass mode, a bottle line with no quantity of 0 or more, or a glass line with no millilitres above 0), so every figure resting on them is null rather than guessed",
  'menu_price_current − unit cost — per row — invoiced lot WAC (inventory_lot_rollup.wac) (40); every row in scope has a recorded cost',
  'items[].marginPerBottle, items[].marginPct, items[].quadrant, items[].action and medians.marginPerBottle are null for rows with no recorded cost; those rows are counted under counts.unclassified (ADR 0051)',
  'items[].velocityPerDay, items[].quadrant and items[].action are null for a costed wine with any line that carries no bottle figure; those rows are counted under counts.unmeasured, and medians.velocityPerDay is over the known velocities only (ADR 0297)',
  // weekday / extremes
  'mean bottles per weekday over the last 90 days of wine_consumption_log; a weekday with no observation is absent from weekdayProfile rather than reported as 0',
  'bestDay/worstDay are null: more than one weekday shares the extreme, and naming one of them would be an arbitrary tie-break, not a finding',
  'bestDay/worstDay are the single weekdays holding the highest and lowest mean',
  // cash flow
  'Outflow: delivered procurement_orders (revenue inflow needs POS feed).',
  // inventory
  'bottles/day over 90d — no consumption lines in this window; 3 row(s) are unassessed (skus[].demandUnknown): their demand, cover, reorder point and stockout risk are null and they are never put on the reorder list',
  'King safety stock at serviceLevel 0.95, lead time 7d — demand-derived, unaffected by cost',
  'skus[].inventoryValue, skus[].unitCost and skus[].eoq are null for any row with no recorded cost; skus[].abcClass is null for EVERY row unless the whole cellar is priced, because ABC cuts on share of a total (ADR 0051)',
  'demandRisk is over bottles/day across 90d — every line has a bottle figure',
  // a single wine
  'invoiced lot WAC (inventory_lot_rollup.wac) — unitCost and marginPerBottle are null (ADR 0051)',
  'restaurant_inventory.menu_price_current',
  // forecast
  'bottles/day over 120d, zero-filled to a dense daily series — every line has a bottle figure',
  'holt_winters fitted on 120 days of history',
  'holt_linear fitted on 40 days of history',
  'ses fitted on 20 days of history',
  'no model fitted — Holt-Winters, Holt and SES each refused this history, so no line is projected and no total is claimed',
  'sum of the 14-day forecast, each day floored at 0',
  'null — there is no projection to total',
  'rolling_one_step_ahead',
  'no_observations_in_scored_window',
  // goals
  "Bottles sold counts bottles by each line's own mode: a bottle line is its quantity, a glass line is its millilitres over the item's stated bottle size, or over the 750 ml stand-in the stock moves by when no size is stated; each Bottles sold goal's `units` counts the lines and items in its window resting on that stand-in; a goal whose window holds a line with no bottle figure is not scored (ADR 0297)",
  // tables and servers (written on the page) and the till feed
  'Non-voided pos_checks the till attributed to a shown table over the last 90 days.',
  'Non-voided pos_checks grouped by server name over the last 30 days.',
  'Feed: awaiting POS check feed — no POS check is recorded for this restaurant (voided checks are not counted).',
];

/** What an owner must never read under a chart. */
const ENGINEERING = [
  /\b[a-z]+(?:_[a-z0-9]+)+\b/, // a table, column or code
  /\[\]/, // a payload field path
  /\bnull\b/,
  /\(ADR \d+/,
  /\$/,
  /\bWAC\b/,
  /\bqty\b/,
  /\b\d+d\b/,
  /\b(?:marginPerBottle|velocityPerDay|demandUnknown|weekdayProfile|bestDay|worstDay|demandRisk|unitCost|inventoryValue)\b/,
];

describe('"Show the working" says it in the house\'s words', () => {
  it('no working line prints a table name, a field, a null, an ADR, a dollar sign or a code', () => {
    for (const raw of SERVER_LINES) {
      const said = workingInHouseWords(raw);
      for (const re of ENGINEERING) {
        expect({ raw, said, match: said.match(re)?.[0] ?? null }).toEqual({ raw, said, match: null });
      }
    }
  });

  it('keeps the lineage: each line still says where its figure came from', () => {
    expect(workingInHouseWords(SERVER_LINES[0])).toBe('Delivered orders (trailing 365 days) — 14 orders summed');
    expect(workingInHouseWords(SERVER_LINES[5])).toBe(
      'Bottles on hand > 0 with nothing poured or sold in 90 days; left blank when the restaurant records no movement at all, or when any idle row has no recorded cost',
    );
    expect(workingInHouseWords(SERVER_LINES[3])).toContain('the average invoiced cost (60); the last price paid (10)');
    expect(workingInHouseWords(SERVER_LINES[8])).toMatch(/^The menu price − unit cost/);
    expect(workingInHouseWords(SERVER_LINES[11])).toContain('over the last 90 days of the record of bottles poured and sold');
    expect(workingInHouseWords('restaurant_inventory.menu_price_current')).toBe('The menu price');
    expect(workingInHouseWords(SERVER_LINES[SERVER_LINES.length - 3])).toBe(
      'Till checks (voided ones left out) the till attributed to a shown table over the last 90 days.',
    );
  });

  it('a blank keeps its reason, and a zero is not given a currency', () => {
    expect(workingInHouseWords(SERVER_LINES[1])).toBe(
      'Delivered orders (trailing 365 days) — left blank: no delivered order was returned for this window, which is either no purchasing or a read that failed, and a zero would claim the first',
    );
  });

  it('engine codes become what they mean', () => {
    expect(workingInHouseWords('rolling_one_step_ahead')).toMatch(/forecasting each day from the days before it/);
    expect(workingInHouseWords('holt_winters fitted on 120 days of history')).toBe(
      'A forecast that follows the trend and the weekly pattern fitted on 120 days of history',
    );
    expect(workingInHouseWords('King safety stock at serviceLevel 0.95, lead time 7d — demand-derived, unaffected by cost')).toBe(
      'Safety stock sized to cover demand 95% of the time, lead time 7 days — demand-derived, unaffected by cost',
    );
  });

  it('a table-style name nobody listed loses its underscores rather than printing as a code', () => {
    expect(workingInHouseWords('read from supplier_price_list rows')).toBe('Read from supplier price list rows');
  });

  it('a sentence already in plain words is left as it is', () => {
    const plain = 'sum of the 14-day forecast, each day floored at 0';
    expect(workingInHouseWords(plain)).toBe('Sum of the 14-day forecast, each day floored at 0');
    expect(workingInHouseWords('Window 2026-01-01 to 2026-03-31.')).toBe('Window 2026-01-01 to 2026-03-31.');
  });

  it('drops empty lines, as Working always did', () => {
    expect(workingLines([null, undefined, '  ', 'rolling_one_step_ahead'])).toHaveLength(1);
  });
});
