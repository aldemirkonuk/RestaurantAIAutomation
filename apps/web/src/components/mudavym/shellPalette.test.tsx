/**
 * The ⌘K palette under the app shell (sketch 119 D): "On the counter" first,
 * then the rooms from the ONE rooms table — and, outside the shell, the
 * palette exactly as it was.
 *
 * The palette is mounted for real. Only its network seam (the top-recommendation
 * fetch) and the two contexts it reads for unrelated features (auth for the
 * house id, toast for the landing-page command) are stubbed.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../../services/api/client', () => ({
  apiClient: { get: vi.fn(() => Promise.reject(new Error('not in this test'))) },
}));
vi.mock('../../contexts/AuthContext', async (orig) => ({
  ...(await orig<typeof import('../../contexts/AuthContext')>()),
  useAuth: () => ({ user: { restaurantId: null } }),
}));
vi.mock('../../contexts/ToastContext', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));

import { CommandPalette } from '../command/CommandPalette';
import {
  ShellPaletteContext,
  counterPaletteRows,
  roomPaletteRows,
  type ShellPaletteValue,
} from './shellPalette';
import { INTERNAL_PATHS } from '../../lib/mudavym/rooms';
import type { CounterRegister, HouseCounterRead } from '../../lib/mudavym/counterRead';

const T = '2026-09-21T14:02:11Z';

const ORDERS: CounterRegister = {
  key: 'orders',
  verb: 'seal',
  state: 'answered',
  readAt: T,
  ms: 4,
  count: 1,
  complete: true,
  act: 'yours',
  rows: [
    {
      id: 'o-1',
      orderNumber: 'ORD-1',
      vendor: 'Kermit Lynch',
      wine: 'Chablis',
      quantity: 12,
      unitType: 'bottle',
      total: 2000,
      status: 'APPROVAL_NEEDED',
      requestedAt: T,
    },
  ],
};
const THREADS_UNREAD: CounterRegister = {
  key: 'threads',
  verb: 'reply',
  state: 'unreadable',
  readAt: T,
  ms: 8000,
  status: 503,
  sentence: 'Vendor replies waiting could not be read (503).',
};
const CREDITS_REFUSED: CounterRegister = {
  key: 'credits',
  verb: 'verify',
  state: 'refused',
  readAt: T,
  ms: 0,
  sentence: "Credit claims carry the house's money, so they are for an owner or a manager.",
};
const DELIVERIES_EMPTY: CounterRegister = {
  key: 'deliveries',
  verb: 'verify',
  state: 'answered',
  readAt: T,
  ms: 2,
  count: 0,
  complete: true,
  act: 'yours',
  rows: [],
};

function read(registers: CounterRegister[]): HouseCounterRead {
  return {
    readAt: T,
    house: { id: 'r-1', currency: { state: 'recorded', code: 'USD' } },
    role: 'owner',
    registers,
  };
}

describe('counterPaletteRows — the counter as palette rows', () => {
  it('an answered register gives its acts; one not read gives ONE row saying so; a refusal and an empty register give none', () => {
    const openAct = vi.fn();
    const readNow = vi.fn();
    const rows = counterPaletteRows(
      read([ORDERS, THREADS_UNREAD, CREDITS_REFUSED, DELIVERIES_EMPTY]),
      null,
      openAct,
      readNow,
    );
    expect(rows.map((r) => r.id)).toEqual(['counter-orders-o-1', 'counter-unread-threads']);
    expect(rows[0].title).toBe('Kermit Lynch — Chablis');
    expect(rows[0].subtitle).toContain('Seal');
    expect(rows[1].title).toBe('Replies waiting · not read');
    // Never a zero for the register that did not answer.
    expect(rows[1].title).not.toMatch(/\b0\b/);

    rows[0].run();
    expect(openAct).toHaveBeenCalledWith({ register: ORDERS, row: (ORDERS as { rows: unknown[] }).rows[0] });
    rows[1].run();
    expect(readNow).toHaveBeenCalledTimes(1);
  });

  it('a first read that failed is said; one still in flight lists nothing', () => {
    const failed = counterPaletteRows(
      null,
      { at: T, status: 503, sentence: 'The counter could not be read (503).' },
      vi.fn(),
      vi.fn(),
    );
    expect(failed).toHaveLength(1);
    expect(failed[0].title).toBe('The counter was not read');
    expect(counterPaletteRows(null, null, vi.fn(), vi.fn())).toEqual([]);
  });
});

describe('roomPaletteRows — the one rooms table', () => {
  it('never offers an internal tool', () => {
    const hrefs = roomPaletteRows('owner', { connections: true }).map((r) => r.href);
    for (const p of INTERNAL_PATHS) expect(hrefs).not.toContain(p);
  });

  it('hides what the rail hides for the role: staff get no Vendor prices and no desk', () => {
    const staff = roomPaletteRows('staff', { connections: true }).map((r) => r.href);
    expect(staff).not.toContain('/vendor-prices');
    expect(staff).not.toContain('/admin');
    const owner = roomPaletteRows('owner', { connections: true }).map((r) => r.href);
    expect(owner).toContain('/vendor-prices');
    expect(owner).toContain('/admin');
  });
});

function mountPalette(value: ShellPaletteValue | null) {
  const onClose = vi.fn();
  render(
    <MemoryRouter initialEntries={['/orders']}>
      <ShellPaletteContext.Provider value={value}>
        <CommandPalette open onClose={onClose} />
      </ShellPaletteContext.Provider>
    </MemoryRouter>,
  );
  return { onClose };
}

beforeEach(() => {
  window.localStorage.clear();
  // jsdom has no layout, so no scrollIntoView; the palette keeps the active
  // row in view with it, which is not what these tests are about.
  Element.prototype.scrollIntoView = vi.fn();
});

describe('the palette under the shell', () => {
  it('puts On the counter first, then the rooms from the table, and runs an act in place', () => {
    const openAct = vi.fn();
    mountPalette({
      counter: counterPaletteRows(read([ORDERS, THREADS_UNREAD]), null, openAct, vi.fn()),
      rooms: roomPaletteRows('owner', { connections: false }),
    });
    const options = screen.getAllByRole('option');
    expect(options[0].textContent).toContain('Kermit Lynch — Chablis');
    expect(options[1].textContent).toContain('Replies waiting · not read');
    expect(screen.getByText('On the counter')).toBeTruthy();
    expect(screen.getByText('Rooms')).toBeTruthy();
    // The rooms are the table's words, not the legacy list's.
    expect(screen.getByText('Receipts & Credits')).toBeTruthy();
    expect(screen.queryByText('Wine Library')).toBeNull();

    fireEvent.click(options[0]);
    expect(openAct).toHaveBeenCalledTimes(1);
  });

  it('an act run from the palette is never kept as a "recent"', () => {
    mountPalette({
      counter: counterPaletteRows(read([ORDERS]), null, vi.fn(), vi.fn()),
      rooms: [],
    });
    fireEvent.click(screen.getAllByRole('option')[0]);
    const recents = JSON.parse(window.localStorage.getItem('wineops.command.recents') ?? '[]');
    expect(recents).not.toContain('counter-orders-o-1');
  });
});

describe('the palette outside the shell is unchanged', () => {
  it('no counter section, and the legacy Navigation list', () => {
    mountPalette(null);
    expect(screen.queryByText('On the counter')).toBeNull();
    expect(screen.queryByText('Rooms')).toBeNull();
    expect(screen.getByText('Wine Library')).toBeTruthy();
    expect(screen.getByText('Navigation')).toBeTruthy();
  });
});
