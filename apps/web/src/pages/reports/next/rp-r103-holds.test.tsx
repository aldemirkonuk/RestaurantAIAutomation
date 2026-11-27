/**
 * r103 (r102 walk check 2): Draw as at 375 keeps the figures list's slot. jsdom has no layout, so the
 * seams are pinned: every drawing renders the same rows (the ones it does not show are held, aria-hidden),
 * the stylesheet gives a held row its space only on a phone, and the full-screen view holds nothing.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Cutting from './Cutting';
import { CATALOGUE } from './rp-catalogue';
import { ANALYSIS_IDS, type GraphType } from './rp-sheet';
import type { ArrangeApi } from './rp-arrange';

const noop = vi.fn();
const arrange: ArrangeApi = {
  ...{ picked: null, origin: null, message: '', cols: 12, keyDown: () => noop },
  ...{ pickUp: noop, place: noop, cancel: noop, nudge: noop, resize: noop },
};
const TILL = CATALOGUE.till.select({
  posConnected: true,
  revenue: 4210,
  checkCount: 96,
  from: '2026-08-03',
  to: '2026-09-01',
  days: 30,
  timezone: 'Europe/Istanbul',
  dailySeries: [
    { date: '2026-08-04', revenue: 310 },
    { date: '2026-08-11', revenue: 480 },
  ],
});

const LEDGER = CATALOGUE.ledger.select({
  basis: {},
  costCoverage: { total: 10, priced: 4, unpriced: 6, complete: false },
  inventoryValue: 1200,
  cogs: 8400,
  revenue: 21000,
});

const draw = (graph: GraphType, id: 'till' | 'ledger' = 'till') =>
  render(
    <MemoryRouter>
      <Cutting
        id={id}
        graph={graph}
        register={{ data: id === 'till' ? TILL : LEDGER, loading: false, failure: null, refetch: vi.fn() } as never}
        ctx={{ days: 30 }}
        arranging={false}
        swapOptions={ANALYSIS_IDS.map((id) => ({ id, taken: false }))}
        arrange={arrange}
        onGraph={vi.fn()}
        onSwap={vi.fn()}
        onRemove={vi.fn()}
        onDays={vi.fn()}
      />
    </MemoryRouter>,
  );
const rows = (c: HTMLElement) => c.querySelectorAll('.rp-dl > .rp-fig');
const held = (c: HTMLElement) => c.querySelectorAll('.rp-dl > .rp-fig[data-held]');

afterEach(cleanup);

describe('Draw as keeps the figures list its slot (phone)', () => {
  it('[REVERT-FAILS] Area, Table and One figure render the same number of rows; One figure holds the headline row', () => {
    const area = draw('area');
    const n = rows(area.container).length;
    expect(n).toBeGreaterThan(1);
    expect(held(area.container).length).toBe(0);
    cleanup();
    const one = draw('figure');
    expect(rows(one.container).length).toBe(n);
    expect(held(one.container).length).toBe(1);
    expect(held(one.container)[0].getAttribute('aria-hidden')).toBe('true');
  });

  it('[REVERT-FAILS] a held row takes its space on a phone only, and is invisible there', () => {
    const t = readFileSync(join(__dirname, 'reports-next.css'), 'utf8');
    expect(t).toMatch(/\.rp-fig\[data-held\] \{\s*display: none;/);
    expect(t).toMatch(/@media \(max-width: 767px\) \{[^@]*\.rp-fig\[data-held\] \{\s*display: flex;\s*visibility: hidden;/);
  });

  it('[REVERT-FAILS] a table with its own layout is the list: one .rp-dl, no held rows behind it', () => {
    const { container } = draw('table', 'ledger');
    expect(container.querySelectorAll('.rp-dl')).toHaveLength(1);
    expect(container.querySelectorAll('[data-held]')).toHaveLength(0);
    expect(container.querySelectorAll('.rp-fig').length).toBeGreaterThan(1);
  });
});
