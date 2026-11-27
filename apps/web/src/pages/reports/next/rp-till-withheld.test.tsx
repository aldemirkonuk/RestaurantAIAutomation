/**
 * The till for a reader the gateway withholds money from (ADR 0348, #2096).
 * The body is the exact one the gateway sends staff: posConnected true, from
 * and to null, dailySeries null. The page must say the takings are kept, never
 * that the till rang nothing (ADR 0020), and must not offer a compare.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Cutting from './Cutting';
import { CATALOGUE } from './rp-catalogue';
import { ANALYSIS_IDS } from './rp-sheet';
import type { ArrangeApi } from './rp-arrange';

const noop = vi.fn();
const arrange: ArrangeApi = {
  ...{ picked: null, origin: null, message: '', cols: 12, keyDown: () => noop },
  ...{ pickUp: noop, place: noop, cancel: noop, nudge: noop, resize: noop },
};

const WITHHELD = {
  restaurantId: 'r1',
  from: null,
  to: null,
  days: 30,
  timezone: null,
  zoneUnset: false,
  posConnected: true,
  salesWithheld: true,
  revenue: null,
  checkCount: null,
  dailySeries: null,
  consumption: null,
};

const TEXT = (compare: boolean) => {
  const v = CATALOGUE.till.view(CATALOGUE.till.select(WITHHELD), { days: 30, compare, currency: 'USD' });
  return JSON.stringify({ say: v.say, figures: v.figures, basis: v.basis });
};

afterEach(cleanup);

describe('till: a withheld read', () => {
  it.each([false, true])('[REVERT-FAILS] says the takings are kept, not that none rang (compare %s)', (compare) => {
    const v = CATALOGUE.till.view(CATALOGUE.till.select(WITHHELD), { days: 30, compare, currency: 'USD' });
    expect(v.say).toBe('Takings are kept to the owner and managers.');
    expect(v.figures).toEqual([]);
    const all = TEXT(compare);
    expect(all).not.toMatch(/no check fell/);
    expect(all).not.toMatch(/No POS revenue/);
    expect(all).not.toMatch(/pos_checks/);
  });

  it('[REVERT-FAILS] offers no compare button on a withheld read, and still offers it on a stated one', () => {
    const drawn = (data: unknown) =>
      render(
        <MemoryRouter>
          <Cutting
            id="till"
            graph="table"
            register={{ data: CATALOGUE.till.select(data), loading: false, failure: null, refetch: vi.fn() } as never}
            ctx={{ days: 30 }}
            arranging={false}
            swapOptions={ANALYSIS_IDS.map((id) => ({ id, taken: false }))}
            arrange={arrange}
            onGraph={vi.fn()}
            onSwap={vi.fn()}
            onRemove={vi.fn()}
            onDays={vi.fn()}
            onCompare={vi.fn()}
          />
        </MemoryRouter>,
      );
    drawn(WITHHELD);
    expect(screen.queryByRole('button', { name: /Against the prior/ })).toBeNull();
    expect(screen.queryByText(/no check fell/)).toBeNull();
    cleanup();
    drawn({ ...WITHHELD, salesWithheld: false, from: '2026-09-02', to: '2026-10-01', revenue: 100, checkCount: 3, dailySeries: [{ date: '2026-09-02', revenue: 100 }] });
    expect(screen.getByRole('button', { name: /Against the prior/ })).toBeTruthy();
  });
});
