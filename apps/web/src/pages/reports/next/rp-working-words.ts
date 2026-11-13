/**
 * "Show the working", in the house's words.
 *
 * WHY. The working lines are the server's own `basis` sentences, reprinted so
 * they cannot go stale (rp-plot.tsx `Working`). Those sentences are written for
 * whoever reads the API: they name tables (`wine_consumption_log`,
 * `procurement_orders`), columns (`menu_price_current`), payload fields
 * (`items[].marginPerBottle`), engine codes (`rolling_one_step_ahead`), ADR
 * numbers and a bare `null`. The 2026-11-11 and 2026-11-12 browser walks saw
 * an owner read all of that under a chart.
 *
 * WHAT THIS KEEPS. The lineage: every line still says where the figure came
 * from (the record of bottles poured and sold, delivered orders, the menu
 * price, the average invoiced cost), over which window, and what was left out
 * and why. Only the vocabulary changes. The API keeps its sentences for the
 * agents and exports that read them; this is the page's translation of them,
 * applied at the one place the page prints them.
 *
 * HOW. Whole sentences that only list payload fields are replaced by what they
 * mean. Then known names become words. Last, any table-style name nobody
 * listed here loses its underscores, so a new one never prints as a code.
 */

/** Sentences that are a list of payload fields: replaced whole, by what they mean. */
const WHOLE: Array<[RegExp, string]> = [
  [
    /^inventoryValue, grossMarginDollars, grossMargin, cogsRatio\b.*$/,
    'Stock value, margin and every ratio built on cost are left blank unless every bottle on hand has a recorded cost. Stock turns and days of stock are left blank again when the cost of goods is unknown, and the three ratios when takings are unknown, because a ratio with no denominator is not a ratio.',
  ],
  [
    /^items\[\]\.marginPerBottle\b.*$/,
    'A wine with no recorded cost has no margin and no place on the menu map; it is counted as unclassified.',
  ],
  [
    /^items\[\]\.velocityPerDay\b.*$/,
    'A costed wine with any line that carries no bottle figure has no pace and no place on the menu map; it is counted as unmeasured, and the middle pace is taken over the known paces only.',
  ],
  [
    /^skus\[\]\.inventoryValue\b.*$/,
    'A wine with no recorded cost has no stock value, unit cost or order size. No wine is given an A, B or C class unless the whole cellar is priced, because those classes cut on a share of a total.',
  ],
  [
    /^bestDay\/worstDay are null\b.*$/,
    'No best or worst day is named: more than one weekday shares the extreme, and naming one of them would be an arbitrary pick, not a finding.',
  ],
  [
    /^bestDay\/worstDay are the single weekdays\b.*$/,
    'The best and worst days are the single weekdays with the highest and lowest average.',
  ],
  [
    /^rolling_one_step_ahead$/,
    'Accuracy is scored by forecasting each day from the days before it and checking it against what happened.',
  ],
  [
    /^no_observations_in_scored_window$/,
    'No day in the scored window had a reading, so accuracy is not scored.',
  ],
  [/^null — there is no projection to total$/, 'Left blank: there is no projection to total.'],
];

/** Names and codes, in the order they must be replaced (longest first where they overlap). */
const WORDS: Array<[RegExp, string | ((...m: string[]) => string)]> = [
  // The house does not keep ADRs; the reason is already in the sentence.
  [/\s*\(ADR \d+(?:, [^)]*)?\)/g, ''],
  // Field references inside an otherwise readable sentence.
  [/\s*\(skus\[\]\.demandUnknown\)/g, ''],
  [/\bunitCost and marginPerBottle are null\b/g, 'the unit cost and the margin are left blank'],
  [/\beach Bottles sold goal's `units` counts\b/g, 'each Bottles sold goal counts'],
  [/\bdemandRisk is over\b/g, 'The demand risk is read from'],
  [/\babsent from weekdayProfile\b/g, 'left out of the weekday profile'],
  // Where a cost came from.
  [
    /invoiced lot WAC covering only part of the on-hand quantity \(inventory_lot_rollup\.wac\)/g,
    'the average invoiced cost, covering only part of the bottles on hand',
  ],
  [/invoiced lot WAC \(inventory_lot_rollup\.wac\)/g, 'the average invoiced cost'],
  [/\brestaurant_inventory\.last_purchase_price\b/g, 'the last price paid'],
  [/\b(?:restaurant_inventory\.)?menu_price_current\b/g, 'the menu price'],
  [/\bunit_price\b/g, 'the menu price'],
  [/\bWAC\b/g, 'average cost'],
  // Where a count came from.
  // `.total` first: the column name must not survive the table's rule as
  // "Till checks (voided ones left out).total" (r11 browser walk).
  [/\bNon-voided pos_checks\.total\b/g, 'The total of every till check, voided ones left out,'],
  [/\bNon-voided pos_checks\b/g, 'Till checks (voided ones left out)'],
  [/\bpos_checks\b/g, 'till checks'],
  [/\bwith zero wine_consumption_log movement in\b/g, 'with nothing poured or sold in'],
  [/\bwine_consumption_log\b/g, 'the record of bottles poured and sold'],
  [/\bdelivered procurement_orders\b/g, 'delivered orders'],
  [/\bprocurement_orders\b/g, 'orders'],
  [/\(revenue inflow needs POS feed\)/g, '(money coming in needs the till connected)'],
  [/\(POS-revenue proxy\)/g, '(standing in for takings until the till is connected)'],
  [/\bPOS check feed\b/g, 'till feed'],
  [/\bPOS checks?\b/g, (m) => (m.endsWith('s') ? 'till checks' : 'till check')],
  // Forecasting and stock science.
  [
    /\bKing safety stock at serviceLevel (0?\.\d+|1(?:\.0+)?)\b/g,
    (_m, level) => `Safety stock sized to cover demand ${Math.round(Number(level) * 100)}% of the time`,
  ],
  [/\bHolt-Winters, Holt and SES each refused this history\b/g, 'none of the three forecasting methods could fit this history'],
  [/\bholt_winters\b/g, 'A forecast that follows the trend and the weekly pattern'],
  [/\bholt_linear\b/g, 'A forecast that follows the trend'],
  [/\bses\b(?= fitted)/g, 'A smoothed average'],
  [/\bzero-filled to a dense daily series\b/g, 'with a day that sold nothing counted as zero'],
  // Units and quantities.
  [/\bbottles\/day\b/g, 'bottles a day'],
  [/\bon-hand qty\b/g, 'bottles on hand'],
  [/\bqty\b/g, 'count'],
  [/\b(\d+)d\b/g, (_m, n) => `${n} ${n === '1' ? 'day' : 'days'}`],
  // An unknown is a blank on this page, and a zero is a claim in no currency.
  [/\$0\b/g, 'a zero'],
  [/— null: /g, '— left blank: '],
  [/\bnull\b/g, 'left blank'],
];

/** Any table-style name nobody listed above: never printed as a code. */
const SNAKE = /\b[a-z]+(?:_[a-z0-9]+)+\b/g;

/** One working line, in the house's words. */
export function workingInHouseWords(line: string): string {
  const trimmed = line.trim();
  for (const [re, said] of WHOLE) if (re.test(trimmed)) return said;
  let out = trimmed;
  for (const [re, said] of WORDS) out = out.replace(re, said as never);
  out = out.replace(SNAKE, (m) => m.replace(/_/g, ' '));
  // A sentence that began with a name now begins with a lower-case word.
  return out.charAt(0).toUpperCase() + out.slice(1);
}

/** The forecast methods the gateway names (`analytics.service.ts` getDemandForecast). */
const MODELS: Record<string, string> = {
  holt_winters: 'Trend and weekly pattern',
  holt_linear: 'Trend',
  ses: 'Smoothed average',
};

/**
 * The forecast's "Model" figure, in the house's words. The gateway sends an
 * engine code (`holt_winters`); the page printed it as is. A code nobody
 * listed loses its underscores, as a working line's would.
 */
export function modelInHouseWords(code: string | null | undefined): string | null {
  if (!code || code.trim() === '') return null;
  const said = MODELS[code.trim()] ?? code.trim().replace(/_/g, ' ');
  return said.charAt(0).toUpperCase() + said.slice(1);
}

/** The lines `Working` prints: the empty ones dropped, the rest in the house's words. */
export function workingLines(lines: Array<string | null | undefined>): string[] {
  return lines
    .filter((l): l is string => !!l && l.trim() !== '')
    .map(workingInHouseWords);
}
