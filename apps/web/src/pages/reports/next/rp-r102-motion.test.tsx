/**
 * r102 motion needs on /reports: the grid's stock transitions are off, the bar
 * rise plays once and rests, the stagger fits one sweep for any count, and a
 * long till window draws at most MAX_DRAWN points. jsdom runs no animation, so
 * the state attribute the stylesheet hangs the rise on, and the stylesheet's
 * own rules, are what is pinned.
 */
import { cloneElement, type ReactElement } from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import { CatPlot, HOLD_OVER, MAX_DRAWN, thinCats } from './rp-plot';
import { DrawKey, RISE_MS, forgetRisen } from './rp-draw';
import type { CatSeries } from './rp-view';

let width = 420;
vi.mock('recharts', async () => {
  const actual = await vi.importActual<typeof import('recharts')>('recharts');
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: ReactElement }) =>
      cloneElement(children, { width, height: 200 } as never),
  };
});

const css = readFileSync(resolve(__dirname, 'reports-next.css'), 'utf8');
const md = readFileSync(resolve(__dirname, 'MOTIONS.md'), 'utf8');

type Cb = (e: Array<{ isIntersecting: boolean }>) => void;
let seen: Cb[];
beforeEach(() => {
  seen = [];
  forgetRisen();
  width = 420;
  vi.useFakeTimers();
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(cb: Cb) {
        seen.push(cb);
      }
      observe() {}
      disconnect() {}
    },
  );
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const series = (n: number): CatSeries => ({
  data: Array.from({ length: n }, (_, i) => ({ label: `D${i + 1}`, value: 100 + ((i * 37) % 91) })),
  xLabel: 'day',
  yLabel: 'taken',
  unit: '₺',
  format: (v) => `₺${v}`,
});
const plot = (c: HTMLElement) => c.querySelector('.rp-plot') as HTMLElement;
const bars = (c: HTMLElement) => c.querySelectorAll('.recharts-bar-rectangle > path').length;

describe('the grid does not tween', () => {
  it('[REVERT-FAILS] react-grid-layout transitions are off at three classes deep, for every reader', () => {
    expect(css).toMatch(
      /\.rp-sheet \.react-grid-layout,\s*\.rp-sheet \.react-grid-layout > \.react-grid-item,\s*\.rp-sheet \.react-grid-layout > \.react-grid-item\.cssTransforms \{\s*transition: none;/,
    );
  });
});

describe('the rise plays once and rests', () => {
  it('[REVERT-FAILS] drawn becomes settled after the longest rise, and no rule animates settled', () => {
    const { container } = render(
      <DrawKey.Provider value="till:bars"><CatPlot series={series(5)} kind="bars" /></DrawKey.Provider>,
    );
    act(() => seen[0]([{ isIntersecting: true }]));
    expect(plot(container).dataset.draw).toBe('drawn');
    act(() => void vi.advanceTimersByTime(RISE_MS - 1));
    expect(plot(container).dataset.draw).toBe('drawn');
    act(() => void vi.advanceTimersByTime(1));
    expect(plot(container).dataset.draw).toBe('settled');
    expect(css).not.toMatch(/data-draw='settled'/);
  });

  it('[REVERT-FAILS] a resize that makes new bars leaves the plot settled, so nothing replays', () => {
    const ui = (
      <DrawKey.Provider value="till:bars"><CatPlot series={series(5)} kind="bars" /></DrawKey.Provider>
    );
    const { container, rerender } = render(ui);
    act(() => seen[0]([{ isIntersecting: true }]));
    act(() => void vi.advanceTimersByTime(RISE_MS));
    width = 300;
    rerender(ui);
    expect(bars(container)).toBe(5);
    expect(plot(container).dataset.draw).toBe('settled');
  });

  it('[REVERT-FAILS] a remount of the same cutting and drawing starts settled; another drawing still rises', () => {
    const a = render(<DrawKey.Provider value="till:bars"><CatPlot series={series(5)} kind="bars" /></DrawKey.Provider>);
    act(() => seen[0]([{ isIntersecting: true }]));
    a.unmount();
    const b = render(<DrawKey.Provider value="till:bars"><CatPlot series={series(5)} kind="bars" /></DrawKey.Provider>);
    expect(plot(b.container).dataset.draw).toBe('settled');
    const c = render(<DrawKey.Provider value="till:combo"><CatPlot series={series(5)} kind="bars" /></DrawKey.Provider>);
    expect(plot(c.container).dataset.draw).toBe('pending');
  });
});

describe('one sweep for any count', () => {
  it('[REVERT-FAILS] each bar carries the count, and the sweep plus one rise is the budget', () => {
    const { container } = render(<CatPlot series={series(30)} kind="bars" />);
    const n = Array.from(container.querySelectorAll<SVGPathElement>('.recharts-bar-rectangle > path')).map((p) =>
      p.style.getPropertyValue('--rp-n'),
    );
    expect(new Set(n)).toEqual(new Set(['30']));
    expect(RISE_MS).toBe(160 + 360);
    expect(css).toMatch(/\.rp-plot\[data-draw='drawn'\] \.rp-bar-value \{\s*animation: rp-value-in 160ms ease-out 360ms both;/);
  });

  it('MOTIONS.md names the rise and no longer says no chart animates in', () => {
    expect(md).toMatch(/rp-grow/);
    expect(md).not.toMatch(/No chart animates in\./);
  });
});

describe('a long window draws a bounded number of points', () => {
  it('[REVERT-FAILS] 365 days draw at most MAX_DRAWN bars, keep the first, last and highest, and say so', () => {
    const s = series(365);
    const { container } = render(<CatPlot series={s} kind="bars" />);
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(bars(container)).toBeGreaterThan(HOLD_OVER);
    expect(bars(container)).toBeLessThanOrEqual(MAX_DRAWN);
    const kept = thinCats(s.data);
    expect(kept[0]).toBe(s.data[0]);
    expect(kept[kept.length - 1]).toBe(s.data[364]);
    expect(Math.max(...kept.map((d) => d.value ?? 0))).toBe(Math.max(...s.data.map((d) => d.value ?? 0)));
    expect(container.textContent).toMatch(new RegExp(`${kept.length} of 365`));
  });

  it('keeps the seam where measurement stops, and leaves a short series alone', () => {
    const data = Array.from({ length: 300 }, (_, i) => ({
      label: `D${i}`,
      value: i < 200 ? i : null,
      projected: i >= 199 ? i : null,
    }));
    const kept = thinCats(data, [{ x: 'D199' }]);
    expect(kept.length).toBeLessThanOrEqual(MAX_DRAWN);
    expect(kept.map((d) => d.label)).toContain('D199');
    expect(kept.map((d) => d.label)).toContain('D200');
    const short = series(40).data;
    expect(thinCats(short)).toBe(short);
  });
});

describe('a heavy plot answers in the first frame and mounts its bars after (r103)', () => {
  const flush = () =>
    act(() => {
      vi.advanceTimersByTime(100);
    });

  it('[REVERT-FAILS] 365 days: the first commit holds the slot, caption and label; the bars come a task later', () => {
    const { container } = render(<CatPlot series={series(365)} kind="bars" />);
    expect(plot(container)).not.toBeNull();
    expect(plot(container).getAttribute('aria-label')).toMatch(/taken by day/);
    expect(container.textContent).toMatch(/of 365/);
    expect(bars(container)).toBe(0);
    flush();
    expect(bars(container)).toBeGreaterThan(HOLD_OVER);
  });

  it('[REVERT-FAILS] switching a light window to a heavy one holds again; a light one never waits', () => {
    const { container, rerender } = render(<CatPlot series={series(30)} kind="bars" />);
    expect(bars(container)).toBe(30);
    rerender(<CatPlot series={series(365)} kind="bars" />);
    expect(bars(container)).toBe(0);
    flush();
    expect(bars(container)).toBeGreaterThan(HOLD_OVER);
    rerender(<CatPlot series={series(90)} kind="bars" />);
    expect(bars(container)).toBe(90);
  });
});
