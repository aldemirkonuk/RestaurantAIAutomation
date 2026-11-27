/**
 * The till as bars and a line (founder /goal 2026-11-07: "bar graph and their
 * combinations"; r28 audit gap 8). The gateway now sends each day's count of
 * checks beside its takings, so the till can put a day's takings beside its
 * checks or its average check. A gateway that does not send the count, or a
 * day without one, offers no combination: a missing count would draw that day
 * as having no checks.
 */

import { cloneElement, type ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { till, tillMeasures, type TillWindow } from './rp-registers-trade';
import { planCombo } from './rp-combo';
import { ComboPlot } from './rp-plot';
import { moneyIn } from './rp-format';

vi.mock('recharts', async () => {
  const actual = await vi.importActual<typeof import('recharts')>('recharts');
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: ReactElement }) =>
      cloneElement(children, { width: 640, height: 320 } as never),
  };
});

const ctx = { days: 3, currency: 'TRY' };

const COUNTED = {
  restaurantId: 'r1',
  from: '2026-11-11',
  to: '2026-11-13',
  days: 3,
  timezone: 'Europe/Istanbul',
  zoneUnset: false,
  posConnected: true,
  revenue: 3000,
  checkCount: 30,
  dailySeries: [
    { date: '2026-11-11', revenue: 1200, checks: 10 },
    { date: '2026-11-13', revenue: 1800, checks: 20 },
  ],
};

const read = (raw: unknown) => till.select(raw) as TillWindow;

describe('the till offers bars and a line', () => {
  it('[REVERT-FAILS] lists the combination among its drawings', () => {
    expect(till.graphs).toContain('combo');
  });

  it("[REVERT-FAILS] reads each day's checks off the payload, and a day without one as unknown", () => {
    const w = read({ ...COUNTED, dailySeries: [{ date: '2026-11-11', revenue: 5 }] });
    expect(w.dailySeries).toEqual([{ date: '2026-11-11', revenue: 5, checks: null, pricedChecks: null }]);
    expect(read(COUNTED).dailySeries[1].checks).toBe(20);
  });

  it('[REVERT-FAILS] carries checks and the average check on every day of the window, a day with no check a gap', () => {
    const view = till.view(read(COUNTED), ctx);
    const plan = planCombo(view.cats!)!;
    expect(plan.measures.map((m) => m.label)).toEqual(['Taken', 'Checks', 'Average check']);
    expect(plan.measures[1].values).toEqual([10, null, 20]);
    expect(plan.measures[2].values).toEqual([120, null, 90]);
    expect(plan.pick).toEqual({ bars: 'value', line: 'checks' });
    expect(plan.split).toBe(true);
    expect(plan.rows[1]).toMatchObject({ bar: null, line: null });
  });

  it('[REVERT-FAILS] the table gains a Checks column', () => {
    const view = till.view(read(COUNTED), ctx);
    expect(view.table!.cols.map((c) => c.label)).toEqual(['Day', 'Taken', 'Checks']);
    expect(view.table!.rows[1].cells[2]).toBe('20');
  });

  it('[REVERT-FAILS] draws both measures, the line on its own axis named in words', () => {
    const view = till.view(read(COUNTED), ctx);
    const { container } = render(<ComboPlot series={view.cats!} />);
    expect(container.querySelectorAll('.recharts-bar-rectangle').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/checks/i).length).toBeGreaterThan(0);
  });

  it('offers no combination when a day came without its count, and none from an older gateway', () => {
    const partly = {
      ...COUNTED,
      dailySeries: [{ date: '2026-11-11', revenue: 1200, checks: 10 }, { date: '2026-11-13', revenue: 1800 }],
    };
    expect(till.view(read(partly), ctx).cats!.measures).toBeUndefined();
    const old = { ...COUNTED, dailySeries: COUNTED.dailySeries.map(({ date, revenue }) => ({ date, revenue })) };
    const view = till.view(read(old), ctx);
    expect(view.cats!.measures).toBeUndefined();
    expect(planCombo(view.cats!)).toBeNull();
    expect(view.table!.cols.map((c) => c.label)).toEqual(['Day', 'Taken']);
  });

  it('the average check is drawn on its own axis beside the takings, and the checks beside it', () => {
    const view = till.view(read(COUNTED), ctx);
    const plan = planCombo(view.cats!, { bars: 'value', line: 'avg' })!;
    expect(plan.line.label).toBe('Average check');
    expect(plan.split).toBe(true);
    expect(planCombo(view.cats!, { bars: 'checks', line: 'avg' })!.split).toBe(true);
  });

  it('a window with no day sent offers nothing to combine', () => {
    expect(tillMeasures(read({ ...COUNTED, dailySeries: [] }), ['2026-11-11'], moneyIn('TRY'))).toBeUndefined();
  });

  it('a day of takings with no check counted has no average, never a division by zero', () => {
    const w = read({ ...COUNTED, dailySeries: [{ date: '2026-11-11', revenue: 0, checks: 0 }] });
    const m = tillMeasures(w, ['2026-11-11'], moneyIn('TRY'))!;
    expect(m[0].values).toEqual([0]);
    expect(m[1].values).toEqual([null]);
  });
});

describe('a check with no total is not in the average (r101 review)', () => {
  const PARTLY = {
    ...COUNTED,
    revenue: 500,
    checkCount: 15,
    // 10 checks totalling $500 and 5 that carry no total: $50 a priced check, not $33.
    dailySeries: [{ date: '2026-11-11', revenue: 500, checks: 15, pricedChecks: 10 }],
  };

  it('[REVERT-FAILS] a day averages over the checks that carry a total', () => {
    const m = tillMeasures(read(PARTLY), ['2026-11-11'], moneyIn('TRY'))!;
    expect(m[0].values).toEqual([15]); // the bar is still every check
    expect(m[1].values).toEqual([50]);
  });

  it('[REVERT-FAILS] says how many checks carried no total, and says nothing when all did', () => {
    expect(till.view(read(PARTLY), { days: 1, currency: 'TRY' }).notes).toEqual([
      "5 of the window's 15 checks carried no total, so each day's average check is over the checks that did.",
    ]);
    expect(till.view(read(COUNTED), ctx).notes).toEqual([]);
    const all = { ...PARTLY, dailySeries: [{ date: '2026-11-11', revenue: 500, checks: 15, pricedChecks: 15 }] };
    expect(till.view(read(all), { days: 1, currency: 'TRY' }).notes).toEqual([]);
  });

  it('an older gateway that sends no pricedChecks keeps dividing by every check, with no note', () => {
    const m = tillMeasures(read(COUNTED), ['2026-11-11', '2026-11-12', '2026-11-13'], moneyIn('TRY'))!;
    expect(m[1].values).toEqual([120, null, 90]);
  });

  it('a day whose checks all carry no total has no average, never a division by zero', () => {
    const w = read({ ...COUNTED, dailySeries: [{ date: '2026-11-11', revenue: 0, checks: 4, pricedChecks: 0 }] });
    expect(tillMeasures(w, ['2026-11-11'], moneyIn('TRY'))![1].values).toEqual([null]);
  });
});
