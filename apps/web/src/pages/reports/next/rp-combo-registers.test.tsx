/**
 * The room, the servers and the reorder list as bars and a line (the founder's
 * /goal, 2026-11-07). Each of the three registers hands the combination a
 * second measure in its own unit; these cases pin what each carries, that a
 * missing figure stays missing (a gap, never a zero), and that the catalogue
 * offers the graph.
 */

import { cloneElement, type ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { seats, service, restock } from './rp-registers-house';
import { week } from './rp-registers-trade';
import { planCombo } from './rp-combo';
import { ComboPlot } from './rp-plot';

vi.mock('recharts', async () => {
  const actual = await vi.importActual<typeof import('recharts')>('recharts');
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: ReactElement }) =>
      cloneElement(children, { width: 640, height: 320 } as never),
  };
});

const ctx = { days: 90 };

const SEATS = {
  sinceDays: 90,
  checksInWindow: 40,
  dataStatus: 'live',
  tables: [
    { tableId: 't1', label: 'T1', seats: 4, checks: 12, revenue: 900, covers: 30, avgCheck: 75 },
    { tableId: 't2', label: 'T2', seats: 2, checks: 3, revenue: 120, covers: 6, avgCheck: null },
  ],
};

const SERVICE = {
  sinceDays: 90,
  checksInWindow: 40,
  dataStatus: 'live',
  waiters: [
    { name: 'Ada', checks: 20, revenue: 2000, avgCheck: 100 },
    { name: 'Bo', checks: 5, revenue: 250, avgCheck: null },
  ],
};

const RESTOCK = {
  params: { serviceLevel: 0.95, leadTimeDays: 5, demandWindowDays: 90 },
  skuCount: 9,
  reorderCount: 2,
  reorderList: [
    { id: 'w1', name: 'Rioja', onHand: 3, daysOfCover: 4, stockoutProbability: 0.6 },
    { id: 'w2', name: 'Barolo', onHand: 1, daysOfCover: null, stockoutProbability: 0.3 },
  ],
};

describe('seats, service and restock offer bars and a line', () => {
  it('lists the combination among each register’s graphs', () => {
    expect(seats.graphs).toContain('combo');
    expect(service.graphs).toContain('combo');
    expect(restock.graphs).toContain('combo');
  });

  it('the room: checks (a count) beside the average check (money), in two units', () => {
    const view = seats.view(seats.select(SEATS) as never, ctx);
    const ms = view.cats?.measures ?? [];
    expect(ms.map((m) => m.key)).toEqual(['checks', 'avg']);
    expect(ms.map((m) => m.unit)).toEqual(['checks', 'per check']);
    // The table with no average check is a gap, not a zero.
    expect(ms[1].values).toEqual([75, null]);
    const plan = planCombo(view.cats!, { bars: 'checks', line: 'avg' });
    expect(plan?.split).toBe(true);
    expect(plan?.rows.map((r) => r.line)).toEqual([75, null]);
  });

  it('the servers: checks beside the average check, a missing average a gap', () => {
    const view = service.view(service.select(SERVICE) as never, ctx);
    const ms = view.cats?.measures ?? [];
    expect(ms.map((m) => m.key)).toEqual(['checks', 'avg']);
    expect(ms[1].values).toEqual([100, null]);
  });

  it('the reorder list: stockout risk as bars, days of cover as the line, an unknown cover a gap', () => {
    const view = restock.view(restock.select(RESTOCK) as never, ctx);
    const ms = view.cats?.measures ?? [];
    expect(ms.map((m) => m.key)).toEqual(['cover']);
    expect(ms[0].unit).toBe('days');
    expect(ms[0].values).toEqual([4, null]);
    const plan = planCombo(view.cats!, undefined);
    expect(plan?.rows.map((r) => r.line)).toEqual([4, null]);
  });
});

describe('what the combination says and leaves blank', () => {
  it('a weekday seen once has no spread: a gap in the line, a dash in the table, never 0', () => {
    const raw = {
      weekdayProfile: [
        { day: 'Mon', mean: 3, stdev: null, n: 1 },
        { day: 'Tue', mean: 4, stdev: 1.2, n: 5 },
      ],
    };
    const view = week.view(week.select(raw) as never, ctx);
    const spread = view.cats?.measures?.find((m) => m.key === 'spread');
    expect(spread?.values).toEqual([null, 1.2]);
    expect(view.table?.rows[0].cells[2]).toBe('—');
  });

  it('the room reads "Taken", then "Average check (per check)", without echoing a unit', () => {
    const view = seats.view(seats.select(SEATS) as never, ctx);
    render(<ComboPlot series={view.cats!} pick={{ bars: 'checks', line: 'avg' }} />);
    expect(
      screen.getByText('Bars: Checks, on the left scale. Line: Average check (per check), on the right scale.'),
    ).toBeInTheDocument();
  });

  it('the reorder list names the risk in words, not "in chance of running out"', () => {
    const view = restock.view(restock.select(RESTOCK) as never, ctx);
    render(<ComboPlot series={view.cats!} />);
    expect(
      screen.getByText(
        'Bars: Stockout risk (chance of running out before the delivery), on the left scale. Line: Days of cover (days), on the right scale.',
      ),
    ).toBeInTheDocument();
  });
});
