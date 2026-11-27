/**
 * Goals drawn as bullet bars (r110 g3): each bar is the goal's share of its
 * own target, a 2 px tick marks where the schedule says it should be by now
 * (expectedByNow / target × 100), and a dashed rule at 100 is the target. A
 * target of 0 is not a share: no bar, counted as could not be scored. No
 * deadline, no tick, and the tip says why. A withheld reading gets no tick.
 */
import { cloneElement, type ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

vi.mock('recharts', async () => {
  const actual = await vi.importActual<typeof import('recharts')>('recharts');
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: ReactElement }) =>
      cloneElement(children, { width: 800, height: 320 } as never),
  };
});

import { CatPlot } from './rp-plot';
import { goals } from './rp-registers-goals';

afterEach(cleanup);

/** One entry as the gateway sends it (goals.service.ts getGoalProgress). */
const entry = (id: string, over: Record<string, unknown> = {}, goal: Record<string, unknown> = {}) => ({
  goal: { id, name: `Goal ${id}`, metric_key: 'covers', direction: 'at_least', deadline: '2026-12-31', period: 'custom', ...goal },
  metricLabel: 'Covers',
  unit: 'count',
  current: 12,
  target: 30,
  progressPct: 0.4,
  expectedByNow: 15,
  onTrack: false,
  daysLeft: 34,
  ...over,
});
const view = (entries: unknown[]) => goals.view(goals.select({ goals: entries, total: entries.length }), { days: 30, currency: 'USD' });
const cat = (v: ReturnType<typeof view>, name: string) => v.cats!.data.find((d) => d.full === name)!;

describe('goals as bullet bars', () => {
  it('[REVERT-FAILS] the tick is where the schedule says: 15 of a target of 30 is 50, not the current 40', () => {
    const v = view([entry('a')]);
    expect(cat(v, 'Goal a').value).toBe(40);
    expect(cat(v, 'Goal a').mark).toBe(50);
    expect(v.cats!.refs).toEqual([{ y: 100, label: 'the target' }]);
    expect(cat(v, 'Goal a').note).toBe(
      '12 of a target of 30; the schedule says 15 by now. Behind the pace this goal needs, 34 days left. There is not enough history to project the deadline, so none is drawn.',
    );
  });

  it('[REVERT-FAILS] a target of 0 draws no bar and counts as could not be scored', () => {
    const v = view([entry('a'), entry('zero', { target: 0, progressPct: 0, expectedByNow: 0, current: 5 })]);
    expect(v.cats!.data.map((d) => d.full)).toEqual(['Goal a']);
    expect(v.figures.find((f) => f.label === 'Could not be scored')!.value).toBe('1');
  });

  it('[REVERT-FAILS] no deadline gives no tick, and the tip says why', () => {
    const v = view([entry('n', { expectedByNow: null, onTrack: null, daysLeft: null }, { deadline: null })]);
    expect(cat(v, 'Goal n').mark).toBeNull();
    expect(cat(v, 'Goal n').note).toBe('12 of a target of 30. No deadline, so there is no schedule to be ahead or behind of.');
  });

  it('a deadline with no pace read gives no tick and the gateway’s own sentence', () => {
    const unread = 'The pace is not computed: set the house’s time zone.';
    const v = view([entry('z', { expectedByNow: null, onTrack: null, paceUnread: unread })]);
    expect(cat(v, 'Goal z').mark).toBeNull();
    expect(cat(v, 'Goal z').note).toContain(unread);
  });

  it('[REVERT-FAILS] a withheld reading gets no tick and no figure in the tip', () => {
    const v = view([entry('w', { current: null })]);
    const w = cat(v, 'Goal w');
    expect(w.mark).toBeNull();
    expect(w.note).not.toMatch(/\d+ of a target/);
    expect(w.note).not.toContain('15');
  });

  it('[REVERT-FAILS] a ceiling goal says used and allows, and says over in words', () => {
    const v = view([entry('c', { current: 49, target: 30, progressPct: 49 / 30, expectedByNow: 20, onTrack: false }, { direction: 'at_most' })]);
    const c = cat(v, 'Goal c');
    expect(c.mark).toBe(66.7);
    expect(c.note).toMatch(/^49 of a limit of 30 used; the schedule allows 20 by now\. That is more than the schedule allows by now\./);
  });

  it('[REVERT-FAILS] the drawing puts one 2 px tick per scheduled goal on the value axis, and the target rule', () => {
    const v = view([entry('a'), entry('b', { current: 24, progressPct: 0.8, expectedByNow: 27 }), entry('n', { expectedByNow: null, onTrack: null }, { deadline: null })]);
    const { container } = render(<CatPlot series={v.cats!} kind="bars" />);
    const ticks = Array.from(container.querySelectorAll('line.rp-mark'));
    expect(ticks.map((t) => Number(t.getAttribute('data-mark')))).toEqual([50, 90]);
    expect(ticks[0].getAttribute('stroke-width')).toBe('2');
    // On the value axis: the 90 tick is higher on the page than the 50 tick, both inside the plot.
    const y = (t: Element) => Number(t.getAttribute('y1'));
    expect(y(ticks[1])).toBeLessThan(y(ticks[0]));
    for (const t of ticks) expect(y(t)).toBeGreaterThan(0);
    for (const t of ticks) expect(y(t)).toBeLessThan(320);
    expect(container.textContent).toContain('the target');
    expect(container.querySelector('.rp-plot-cap')!.textContent).toContain('the tick is where the schedule says it should be by now');
    fireEvent.focus(container.querySelector('.recharts-surface')!);
    expect(screen.getByTestId('rp-plot-live').textContent).toContain('the schedule says 15 by now');
  });
});
