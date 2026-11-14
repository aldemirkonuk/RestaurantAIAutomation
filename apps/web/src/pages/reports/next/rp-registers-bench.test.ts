/**
 * "Against ourselves": the buying row sits under the columns that name it,
 * and a goal is printed in its own unit (r28 /reports audit, gaps 5 and 6).
 *
 * Before: the last 30 days' spend was printed under "Then / best" and the 30
 * before under "Now / worst", so a month of rising spend read as falling; and
 * a goal's baseline, current and target were bare numbers ("2.4K", "0.2"),
 * with no currency, no percent sign and no "days".
 */
import { describe, expect, it } from 'vitest';
import { bench, type BenchRegister } from './rp-registers-bench';
import { money } from './rp-format';

const PAYLOAD = {
  cashflow: { spendLast30d: 1200, spendPrev30d: 900, paceDeltaPct: 0.3333, committedOpenOrders: 400, openOrderCount: 2 },
  seasonality: null,
  activeGoals: [
    { name: 'Revenue', metric_key: 'wine_revenue', unit: 'currency', baseline_value: 2400, current_value: 2600, target_value: 3000 },
    { name: 'Attach', metric_key: 'wine_attach_rate', unit: 'percent', baseline_value: 0.2, current_value: 0.24, target_value: 0.3 },
    { name: 'Cover', metric_key: 'days_of_inventory', unit: 'days', baseline_value: 30, current_value: 24, target_value: 21 },
    { name: 'Old', metric_key: 'checks', baseline_value: 120, current_value: 140, target_value: 150 },
  ],
};
const CURRENCY = 'TRY';

const view = (raw: unknown) =>
  bench.view(bench.select(raw) as BenchRegister, { days: 30, currency: CURRENCY } as never);

const rows = (raw: unknown) => {
  const t = view(raw).table!;
  return { cols: t.cols.map((c) => c.label), rows: t.rows };
};

describe('against ourselves — the table says what its columns say', () => {
  it('[REVERT-FAILS] the earlier window is under "Then", the latest under "Now"', () => {
    const { cols, rows: r } = rows(PAYLOAD);
    expect(cols[1]).toMatch(/^Then/);
    expect(cols[2]).toMatch(/^Now/);
    const buying = r.find((x) => x.key === 'buying')!;
    expect(buying.cells[1]).toBe(money(900, 'table', CURRENCY));
    expect(buying.cells[2]).toBe(money(1200, 'table', CURRENCY));
  });

  it('[REVERT-FAILS] a money goal is money in the house currency', () => {
    const goal = rows(PAYLOAD).rows.find((x) => x.key === 'goal-Revenue')!;
    expect(goal.cells.slice(1)).toEqual([
      money(2400, 'compact', CURRENCY),
      money(2600, 'compact', CURRENCY),
      money(3000, 'compact', CURRENCY),
    ]);
    expect(goal.cells[1]).not.toBe('2.4K');
  });

  it('[REVERT-FAILS] a rate goal is a percent and a days goal says days', () => {
    const r = rows(PAYLOAD).rows;
    const attach = r.find((x) => x.key === 'goal-Attach')!;
    for (const c of attach.cells.slice(1)) expect(c).toMatch(/%$/);
    const cover = r.find((x) => x.key === 'goal-Cover')!;
    expect(cover.cells.slice(1)).toEqual(['30 days', '24 days', '21 days']);
  });

  it('a goal from a gateway that sends no unit keeps the bare figure, never a borrowed unit', () => {
    const old = rows(PAYLOAD).rows.find((x) => x.key === 'goal-Old')!;
    expect(old.cells.slice(1)).toEqual(['120', '140', '150']);
  });

  it('an unknown baseline is the dash, whatever the unit', () => {
    const r = rows({
      ...PAYLOAD,
      activeGoals: [{ ...PAYLOAD.activeGoals[0], baseline_value: null }],
    }).rows.find((x) => x.key === 'goal-Revenue')!;
    expect(r.cells[1]).toBe('—');
  });
});
