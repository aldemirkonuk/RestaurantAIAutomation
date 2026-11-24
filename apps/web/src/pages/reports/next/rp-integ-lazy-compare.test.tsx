/**
 * r105 item 2: #2016 (phone 90 points), #2028 (compare prior label) and #2041
 * (lazy plot) all edit CatPlot. The lazy module must still draw both: the
 * prior window named in words, and a phone's drawn count capped.
 */
import { cloneElement, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CatPlot } from './rp-plot-lazy';
import { PHONE_DRAWN } from './rp-plot';
import type { CatSeries } from './rp-view';

vi.mock('recharts', async () => {
  const actual = await vi.importActual<typeof import('recharts')>('recharts');
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: ReactElement }) =>
      cloneElement(children, { width: 375, height: 200 } as never),
  };
});

beforeEach(() => {
  vi.stubGlobal('matchMedia', (q: string) => ({
    matches: q.includes('max-width: 767px'),
    media: q,
    addEventListener() {},
    removeEventListener() {},
  }));
});
afterEach(() => vi.unstubAllGlobals());

const series: CatSeries = {
  data: Array.from({ length: 365 }, (_, i) => ({ label: `D${i + 1}`, value: 100 + (i % 7), prior: 90 })),
  xLabel: 'day',
  yLabel: 'taken',
  unit: '₺',
  format: (v) => `₺${v}`,
  priorLabel: 'the prior 365 days',
};

describe('the lazy CatPlot keeps both merged behaviours', () => {
  it('[REVERT-FAILS] draws the prior label and no more than the phone cap', async () => {
    const { container } = render(<CatPlot series={series} kind="line" />);
    await screen.findByRole('img', { name: /the prior 365 days dashed beside it/ });
    const dots = container.querySelectorAll('.recharts-line-curve').length;
    expect(dots).toBeGreaterThan(0);
    const n = Number(/(\d+) of 365/.exec(container.textContent ?? '')?.[1]);
    expect(n).toBeGreaterThan(40);
    expect(n).toBeLessThanOrEqual(PHONE_DRAWN);
  });
});
