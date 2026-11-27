/**
 * r107 g5: the compare answer stays on the phone card, and the prior line draws once.
 * jsdom has no layout, so the seams are pinned: the sheet adds the answer row's 66 px to the
 * till's stack slot (settling over 160 ms, none when reduced), the prior's line carries the
 * class the stylesheet draws with a clip-path over 360 ms, and a re-read keeps that line's node.
 */
import { cloneElement, type ReactElement, type ReactNode } from 'react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('recharts', async () => {
  const actual = await vi.importActual<typeof import('recharts')>('recharts');
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: ReactElement }) =>
      cloneElement(children, { width: 640, height: 320 } as never),
  };
});
const grid = vi.hoisted(() => ({ layouts: null as Record<string, { i: string; h: number }[]> | null }));
vi.mock('react-grid-layout/legacy', () => ({
  Responsive: (props: Record<string, unknown>) => {
    grid.layouts = props.layouts as typeof grid.layouts;
    return <div>{props.children as ReactNode}</div>;
  },
}));

import Sheet from './Sheet';
import { CatPlot } from './rp-plot';
import { COMPARE_ANSWER_PX, COMPARE_GRID_ROWS } from './rp-fit';
import { slotHeightPx } from './rp-sheet';
import { daysBetween, tillAnswersCompare, till } from './rp-registers-trade';
import type { AnalysisId } from './rp-sheet';
import type { CatSeries } from './rp-view';

const css = readFileSync(join(__dirname, 'reports-next.css'), 'utf8');

const innerWidth = window.innerWidth;
let spy: { mockRestore: () => void } | null = null;
afterEach(() => {
  cleanup();
  spy?.mockRestore();
  Object.defineProperty(window, 'innerWidth', { value: innerWidth, configurable: true });
});
function phone() {
  Object.defineProperty(window, 'innerWidth', { value: 375, configurable: true });
  spy = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(343);
}

const SLOT = { x: 0, y: 0, w: 12, h: 6 };
const sheet = (holdPx: number | undefined, holdRows?: number) =>
  render(
    <Sheet
      arranging={false}
      onMove={() => {}}
      cuttings={[{ id: 'till' as AnalysisId, slot: SLOT, holdPx, holdRows, body: <div data-cut="till" /> }] as never}
    />,
  );
const item = (c: HTMLElement) => c.querySelector<HTMLElement>('.rp-stack__item')!;

describe('the phone till card holds the compare answer', () => {
  it('[REVERT-FAILS] the stack slot is the slot plus the answer row while compare is drawn, and the slot alone after', () => {
    phone();
    const on = sheet(COMPARE_ANSWER_PX);
    expect(COMPARE_ANSWER_PX).toBe(66);
    expect(item(on.container).style.height).toBe(`${slotHeightPx(SLOT.h) + 66}px`);
    expect(item(on.container).hasAttribute('data-holds')).toBe(true);
    cleanup();
    const off = sheet(0);
    expect(item(off.container).style.height).toBe(`${slotHeightPx(SLOT.h)}px`);
    expect(item(off.container).hasAttribute('data-holds')).toBe(true);
    cleanup();
    const other = sheet(undefined);
    expect(item(other.container).hasAttribute('data-holds')).toBe(false);
  });

  it('[REVERT-FAILS] settles over 160 ms on the house curve, and not at all when motion is reduced', () => {
    expect(css).toMatch(/\.rp-stack__item\[data-holds\]\s*\{[^}]*transition:\s*height 160ms cubic-bezier\(0\.16, 1, 0\.3, 1\)/);
    const reduced = css.split('@media (prefers-reduced-motion: reduce)').slice(1).join('\n');
    // the reduced rule must be as specific as the rule it switches off ([data-holds]), or it never wins (walk r107)
    expect(reduced).toMatch(/\.rp-stack__item\[data-holds\]\s*\{\s*transition:\s*none/);
  });

  it('answers compare only when the read draws the prior and its change', () => {
    const series = (from: string, to: string, r: number) => daysBetween(from, to).map((date) => ({ date, revenue: r }));
    const raw = (over: Record<string, unknown> = {}) => ({
      posConnected: true, revenue: 1, checkCount: 1, from: '2026-08-03', to: '2026-10-01', days: 60,
      dailySeries: [...series('2026-08-03', '2026-09-01', 100), ...series('2026-09-02', '2026-10-01', 130)], ...over,
    });
    const ctx = { days: 30, compare: true };
    expect(tillAnswersCompare(till.select(raw()), ctx)).toBe(true);
    expect(tillAnswersCompare(till.select(raw()), { days: 30, compare: false })).toBe(false);
    expect(tillAnswersCompare(undefined, ctx)).toBe(false);
    expect(tillAnswersCompare(till.select(raw({ salesWithheld: true, revenue: null, dailySeries: null })), ctx)).toBe(false);
    expect(tillAnswersCompare(till.select(raw({ from: '2026-09-02', dailySeries: series('2026-09-02', '2026-10-01', 130) })), ctx)).toBe(false);
  });
});

describe('the 1440 till card holds the compare answer in rows', () => {
  const wide = () => {
    Object.defineProperty(window, 'innerWidth', { value: 1440, configurable: true });
    spy = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1100);
  };
  const tillRows = (holdRows: number | undefined, arranging = false) => {
    grid.layouts = null;
    render(
      <Sheet
        arranging={arranging}
        onMove={() => {}}
        cuttings={[{ id: 'till' as AnalysisId, slot: SLOT, holdRows, body: <div data-cut="till" /> }] as never}
      />,
    );
    return (Object.values(grid.layouts ?? {}) as { i: string; h: number }[][]).flat().find((l) => l.i === 'till')?.h;
  };

  it('[REVERT-FAILS] covers the 5 px the card ran over with whole rows, while compare is drawn and the sheet is read', () => {
    wide();
    expect(COMPARE_GRID_ROWS).toBe(1);
    expect(tillRows(COMPARE_GRID_ROWS)).toBe(SLOT.h + COMPARE_GRID_ROWS);
    expect(tillRows(0)).toBe(SLOT.h);
    expect(tillRows(undefined)).toBe(SLOT.h);
  });

  it('[REVERT-FAILS] never draws the held row while arranging (the stored slot is what moves) nor on the phone column', () => {
    wide();
    expect(tillRows(COMPARE_GRID_ROWS, true)).toBe(SLOT.h);
    cleanup();
    phone();
    const on = sheet(COMPARE_ANSWER_PX, COMPARE_GRID_ROWS);
    expect(item(on.container).style.height).toBe(`${slotHeightPx(SLOT.h) + 66}px`);
  });

  it('adds no transition: the stylesheet has no rule on the grid item that names the hold', () => {
    expect(css).not.toMatch(/\.rp-grid-item\[data-hold/);
  });
});

describe('the prior line draws once', () => {
  const series = (k: number): CatSeries => ({
    data: [1, 2, 3, 4].map((i) => ({ label: `d${i}`, value: i * 10 * k, prior: i * 8 * k })),
    xLabel: 'day', yLabel: 'taken', unit: 'taken', format: String, priorLabel: 'the prior 30 days',
  });
  const plot = (k: number, kind: 'line' | 'area' | 'bars') => (
    <MemoryRouter><CatPlot series={series(k)} kind={kind} /></MemoryRouter>
  );

  it('[REVERT-FAILS] the line and area drawings mark the prior for the clip-path draw; bars do not', () => {
    for (const kind of ['line', 'area'] as const) {
      const { container, unmount } = render(plot(1, kind));
      expect(container.querySelectorAll('.rp-prior')).toHaveLength(1);
      unmount();
    }
    expect(render(plot(1, 'bars')).container.querySelectorAll('.rp-prior')).toHaveLength(0);
  });

  it('[REVERT-FAILS] draws left to right over 360 ms by clip-path, and shows at once when motion is reduced', () => {
    expect(css).toMatch(/\.rp-prior\s*\{[^}]*animation:\s*rp-prior-draw 360ms cubic-bezier\(0\.16, 1, 0\.3, 1\) both/);
    expect(css).toMatch(/@keyframes rp-prior-draw\s*\{\s*from\s*\{\s*clip-path:\s*inset\(0 100% 0 0\);\s*\}\s*to\s*\{\s*clip-path:\s*inset\(0\);/);
    const reduced = css.split('@media (prefers-reduced-motion: reduce)').slice(1).join('\n');
    expect(reduced).toMatch(/\.rp-prior\s*\{\s*animation:\s*none/);
  });

  it('a re-read of the same window keeps the line in place, so nothing replays', () => {
    const { container, rerender } = render(plot(1, 'line'));
    const before = container.querySelector('.rp-prior');
    rerender(plot(2, 'line'));
    expect(container.querySelector('.rp-prior')).toBe(before);
  });
});
