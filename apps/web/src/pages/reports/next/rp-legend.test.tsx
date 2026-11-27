/**
 * The legend that hides and shows a series (r109 g4). A drawing with two or
 * more series gets one button per series; hiding drops the series, never
 * rescales the y axis, never moves a gutter, and showing it again replays no
 * draw. View-only, so it is gone when "Draw as" changes.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cloneElement, type ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { CatPlot, ComboPlot } from './rp-plot';
import { till, type TillWindow } from './rp-registers-trade';
import type { CatSeries } from './rp-view';

vi.mock('recharts', async () => {
  const actual = await vi.importActual<typeof import('recharts')>('recharts');
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: ReactElement }) =>
      cloneElement(children, { width: 640, height: 320 } as never),
  };
});

const days = ['D1', 'D2', 'D3', 'D4', 'D5'];
/** The prior is far taller than the window, so hiding it WOULD rescale an auto axis. */
const WITH_PRIOR: CatSeries = {
  data: days.map((d, i) => ({ label: d, full: d, value: 100 + i * 20, prior: 900 + i * 25 })),
  xLabel: 'day',
  yLabel: 'Takings',
  unit: 'TL',
  format: (v) => `${v}`,
  priorLabel: 'the prior 30 days',
};
const ALONE: CatSeries = { ...WITH_PRIOR, data: WITH_PRIOR.data.map(({ prior: _p, ...d }) => d), priorLabel: undefined };

const ticks = (c: HTMLElement) =>
  [...c.querySelectorAll('.recharts-yAxis .recharts-cartesian-axis-tick-value')].map((t) => t.textContent);
const hide = (name: string) => fireEvent.click(screen.getByRole('button', { name }));

describe('the legend hides and shows a series', () => {
  it('a single series has no legend', () => {
    render(<CatPlot series={ALONE} kind="line" />);
    expect(screen.queryByRole('group', { name: 'Series drawn' })).toBeNull();
  });

  it('hiding the prior removes the dashed path with the y ticks and the gutter unchanged', () => {
    const { container } = render(<CatPlot series={WITH_PRIOR} kind="line" />);
    const before = ticks(container);
    const axisBefore = container.querySelector('.recharts-yAxis')?.getAttribute('width') ?? container.querySelector('.recharts-yAxis .recharts-cartesian-axis-line')?.outerHTML;
    expect(container.querySelector('.rp-prior')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Hide the prior 30 days' })).toHaveAttribute('aria-pressed', 'true');

    hide('Hide the prior 30 days');
    expect(container.querySelector('.rp-prior')).toBeNull();
    expect(screen.getByRole('button', { name: 'Show the prior 30 days' })).toHaveAttribute('aria-pressed', 'false');
    expect(ticks(container)).toEqual(before);
    expect(container.querySelector('.recharts-yAxis')?.getAttribute('width') ?? container.querySelector('.recharts-yAxis .recharts-cartesian-axis-line')?.outerHTML).toBe(axisBefore);
    expect(screen.getByRole('img').getAttribute('aria-label')).toMatch(/, the prior 30 days hidden/);
  });

  it('the last series still shown cannot be hidden', () => {
    const { container } = render(<CatPlot series={WITH_PRIOR} kind="line" />);
    hide('Hide the prior 30 days');
    const last = screen.getByRole('button', { name: 'Hide takings' });
    expect(last).toHaveAttribute('aria-disabled', 'true');
    expect(last).toHaveAccessibleDescription('One series stays drawn');
    fireEvent.click(last);
    expect(container.querySelector('.recharts-line-curve')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Hide takings' })).toBeInTheDocument();
  });

  it('a re-shown prior is painted at rest: no draw replays', () => {
    const { container } = render(<CatPlot series={WITH_PRIOR} kind="line" />);
    expect(container.querySelector('.rp-prior [data-again]')).toBeNull();
    hide('Hide the prior 30 days');
    hide('Show the prior 30 days');
    expect(container.querySelector('.rp-prior [data-again="true"]')).not.toBeNull();
    const css = readFileSync(resolve(__dirname, 'reports-next.css'), 'utf8');
    expect(css).toMatch(/\.rp-prior:has\(> \[data-again\]\)\s*\{(?:\s*\/\*[^*]*\*\/)?\s*animation:\s*none;/);
    expect(container.querySelector('.recharts-line-curve')?.getAttribute('isAnimationActive')).toBeNull();
  });

  it('it is view-only and goes when Draw as changes', () => {
    const { rerender } = render(<CatPlot series={WITH_PRIOR} kind="line" />);
    hide('Hide the prior 30 days');
    rerender(<CatPlot series={WITH_PRIOR} kind="area" />);
    expect(screen.getByRole('button', { name: 'Hide the prior 30 days' })).toBeInTheDocument();
  });

  it('every button is 44 px tall by padding', () => {
    const css = readFileSync(resolve(__dirname, 'reports-next.css'), 'utf8');
    const rule = css.match(/\.rp-legend__btn\s*\{[^}]*\}/)?.[0] ?? '';
    expect(rule).toMatch(/min-height:\s*44px/);
    expect(rule).toMatch(/padding:\s*14px 8px/);
  });
});

describe('the combination legend', () => {
  const COUNTED = {
    restaurantId: 'r1', from: '2026-11-11', to: '2026-11-13', days: 3, timezone: 'Europe/Istanbul',
    zoneUnset: false, posConnected: true, revenue: 3000, checkCount: 30,
    dailySeries: [
      { date: '2026-11-11', revenue: 1200, checks: 10 },
      { date: '2026-11-12', revenue: 900, checks: 8 },
      { date: '2026-11-13', revenue: 1800, checks: 20 },
    ],
  };
  const series = () => till.view(till.select(COUNTED) as TillWindow, { days: 3, currency: 'TRY' }).cats!;

  it('hiding the line drops it but keeps both axes, their ticks and the gutters', () => {
    const { container } = render(<ComboPlot series={series()} />);
    const axes = () => container.querySelectorAll('.recharts-yAxis').length;
    const all = () => [...container.querySelectorAll('.recharts-yAxis .recharts-cartesian-axis-tick-value')].map((t) => t.textContent);
    const [n, t] = [axes(), all()];
    expect(n).toBe(2);
    expect(container.querySelector('.recharts-line-curve')).not.toBeNull();
    const [bars, line] = screen.getAllByRole('button').filter((b) => /^Hide /.test(b.textContent ?? ''));
    fireEvent.click(line);
    expect(container.querySelector('.recharts-line-curve')).toBeNull();
    expect(container.querySelectorAll('.recharts-bar-rectangle').length).toBeGreaterThan(0);
    expect(axes()).toBe(n);
    expect(all()).toEqual(t);
    expect(screen.getByRole('img').getAttribute('aria-label')).toMatch(/, the line hidden$|the line hidden/);
    expect(bars).toHaveAttribute('aria-disabled', 'true');
  });

  it('hiding the bars keeps the line and both axes', () => {
    const { container } = render(<ComboPlot series={series()} />);
    const t = [...container.querySelectorAll('.recharts-yAxis .recharts-cartesian-axis-tick-value')].map((x) => x.textContent);
    fireEvent.click(screen.getAllByRole('button').filter((b) => /^Hide /.test(b.textContent ?? ''))[0]);
    expect(container.querySelectorAll('.recharts-bar-rectangle').length).toBe(0);
    expect(container.querySelector('.recharts-line-curve')).not.toBeNull();
    expect([...container.querySelectorAll('.recharts-yAxis .recharts-cartesian-axis-tick-value')].map((x) => x.textContent)).toEqual(t);
  });
});
