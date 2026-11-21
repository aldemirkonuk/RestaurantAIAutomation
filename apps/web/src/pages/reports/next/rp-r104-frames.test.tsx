/**
 * r104 (r103 walk 2b, 7a, 7b). jsdom has no layout and no frames, so the seams are pinned:
 *  - the till's stand-in box may shrink to the card body, so a table scrolls in its own wrap and the figures list
 *    keeps its place (2b; the layout itself was measured in Chromium against this stylesheet, see the PR);
 *  - a phone draws at most PHONE_DRAWN points, under HOLD_OVER, so a 365-day switch needs no held frame (7a);
 *  - entering Arrange is a transition, not one urgent render of ten cards (7b).
 */
import { cloneElement, type ReactElement } from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import { CatPlot, HOLD_OVER, MAX_DRAWN, PHONE_DRAWN } from './rp-plot';
import { forgetRisen } from './rp-draw';
import type { CatSeries } from './rp-view';

vi.mock('recharts', async () => {
  const actual = await vi.importActual<typeof import('recharts')>('recharts');
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: ReactElement }) =>
      cloneElement(children, { width: 375, height: 200 } as never),
  };
});

const css = readFileSync(resolve(__dirname, 'reports-next.css'), 'utf8');
const page = readFileSync(resolve(__dirname, 'ReportsNext.tsx'), 'utf8');

let phone = true;
beforeEach(() => {
  forgetRisen();
  phone = true;
  vi.useFakeTimers();
  vi.stubGlobal('matchMedia', (q: string) => ({
    matches: q.includes('max-width: 767px') ? phone : false,
    media: q,
    addEventListener() {},
    removeEventListener() {},
  }));
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
const bars = (c: HTMLElement) => c.querySelectorAll('.recharts-bar-rectangle').length;

describe('the stand-in box takes the body, not the table (r103 2b)', () => {
  it('[REVERT-FAILS] .rp-standin may shrink below its content', () => {
    expect(css).toMatch(/\.rp-standin \{[^}]*flex: 1 1 auto;[^}]*min-height: 0;/);
  });
});

describe('a phone draws few enough points that a long window is not held (r103 7a)', () => {
  it('[REVERT-FAILS] 365 days on a phone: at most PHONE_DRAWN bars, in the first commit, and the caption says so', () => {
    expect(PHONE_DRAWN).toBeLessThanOrEqual(HOLD_OVER);
    const { container } = render(<CatPlot series={series(365)} kind="bars" />);
    expect(bars(container)).toBeGreaterThan(40);
    expect(bars(container)).toBeLessThanOrEqual(PHONE_DRAWN);
    expect(container.textContent).toMatch(new RegExp(`${bars(container)} of 365`));
  });

  it('[REVERT-FAILS] a desk keeps the fuller drawing, held a frame as before', () => {
    phone = false;
    const { container } = render(<CatPlot series={series(365)} kind="bars" />);
    expect(bars(container)).toBe(0);
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(bars(container)).toBeGreaterThan(HOLD_OVER);
    expect(bars(container)).toBeLessThanOrEqual(MAX_DRAWN);
  });
});

describe('entering Arrange does not hold one urgent frame (r103 7b)', () => {
  it('[REVERT-FAILS] the Arrange tap sets the draft and the arranging flag inside a transition', () => {
    expect(page).toMatch(/startTransition\(\(\) => \{\s*setDraft\([\s\S]*?\);\s*setArranging\(true\);\s*\}\);/);
  });
});
