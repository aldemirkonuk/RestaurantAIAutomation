/**
 * r107 g1: a till the gateway kept from the reader (staff, ADR 0348) says so. It never says
 * the till rang nothing (ADR 0020: a withheld read is not an empty one), cites no table
 * or figure, and offers no compare, even when the link says `?compare=prior`.
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
// What the gateway sends a staff caller (analytics.controller.ts, #2096).
const WITHHELD = {
  posConnected: true,
  salesWithheld: true,
  revenue: null,
  checkCount: null,
  from: '2026-08-03',
  to: '2026-10-01',
  days: 60,
  timezone: null,
  zoneUnset: false,
  dailySeries: null,
};
const OWNER = {
  ...WITHHELD,
  salesWithheld: undefined,
  revenue: 7800,
  checkCount: 90,
  dailySeries: [{ date: '2026-09-05', revenue: 310, checks: 3 }],
};

const draw = (raw: unknown, compare: boolean) =>
  render(
    <MemoryRouter>
      <Cutting
        id="till"
        graph="table"
        register={{ data: CATALOGUE.till.select(raw), loading: false, failure: null, refetch: vi.fn() } as never}
        ctx={{ days: 30, compare }}
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

afterEach(cleanup);

describe('the till kept from staff', () => {
  it('[REVERT-FAILS] says takings are kept to the owner and managers, with no "no check fell", figures or basis', () => {
    const { container } = draw(WITHHELD, true);
    const text = container.textContent ?? '';
    expect(text).toContain('Takings are kept to the owner and managers.');
    expect(text).not.toMatch(/no check fell/i);
    expect(text).not.toMatch(/pos_checks/);
    expect(container.querySelectorAll('.rp-dl > .rp-fig')).toHaveLength(0);
  });

  it('[REVERT-FAILS] offers no compare button, with ?compare=prior or without', () => {
    for (const compare of [true, false]) {
      draw(WITHHELD, compare);
      expect(screen.queryByRole('button', { name: /Against the prior/ })).toBeNull();
      cleanup();
    }
  });

  it('the owner reads the same card as before: figures, basis and the compare button', () => {
    const { container } = draw(OWNER, false);
    expect(container.textContent).not.toContain('kept to the owner');
    expect(screen.getByRole('button', { name: /Against the prior/ })).toBeTruthy();
    expect(container.querySelectorAll('.rp-dl > .rp-fig').length).toBeGreaterThan(0);
  });
});
