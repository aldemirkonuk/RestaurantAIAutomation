/**
 * F-1145: the gateway gives COGS, spend and committed WITH their code when it
 * is one currency that is not the house's (cogsCurrency, spendCurrency,
 * committedCurrency, notCounted.orderValueCurrency). The page read none of
 * them and printed every figure through the house's money: a lira house that
 * bought its year in euros read "Cost of goods (365d) ₺48.000" for €48,000.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setHouseCurrency, setHouseLocale } from '@/lib/houseCurrency';
import { ledger } from './rp-registers-house';
import { notCountedNote, pacing, type PacingRegister } from './rp-registers-trade';
import { bench } from './rp-registers-bench';
import { money } from './rp-format';

const ctx = { days: 30 } as never;

type Fig = { label: string; value: string };
const valueOf = (view: unknown, label: string) =>
  ((view as { figures: Fig[] }).figures.find((f) => f.label === label) ?? { value: undefined }).value;

describe('a figure in another currency prints with its own sign (F-1145)', () => {
  beforeEach(() => {
    setHouseCurrency('TRY');
    setHouseLocale('tr-TR');
  });
  afterEach(() => {
    setHouseCurrency(null);
    setHouseLocale(null);
  });

  it('money() takes the code it is given, and the house’s money without one', () => {
    expect(money(48000, 'full', 'EUR')).toContain('€');
    expect(money(48000, 'full', 'EUR')).not.toContain('₺');
    expect(money(48000)).toContain('₺');
  });

  it('Figures of record prints a euro cost of goods in euros', () => {
    const f = ledger.select({ cogs: 48000, cogsCurrency: 'EUR', basis: {} });
    const v = valueOf(ledger.view(f, ctx), 'Cost of goods (365d)');
    expect(v).toContain('€');
    expect(v).not.toContain('₺');
  });

  it('Spend pacing prints euro committed, paid out and order value in euros', () => {
    const c = pacing.select({
      spendLast30d: 1200,
      spendPrev30d: 800,
      paceDeltaPct: 0.5,
      projectedNext4Weeks: [300],
      spendCurrency: 'EUR',
      committedOpenOrders: 5000,
      committedCurrency: 'EUR',
      openOrderCount: 1,
      notCounted: { approved: 1, partlyReceived: 0, other: 0, orderValue: 700, orderValueCurrency: 'EUR', unpriced: 0 },
      basis: {},
    }) as PacingRegister;
    const view = pacing.view(c, ctx) as { table: { rows: Array<{ cells: string[] }> } };
    expect(valueOf(view, 'Committed, not yet delivered')).toContain('€');
    for (const row of view.table.rows) expect(row.cells[1]).toContain('€');
    const note = notCountedNote(c.notCounted) ?? '';
    expect(note).toContain('€');
    expect(note).not.toContain('₺');
  });

  it('Against ourselves prints euro buying and committed in euros', () => {
    const b = bench.select({
      cashflow: {
        spendLast30d: 1200,
        spendPrev30d: 800,
        spendCurrency: 'EUR',
        committedOpenOrders: 5000,
        committedCurrency: 'EUR',
      },
      seasonality: {},
      activeGoals: [],
    });
    const view = bench.view(b, ctx);
    expect(valueOf(view, 'Bought, last 30 days')).toContain('€');
    expect(valueOf(view, 'Bought, the 30 before')).toContain('€');
    expect(valueOf(view, 'Committed, not yet delivered')).toContain('€');
  });

  it('a figure in the house’s own money reads as before', () => {
    const f = ledger.select({ cogs: 48000, cogsCurrency: 'TRY', basis: {} });
    expect(valueOf(ledger.view(f, ctx), 'Cost of goods (365d)')).toContain('₺');
  });
});
