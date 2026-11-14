/**
 * A value axis's title stands on the middle of its axis and fits the drawing
 * (r33 walk R-F1). recharts anchored a rotated title at one end, so on the
 * till's bars and a line (a 130 px cutting) "Average check" ran from the
 * axis's middle up past the top edge, where `.rp-plot` clips it, and read
 * "ge check". jsdom does not lay out text, so these pin the anchor, the
 * centre and the glyph estimate; the browser check is in the r35 build doc.
 */
import { cloneElement, type ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { CatPlot, ComboPlot, PointPlot, SideTitle, fitTitle } from './rp-plot';
import type { CatSeries, PointSeries } from './rp-view';

let size = { width: 320, height: 130 };
vi.mock('recharts', async () => {
  const actual = await vi.importActual<typeof import('recharts')>('recharts');
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: ReactElement }) =>
      cloneElement(children, size as never),
  };
});

const n = (v: number) => String(v);
/** The till's shape: Taken in bars, the average check as the other measure. */
const till: CatSeries = {
  data: [
    { label: 'Mon', value: 4200 },
    { label: 'Tue', value: 3900 },
    { label: 'Wed', value: 5100 },
  ],
  xLabel: 'day',
  yLabel: 'taken',
  unit: '₺',
  format: n,
  measureLabel: 'Taken',
  measures: [{ key: 'avg', label: 'Average check', unit: '₺ a check', format: n, values: [210, 195, 240] }],
};
const points: PointSeries = {
  data: [{ name: 'Rakı', x: 1, y: 2 }],
  xLabel: 'bottles a day',
  yLabel: 'margin a bottle',
  formatX: n,
  formatY: n,
} as PointSeries;

/** The glyph estimate the plot uses (9 px mono, 0.08em tracking). */
const GLYPH = 9 * 0.68;

const titles = (c: HTMLElement) => Array.from(c.querySelectorAll<SVGTextElement>('text.rp-axis-title'));

function centredAndInside(t: SVGTextElement) {
  const x = Number(t.getAttribute('x'));
  const y = Number(t.getAttribute('y'));
  const side = t.getAttribute('data-side');
  expect(t.getAttribute('text-anchor')).toBe('middle');
  expect(t.getAttribute('transform')).toBe(`rotate(${side === 'left' ? -90 : 90}, ${x}, ${y})`);
  // What is drawn, without the <title> a shortened one carries.
  const drawn = (t.textContent ?? '').slice((t.querySelector('title')?.textContent ?? '').length);
  const half = (drawn.length * GLYPH) / 2;
  expect(y - half).toBeGreaterThanOrEqual(0);
  expect(y + half).toBeLessThanOrEqual(size.height);
  return { x, y, side, text: drawn };
}

describe('a value axis title stands on the middle of its axis', () => {
  it('[REVERT-FAILS] the till drawn as bars and a line keeps "Average check" whole on a 130 px cutting', () => {
    size = { width: 320, height: 130 };
    const { container } = render(<ComboPlot series={till} />);
    const ts = titles(container).map(centredAndInside);
    expect(ts.map((t) => [t.side, t.text])).toEqual([
      ['left', 'Taken'],
      ['right', 'Average check'],
    ]);
    // The right title stands in the outer half of the right axis (52 px wide,
    // inside a 2 px margin), the left one in the outer half of the left.
    const right = ts.find((t) => t.side === 'right');
    const left = ts.find((t) => t.side === 'left');
    expect(right!.x).toBeGreaterThan(size.width - 2 - 52 / 2);
    expect(right!.x).toBeLessThan(size.width);
    expect(left!.x).toBeLessThan(2 + 52 / 2);
    // No title is left anchored at one end by recharts' own Label.
    expect(container.querySelector('text.recharts-label[text-anchor="end"]')).toBeNull();
  });

  it.each([
    ['bars', () => <CatPlot series={till} kind="bars" />],
    ['a line', () => <CatPlot series={till} kind="line" />],
    ['points', () => <PointPlot series={points} />],
  ])('%s: the value title is centred too', (_name, draw) => {
    size = { width: 320, height: 130 };
    const { container } = render(draw());
    const ts = titles(container).map(centredAndInside);
    expect(ts).toHaveLength(1);
    expect(ts[0].side).toBe('left');
  });

  it('a drawing too short for the whole title shortens it and keeps the name for a pointer', () => {
    size = { width: 320, height: 60 };
    const { container } = render(<ComboPlot series={till} />);
    const right = titles(container).find((t) => t.getAttribute('data-side') === 'right')!;
    centredAndInside(right);
    expect(right.textContent).toMatch(/…$/);
    expect(right.querySelector('title')?.textContent).toBe('Average check');
  });
});

describe('fitTitle', () => {
  it('keeps a title that fits, shortens one that does not, and drops one with no room', () => {
    expect(fitTitle('Average check', 13 * GLYPH + 0.5)).toBe('Average check');
    expect(fitTitle('Average check', 13 * GLYPH - 1)).toBe('Average che…');
    expect(fitTitle('Average check', 8 * GLYPH + 0.5)).toBe('Average…');
    expect(fitTitle('Average check', 2 * GLYPH + 0.5)).toBe('A…');
    expect(fitTitle('Average check', 2 * GLYPH - 1)).toBe('');
  });

  it('a title with no room draws nothing rather than an ellipsis', () => {
    const { container } = render(
      <svg>
        <SideTitle viewBox={{ x: 0, y: 0, width: 52, height: 4 }} text="Average check" side="right" />
      </svg>,
    );
    expect(container.querySelector('text')).toBeNull();
  });

  it('draws nothing without the axis box recharts passes', () => {
    const { container } = render(
      <svg>
        <SideTitle text="Average check" side="left" />
      </svg>,
    );
    expect(container.querySelector('text')).toBeNull();
  });
});
