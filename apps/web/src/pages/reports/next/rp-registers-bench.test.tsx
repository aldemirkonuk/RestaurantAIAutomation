/**
 * Two readings of the house's own books that said more than they knew.
 *
 * F-573, "Against ourselves": each goal's middle figure is the value stored the
 * last time the goal was opened, printed with no unit, so an attach goal read
 * "0.35" here and "35%" on the goals desk. A failed goals read reached the page
 * as an empty list and said "No goal is running". The gateway now sends each
 * goal's unit and a null lens for a failed read.
 *
 * F-574, "Figures of record": a wine with no bottle price is left out of the
 * sell-price valuation and the margin, and the gateway counts it in
 * `priceCoverage`. The register says how many.
 *
 * This file also holds the second case so the change stays within 15 files.
 */

import { describe, expect, it } from 'vitest';
import { bench, type BenchRegister } from './rp-registers-bench';
import { ledger, type LedgerRegister } from './rp-registers-house';

const ctx = { days: 90 };

const OVERVIEW = {
  cashflow: { spendLast30d: 1200, spendPrev30d: 900, paceDeltaPct: 0.3333 },
  seasonality: { tie: false, bestDay: 'Friday', worstDay: 'Monday', weekdayProfile: [] },
};

const readBench = (raw: unknown) => bench.select(raw) as BenchRegister;
const goalRows = (v: ReturnType<typeof bench.view>) =>
  (v.table?.rows ?? []).filter((r) => r.key.startsWith('goal-')).map((r) => r.cells);

describe('Against ourselves — each goal in its unit, and a failed read is not "no goal" (F-573)', () => {
  it('prints an attach goal as a percent and a money goal as money, and names the stored reading', () => {
    const view = bench.view(
      readBench({
        ...OVERVIEW,
        activeGoals: [
          {
            name: 'Lift wine attach',
            metric_key: 'wine_attach_rate',
            unit: 'percent',
            baseline_value: 0.2,
            current_value: 0.35,
            target_value: 0.4,
            updated_at: '2026-10-01T09:00:00Z',
          },
          {
            name: 'Wine sales',
            metric_key: 'wine_revenue',
            unit: 'currency',
            baseline_value: 1000,
            current_value: 4210,
            target_value: 6000,
          },
        ],
      }),
      ctx,
    );
    const [attach, sales] = goalRows(view);
    expect(attach[0]).toBe('Lift wine attach — when set, last read Oct 1, target');
    expect(attach.slice(1)).toEqual(['20.0%', '35.0%', '40.0%']);
    expect(sales[2]).toMatch(/^\$/);
    expect(view.notes.join(' ')).toContain('the last time it was opened on the goals desk');
  });

  it('a goals lens that did not answer is not "No goal is running"', () => {
    const view = bench.view(readBench({ ...OVERVIEW, activeGoals: null }), ctx);
    const notes = view.notes.join(' ');
    expect(notes).toContain('The goals could not be read');
    expect(notes).not.toContain('No goal is running');
    expect(view.figures.find((f) => f.label === 'Goals running')?.value).toBe('—');
  });

  it('an empty goals list still says no goal is running', () => {
    const view = bench.view(readBench({ ...OVERVIEW, activeGoals: [] }), ctx);
    expect(view.notes.join(' ')).toContain('No goal is running');
  });
});

describe('Figures of record — an unpriced wine is counted, not valued at $0 (F-574)', () => {
  const read = (raw: unknown) => ledger.select(raw) as LedgerRegister;

  it('says how many on-hand wines have no bottle price', () => {
    const view = ledger.view(
      read({
        revenue: 300,
        costCoverage: { total: 2, priced: 2, unpriced: 0, complete: true },
        priceCoverage: { total: 2, priced: 1, unpriced: 1 },
      }),
      ctx,
    );
    expect(view.notes.join(' ')).toContain(
      '1 wine on hand has no bottle price, so it is left out of the sell-price valuation',
    );
  });

  it('says nothing about prices when every wine carries one, or the gateway is older', () => {
    for (const priceCoverage of [{ total: 2, priced: 2, unpriced: 0 }, undefined]) {
      const view = ledger.view(read({ revenue: 300, priceCoverage }), ctx);
      expect(view.notes.join(' ')).not.toContain('bottle price');
    }
  });
});
