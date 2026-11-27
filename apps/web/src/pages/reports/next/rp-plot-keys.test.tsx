/**
 * r108 g2: a keyboard and a screen reader read every point. The chart's own surface is the tab stop
 * (recharts' accessibilityLayer), Left and Right walk the tooltip, one polite line says what it shows
 * (built by the same function as the visible tip), a day with no figure reads "not stated", never 0,
 * and Escape hides the tip. jsdom has no layout, so the chart is given a real size as in rp-plot.test.
 */
import { cloneElement, type ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

vi.mock('recharts', async () => {
  const actual = await vi.importActual<typeof import('recharts')>('recharts');
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: ReactElement }) =>
      cloneElement(children, { width: 640, height: 320 } as never),
  };
});

import { CatPlot, ComboPlot, PointPlot, tipSentence } from './rp-plot';
import type { CatSeries, PointSeries } from './rp-view';
import { daysBetween, till as tillRegister, type TillWindow } from './rp-registers-trade';

afterEach(cleanup);

const money = (v: number) => `$${v}`;
const till = (rows: Array<number | null>): CatSeries => ({
  data: rows.map((v, i) => ({ label: `D${i + 1}`, full: `Day ${i + 1}`, value: v })),
  xLabel: 'day',
  yLabel: 'taken',
  unit: 'taken',
  format: money,
});

const live = () => screen.getByTestId('rp-plot-live');
const surface = (c: HTMLElement) => c.querySelector('.recharts-surface') as SVGElement;
const arrow = (el: Element, key: 'ArrowRight' | 'ArrowLeft') => fireEvent.keyDown(el, { key });

describe.each(['bars', 'area', 'line'] as const)('the %s drawing', (kind) => {
  it('is a labelled group with one tab stop, and ArrowRight moves the spoken line from day 1 to day 2', () => {
    const { container } = render(<CatPlot series={till([310, 480, 220, 390, 410, 500, 260])} kind={kind} />);
    const group = container.querySelector('.rp-plot') as HTMLElement;
    expect(group.getAttribute('role')).toBe('group');
    expect(group.getAttribute('aria-roledescription')).toBe('chart');
    expect(group.getAttribute('aria-label')).toContain('taken');
    // One tab stop: the surface, not the group around it.
    expect(surface(container).getAttribute('tabindex')).toBe('0');
    expect(group.hasAttribute('tabindex')).toBe(false);
    expect(live().getAttribute('aria-live')).toBe('polite');
    fireEvent.focus(surface(container));
    expect(live().textContent).toBe('Day 1. $310 taken');
    arrow(surface(container), 'ArrowRight');
    expect(live().textContent).toBe('Day 2. $480 taken');
    arrow(surface(container), 'ArrowLeft');
    expect(live().textContent).toBe('Day 1. $310 taken');
  });

  it('reads a day with no figure as not stated, never 0', () => {
    const { container } = render(<CatPlot series={till([310, null, 220])} kind={kind} />);
    fireEvent.focus(surface(container));
    arrow(surface(container), 'ArrowRight');
    expect(live().textContent).toBe('Day 2. not stated');
    expect(live().textContent).not.toMatch(/\$0|\b0\b/);
    // The visible tip says the same thing in a word, not a zero.
    expect(container.querySelector('.rp-tip')?.textContent).toContain('Not stated');
  });
});

describe('Escape', () => {
  it('hides the tip and the spoken line, and stops there; the next arrow brings it back', () => {
    const { container } = render(<CatPlot series={till([310, 480, 220])} kind="bars" />);
    fireEvent.focus(surface(container));
    expect(container.querySelector('.rp-tip')).not.toBeNull();
    const esc = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    fireEvent(surface(container), esc);
    // It was the tip's: whoever listens above (the full-screen view) sees it as handled.
    expect(esc.defaultPrevented).toBe(true);
    expect(container.querySelector('.rp-tip')).toBeNull();
    expect(live().textContent).toBe('');
    // With nothing showing, Escape is not ours to take.
    const again = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    fireEvent(surface(container), again);
    expect(again.defaultPrevented).toBe(false);
    arrow(surface(container), 'ArrowRight');
    expect(container.querySelector('.rp-tip')).not.toBeNull();
    expect(live().textContent).toBe('Day 2. $480 taken');
  });
});

describe('the bars and a line', () => {
  it('walks by keyboard and speaks each measure in its own unit, a null measure as not stated', () => {
    const series: CatSeries = {
      data: [
        { label: 'Mon', value: 10, full: 'Monday' },
        { label: 'Tue', value: 12, full: 'Tuesday' },
        { label: 'Wed', value: null, full: 'Wednesday' },
      ],
      xLabel: 'weekday',
      yLabel: 'bottles/day',
      unit: 'bottles/day',
      format: String,
      measureLabel: 'Mean per day',
      measures: [{ key: 'seen', label: 'Days seen', unit: 'days', format: String, values: [12, 11, null] }],
    };
    const { container } = render(<ComboPlot series={series} />);
    expect(container.querySelector('.rp-plot')?.getAttribute('role')).toBe('group');
    fireEvent.focus(surface(container));
    expect(live().textContent).toMatch(/^Monday\. .*: 10 .*; Days seen: 12 days$/);
    arrow(surface(container), 'ArrowRight');
    arrow(surface(container), 'ArrowRight');
    expect(live().textContent).toMatch(/^Wednesday\. .*: not stated; Days seen: not stated$/);
    expect(container.querySelector('.rp-tip')?.textContent).toContain('—');
  });
});

describe('the scatter', () => {
  it('stays a picture with its table as the keyboard path', () => {
    const points = {
      data: [{ name: 'a', x: 1, y: 2 }],
      xLabel: 'x',
      yLabel: 'y',
      formatX: String,
      formatY: String,
    } as unknown as PointSeries;
    const { container } = render(<PointPlot series={points} />);
    const wrap = container.querySelector('.rp-plot') as HTMLElement;
    expect(wrap.getAttribute('role')).toBe('img');
    expect(container.querySelector('[data-testid="rp-plot-live"]')).toBeNull();
    expect(surface(container).getAttribute('tabindex')).toBeNull();
  });
});

describe('the spoken line and the visible tip are one function', () => {
  it('writes a measure with its unit, and a null as not stated', () => {
    expect(tipSentence({ head: 'Day 2', lines: [{ value: '$480', tail: ' taken · projected' }] })).toBe(
      'Day 2. $480 taken · projected',
    );
    expect(tipSentence({ head: 'Day 2', lines: [{ name: 'Line', value: null, tail: '' }] })).toBe(
      'Day 2. Line: not stated',
    );
  });
});

/* ───────────── Read a stretch from the keyboard (DD-r108-41, r109 reports-r109-6) ───── */

const WEEK = daysBetween('2026-11-04', '2026-11-09');
const tillView = (withheld = false) =>
  tillRegister.view(
    tillRegister.select({
      posConnected: true,
      revenue: 3620,
      checkCount: 182,
      from: WEEK[0],
      to: WEEK[5],
      days: 6,
      timezone: 'Europe/Istanbul',
      ...(withheld ? { salesWithheld: true } : {}),
      // Nov 5 came with no figure: the till could not state it.
      dailySeries: [100, null, 400, 1200, 1000, 520].map((revenue, i) => ({
        date: WEEK[i],
        revenue,
        checks: revenue == null ? null : [10, 0, 20, 40, 50, 62][i],
      })),
    }) as TillWindow,
    { days: 6, currency: 'USD' },
  );
const shiftArrow = (el: Element, key: 'ArrowRight' | 'ArrowLeft') => fireEvent.keyDown(el, { key, shiftKey: true });
const readout = (c: HTMLElement) => c.querySelector('.rp-stretch') as HTMLElement;

describe('Shift and the arrow keys read a stretch', () => {
  it.each(['bars', 'line', 'area'] as const)(
    '[REVERT-FAILS] %s: Shift+Right twice from the first day reads three days, a day with no figure never as 0',
    (kind) => {
      const series = tillView().cats!;
      const { container } = render(<CatPlot series={series} kind={kind} />);
      fireEvent.focus(surface(container));
      shiftArrow(surface(container), 'ArrowRight');
      shiftArrow(surface(container), 'ArrowRight');
      expect(readout(container)).toHaveAttribute('data-state', 'read');
      // The same words the pointer path says for days 1-3 (one function, rp-stretch.ts).
      expect(readout(container).textContent).toBe(series.stretch!(0, 2));
      // Known days only: 100 + 400, over 2 of 3 days; no average while a day is unknown.
      expect(readout(container).textContent).toContain('Taken $500 over 2 of 3 days; 1 day the till could not state');
      expect(readout(container).textContent).not.toMatch(/average/);
      // The tip still walks with the keys.
      expect(live().textContent).toBe('Nov 6. $400 taken');
    },
  );

  it('[REVERT-FAILS] the anchor holds: Shift+Left walks the last day back, a plain arrow keeps the stretch, Escape clears it', () => {
    const series = tillView().cats!;
    const { container } = render(<CatPlot series={series} kind="bars" />);
    fireEvent.focus(surface(container));
    arrow(surface(container), 'ArrowRight');
    arrow(surface(container), 'ArrowRight');
    arrow(surface(container), 'ArrowRight');
    shiftArrow(surface(container), 'ArrowRight');
    expect(readout(container).textContent).toBe(series.stretch!(3, 4));
    shiftArrow(surface(container), 'ArrowLeft');
    shiftArrow(surface(container), 'ArrowLeft');
    // Anchored on day 4 (index 3), the last day walked back to day 3: low to high.
    expect(readout(container).textContent).toBe(series.stretch!(2, 3));
    // Sum over sum: 400 + 1200 over 20 + 40 checks.
    expect(readout(container).textContent).toContain('Taken $1,600 · 60 checks · average $26.67');
    arrow(surface(container), 'ArrowRight');
    expect(readout(container).textContent).toBe(series.stretch!(2, 3));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(readout(container)).toHaveAttribute('data-state', 'hint');
  });

  it('[REVERT-FAILS] a read kept from this role offers no stretch, from the keyboard either', () => {
    const view = tillView(true);
    // A withheld till draws nothing to stretch over; if it draws at all, it carries no stretch.
    if (view.cats) {
      const { container } = render(<CatPlot series={view.cats} kind="bars" />);
      fireEvent.focus(surface(container));
      shiftArrow(surface(container), 'ArrowRight');
      expect(container.querySelector('.rp-stretch')).toBeNull();
    } else expect(view.cats).toBeUndefined();
  });
});
