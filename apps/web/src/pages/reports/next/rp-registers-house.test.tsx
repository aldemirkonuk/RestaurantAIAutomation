/**
 * F-644 (sim wave 21, 2026-10-09): one wine with no cost — a bottle that came
 * back from a count or a void, a wine never invoiced — blanked "Cellar at
 * cost" for the whole house. The priced wines are now shown under a label that
 * says they are not all of it, and the page says how many wines it left out.
 */
import { describe, expect, it } from 'vitest';
import { ledger, service, type LedgerRegister } from './rp-registers-house';
import { EM, money } from './rp-format';

const ctx = { days: 30 };
const base = {
  inventoryValue: null,
  cogs: null,
  revenue: null,
  grossMargin: null,
  cogsRatio: null,
  inventoryTurnover: null,
  daysInventoryOutstanding: null,
  gmroi: null,
  deadStockCapital: null,
};
const view = (raw: Record<string, unknown>) =>
  ledger.view(ledger.select(raw) as LedgerRegister, ctx as never);

describe('Figures of record — one uncosted wine does not blank the cellar', () => {
  it('shows the priced wines and says how many it left out', () => {
    const v = view({
      ...base,
      pricedInventoryValue: 1840,
      costCoverage: { total: 12, priced: 11, unpriced: 1, complete: false },
    });
    expect(v.figures?.[0]).toMatchObject({
      label: 'Cellar at cost (priced wines)',
      value: money(1840),
    });
    expect(v.notes?.[0]).toContain('1 of 12 on-hand wines have no cost yet');
  });

  // F-1652 (sim 54): 24 bottles loaded with no cost, 12 invoiced. The wine
  // counted as costed and the page said nothing was left out.
  it('[REVERT-FAILS] a wine costed for part of its bottles is said, in bottles', () => {
    const v = view({
      ...base,
      pricedInventoryValue: 7200,
      costCoverage: { total: 1, priced: 1, unpriced: 0, complete: false, partial: 1, uncostedBottles: 24 },
    });
    expect(v.figures?.[0]).toMatchObject({
      label: 'Cellar at cost (priced wines)',
      value: money(7200),
      note: 'Leaves out 24 bottles with no cost in 1 wine costed only in part',
    });
    expect(v.notes?.[0]).toContain('counts only the bottles that carry a cost');
  });

  it('a fully priced cellar keeps its plain label', () => {
    const v = view({
      ...base,
      inventoryValue: 2000,
      pricedInventoryValue: 2000,
      costCoverage: { total: 12, priced: 12, unpriced: 0, complete: true },
    });
    expect(v.figures?.[0]).toMatchObject({ label: 'Cellar at cost', value: money(2000) });
    expect(v.notes).toEqual([]);
  });

  it('nothing priced at all still reads the dash', () => {
    const v = view({
      ...base,
      pricedInventoryValue: null,
      costCoverage: { total: 3, priced: 0, unpriced: 3, complete: false },
    });
    expect(v.figures?.[0]).toMatchObject({ label: 'Cellar at cost', value: EM });
  });
});

// F-1054: Cost of goods blanked because the orders were in two currencies says
// so; the "no delivered order" sentence is kept for the empty window only.
describe('Figures of record — Cost of goods in two currencies', () => {
  const cogsOf = (raw: Record<string, unknown>) =>
    view(raw).figures?.find((x) => x.label === 'Cost of goods (365d)');
  const ORDERED =
    'Ordered in EUR and TRY: with no exchange rate on record these cannot be added into one figure.';

  it('gives the two currencies as the reason', () => {
    expect(cogsOf({ ...base, cogsNote: ORDERED })).toMatchObject({ value: EM, note: ORDERED });
  });

  it('keeps the no-orders sentence for an empty window', () => {
    expect(cogsOf({ ...base, cogsNote: null })?.note).toBe('No delivered order came back for the window');
  });
});

// F-1491: a house under a month of buying had its turns and days of stock
// withheld with no reason on the screen, and the basis list left turns out.
describe('Figures of record — a young house is told why it has no turns', () => {
  const SHORT =
    'Turns and days of stock need 30 days of buying on record; this house has 21 days, counted from its first delivery.';
  const young = {
    ...base,
    turnsSpanNote: SHORT,
    turnsSpanShort: true,
    basis: { turns: 'null: the house has 21 days of buying on record' },
  };

  it('says the span beside the two figures, in the notes and in the basis', () => {
    const v = view(young);
    for (const label of ['Inventory turns', 'Days of inventory'])
      expect(v.figures?.find((x) => x.label === label)).toMatchObject({ value: EM, note: SHORT });
    expect(v.notes).toContain(SHORT);
    expect(v.basis).toContain('null: the house has 21 days of buying on record');
  });

  it('says it to staff too, who keep the two figures', () => {
    const v = view({ ...young, amountsWithheld: true });
    expect(v.notes).toContain(SHORT);
  });
});

// F-1518: a house past a month of buying whose turns are withheld for another
// reason was told they were "taken over the 45 days since its first delivery,
// scaled up" — the span, which is not why the figure is missing.
describe('Figures of record — the dash on turns gives its own reason', () => {
  const SCALED =
    "Turns and days of stock are taken over the 45 days since this house's first delivery, and turns are scaled up to a year.";
  const note = (raw: Record<string, unknown>, label: string) =>
    view(raw).figures?.find((x) => x.label === label)?.note;

  it('Cost of goods in another money is the reason, not the span', () => {
    const raw = { ...base, cogs: 900, cogsCurrency: 'EUR', houseCurrency: 'TRY', turnsSpanNote: SCALED, turnsSpanShort: false };
    for (const label of ['Inventory turns', 'Days of inventory'])
      expect(note(raw, label)).toBe(
        "Cost of goods is in EUR, not the house's TRY, and with no exchange rate on record it is not set against the cellar",
      );
    expect(view(raw).notes).not.toContain(SCALED);
  });

  it('an uncosted cellar is the reason, not the span', () => {
    const raw = { ...base, cogs: 900, cogsCurrency: 'EUR', houseCurrency: 'EUR', turnsSpanNote: SCALED, turnsSpanShort: false };
    expect(note(raw, 'Inventory turns')).toBe('Needs a complete cost basis and a delivered order with a price');
    expect(view(raw).notes).not.toContain(SCALED);
  });

  it('a drawn figure keeps the scaled span in the notes (control)', () => {
    const raw = {
      ...base,
      inventoryValue: 2000,
      cogs: 900,
      cogsCurrency: 'EUR',
      houseCurrency: 'EUR',
      inventoryTurnover: 3.65,
      daysInventoryOutstanding: 100,
      turnsSpanNote: SCALED,
      turnsSpanShort: false,
    };
    expect(view(raw).notes).toContain(SCALED);
  });
});

// F-1715 (sim 57): at a house whose till prices include tax, the margins
// were taken on the shelf price with KDV inside and nothing said so.
describe('Figures of record — the margins at a house whose till prices include tax', () => {
  const SAID =
    "Your till prices include tax, so the sell-price valuation and the margins here are worked out on prices without it, price ÷ (1 + the wine's tax rate).";
  const REFUSED =
    'Your till prices include tax, so margin is set against costs recorded without tax, and 1 wine on hand has a cost not recorded that way, so gross margin, COGS ratio and GMROI are not worked out.';

  it('says what a drawn margin is worked out on', () => {
    const v = view({ ...base, revenue: 1000, grossMargin: 0.6, marginTaxNote: SAID });
    expect(v.notes).toContain(SAID);
  });

  it('gives the tax basis as the reason a margin reads a dash', () => {
    const v = view({ ...base, revenue: 1000, marginTaxNote: REFUSED });
    for (const label of ['Gross margin', 'COGS ratio', 'GMROI'])
      expect(v.figures?.find((x) => x.label === label)).toMatchObject({ value: EM, note: REFUSED });
    expect(v.notes).toContain(REFUSED);
  });

  it('staff are not told the margin sentence; a house without the key is as before (control)', () => {
    expect(view({ ...base, marginTaxNote: SAID, amountsWithheld: true }).notes).not.toContain(SAID);
    expect(view({ ...base }).figures?.find((x) => x.label === 'Gross margin')?.note).toBe(
      'Needs a complete cost basis',
    );
  });
});

/**
 * w111-tips-owed (S239, after F-1691): Who served it read a fixed 90 days and
 * gave each server's tip only as a rate. It now follows the page's calendar
 * month on the house's days, as the till does, and gives tips as money.
 */
describe('Who served it — a month window and tips as money', () => {
  const raw = {
    sinceDays: 90,
    month: '2026-07',
    dataStatus: 'live',
    checksInWindow: 3,
    adjusted: null,
    tips: 42.5,
    waiters: [
      { name: 'Deniz', checks: 2, revenue: 300, avgCheck: 150, wineAttachRate: 0.5, tipPct: 0.1, tips: 42.5 },
      { name: 'Ali', checks: 1, revenue: 80, avgCheck: 80, wineAttachRate: 0, tipPct: null, tips: null },
    ],
  };

  it('[REVERT-FAILS] reads the page’s month on the house’s days, and its 90 days without one', () => {
    expect(service.takesMonth).toBe(true);
    const july = { days: 30, month: '2026-07', zone: 'Europe/Istanbul' };
    expect(service.path!('r1', july)).toBe('/analytics/waiters/r1?month=2026-07');
    expect(service.window(july)).toMatch(/of POS checks, by the house’s days$/);
    expect(service.path!('r1', { days: 30 })).toBe('/analytics/waiters/r1?sinceDays=90');
    expect(service.window({ days: 30 })).toBe('the last 90 days of POS checks');
  });

  it('[REVERT-FAILS] gives each server’s tips as money in a Tips column, and the month’s total', () => {
    const v = service.view(service.select(raw), { days: 30 });
    const cols = v.table!.cols.map((c) => c.label);
    expect(cols).toEqual(['Server', 'Checks', 'Avg check', 'Wine attach', 'Tip', 'Tips']);
    const tipsAt = cols.indexOf('Tips');
    expect(v.table!.rows[0].cells[tipsAt]).toBe(money(42.5, 'table'));
    // No tip on any of their checks is a dash, never 0.
    expect(v.table!.rows[1].cells[tipsAt]).toBe(EM);
    expect(v.figures).toContainEqual(expect.objectContaining({ label: 'Tips', value: money(42.5, 'full') }));
    expect(v.basis.join(' ')).toContain('in July 2026, by the house’s days');
  });

  it('an empty month says the month, not 90 days', () => {
    const v = service.view(
      service.select({ ...raw, waiters: [], checksInWindow: 0, latestCheckAt: '2026-09-02T12:00:00.000Z' }),
      { days: 30 },
    );
    expect(v.say).toMatch(/^No POS check was opened in July 2026 — /);
  });
});
