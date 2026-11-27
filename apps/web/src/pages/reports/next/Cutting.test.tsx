/**
 * perf-p10-4: a till window click (90D) redraws the till, and the view of the
 * answer is built for the one drawing the cutting is set to — not for the heat
 * map and the table too — and once per answer, not on every render. The chart
 * comes first; the working is a closed list behind a button.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const shortDaySpy = vi.hoisted(() => ({ calls: 0 }));
vi.mock('./rp-format', async (importOriginal) => {
  const real = await importOriginal<typeof import('./rp-format')>();
  return {
    ...real,
    shortDay: (d: string) => {
      shortDaySpy.calls += 1;
      return real.shortDay(d);
    },
  };
});
vi.mock('./rp-plot', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./rp-plot')>()),
  // recharts measures a box jsdom does not have; the frame stands in for the drawing
  CatPlot: ({ series }: { series: { data: unknown[] } }) => <div data-testid="chart" data-points={series.data.length} />,
}));

import Cutting from './Cutting';
import { till, type TillWindow } from './rp-registers-trade';

const days = Array.from({ length: 90 }, (_, i) => {
  const d = new Date(Date.UTC(2026, 5, 1 + i));
  return { date: d.toISOString().slice(0, 10), revenue: 1000 + i };
});
const answer: TillWindow = till.select({
  posConnected: true,
  revenue: 90000,
  checkCount: 900,
  from: days[0].date,
  to: days[89].date,
  days: 90,
  timezone: 'America/Los_Angeles',
  zoneUnset: false,
  dailySeries: days,
}) as TillWindow;

beforeEach(() => {
  shortDaySpy.calls = 0;
});

describe('the till view builds only what is drawn (perf-p10-4)', () => {
  it('reading the area drawing formats the days once each way and builds no heat map or table', () => {
    const view = till.view(answer, { days: 90 });
    expect(shortDaySpy.calls).toBe(0); // nothing is built until a drawing asks
    expect(view.cats?.data).toHaveLength(90);
    expect(shortDaySpy.calls).toBe(180); // label + full, per day
    expect(view.cats).toBe(view.cats); // built once
    expect(shortDaySpy.calls).toBe(180);
  });

  it('the heat map and the table are still there when their drawing is picked', () => {
    const view = till.view(answer, { days: 90 });
    expect(view.table?.rows).toHaveLength(90);
    expect(view.matrix?.cells.length).toBe(90);
    expect(view.matrix?.cols.length).toBeGreaterThan(10);
  });
});

describe('Cutting on the till at 90 days', () => {
  // The page memoises its ctx and the register's answer is the query's stable object; so are these.
  const ctx = { days: 90 } as never;
  const register = { data: answer, loading: false, failure: null, refetch: () => {} } as never;
  const sheet = (graph: 'area' | 'table') => (
    <MemoryRouter>
      <Cutting
        id="till"
        graph={graph}
        register={register}
        ctx={ctx}
        arranging={false}
        swapOptions={[]}
        arrange={{ picked: null } as never}
        onGraph={() => {}}
        onSwap={() => {}}
        onRemove={() => {}}
        onDays={() => {}}
      />
    </MemoryRouter>
  );

  it('draws the chart with the working closed behind its button, formatting each day twice, not four times', () => {
    render(sheet('area'));
    expect(screen.getByTestId('chart').getAttribute('data-points')).toBe('90');
    expect(screen.getByRole('button', { name: 'Show the working' })).toBeTruthy();
    expect(shortDaySpy.calls).toBe(180);
  });

  it('a re-render of the same answer does not build the view again', () => {
    const { rerender } = render(sheet('area'));
    const first = shortDaySpy.calls;
    rerender(sheet('area'));
    expect(shortDaySpy.calls).toBe(first);
  });
});
