/**
 * r101 review: bars and a line carry the same cap as every other drawing. The gateway now sends each day's
 * checks at every window, so a 365-day till is offered as bars and a line; it drew 365 bars and 365 dots until
 * `ComboPlot` thinned the way `CatPlot` does (r102 M7). Every bar kept is a real day; the table has every one.
 */
import { cloneElement, type ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { ComboPlot, MAX_DRAWN } from './rp-plot';
import type { CatSeries } from './rp-view';

vi.mock('recharts', async () => {
  const actual = await vi.importActual<typeof import('recharts')>('recharts');
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: ReactElement }) =>
      cloneElement(children, { width: 640, height: 240 } as never),
  };
});

const days = (n: number): CatSeries => ({
  data: Array.from({ length: n }, (_, i) => ({ label: `D${i + 1}`, value: 100 + ((i * 37) % 91) })),
  xLabel: 'day',
  yLabel: 'taken',
  unit: 'taken',
  format: (v) => `${v}`,
  measureLabel: 'Taken',
  measures: [
    { key: 'checks', label: 'Checks', unit: 'checks', format: (v) => `${v}`, values: Array.from({ length: n }, (_, i) => 10 + (i % 5)) },
  ],
});
const bars = (c: HTMLElement) => c.querySelectorAll('.recharts-bar-rectangle > path').length;

describe('bars and a line over a long window', () => {
  it('[REVERT-FAILS] 365 days draw at most MAX_DRAWN bars and say how many of the days are drawn', () => {
    const { container } = render(<ComboPlot series={days(365)} />);
    expect(bars(container)).toBeGreaterThan(0);
    expect(bars(container)).toBeLessThanOrEqual(MAX_DRAWN);
    expect(container.textContent).toMatch(/\d+ of 365, the highest of each stretch; the table has every one/);
  });

  it('a short window is drawn whole and says nothing about thinning', () => {
    const { container } = render(<ComboPlot series={days(40)} />);
    expect(bars(container)).toBe(40);
    expect(container.textContent).not.toMatch(/the highest of each stretch/);
  });
});
