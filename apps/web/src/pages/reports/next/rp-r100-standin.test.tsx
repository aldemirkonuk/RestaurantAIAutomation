/** r100 /reports review of the stand-in: house, holding still, notes, the landscape line, aria-busy. */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cloneElement, type ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Cutting from './Cutting';
import { CATALOGUE } from './rp-catalogue';
import { ANALYSIS_IDS, type AnalysisId, type GraphType } from './rp-sheet';
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
const till = (days: number) =>
  CATALOGUE.till.select({
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

function sheet(o: {
  id?: AnalysisId;
  register: Register<unknown>;
  days?: number;
  house?: string;
  graph?: GraphType;
  at?: string;
}) {
  return (
    <MemoryRouter initialEntries={[o.at ?? '/reports']}>
      <Cutting
        id={o.id ?? 'till'}
        house={o.house ?? 'A'}
        graph={o.graph ?? 'area'}
        register={o.register}
        ctx={{ days: o.days ?? 30 }}
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
const css = (f: string) => readFileSync(join(__dirname, f), 'utf8');

describe('the stand-in is the same house\'s last drawing, never another house\'s', () => {
  it('[REVERT-FAILS] a house switch then a window pick before the first read shows a skeleton, not house A', () => {
    const { rerender, container } = render(sheet({ register: reg(till(7)), days: 7, house: 'A' }));
    expect(container.querySelector('.rp-plot')).not.toBeNull();
    // House B, same URL window, first read in flight; then the reader picks 30 days.
    rerender(sheet({ register: reg(undefined, true), days: 7, house: 'B' }));
    rerender(sheet({ register: reg(undefined, true), days: 30, house: 'B' }));
    expect(container.querySelector('.rp-plot')).toBeNull();
    expect(container.querySelector('.rp-standin')).not.toHaveAttribute('data-stale');
    expect(screen.queryByText(/Until they arrive/)).toBeNull();
  });

  it('the same house still keeps its drawing across a pick', () => {
    const { rerender, container } = render(sheet({ register: reg(till(30)), days: 30 }));
    rerender(sheet({ register: reg(undefined, true), days: 90 }));
    expect(container.querySelector('.rp-standin')).toHaveAttribute('data-stale');
  });
});

describe('a pick moves nothing and the status is not inside a busy subtree', () => {
  it('[REVERT-FAILS] nothing but the drawing is in flow in the stand-in, fresh or stale', () => {
    const { rerender, container } = render(sheet({ register: reg(till(30)), days: 30 }));
    const flow = () => Array.from(container.querySelector('.rp-standin')!.children).map((k) => k.className);
    const fresh = flow();
    rerender(sheet({ register: reg(undefined, true), days: 90 }));
    expect(container.querySelector('.rp-standin')).toHaveAttribute('data-stale');
    expect(flow()).toEqual(fresh);
    expect(container.querySelector('.rp-standin p.rp-cap')).toBeNull();
    // The words still reach the reader: in the head's line, and to a screen reader in a status.
    expect(container.querySelector('.rp-cut__window')?.textContent).toMatch(/30 days.*reading 90 days/);
    expect(screen.getByText(/Until they arrive/)).toHaveClass('rp-sr-only');
  });

  it('[REVERT-FAILS] the status is a sibling of the busy drawing, never inside it', () => {
    const { rerender, container } = render(sheet({ register: reg(till(30)), days: 30 }));
    rerender(sheet({ register: reg(undefined, true), days: 90 }));
    expect(screen.getByText(/Until they arrive/).closest('[aria-busy]')).toBeNull();
    expect(container.querySelector('.rp-standin')).not.toHaveAttribute('aria-busy', 'true');
  });
});

describe('a JSX note clamped on the sheet still has its whole sentence as its title', () => {
  it('[REVERT-FAILS] Spend pacing\'s projection is readable in its title', () => {
    const data = CATALOGUE.pacing.select({
      spendLast30d: 1200,
      spendPrev30d: 900,
      paceDeltaPct: 0.33,
      projectedNext4Weeks: [100, 200, 300, 400],
      committedOpenOrders: 400,
      openOrderCount: 2,
    });
    const { container } = render(sheet({ id: 'pacing', register: reg(data), graph: 'table' }));
    const caps = Array.from(container.querySelectorAll('.rp-cut__body p.rp-cap'));
    const projection = caps.find((p) => /Projected, next four weeks/.test(p.textContent ?? ''));
    expect(projection).toBeDefined();
    for (const p of caps) expect(p.getAttribute('title')?.length ?? 0).toBeGreaterThan(0);
    expect(projection!.getAttribute('title')).toMatch(/a Holt projection, not a measurement\.$/);
  });
});

describe('the landscape one-row head keeps the line that names the days', () => {
  it('[REVERT-FAILS] the line wraps in two lines instead of one clipped row', () => {
    const c = css('reports-flat.css');
    const rule = c.match(/\.rp-flat__row \.rp-cut__window \{[^}]*\}/)?.[0] ?? '';
    expect(rule).not.toMatch(/white-space: nowrap/);
    expect(rule).toMatch(/-webkit-line-clamp: 2;/);
  });

  it('[REVERT-FAILS] full screen carries the line whole in its title, and the days drawn while a pick is read', () => {
    const { rerender, container } = render(
      sheet({ register: reg(till(30)), days: 30, at: '/reports?flat=till' }),
    );
    rerender(sheet({ register: reg(undefined, true), days: 90, at: '/reports?flat=till' }));
    const line = document.querySelector('.rp-flat__head .rp-cut__window')!;
    expect(line.textContent).toMatch(/reading 90 days/);
    expect(line.getAttribute('title')).toBe(line.textContent);
    expect(container).toBeDefined();
  });
});
