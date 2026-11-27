/**
 * "Draw only these days" (r110 g1) on the full-screen drawing: a read stretch
 * of two days or more offers the zoom, the zoom draws every day of it (no
 * thinning), its caption says which, it paints at rest (no `rp-grow` replay),
 * the stretch inside it names the window's own days, and "All 365 days" or
 * Escape goes back. A window, a Draw as or a withheld read drops it.
 */
import { cloneElement, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('recharts', async () => {
  const actual = await vi.importActual<typeof import('recharts')>('recharts');
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: ReactElement }) =>
      cloneElement(children, { width: 1376, height: 460 } as never),
  };
});

import { FlatCats, thinCats } from './rp-plot';
import { daysBetween, till, type TillWindow } from './rp-registers-trade';
import type { CatSeries } from './rp-view';

class StillObserver {
  observe() {}
  disconnect() {}
  unobserve() {}
}
beforeEach(() => vi.stubGlobal('IntersectionObserver', StillObserver));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const DAYS = daysBetween('2025-11-28', '2026-11-27');
const read = (days: string[], extra: object = {}) =>
  till.select({
    posConnected: true,
    revenue: 1,
    checkCount: 1,
    from: days[0],
    to: days[days.length - 1],
    days: days.length,
    timezone: 'Europe/Istanbul',
    dailySeries: days.map((date, i) => ({ date, revenue: 100 + ((i * 37) % 500), checks: 1 + (i % 20) })),
    ...extra,
  }) as TillWindow;
const year = (): CatSeries => till.view(read(DAYS), { days: 365, currency: 'USD' }).cats!;

const surface = (c: HTMLElement) => c.querySelector('.recharts-surface') as SVGElement;
const bars = (c: HTMLElement) => c.querySelectorAll('.recharts-bar-rectangle').length;
const plot = (c: HTMLElement) => c.querySelector('.rp-plot') as HTMLElement;
const key = (el: Element, k: 'ArrowRight' | 'ArrowLeft', shiftKey = false) => fireEvent.keyDown(el, { key: k, shiftKey });

/** Plain Right `from` times, then Shift+Right `over` times: a stretch from drawn row `from` to `from + over`. */
async function markStretch(c: HTMLElement, from: number, over: number) {
  await waitFor(() => expect(surface(c)).not.toBeNull());
  fireEvent.focus(surface(c));
  for (let i = 0; i < from; i++) key(surface(c), 'ArrowRight');
  for (let i = 0; i < over; i++) key(surface(c), 'ArrowRight', true);
}

describe('full screen draws only the marked days', () => {
  it('[REVERT-FAILS] a stretch offers the zoom; the zoom draws every day of it, says which, paints at rest; All 365 days restores', async () => {
    const all = year();
    const thin = thinCats(all.data, all.refs);
    const drawn = thin.length;
    // 365 days are thinned to the highest of each run outside a zoom (MAX_DRAWN, r102 M7).
    expect(thin.length).toBeGreaterThan(100);
    expect(thin.length).toBeLessThan(365);
    const { container } = render(<FlatCats series={all} kind="bars" />);
    // The 44 px row is reserved before anything is marked, empty.
    expect(container.querySelector('.rp-zoom')).not.toBeNull();
    expect(screen.queryByRole('button', { name: /Draw only these/ })).toBeNull();
    await waitFor(() => expect(bars(container)).toBe(drawn));
    expect(plot(container)).toHaveAttribute('data-draw', 'pending');

    await markStretch(container, 4, 14);
    const lo = all.data.indexOf(thin[4]);
    const hi = all.data.indexOf(thin[18]);
    expect(lo).toBeGreaterThan(0);
    const n = hi - lo + 1;
    expect(n).toBeGreaterThan(14); // more days than were drawn between them
    const draw = screen.getByRole('button', { name: `Draw only these ${n} days` });
    fireEvent.click(draw);

    expect(bars(container)).toBe(n);
    expect(container.querySelector('.rp-plot-cap')!.textContent).toBe(
      `Taken · by day · ${n} of 365 days, ${all.data[lo].label} to ${all.data[hi].label}`,
    );
    expect(plot(container)).toHaveAttribute('data-draw', 'settled');
    const back = screen.getByRole('button', { name: 'All 365 days' });
    expect(document.activeElement).toBe(back);

    // The stretch inside the zoom names the window's own days.
    await markStretch(container, 3, 2);
    expect(container.querySelector('.rp-stretch')!.textContent).toBe(all.stretch!(lo + 3, lo + 5));

    fireEvent.click(screen.getByRole('button', { name: 'All 365 days' }));
    await waitFor(() => expect(bars(container)).toBe(drawn));
    expect(plot(container)).toHaveAttribute('data-draw', 'settled');
    expect(screen.queryByRole('button', { name: 'All 365 days' })).toBeNull();
  });

  it('[REVERT-FAILS] Escape with no stretch marked goes back and keeps full screen up; with one marked it clears only the stretch', async () => {
    const all = year();
    const drawn = thinCats(all.data, all.refs).length;
    const { container } = render(<FlatCats series={all} kind="bars" />);
    await markStretch(container, 2, 3);
    fireEvent.click(screen.getByRole('button', { name: /Draw only these/ }));
    const zoomed = bars(container);
    expect(zoomed).toBeLessThan(drawn);

    // A pointer stretch, and the pointer gone off the drawing: no tip is up for Escape to hide.
    const rc = container.querySelector('.recharts-wrapper')!;
    const at = (x: number) => ({ pageX: x, pageY: 200, clientX: x, clientY: 200 });
    fireEvent.mouseDown(rc, at(300));
    fireEvent.mouseMove(rc, at(700));
    fireEvent.mouseUp(rc, at(700));
    fireEvent.mouseLeave(rc);
    expect(plot(container)).toHaveAttribute('data-stretching', 'true');
    expect(screen.getByTestId('rp-plot-live').textContent).toBe('');
    const first = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    act(() => {
      surface(container).dispatchEvent(first);
    });
    expect(first.defaultPrevented).toBe(true);
    expect(plot(container)).toHaveAttribute('data-stretching', 'false');
    expect(bars(container)).toBe(zoomed);

    const second = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    act(() => {
      surface(container).dispatchEvent(second);
    });
    expect(second.defaultPrevented).toBe(true);
    await waitFor(() => expect(bars(container)).toBe(drawn));
  });

  it('[REVERT-FAILS] a window or a Draw as drops the zoom, and it does not come back', async () => {
    const all = year();
    const drawn = thinCats(all.data, all.refs).length;
    const { container, rerender } = render(<FlatCats series={all} kind="bars" />);
    await markStretch(container, 2, 3);
    fireEvent.click(screen.getByRole('button', { name: /Draw only these/ }));
    expect(screen.getByRole('button', { name: 'All 365 days' })).toBeInTheDocument();
    rerender(<FlatCats series={all} kind="line" />);
    expect(screen.queryByRole('button', { name: 'All 365 days' })).toBeNull();
    rerender(<FlatCats series={all} kind="bars" />);
    expect(screen.queryByRole('button', { name: 'All 365 days' })).toBeNull();
    await waitFor(() => expect(bars(container)).toBe(drawn));

    await markStretch(container, 2, 3);
    fireEvent.click(screen.getByRole('button', { name: /Draw only these/ }));
    const ninety = till.view(read(DAYS.slice(-90)), { days: 90, currency: 'USD' }).cats!;
    rerender(<FlatCats series={ninety} kind="bars" />);
    expect(screen.queryByRole('button', { name: /^All / })).toBeNull();
    expect(bars(container)).toBe(90);
  });

  it('bars and a line zoom together: the bars are the stretch, every one', async () => {
    const all = year();
    const { container } = render(<FlatCats series={all} kind="combo" />);
    await markStretch(container, 5, 4);
    const n = Number(/Draw only these (\d+) days/.exec(screen.getByRole('button', { name: /Draw only these/ }).textContent!)![1]);
    fireEvent.click(screen.getByRole('button', { name: /Draw only these/ }));
    expect(bars(container)).toBe(n);
    expect(container.textContent).toContain(`${n} of 365 days`);
    // The line moved with the bars: the first drawn day speaks slot 5's checks, not slot 0's.
    fireEvent.focus(surface(container));
    const checks = all.measures!.find((m) => m.key === 'checks')!;
    expect(checks.values[5]).not.toBe(checks.values[0]);
    expect(screen.getByTestId('rp-plot-live').textContent).toBe(
      `${all.data[5].label}. Taken: ${all.format(all.data[5].value!)} taken; Checks: ${checks.format(checks.values[5]!)} checks`,
    );
  });

  it('[REVERT-FAILS] not offered on a withheld read or at week grain', () => {
    const withheld = till.view(read(DAYS, { salesWithheld: true }), { days: 365, currency: 'USD' });
    if (withheld.cats) {
      const { container } = render(<FlatCats series={withheld.cats} kind="bars" />);
      expect(container.querySelector('.rp-zoom')).toBeNull();
      cleanup();
    }
    const { container } = render(<FlatCats series={{ ...year(), xLabel: 'week' }} kind="bars" />);
    expect(container.querySelector('.rp-zoom')).toBeNull();
  });
});
