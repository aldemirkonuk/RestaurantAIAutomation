/**
 * Bars and a line on one set of points (founder /goal 2026-11-07).
 *
 * The planning rules are pure and tested as such; the drawing is rendered with
 * recharts' ResponsiveContainer given a real size (jsdom measures every box as
 * zero, so the chart would otherwise draw nothing at all).
 */

import { cloneElement, type ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { choose, comboMeasures, planCombo, resolvePick } from './rp-combo';
import { ComboPlot } from './rp-plot';
import type { CatSeries } from './rp-view';

vi.mock('recharts', async () => {
  const actual = await vi.importActual<typeof import('recharts')>('recharts');
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: ReactElement }) =>
      cloneElement(children, { width: 640, height: 320 } as never),
  };
});

const n = (v: number) => String(v);

/** Five days; day 3 has no row at all (null in both), day 4 has bars only. */
function series(over: Partial<CatSeries> = {}): CatSeries {
  return {
    data: [
      { label: 'Mon', value: 10, full: 'Monday' },
      { label: 'Tue', value: 12, full: 'Tuesday' },
      { label: 'Wed', value: null, full: 'Wednesday' },
      { label: 'Thu', value: 9, full: 'Thursday' },
      { label: 'Fri', value: 14, full: 'Friday' },
    ],
    xLabel: 'weekday',
    yLabel: 'bottles/day',
    unit: 'bottles/day',
    format: n,
    measureLabel: 'Mean per day',
    measures: [
      { key: 'seen', label: 'Days seen', unit: 'days', format: n, values: [12, 11, null, null, 12] },
    ],
    ...over,
  };
}

describe('planning a bars-and-line drawing', () => {
  it('needs a second measure; one measure alone is not a combination', () => {
    expect(comboMeasures(series({ measures: undefined }))).toBeNull();
    expect(comboMeasures(series({ measures: [] }))).toBeNull();
    expect(planCombo(series({ measures: undefined }))).toBeNull();
  });

  it('puts different units on two axes and the same unit on one', () => {
    const split = planCombo(series());
    expect(split?.split).toBe(true);
    expect(split?.bars.unit).toBe('bottles/day');
    expect(split?.line.unit).toBe('days');

    const sameUnit = planCombo(
      series({
        measures: [
          { key: 'spread', label: 'Spread', unit: 'bottles/day', format: n, values: [1, 2, null, 1, 3] },
        ],
      }),
    );
    expect(sameUnit?.split).toBe(false);
  });

  it('keeps a missing value as null in both series, never zero', () => {
    const plan = planCombo(series());
    expect(plan?.rows.map((r) => r.bar)).toEqual([10, 12, null, 9, 14]);
    expect(plan?.rows.map((r) => r.line)).toEqual([12, 11, null, null, 12]);
  });

  it('defaults to the first two measures and never names one twice', () => {
    const measures = comboMeasures(series())!;
    expect(resolvePick(measures)).toEqual({ bars: 'value', line: 'seen' });
    expect(resolvePick(measures, { bars: 'seen', line: 'seen' })).toEqual({ bars: 'seen', line: 'value' });
    expect(resolvePick(measures, { bars: 'gone', line: 'gone' })).toEqual({ bars: 'value', line: 'seen' });
    // Choosing the line's measure for the bars trades the two places.
    expect(choose({ bars: 'value', line: 'seen' }, 'bars', 'seen')).toEqual({ bars: 'seen', line: 'value' });
  });
});

/** Bars with any height at all — a null day must not stand as a zero-height bar's twin. */
const barsDrawn = (c: HTMLElement) =>
  Array.from(c.querySelectorAll('.recharts-bar-rectangle path, .recharts-bar-rectangle rect')).filter(
    (e) => Number(e.getAttribute('height') ?? 0) > 0,
  ).length;

describe('the bars-and-line drawing', () => {
  it('draws both series: a bar per recorded point and a line through them', () => {
    const { container } = render(<ComboPlot series={series()} />);
    expect(barsDrawn(container)).toBe(4);
    expect(container.querySelector('.recharts-line-curve')).not.toBeNull();
  });

  it('breaks the line at a missing day instead of dropping it to zero', () => {
    const { container } = render(<ComboPlot series={series()} />);
    const d = container.querySelector('.recharts-line-curve')?.getAttribute('d') ?? '';
    // Mon-Tue, a break, then Fri alone: two separate strokes.
    expect((d.match(/M/g) ?? []).length).toBe(2);
  });

  it('gives a different unit its own right-hand axis, named in words', () => {
    const { container } = render(<ComboPlot series={series()} />);
    expect(container.querySelectorAll('.recharts-yAxis').length).toBe(2);
    expect(container.querySelector('.recharts-yAxis.yAxis.recharts-yAxis')).not.toBeNull();
    expect(
      screen.getByText(/Bars: Mean per day \(bottles\/day\), on the left scale\. Line: Days seen \(days\), on the right scale\./),
    ).toBeInTheDocument();
  });

  it('does not repeat a unit that only echoes the measure’s name', () => {
    const echo = series({
      measureLabel: 'Taken',
      unit: 'taken',
      measures: [{ key: 'checks', label: 'Checks', unit: 'checks', format: n, values: [1, 2, null, 1, 3] }],
    });
    render(<ComboPlot series={echo} />);
    expect(screen.getByText('Bars: Taken, on the left scale. Line: Checks, on the right scale.')).toBeInTheDocument();
  });

  it('shares one axis when the unit is the same', () => {
    const same = series({
      measures: [
        { key: 'spread', label: 'Spread', unit: 'bottles/day', format: n, values: [1, 2, null, 1, 3] },
      ],
    });
    const { container } = render(<ComboPlot series={same} />);
    expect(container.querySelectorAll('.recharts-yAxis').length).toBe(1);
    expect(screen.getByText(/Both are in bottles\/day, so they share one scale\./)).toBeInTheDocument();
  });

  it('offers a picker only past two measures, and trading places keeps both', () => {
    const { rerender } = render(<ComboPlot series={series()} />);
    expect(screen.queryByLabelText('Bars show')).toBeNull();

    const three = series({
      measures: [
        { key: 'spread', label: 'Spread', unit: 'bottles/day', format: n, values: [1, 2, null, 1, 3] },
        { key: 'seen', label: 'Days seen', unit: 'days', format: n, values: [12, 11, null, null, 12] },
      ],
    });
    rerender(<ComboPlot series={three} />);
    const bars = screen.getByLabelText('Bars show') as HTMLSelectElement;
    const line = screen.getByLabelText('Line shows') as HTMLSelectElement;
    expect([bars.value, line.value]).toEqual(['value', 'spread']);
    fireEvent.change(bars, { target: { value: 'spread' } });
    expect([bars.value, line.value]).toEqual(['spread', 'value']);
  });
});
