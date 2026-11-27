/** r100 /reports P0 round (M1 M3 M6 M8 M11), MOTION-reports-2026-11-20. */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cloneElement, type ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Cutting from './Cutting';
import { CATALOGUE } from './rp-catalogue';
import { CatPlot, X_ORIGIN_PAD } from './rp-plot';
import { ANALYSIS_IDS, type GraphType } from './rp-sheet';
import type { ArrangeApi } from './rp-arrange';
import type { Register } from './useReportsNextData';

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

const tillRaw = (days: number, withChecks: boolean) => ({
  posConnected: true,
  revenue: 4210,
  checkCount: 96,
  from: '2026-08-03',
  to: '2026-09-01',
  days,
  timezone: 'Europe/Istanbul',
  dailySeries: [
    { date: '2026-08-04', revenue: 310, ...(withChecks ? { checks: 4 } : {}) },
    { date: '2026-08-11', revenue: 480, ...(withChecks ? { checks: 6 } : {}) },
  ],
});
const TILL_OLD = CATALOGUE.till.select(tillRaw(30, false));
const TILL_COUNTED = CATALOGUE.till.select(tillRaw(30, true));
const TILL_90 = CATALOGUE.till.select(tillRaw(90, true));

function sheet(register: Register<unknown>, days = 30, graph: GraphType = 'bars', arranging = false, at = '/reports') {
  return (
    <MemoryRouter initialEntries={[at]}>
      <Cutting
        id="till"
        graph={graph}
        register={register}
        ctx={{ days }}
        arranging={arranging}
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
const optionsOf = (select: HTMLElement) =>
  within(select).getAllByRole('option').map((o) => (o as HTMLOptionElement).value);

const FLAT = '/reports?flat=till';
const css = (f: string) => readFileSync(join(__dirname, f), 'utf8');

describe('M1: bars and a line are offered only when the till can draw them', () => {
  // At 7 days there is no 7-day average to draw either (r109 g2), so a gateway
  // with no counts has nothing to put beside the takings.
  it('[REVERT-FAILS] a gateway that sends no checks per day does not offer bars and a line at 7 days, while arranging', () => {
    render(sheet(reg(TILL_OLD), 7, 'bars', true));
    expect(optionsOf(screen.getByRole('combobox', { name: 'Draw Through the till as' }))).not.toContain('combo');
  });

  it('[REVERT-FAILS] at 30 days it offers bars and a line of the takings and their 7-day average (r109 g2)', () => {
    render(sheet(reg(TILL_OLD), 30, 'bars', true));
    expect(optionsOf(screen.getByRole('combobox', { name: 'Draw Through the till as' }))).toContain('combo');
  });

  it('[REVERT-FAILS] nor in full screen, and nothing there tells the reader to arrange the sheet', () => {
    render(sheet(reg(TILL_OLD), 7, 'combo', false, FLAT));
    const dialog = screen.getByRole('dialog');
    const pick = within(dialog).getByRole('combobox', { name: 'Draw Through the till as' });
    expect(optionsOf(pick)).not.toContain('combo');
    expect(pick).toHaveValue('area');
    expect(dialog.textContent).not.toMatch(/arranging/i);
    expect(dialog.querySelector('.rp-plot')).not.toBeNull();
  });

  it('offers it once every day carries its count', () => {
    render(sheet(reg(TILL_COUNTED), 30, 'bars', true));
    expect(optionsOf(screen.getByRole('combobox', { name: 'Draw Through the till as' }))).toContain('combo');
  });
});

describe('M1: an undrawable drawing in full screen', () => {
  it('[REVERT-FAILS] points at the control above, never at arranging the sheet', () => {
    const real = CATALOGUE.till.view(TILL_COUNTED, { days: 30 });
    const spy = vi.spyOn(CATALOGUE.till, 'view').mockReturnValue({ ...real, matrix: undefined });
    render(sheet(reg(TILL_COUNTED), 30, 'heatmap', false, FLAT));
    const said = screen.getByRole('dialog').textContent ?? '';
    expect(said).toMatch(/cannot be drawn as heat map/i);
    expect(said).toMatch(/Pick another drawing above\./);
    expect(said).not.toMatch(/while arranging/);
    spy.mockRestore();
  });
});

describe('M6: a till window pick keeps the last drawing until the new one lands', () => {
  it('[REVERT-FAILS] keeps the 30-day plot, says which days it is, and never shows a skeleton', () => {
    const { rerender, container } = render(sheet(reg(TILL_COUNTED), 30, 'area'));
    expect(container.querySelector('.rp-plot')).not.toBeNull();
    rerender(sheet(reg(undefined, true), 90, 'area'));
    expect(container.querySelector('.rp-plot')).not.toBeNull();
    expect(container.querySelector('.rp-standin')).toHaveAttribute('data-stale');
    expect(screen.getByRole('status')).toHaveTextContent(
      'Reading the last 90 days. Until they arrive, the figures shown are the last 30 days.',
    );
    // The window line carries the days on screen, not the days asked for.
    expect(container.querySelector('.rp-cut__window')?.textContent).toMatch(/30 days/);
    rerender(sheet(reg(TILL_90), 90, 'area'));
    expect(container.querySelector('.rp-standin')).not.toHaveAttribute('data-stale');
    expect(screen.queryByRole('status')).toBeNull();
    expect(container.querySelector('.rp-cut__window')?.textContent).toMatch(/90 days/);
  });

  it('[REVERT-FAILS] a first read has nothing of ours to keep, so it is the skeleton', () => {
    const { container } = render(sheet(reg(undefined, true), 90, 'area'));
    expect(container.querySelector('.rp-plot')).toBeNull();
    expect(container.querySelector('.rp-standin')).not.toHaveAttribute('data-stale');
  });

  it('the dimming is ink-only and off under reduced motion', () => {
    const c = css('reports-next.css');
    expect(c).toMatch(/\.rp-standin\[data-stale\] > :not\(\[role='status'\]\) \{\s*opacity: 0\.55;/);
    expect(c).toMatch(/transition: opacity 160ms cubic-bezier\(0\.16, 1, 0\.3, 1\)/);
    expect(c).toMatch(/prefers-reduced-motion: reduce\) \{\s*\.rp-standin > \* \{\s*transition: none;/);
  });
});

describe('M8: a "Draw as" switch in full screen swaps what is in the slot and nothing else', () => {
  const flat = () => sheet(reg(TILL_COUNTED), 30, 'area', false, FLAT);

  it('[REVERT-FAILS] the drawing is always inside one .rp-flat__slot, whatever it is drawn as', () => {
    render(flat());
    const dialog = screen.getByRole('dialog');
    const pick = within(dialog).getByRole('combobox', { name: 'Draw Through the till as' });
    for (const g of ['area', 'bars', 'table', 'figure', 'heatmap']) {
      fireEvent.change(pick, { target: { value: g } });
      const slots = dialog.querySelectorAll('.rp-flat__slot');
      expect(slots).toHaveLength(1);
      expect(slots[0]).toHaveAttribute('data-graph', g);
      expect(slots[0].textContent?.length).toBeGreaterThan(0);
    }
  });

  it('[REVERT-FAILS] the slot has one height for every drawing, and the table scrolls inside it', () => {
    const c = css('reports-flat.css');
    expect(c).toMatch(/\.rp-flat__slot \{\s*flex: 0 0 var\(--rp-flat-slot\);\s*height: var\(--rp-flat-slot\);/);
    expect(c).toMatch(/\.rp-flat__slot \{[^}]*overflow-y: auto;/);
    // No per-drawing height: the old floor on the plot is gone.
    expect(c).not.toMatch(/\.rp-flat__body \.rp-plot \{[^}]*min-height: max\(180px/);
  });
});

describe('M3: full screen fills a landscape phone', () => {
  const c = css('reports-flat.css');
  const landscape = c.slice(c.indexOf('@media (max-height: 500px)'));

  it('[REVERT-FAILS] is as tall and as wide as the dynamic viewport, inside the safe areas', () => {
    expect(c).toMatch(/\.rp-flat \{[^}]*width: 100dvw;[^}]*height: 100dvh;/);
    expect(c).toMatch(/env\(safe-area-inset-top\)/);
    expect(c).toMatch(/env\(safe-area-inset-bottom\)/);
  });

  it('[REVERT-FAILS] a short viewport has a one-row head and a slot that takes the rest', () => {
    expect(landscape).toMatch(/\.rp-flat__head \{\s*display: flex;[^}]*min-height: 44px;/);
    expect(landscape).toMatch(/--rp-flat-slot: max\(\s*120px,\s*calc\(100dvh - 104px/);
    expect(landscape).toMatch(/\.rp-flat__back-label \{\s*position: absolute;/);
  });

  it('the note lives under the drawing, not in the head, and Back keeps its name', () => {
    render(sheet(reg(TILL_COUNTED), 30, 'area', false, FLAT));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('button', { name: 'Back to the sheet' })).toBeInTheDocument();
    expect(dialog.querySelector('.rp-flat__head .rp-flat__note')).toBeNull();
    expect(dialog.querySelector('.rp-flat__note')).not.toBeNull();
  });
});

describe('M11: the last label and the last sentence have room', () => {
  const series = {
    data: [
      { label: 'Mon', value: 3 },
      { label: 'Tue', value: 5 },
      { label: 'Sat', value: 4 },
    ],
    xLabel: 'weekday',
    yLabel: 'Bottles/day',
    unit: 'bottles',
    format: (v: number) => String(v),
  };

  it('[REVERT-FAILS] a line and an area keep room at the right edge for the last label', () => {
    expect(X_ORIGIN_PAD.right).toBeGreaterThanOrEqual(12);
    const { container } = render(<CatPlot series={series as never} kind="line" />);
    const plot = Number(container.querySelector('.recharts-wrapper')?.getAttribute('style')?.match(/width: (\d+)/)?.[1] ?? 640);
    const ticks = Array.from(container.querySelectorAll('.recharts-xAxis .recharts-cartesian-axis-tick text'));
    const last = Number(ticks[ticks.length - 1].getAttribute('x'));
    expect(last + 10).toBeLessThanOrEqual(plot - 5);
  });

  it('[REVERT-FAILS] a sentence under a sheet chart ends in an ellipsis, not at the card edge', () => {
    expect(css('reports-next.css')).toMatch(/\.rp-cut__body > p\.rp-cap[^{]*\{[^}]*-webkit-line-clamp: 3;/);
  });
});
