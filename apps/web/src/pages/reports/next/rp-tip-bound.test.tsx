/**
 * The hover detail stays on the plot (audit G16, r28 gap 18). `.rp-plot`
 * clips whatever runs past its edge, and recharts only keeps a tooltip at or
 * right of the plotting area's left edge: one wider than the room right of
 * that edge lost its end. Every drawing's tooltip is bounded to that room and
 * a long name wraps. ResponsiveContainer is given a real size, as in
 * `rp-combo.test.tsx`; jsdom does not lay out, so the bound itself (not a
 * measured box) is what these pin. The browser check is in the r32 build doc.
 */
import { cloneElement, type ReactElement } from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { CatPlot, ComboPlot, PointPlot, TIP_WRAPPER } from './rp-plot';
import type { CatSeries, PointSeries } from './rp-view';

vi.mock('recharts', async () => {
  const actual = await vi.importActual<typeof import('recharts')>('recharts');
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: ReactElement }) =>
      cloneElement(children, { width: 320, height: 160 } as never),
  };
});

const n = (v: number) => String(v);
const cats: CatSeries = {
  data: [
    { label: 'Öküz…', value: 4, full: 'Öküzgözü Kalecik Karası Reserve 2019, magnum from the cellar' },
    { label: 'Rakı', value: 6, full: 'Rakı' },
  ],
  xLabel: 'good',
  yLabel: 'bottles',
  unit: 'bottles',
  format: n,
  measureLabel: 'Bottles',
  measures: [{ key: 'seen', label: 'Days seen', unit: 'days', format: n, values: [3, 5] }],
};
const points: PointSeries = {
  data: [{ name: 'Öküzgözü Kalecik Karası Reserve 2019', x: 1, y: 2 }],
  xLabel: 'bottles a day',
  yLabel: 'margin',
  formatX: n,
  formatY: n,
} as PointSeries;

const wrappers = (c: HTMLElement) =>
  Array.from(c.querySelectorAll<HTMLElement>('.recharts-tooltip-wrapper'));

describe('the hover detail is bounded to the plot (r28 gap 18)', () => {
  it('[REVERT-FAILS] is never wider than the room right of the value axis', () => {
    // The left margin (2) and the value axis (52).
    expect(TIP_WRAPPER.maxWidth).toBe('calc(100% - 54px)');
  });

  it.each([
    ['bars', () => <CatPlot series={cats} kind="bars" />],
    ['a line', () => <CatPlot series={cats} kind="line" />],
    ['an area', () => <CatPlot series={cats} kind="area" />],
    ['bars and a line', () => <ComboPlot series={cats} />],
    ['points', () => <PointPlot series={points} />],
  ])('[REVERT-FAILS] %s: the tooltip wrapper carries the bound', (_name, draw) => {
    const { container } = render(draw());
    const ws = wrappers(container);
    expect(ws.length).toBe(1);
    expect(ws[0].style.maxWidth).toBe('calc(100% - 54px)');
  });

  it('[REVERT-FAILS] a long name wraps inside the tooltip instead of running on', () => {
    const css = readFileSync(resolve(__dirname, 'reports-next.css'), 'utf8');
    const rule = /\.rp-tip\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(rule).toMatch(/max-width:\s*100%/);
    expect(rule).toMatch(/overflow-wrap:\s*anywhere/);
    expect(rule).toMatch(/white-space:\s*normal/);
  });
});
