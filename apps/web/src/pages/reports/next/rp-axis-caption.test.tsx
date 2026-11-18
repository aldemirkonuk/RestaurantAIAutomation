/**
 * A plot names what it draws once, in a caption above it (N-03, r58). The
 * rotated value-axis titles sat on the tick labels ("paid to" over "$3.4K"),
 * so they are gone; ticks are 11 px tabular, the left gutter is worked out from
 * the widest tick, and the plot's spoken name carries the one-sentence reading.
 * jsdom does not lay out text, so these pin the structure and the numbers the
 * layout is built from; the browser check is in the r58 build doc.
 */
import { cloneElement, type ReactElement } from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { CatPlot, ComboPlot, PointPlot, gutterFor, readingOf, tipWrapper } from './rp-plot';
import type { CatSeries, PointSeries } from './rp-view';

vi.mock('recharts', async () => {
  const actual = await vi.importActual<typeof import('recharts')>('recharts');
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: ReactElement }) =>
      cloneElement(children, { width: 320, height: 160 } as never),
  };
});

const money = (v: number) => `₺${v >= 1000 ? `${(v / 1000).toFixed(1)}K` : v}`;
const till: CatSeries = {
  data: [
    { label: 'Mon', value: 4200 },
    { label: 'Tue', value: 3900 },
    { label: 'Wed', value: 5100 },
  ],
  xLabel: 'day',
  yLabel: 'taken',
  unit: '₺ taken',
  format: money,
  measureLabel: 'Taken',
  measures: [{ key: 'avg', label: 'Average check', unit: '₺ a check', format: String, values: [210, 195, 240] }],
};
const points: PointSeries = {
  data: [{ name: 'Rakı', x: 1, y: 2 }],
  xLabel: 'bottles a day',
  yLabel: 'margin a bottle',
  formatX: String,
  formatY: String,
} as PointSeries;

const draws: Array<[string, () => JSX.Element]> = [
  ['bars', () => <CatPlot series={till} kind="bars" />],
  ['a line', () => <CatPlot series={till} kind="line" />],
  ['an area', () => <CatPlot series={till} kind="area" />],
  ['bars and a line', () => <ComboPlot series={till} />],
  ['points', () => <PointPlot series={points} />],
];

describe('the plot names its axes in one caption, not on the ticks (N-03)', () => {
  it.each(draws)('[REVERT-FAILS] %s: no rotated title is drawn', (_n, draw) => {
    const { container } = render(draw());
    expect(container.querySelector('text.rp-axis-title')).toBeNull();
    expect(container.querySelector('text[transform*="rotate"]')).toBeNull();
  });

  it('[REVERT-FAILS] says what is drawn once above the plot, before the plot in the document', () => {
    const { container } = render(<CatPlot series={till} kind="bars" />);
    const cap = container.querySelector('.rp-plot-cap');
    expect(cap?.textContent).toBe('Taken, ₺ taken · by day');
    expect(cap!.compareDocumentPosition(container.querySelector('.rp-plot')!)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it('a unit that only repeats the name is not said twice, and the combination names both measures', () => {
    const same = { ...till, unit: 'taken' };
    const a = render(<CatPlot series={same} kind="line" />);
    expect(a.container.querySelector('.rp-plot-cap')?.textContent).toBe('Taken · by day');
    a.unmount();
    const b = render(<ComboPlot series={till} />);
    expect(b.container.querySelector('.rp-plot-cap')?.textContent).toBe(
      'Taken, ₺ taken (bars, left) · Average check, ₺ a check (line, right) · by day',
    );
  });

  it.each(draws)('[REVERT-FAILS] %s: every tick is 11 px', (_n, draw) => {
    const { container } = render(draw());
    const ticks = Array.from(container.querySelectorAll('.recharts-cartesian-axis-tick-value'));
    expect(ticks.length).toBeGreaterThan(0);
    for (const t of ticks) expect(t.getAttribute('font-size')).toBe('11');
  });

  it('draws no axis line and the grid is a hairline at 6% ink', () => {
    const { container } = render(<CatPlot series={till} kind="bars" />);
    expect(container.querySelector('.recharts-cartesian-axis-line')).toBeNull();
    const grid = container.querySelector('.recharts-cartesian-grid-horizontal line');
    expect(grid?.getAttribute('stroke-opacity')).toBe('0.06');
  });
});

describe('the left gutter is worked out from the widest tick (N-03)', () => {
  it('[REVERT-FAILS] grows with the label and never goes under 32 px', () => {
    expect(gutterFor(['0'])).toBe(32);
    expect(gutterFor(['₺0', '₺3.4K', '₺4.1K'])).toBeGreaterThan(gutterFor(['0', '9']));
    expect(gutterFor(['₺1,234,567'])).toBeGreaterThan(gutterFor(['₺1,234']));
    // five glyphs at 11 px mono, a touch generous, plus the 8 px breath
    expect(gutterFor(['₺3.4K'])).toBe(Math.ceil(5 * 11 * 0.62) + 8);
  });

  it('the tooltip is bounded by the plot gutter it actually has', () => {
    expect(tipWrapper(44).maxWidth).toBe('calc(100% - 46px)');
    expect(tipWrapper(60).maxWidth).toBe('calc(100% - 62px)');
  });

  it('a plot of long figures gets a wider axis than one of short figures', () => {
    const wide = { ...till, data: till.data.map((d) => ({ ...d, value: (d.value ?? 0) * 1000 })) };
    const narrow = render(<CatPlot series={till} kind="bars" />);
    const w1 = Number(narrow.container.querySelector('.recharts-yAxis .recharts-cartesian-axis-tick-value')?.getAttribute('x'));
    narrow.unmount();
    const long = render(<CatPlot series={{ ...wide, format: (v) => `₺${v.toLocaleString('en')}` }} kind="bars" />);
    const w2 = Number(long.container.querySelector('.recharts-yAxis .recharts-cartesian-axis-tick-value')?.getAttribute('x'));
    // ticks are right-aligned to the plot's left edge: a wider gutter pushes it right
    expect(w2).toBeGreaterThan(w1);
  });
});

describe('the plot carries a one-sentence reading for a screen reader (N-03)', () => {
  it('[REVERT-FAILS] names the highest and the lowest point', () => {
    const { container } = render(<CatPlot series={till} kind="bars" />);
    const label = container.querySelector('.rp-plot')?.getAttribute('aria-label') ?? '';
    expect(label).toContain('Highest Wed, ₺5.1K ₺ taken; lowest Tue, ₺3.9K ₺ taken');
    expect(container.querySelector('.rp-plot')?.getAttribute('role')).toBe('img');
  });

  it('says nothing about a high and a low when there is only one point, and says "every point" when flat', () => {
    expect(readingOf([{ label: 'Mon', v: 5 }], String, 'x')).toBe('');
    expect(readingOf([{ label: 'Mon', v: null }, { label: 'Tue', v: 5 }], String, 'x')).toBe('');
    expect(readingOf([{ label: 'Mon', v: 5 }, { label: 'Tue', v: 5 }], String, 'x')).toBe('. Every point is 5 x');
  });
});

describe('the caption is 11 px at 60% ink', () => {
  it('[REVERT-FAILS] says so in the stylesheet', () => {
    const css = readFileSync(resolve(__dirname, 'reports-next.css'), 'utf8');
    const rule = /\.rp-plot-cap\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(rule).toMatch(/font-size:\s*11px/);
    expect(rule).toMatch(/var\(--ink-1\)\s*60%/);
  });
});
