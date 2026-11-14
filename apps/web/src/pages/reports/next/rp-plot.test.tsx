/**
 * The charts say only what is true (audit G10, G12-G14). ResponsiveContainer is
 * given a real size, as in `rp-combo.test.tsx`: jsdom measures boxes as zero.
 */

import { cloneElement, type ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CatPlot, HeatGrid, tickInterval } from './rp-plot';
import { MemoryRouter } from 'react-router-dom';
import {
  ahead,
  daysBetween,
  heldWords,
  pacing,
  till,
  week,
  type AheadRegister,
  type PacingRegister,
  type TillWindow,
  type WeekRegister,
} from './rp-registers-trade';
import { fitWords } from './rp-registers-house';
import type { CatSeries, MatrixSeries } from './rp-view';

vi.mock('recharts', async () => {
  const actual = await vi.importActual<typeof import('recharts')>('recharts');
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: ReactElement }) =>
      cloneElement(children, { width: 640, height: 320 } as never),
  };
});

const n = (v: number) => String(v);

/** Three measured days, the seam on day 3, then two projected days. */
function forecastSeries(): CatSeries {
  return {
    data: [
      { label: 'd1', value: 4, projected: null },
      { label: 'd2', value: 6, projected: null },
      { label: 'd3', value: 5, projected: 5 },
      { label: 'd4', value: null, projected: 7 },
      { label: 'd5', value: null, projected: 8 },
    ],
    xLabel: 'day',
    yLabel: 'bottles',
    unit: 'bottles',
    format: n,
    projectedLabel: 'projected',
  };
}

const bars = (c: HTMLElement) => Array.from(c.querySelectorAll('path.recharts-rectangle'));

describe('bars with a projection', () => {
  it('draws one series: one bar per day, the seam day once, projected days dashed', () => {
    const { container } = render(<CatPlot series={forecastSeries()} kind="bars" />);
    expect(container.querySelectorAll('.recharts-bar')).toHaveLength(1);
    const drawn = bars(container);
    // Grouped series drew 6: three measured, the seam twice, two projected.
    expect(drawn).toHaveLength(5);
    const dashed = drawn.filter((b) => b.getAttribute('stroke-dasharray') === '3 2');
    expect(dashed).toHaveLength(2);
  });

});

describe('a day with no figure is a gap', () => {
  it('a line over a null day lifts the pen instead of bridging it', () => {
    const series: CatSeries = {
      data: [
        { label: 'a', value: 3 },
        { label: 'b', value: 4 },
        { label: 'c', value: null },
        { label: 'd', value: 5 },
        { label: 'e', value: 6 },
      ],
      xLabel: 'day',
      yLabel: 'taken',
      unit: 'taken',
      format: n,
    };
    const { container } = render(<CatPlot series={series} kind="line" />);
    const d = container.querySelector('.recharts-line-curve')?.getAttribute('d') ?? '';
    expect(d.match(/M/g)?.length).toBe(2);
  });

  it('names the chart for a screen reader in words', () => {
    render(<CatPlot series={forecastSeries()} kind="line" />);
    expect(
      screen.getByRole('img', { name: 'A line of bottles by day, the projected part dashed' }),
    ).toBeInTheDocument();
  });
});

describe('the heat map', () => {
  it('a cell that exists with no figure says "nothing recorded", never a formatted null', () => {
    const series: MatrixSeries = {
      rows: ['Mon'],
      cols: ['Aug 3', 'Aug 10'],
      cells: [
        { row: 'Mon', col: 'Aug 3', value: 120, title: 'Aug 3' },
        { row: 'Mon', col: 'Aug 10', value: null, title: 'Aug 10' },
      ],
      xLabel: 'week beginning',
      yLabel: 'weekday',
      unit: 'taken',
      format: (v) => `$${v.toFixed(0)}`,
    };
    render(<HeatGrid series={series} />);
    expect(screen.getByLabelText('Aug 10, nothing recorded')).toBeInTheDocument();
    expect(screen.getByLabelText('Aug 3, $120 taken')).toBeInTheDocument();
  });
});

describe('the till fills its window', () => {
  const w = till.select({
    posConnected: true,
    revenue: 790,
    checkCount: 12,
    from: '2026-08-03',
    to: '2026-08-09',
    days: 7,
    timezone: 'Europe/Istanbul',
    zoneUnset: false,
    dailySeries: [
      { date: '2026-08-04', revenue: 310 },
      { date: '2026-08-07', revenue: 480 },
      { date: '2026-08-08', revenue: null },
    ],
  }) as TillWindow;

  it('keeps a day the server could not state as unknown, not 0', () => {
    expect(w.dailySeries[2].revenue).toBeNull();
  });

  it('plots every house day of the window, a day with no check as a gap', () => {
    const view = till.view(w, { days: 7 });
    expect(view.cats?.data.map((c) => c.value)).toEqual([null, 310, null, null, 480, null, null]);
    expect(view.cats?.data[0].full).toMatch(/no check/);
  });

  it('daysBetween is inclusive and refuses a reversed or malformed range', () => {
    expect(daysBetween('2026-02-27', '2026-03-02')).toEqual([
      '2026-02-27',
      '2026-02-28',
      '2026-03-01',
      '2026-03-02',
    ]);
    expect(daysBetween('2026-03-02', '2026-02-27')).toEqual([]);
    expect(daysBetween('', '2026-02-27')).toEqual([]);
  });
});

describe('model quality is said in words (ADR 0104)', () => {
  it('bands the backtest error', () => {
    expect(heldWords(null)).toBe('—');
    expect(heldWords(9)).toBe('Held close in past weeks');
    expect(heldWords(15)).toBe('Held close in past weeks');
    expect(heldWords(30)).toMatch(/rough/);
    expect(heldWords(80)).toMatch(/direction/);
  });

  it('bands the table-adjusted fit', () => {
    expect(fitWords(null)).toBe('—');
    expect(fitWords(0.6)).toMatch(/ranking holds/);
    expect(fitWords(0.3)).toMatch(/loosely/);
    expect(fitWords(0.05)).toMatch(/rough/);
  });

  it('the forecast prints neither the error statistic nor the model name', () => {
    const a = ahead.select({
      model: 'holt_winters',
      modelFitted: true,
      horizon: 14,
      history: { dates: ['2026-08-01', '2026-08-02'], values: [3, 4] },
      forecast: [{ date: '2026-08-03', value: 5 }],
      totalForecastDemand: 70,
      accuracy: { mape: 12, scoredPoints: 14, basis: 'scored on the last fortnight' },
    }) as AheadRegister;
    const view = ahead.view(a, { days: 30 });
    const words = view.figures.map((f) => `${f.label} ${f.value}`).join(' | ');
    expect(words).not.toMatch(/MAPE|holt|Model/);
    expect(words).toContain('How it has held Held close in past weeks');
  });
});

describe('a house with no time zone says so on spend and the week (ADR 0296)', () => {
  const sayOf = (node: unknown) =>
    render(<MemoryRouter>{node as never}</MemoryRouter>).container.textContent ?? '';

  it('pacing withholds spend and the pace, and still states what is committed', () => {
    const c = pacing.select({
      zoneUnset: true,
      spendLast30d: null,
      spendPrev30d: null,
      paceDeltaPct: null,
      projectedNext4Weeks: null,
      committedOpenOrders: 300,
      openOrderCount: 1,
    }) as PacingRegister;
    const view = pacing.view(c, { days: 30, currency: 'USD' });
    expect(view.cats).toBeUndefined();
    expect(sayOf(view.say)).toMatch(/time zone isn’t set/);
    expect(view.figures.map((f) => f.label)).toEqual(['Committed, not yet delivered', 'Open orders']);
    expect(view.figures[0].value).toBe('$300');
  });

  it('a quiet stretch is said plainly, never called ambiguous', () => {
    const c = pacing.select({ spendLast30d: 0, spendPrev30d: 0, committedOpenOrders: 0, openOrderCount: 0 }) as PacingRegister;
    const view = pacing.view(c, { days: 30 });
    // A node since r38: the sentence, then the way in (rp-next-step.tsx).
    expect(sayOf(view.say)).toMatch(/No delivered purchase order/);
  });

  it('the week names no weekday and says why', () => {
    const w = week.select({ zoneUnset: true, weekdayProfile: [], bestDay: null, worstDay: null }) as WeekRegister;
    const view = week.view(w, { days: 30 });
    expect(sayOf(view.say)).toMatch(/time zone isn’t set/);
    expect(view.figures).toEqual([]);
  });
});

describe('tickInterval', () => {
  it('draws every day of a week, and thins only longer or wordier runs', () => {
    const week = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((label) => ({ label }));
    expect(tickInterval(week)).toBe(0);
    const month = Array.from({ length: 30 }, (_, i) => ({ label: `Oct ${i + 1}` }));
    expect(tickInterval(month)).toBe('preserveStartEnd');
    expect(tickInterval([{ label: 'Local Check…' }, { label: 'Ana' }])).toBe('preserveStartEnd');
  });
});
