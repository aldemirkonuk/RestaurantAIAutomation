/**
 * The counter draws each register's own outcome — answered, refused, or not
 * read — and never prints a failure as a zero (sketch 119 D; the founder's
 * pick of 2026-09-21).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { HouseCounter } from './HouseCounter';
import type { CounterRegister, HouseCounterRead } from '../../lib/mudavym/counterRead';
import type { HouseCounterState } from '../../lib/mudavym/useHouseCounter';
import { houseSaid, resetHouseSaid } from '../../lib/mudavym/houseSaid';

const T = '2026-09-21T14:02:11Z';

function read(registers: CounterRegister[]): HouseCounterRead {
  return {
    readAt: T,
    house: { id: 'h-1', currency: { state: 'recorded', code: 'USD' } },
    role: 'owner',
    registers,
  };
}

const ORDERS: CounterRegister = {
  key: 'orders',
  verb: 'seal',
  state: 'answered',
  readAt: T,
  ms: 5,
  count: 7,
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
const CREDITS_REFUSED: CounterRegister = {
  key: 'credits',
  verb: 'verify',
  state: 'refused',
  readAt: T,
  ms: 0,
  sentence: "Credit claims carry the house's money, so they are for an owner or a manager.",
};
const DELIVERIES_UNREAD: CounterRegister = {
  key: 'deliveries',
  verb: 'verify',
  state: 'unreadable',
  readAt: T,
  ms: 8000,
  status: 503,
  sentence: 'Deliveries counted by case could not be read (503).',
};
const THREADS_EMPTY: CounterRegister = {
  key: 'threads',
  verb: 'reply',
  state: 'answered',
  readAt: T,
  ms: 3,
  count: 0,
  complete: true,
  act: 'not_yours',
  rows: [],
};

function state(over: Partial<HouseCounterState> = {}): HouseCounterState {
  return {
    last: read([ORDERS, DELIVERIES_UNREAD, CREDITS_REFUSED, THREADS_EMPTY]),
    reading: false,
    failure: null,
    offline: false,
    readNow: vi.fn(),
    ...over,
  };
}

function mount(s: HouseCounterState, width: 'open' | 'tucked' = 'open', onOpen = vi.fn(), onToggle = vi.fn()) {
  render(
    <MemoryRouter>
      <HouseCounter state={s} onOpen={onOpen} width={width} onToggle={onToggle} />
    </MemoryRouter>,
  );
  return { onOpen, onToggle };
}

beforeEach(() => resetHouseSaid());

describe('answered', () => {
  it('lists the rows it was given, and sends the rest to their room', () => {
    const { onOpen } = mount(state());
    const act = screen.getByRole('button', { name: /Kermit Lynch — Chablis/ });
    fireEvent.click(act);
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ row: ORDERS.state === 'answered' ? ORDERS.rows[0] : null }));
    expect(screen.getByRole('link', { name: '6 more on Orders' })).toBeTruthy();
  });

  it('an empty register that answered says so in words', () => {
    mount(state());
    expect(screen.getByText('Replies waiting · none waiting')).toBeTruthy();
  });

  it('the head counts registers from the outcomes, never acts', () => {
    mount(state());
    expect(screen.getByTestId('counter-head').textContent).toBe('2 of 4 registers · 1 refused · 1 not read');
  });
});

describe('refused', () => {
  it('says refused in words and prints no count for it', () => {
    mount(state());
    const line = screen.getByText('Credits promised · refused for your role');
    expect(line.getAttribute('title')).toBe(CREDITS_REFUSED.state === 'refused' ? CREDITS_REFUSED.sentence : '');
    const block = line.closest('[data-register="credits"]') as HTMLElement;
    expect(within(block).queryByText(/\d/)).toBeNull();
  });
});

describe('not read', () => {
  it('is a hollow ring with the failure named and Read again — never a zero', () => {
    const s = state();
    mount(s);
    const block = document.querySelector('[data-register="deliveries"]') as HTMLElement;
    expect(block.getAttribute('data-state')).toBe('unreadable');
    expect(block.querySelector('.mdv-counter__ring')).not.toBeNull();
    expect(block.textContent).toMatch(/not read · 503 at/);
    expect(block.textContent).not.toMatch(/none waiting|\b0\b/);
    fireEvent.click(within(block).getByRole('button', { name: 'Read again' }));
    expect(s.readNow).toHaveBeenCalled();
  });

  it('a failed re-read keeps the last answer on screen, dated, with the failure beside it', () => {
    mount(state({ failure: { at: '2026-09-21T14:03:11Z', status: 502, sentence: 'The counter could not be read (502).' } }));
    expect(screen.getByText(/The counter could not be read \(502\)/).textContent).toMatch(/what shows is from/);
    expect(screen.getByRole('button', { name: /Kermit Lynch/ })).toBeTruthy();
  });

  it('a first read that fails shows no registers and claims no count', () => {
    mount(state({ last: null, failure: { at: T, status: null, sentence: 'The counter did not answer.' } }));
    expect(screen.getByTestId('counter-head').textContent).toBe('not read');
    expect(document.querySelector('[data-register]')).toBeNull();
  });
});

describe('the foot never claims a read that has not landed', () => {
  it('while reading: no cadence, no Read now', () => {
    mount(state({ last: null, reading: true }));
    expect(screen.getAllByText('reading the registers…').length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'Read now' })).toBeNull();
    expect(screen.queryByText(/again in 60 s/)).toBeNull();
  });

  it('after a read: the cadence and Read now', () => {
    mount(state());
    expect(screen.getByText(/again in 60 s · on focus/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Read now' })).toBeTruthy();
  });

  it('offline: frozen and dated, and no promise of a read', () => {
    mount(state({ offline: true }));
    expect(screen.getByTestId('counter-head').textContent).toMatch(/^4 registers · from /);
    expect(screen.getByText(/offline · will read on return/)).toBeTruthy();
    expect(screen.queryByText(/again in 60 s/)).toBeNull();
  });
});

describe('tucked: a ~52 px strip that still shows each verb, never a blank edge', () => {
  it('prints a count, a ring for a verb with a register not read, and a dash for one refused', () => {
    const s = state({
      last: read([ORDERS, DELIVERIES_UNREAD, CREDITS_REFUSED, THREADS_EMPTY, { ...CREDITS_REFUSED, key: 'invitations', verb: 'decide' } as CounterRegister]),
    });
    mount(s, 'tucked');
    expect(screen.getByRole('button', { name: 'Seal: 7' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Verify: not read' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Reply: 0' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Decide: refused for your role' })).toBeTruthy();
  });

  it('while the first read is in flight, a hairline per verb — not a zero', () => {
    mount(state({ last: null, reading: true }), 'tucked');
    expect(screen.getByRole('button', { name: 'Seal: reading' })).toBeTruthy();
  });

  it('a first read that FAILED is a ring per verb, never the hairline that says "still reading"', () => {
    mount(
      state({
        last: null,
        reading: false,
        failure: { at: T, status: 503, sentence: 'The counter could not be read (503).' },
      }),
      'tucked',
    );
    expect(screen.getByRole('button', { name: 'Seal: not read' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Seal: reading' })).toBeNull();
    expect(document.querySelectorAll('.mdv-counter--strip .mdv-counter__ring').length).toBe(5);
  });

  it('offline before any read: says so per verb, neither a count nor "reading"', () => {
    mount(state({ last: null, reading: false, offline: true }), 'tucked');
    expect(screen.getByRole('button', { name: 'Seal: offline, not read yet' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Seal: reading' })).toBeNull();
  });
});

describe('The house said — this sitting only', () => {
  it('lists what the house said this sitting, newest first', () => {
    houseSaid('sealed', 'Order to Kermit Lynch sealed');
    houseSaid('refused', 'Order to Revel not sealed', 'Over the ceiling');
    mount(state());
    const items = document.querySelectorAll('.mdv-counter__saidlist li');
    expect(items[0].textContent).toContain('Order to Revel not sealed');
    expect(items[1].textContent).toContain('Order to Kermit Lynch sealed');
  });

  it('keeps nothing in storage, so a reload starts it empty', () => {
    houseSaid('sealed', 'Order to Kermit Lynch sealed');
    expect(window.localStorage.setItem).not.toHaveBeenCalledWith(expect.stringMatching(/said/i), expect.anything());
    expect(window.sessionStorage?.getItem?.('houseSaid') ?? null).toBeNull();
  });
});
