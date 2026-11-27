/**
 * The till by week or month (r109 g3): the register buckets its days for the
 * bars, the line and the area; the table and the heat map keep every day; a
 * grain the window does not offer draws days. (The pill is the next PR.)
 */

import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { till, daysBetween, type TillWindow } from './rp-registers-trade';
import { moneyIn } from './rp-format';
import { planCombo } from './rp-combo';
import { CatPlot, PART_OPACITY } from './rp-plot';
import { cloneElement, type ReactElement } from 'react';

vi.mock('recharts', async () => {
  const actual = await vi.importActual<typeof import('recharts')>('recharts');
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: ReactElement }) =>
      cloneElement(children, { width: 640, height: 320 } as never),
  };
});

// 90 house days to Fri 2026-11-27, from Sun 2026-08-30: a 1-day week, 12 whole, a 5-day week.
const span = daysBetween('2026-08-30', '2026-11-27');
const raw = (extra: object = {}) => ({
  posConnected: true,
  from: span[0],
  to: span[span.length - 1],
  days: 90,
  timezone: 'Europe/Istanbul',
  zoneUnset: false,
  revenue: 1,
  checkCount: 1,
  dailySeries: span.map((date) => ({ date, revenue: 700, checks: 7 })),
  ...extra,
});
const read = (r: unknown) => till.select(r) as TillWindow;

describe('the till drawn by week or month', () => {
  it('[REVERT-FAILS] at Week the bars are weeks, the edge ones lighter and named', () => {
    const view = till.view(read(raw()), { days: 90, currency: 'TRY', grain: 'week' });
    const data = view.cats!.data;
    expect(view.cats!.xLabel).toBe('week');
    expect(data).toHaveLength(14);
    expect(data[0]).toMatchObject({ label: 'Aug 24', value: 700, part: true, full: 'week of Aug 24 · part week: 1 day' });
    expect(data[1]).toMatchObject({ value: 4900 });
    expect(data[1].part).toBeUndefined();
    expect(data[13]).toMatchObject({ part: true, full: 'week of Nov 23 · part week: 5 days' });
    // The table keeps every day.
    expect(view.table!.rows).toHaveLength(90);
  });

  it('[REVERT-FAILS] the average check of a week is its takings over its checks, in the house money', () => {
    const series = span.map((date, i) => ({ date, revenue: i % 2 ? 900 : 100, checks: i % 2 ? 3 : 1 }));
    const view = till.view(read(raw({ dailySeries: series })), { days: 90, currency: 'TRY', grain: 'week' });
    const plan = planCombo(view.cats!, { bars: 'value', line: 'avg' })!;
    // Week 2 (Aug 31 - Sep 6): 7 days alternating, Σ/Σ, never the mean of 100 and 300.
    const wk = series.slice(1, 8);
    const sigma = wk.reduce((a, d) => a + d.revenue, 0) / wk.reduce((a, d) => a + d.checks, 0);
    expect(plan.rows[1].line).toBeCloseTo(sigma, 9);
    expect(view.cats!.format(4900)).toBe(moneyIn('TRY')(4900, 'compact'));
  });

  it('[REVERT-FAILS] at Month 90 days are 4 months, the first and last part', () => {
    const view = till.view(read(raw()), { days: 90, currency: 'TRY', grain: 'month' });
    expect(view.cats!.data.map((d) => d.label)).toEqual(['Aug 2026', 'Sep 2026', 'Oct 2026', 'Nov 2026']);
    expect(view.cats!.data.map((d) => d.part === true)).toEqual([true, false, false, true]);
    expect(view.cats!.data.reduce((a, d) => a + (d.value ?? 0), 0)).toBe(90 * 700);
  });

  it('[REVERT-FAILS] a grain the window does not offer draws days', () => {
    const view = till.view(read(raw()), { days: 30, currency: 'TRY', grain: 'month' });
    expect(view.cats!.xLabel).toBe('day');
  });

  it('[REVERT-FAILS] a part bucket is drawn lighter', () => {
    const view = till.view(read(raw()), { days: 90, currency: 'TRY', grain: 'week' });
    const { container } = render(<CatPlot series={view.cats!} kind="bars" />);
    const part = container.querySelectorAll('[data-part="true"]');
    expect(part.length).toBe(2);
    expect(part[0].getAttribute('fill-opacity')).toBe(String(PART_OPACITY));
  });

  it('with compare, the prior is bucketed by the same slots and aligned by index', () => {
    const doubled = daysBetween('2026-06-01', '2026-11-27').slice(-180);
    const r = raw({
      from: doubled[0],
      days: 180,
      dailySeries: doubled.map((date, i) => ({ date, revenue: i < 90 ? 10 : 700, checks: 1 })),
    });
    const view = till.view(read(r), { days: 90, currency: 'TRY', compare: true, grain: 'week' });
    const data = view.cats!.data;
    expect(data[0].prior).toBe(10);
    expect(data[1].prior).toBe(70);
    expect(data[13].prior).toBe(50);
  });
});
