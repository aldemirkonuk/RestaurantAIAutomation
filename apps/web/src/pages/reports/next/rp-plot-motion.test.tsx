/**
 * How a plot arrives and answers (N-15, r58): bars rise once when 40% of the
 * plot is in view, each 40 ms after the last; a bar carries its figure when the
 * bars are few; the hover detail is a 10 px-radius card that slides in 120 ms;
 * the seam where measurement stops is a 1 px divider with a 4 px dot. Under
 * `prefers-reduced-motion` nothing moves. jsdom runs no animation, so the
 * state machine, the markup the stylesheet hangs the motion on, and the
 * stylesheet's own numbers are what is pinned; the browser check is in the
 * r58 build doc.
 */
import { cloneElement, type ReactElement } from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import { CatPlot, ComboPlot, LABEL_BARS_MAX } from './rp-plot';
import { DRAW_AT, tipMotion } from './rp-draw';
import type { CatSeries } from './rp-view';

vi.mock('recharts', async () => {
  const actual = await vi.importActual<typeof import('recharts')>('recharts');
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: ReactElement }) =>
      cloneElement(children, { width: 420, height: 200 } as never),
  };
});

const css = readFileSync(resolve(__dirname, 'reports-next.css'), 'utf8');

type Cb = (e: Array<{ isIntersecting: boolean }>) => void;
let observers: Array<{ cb: Cb; opts?: { threshold?: number }; disconnect: ReturnType<typeof vi.fn> }>;

function stubWorld({ reduced, io = true }: { reduced: boolean; io?: boolean }) {
  observers = [];
  vi.stubGlobal(
    'matchMedia',
    (q: string) => ({ matches: reduced && q.includes('reduce'), media: q, addEventListener() {}, removeEventListener() {} }),
  );
  if (io) {
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        disconnect = vi.fn();
        constructor(cb: Cb, opts?: { threshold?: number }) {
          observers.push({ cb, opts, disconnect: this.disconnect });
        }
        observe() {}
        unobserve() {}
      },
    );
  } else {
    vi.stubGlobal('IntersectionObserver', undefined);
  }
}

const money = (v: number) => `₺${v}`;
const week = (n: number): CatSeries => ({
  data: Array.from({ length: n }, (_, i) => ({ label: `D${i + 1}`, value: 100 * (i + 1) })),
  xLabel: 'day',
  yLabel: 'taken',
  unit: '₺',
  format: money,
  measureLabel: 'Taken',
  measures: [{ key: 'chk', label: 'Checks', unit: 'checks', format: String, values: Array.from({ length: n }, (_, i) => i + 1) }],
});

beforeEach(() => stubWorld({ reduced: false }));
afterEach(() => vi.unstubAllGlobals());

const plot = (c: HTMLElement) => c.querySelector('.rp-plot') as HTMLElement;

describe('bars rise once, when 40% of the plot is in view', () => {
  it('[REVERT-FAILS] waits flat, rises when seen, and stops watching', () => {
    const { container } = render(<CatPlot series={week(5)} kind="bars" />);
    expect(plot(container).dataset.draw).toBe('pending');
    expect(observers).toHaveLength(1);
    expect(observers[0].opts?.threshold).toBe(DRAW_AT);
    expect(DRAW_AT).toBe(0.4);
    act(() => observers[0].cb([{ isIntersecting: false }]));
    expect(plot(container).dataset.draw).toBe('pending');
    act(() => observers[0].cb([{ isIntersecting: true }]));
    expect(plot(container).dataset.draw).toBe('drawn');
    expect(observers[0].disconnect).toHaveBeenCalled();
  });

  it('[REVERT-FAILS] a reader who asked for less motion gets the bars where they are, and nothing is watched', () => {
    stubWorld({ reduced: true });
    const { container } = render(<CatPlot series={week(5)} kind="bars" />);
    expect(plot(container).dataset.draw).toBe('still');
    expect(observers).toHaveLength(0);
  });

  it('a browser that cannot tell what is in view draws them at once rather than never', () => {
    stubWorld({ reduced: false, io: false });
    const { container } = render(<CatPlot series={week(5)} kind="bars" />);
    expect(plot(container).dataset.draw).toBe('still');
  });

  it('each bar knows its place in the rise, so the stylesheet can stagger it by 40 ms', () => {
    const { container } = render(<CatPlot series={week(5)} kind="bars" />);
    const idx = Array.from(container.querySelectorAll<SVGPathElement>('.recharts-bar-rectangle > path')).map(
      (p) => p.style.getPropertyValue('--rp-i'),
    );
    expect(idx).toEqual(['0', '1', '2', '3', '4']);
    const c = render(<ComboPlot series={week(3)} />);
    const ci = Array.from(c.container.querySelectorAll<SVGPathElement>('.recharts-bar-rectangle > path')).map(
      (p) => p.style.getPropertyValue('--rp-i'),
    );
    expect(ci).toEqual(['0', '1', '2']);
  });

  it('[REVERT-FAILS] the stylesheet draws from the baseline over 480 ms on the settle curve, 40 ms apart, transform and opacity only', () => {
    expect(css).toMatch(/\[data-draw='drawn'\] \.recharts-bar-rectangle > path \{[^}]*rp-grow 480ms cubic-bezier\(0\.16, 1, 0\.3, 1\)/);
    expect(css).toMatch(/animation-delay:\s*calc\(var\(--rp-i, 0\) \* 40ms\)/);
    expect(css).toMatch(/transform-origin:\s*50% 100%/);
    expect(css).toMatch(/@keyframes rp-grow \{\s*from \{\s*transform: scaleY\(0\);/);
    expect(css).not.toMatch(/rp-plot[^{]*\{[^}]*transition:\s*all/);
  });

  it('[REVERT-FAILS] the reduced-motion guard stops the rise, the labels and the card', () => {
    const block = /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\n\}\n/.exec(css)?.[0] ?? '';
    expect(block).toContain('.rp-plot .recharts-bar-rectangle > path');
    expect(block).toContain('.rp-plot .rp-bar-value');
    expect(block).toContain('.rp-tip');
    expect(block).toMatch(/animation:\s*none !important/);
  });
});

describe('a bar carries its figure when the bars are few', () => {
  const labels = (c: HTMLElement) =>
    Array.from(c.querySelectorAll('.rp-bar-value text, text.rp-bar-value')).map((t) => t.textContent);

  it('[REVERT-FAILS] writes each bar\'s figure the way the axis does, in tabular mono', () => {
    const { container } = render(<CatPlot series={week(4)} kind="bars" />);
    expect(labels(container)).toEqual(['₺100', '₺200', '₺300', '₺400']);
    const t = container.querySelector('.rp-bar-value text, text.rp-bar-value') as SVGTextElement;
    const style = `${t.getAttribute('style') ?? ''} ${t.parentElement?.getAttribute('style') ?? ''}`;
    expect(style).toMatch(/font-size:\s*11px/);
    expect(style).toMatch(/tabular-nums/);
  });

  it('[REVERT-FAILS] leaves the figures to the tooltip once the bars would touch', () => {
    const { container } = render(<CatPlot series={week(LABEL_BARS_MAX + 1)} kind="bars" />);
    expect(labels(container)).toEqual([]);
    const ok = render(<CatPlot series={week(LABEL_BARS_MAX)} kind="bars" />);
    expect(labels(ok.container)).toHaveLength(LABEL_BARS_MAX);
  });
});

describe('the seam where measurement stops', () => {
  it('[REVERT-FAILS] is a solid 1 px divider with a 4 px dot on the line', () => {
    const series: CatSeries = {
      ...week(0),
      data: [
        { label: 'Mon', value: 5, projected: 5 },
        { label: 'Tue', value: null, projected: 6 },
        { label: 'Wed', value: null, projected: 7 },
      ],
      projectedLabel: 'projected',
      refs: [{ x: 'Mon', label: 'projected from here' }],
    };
    const { container } = render(<CatPlot series={series} kind="line" />);
    const line = container.querySelector('.recharts-reference-line-line');
    expect(line?.getAttribute('stroke-width')).toBe('1');
    expect(line?.getAttribute('stroke-dasharray')).toBeNull();
    const dot = container.querySelector('.rp-seam-dot circle, circle.rp-seam-dot');
    expect(dot).not.toBeNull();
    expect(dot?.getAttribute('r')).toBe('4');
  });

  it('a threshold the server sent stays dashed, and gets no dot', () => {
    const series: CatSeries = { ...week(3), refs: [{ y: 200, label: 'target' }] };
    const { container } = render(<CatPlot series={series} kind="line" />);
    expect(container.querySelector('.recharts-reference-line-line')?.getAttribute('stroke-dasharray')).toBe('2 3');
    expect(container.querySelector('.rp-seam-dot')).toBeNull();
  });
});

describe('the hover detail', () => {
  it('[REVERT-FAILS] slides in 120 ms, and not at all for a reader who asked for less motion', () => {
    expect(tipMotion()).toMatchObject({ isAnimationActive: true, animationDuration: 120 });
    stubWorld({ reduced: true });
    expect(tipMotion().isAnimationActive).toBe(false);
  });

  it('[REVERT-FAILS] is a 10 px card with the warm 14/28 shadow, fading in over 120 ms', () => {
    const rule = /\.rp-tip \{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(rule).toMatch(/border-radius:\s*10px/);
    expect(rule).toMatch(/box-shadow:\s*0 14px 28px -18px rgba\(33, 28, 22, 0\.35\)/);
    expect(rule).toMatch(/animation:\s*rp-tip-in 120ms/);
  });
});
