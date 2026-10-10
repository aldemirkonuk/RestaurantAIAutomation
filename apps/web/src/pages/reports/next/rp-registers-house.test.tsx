/**
 * F-644 (sim wave 21, 2026-10-09): one wine with no cost — a bottle that came
 * back from a count or a void, a wine never invoiced — blanked "Cellar at
 * cost" for the whole house. The priced wines are now shown under a label that
 * says they are not all of it, and the page says how many wines it left out.
 */
import { describe, expect, it } from 'vitest';
import { ledger, type LedgerRegister } from './rp-registers-house';
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
