/** The first x label no longer prints over the value axis's "0" (r61, c2, need 10). */
import { cloneElement, type ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { CatPlot, X_ORIGIN_PAD } from './rp-plot';
import type { CatSeries } from './rp-view';

vi.mock('recharts', async () => {
  const actual = await vi.importActual<typeof import('recharts')>('recharts');
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: ReactElement }) =>
      cloneElement(children, { width: 420, height: 200 } as never),
  };
});

const series: CatSeries = {
  data: [
    { label: 'Oct 20', value: 0 },
    { label: 'Oct 21', value: 120 },
    { label: 'Oct 22', value: 90 },
  ],
  xLabel: 'day',
  yLabel: 'Taken',
  unit: 'taken',
  format: (v) => `$${v}`,
};

/** x of the first tick label of an axis, from the rendered text node. */
const firstX = (el: Element, axis: 'xAxis' | 'yAxis') =>
  Number(el.querySelector(`.recharts-${axis} .recharts-cartesian-axis-tick text`)?.getAttribute('x'));

describe('chart origin', () => {
  it('[REVERT-FAILS] a line keeps room between the value axis and its first x label', () => {
    expect(X_ORIGIN_PAD.left).toBeGreaterThanOrEqual(18);
    const { container } = render(<CatPlot series={series} kind="line" />);
    const yTick = firstX(container, 'yAxis');
    const x0 = firstX(container, 'xAxis');
    // Half of "Oct 20" at 11 px mono is about 18 px: its left edge must clear the y gutter's tick.
    expect(x0 - 18).toBeGreaterThanOrEqual(yTick);
  });

  it('bars keep the band, with no extra padding', () => {
    const { container } = render(<CatPlot series={series} kind="bars" />);
    expect(firstX(container, 'xAxis')).toBeGreaterThan(0);
  });
});
