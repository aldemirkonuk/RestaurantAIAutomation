/**
 * r107 reports-5: laying the till beside the window before it. The dashed prior
 * is named beside a swatch of itself, and toggling compare keeps the plot and
 * the sparks (no skeleton, so no second sheen, spark draw or ruled-in).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cloneElement, type ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Cutting from './Cutting';
import { CATALOGUE } from './rp-catalogue';
import { CatPlot } from './rp-plot';
import { ANALYSIS_IDS } from './rp-sheet';
import type { ArrangeApi } from './rp-arrange';
import type { Register } from './useReportsNextData';
import type { CatSeries } from './rp-view';

vi.mock('recharts', async () => {
  const actual = await vi.importActual<typeof import('recharts')>('recharts');
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: ReactElement }) =>
      cloneElement(children, { width: 640, height: 320 } as never),
  };
});

const noop = vi.fn();
const arrange: ArrangeApi = {
  ...{ picked: null, origin: null, message: '', cols: 12, keyDown: () => noop },
  ...{ pickUp: noop, place: noop, cancel: noop, nudge: noop, resize: noop },
};
const swapOptions = ANALYSIS_IDS.map((id) => ({ id, taken: false }));
const reg = (data: unknown, loading = false): Register<unknown> => ({
  data,
  loading,
  failure: null,
  refetch: vi.fn(),
});
const css = (f: string) => readFileSync(join(__dirname, f), 'utf8');

const series = (withPrior: boolean): CatSeries => ({
  data: [1, 2, 3, 4].map((i) => ({ label: `d${i}`, value: i * 10, prior: withPrior ? i * 8 : undefined })),
  xLabel: 'day',
  yLabel: 'taken',
  unit: 'taken',
  format: String,
  priorLabel: 'the prior 30 days',
});

describe('the dashed prior is named beside a swatch of itself', () => {
  it.each(['line', 'area', 'bars'] as const)('[REVERT-FAILS] the %s caption says "dashed: prior 30 days" with a swatch', (k) => {
    const { container } = render(<MemoryRouter><CatPlot series={series(true)} kind={k} /></MemoryRouter>);
    const cap = container.querySelector('.rp-plot-cap')!;
    expect(cap.textContent).toBe('Taken · by day, dashed: prior 30 days');
    const key = cap.querySelector('.rp-plot-key')!;
    expect(key.getAttribute('data-kind')).toBe(k);
    expect(key.getAttribute('aria-hidden')).toBe('true');
  });

  it('says nothing of a dashed line when none is drawn', () => {
    const { container } = render(<MemoryRouter><CatPlot series={series(false)} kind="line" /></MemoryRouter>);
    expect(container.querySelector('.rp-plot-cap')!.textContent).toBe('Taken · by day');
    expect(container.querySelector('.rp-plot-key')).toBeNull();
  });

  it('the swatch is drawn in the line colour of the dashed series and is never animated', () => {
    const c = css('reports-next.css');
    const block = c.slice(c.indexOf('.rp-plot-key {'), c.indexOf('}', c.indexOf('.rp-plot-key {')));
    expect(block).toMatch(/border-top:\s*1\.5px dashed var\(--ink-3\)/);
    expect(c.slice(c.indexOf('.rp-plot-key['), c.indexOf('}', c.indexOf('.rp-plot-key[')))).toMatch(/dashed var\(--seal-deep\)/);
    expect(c.slice(c.indexOf('.rp-plot-key {'), c.indexOf('.rp-plot-key[data-kind')) + block).not.toMatch(/animation|transition/);
  });
});

const raw = (days: number) => ({
  posConnected: true,
  revenue: 4210,
  checkCount: 96,
  from: '2026-08-03',
  to: '2026-09-01',
  days,
  timezone: 'Europe/Istanbul',
  dailySeries: [
    { date: '2026-08-04', revenue: 310, checks: 4 },
    { date: '2026-08-11', revenue: 480, checks: 6 },
  ],
});
const TILL_30 = CATALOGUE.till.select(raw(30));

function sheet(register: Register<unknown>, compare: boolean) {
  return (
    <MemoryRouter>
      <Cutting
        id="till"
        graph="area"
        register={register}
        ctx={{ days: 30, compare }}
        arranging={false}
        swapOptions={swapOptions}
        arrange={arrange}
        onGraph={vi.fn()}
        onSwap={vi.fn()}
        onRemove={vi.fn()}
        onDays={vi.fn()}
      />
    </MemoryRouter>
  );
}

describe('toggling compare keeps the plot', () => {
  it('[REVERT-FAILS] the plot is the same element across the read: no skeleton, no second draw', async () => {
    const { rerender, container } = render(sheet(reg(TILL_30), false));
    // the drawing may be lazy-loaded (#2041): wait for the first one, then hold it across the read
    const plot = await waitFor(() => {
      const p = container.querySelector('.rp-plot');
      expect(p).not.toBeNull();
      return p;
    });
    rerender(sheet(reg(undefined, true), true));
    expect(container.querySelector('.rp-plot')).toBe(plot);
    expect(container.querySelector('.rp-standin')).toHaveAttribute('data-stale');
    expect(screen.getByRole('status')).toHaveTextContent(
      'Reading the 30 days before. Until they arrive, the last 30 days are shown alone.',
    );
    rerender(sheet(reg(CATALOGUE.till.select(raw(60))), true));
    expect(container.querySelector('.rp-plot')).toBe(plot);
    expect(container.querySelector('.rp-standin')).not.toHaveAttribute('data-stale');
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('a first read still has nothing to keep', () => {
    const { container } = render(sheet(reg(undefined, true), true));
    expect(container.querySelector('.rp-plot')).toBeNull();
  });

  it('turning compare off keeps the plot too, and says the days before are still beside it', async () => {
    const { rerender, container } = render(sheet(reg(CATALOGUE.till.select(raw(60))), true));
    const plot = await waitFor(() => {
      const p = container.querySelector('.rp-plot');
      expect(p).not.toBeNull();
      return p;
    });
    rerender(sheet(reg(undefined, true), false));
    expect(container.querySelector('.rp-plot')).toBe(plot);
    expect(screen.getByRole('status').textContent).toMatch(/still has the days before beside it/);
  });
});

describe('nothing runs again on a compare toggle', () => {
  it('the stand-in dims by ink only and the dimming is off under reduced motion; the swatch has no motion', () => {
    const c = css('reports-next.css');
    expect(c.slice(c.indexOf('@media (prefers-reduced-motion: reduce)', c.indexOf('.rp-standin {')))).toMatch(
      /\.rp-standin > \*\s*{\s*transition:\s*none/,
    );
  });
});
