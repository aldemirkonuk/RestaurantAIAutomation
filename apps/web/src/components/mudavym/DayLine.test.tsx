/**
 * The day line (sketch 119 §E, a PAGE element): gated like the shell, and
 * every honesty rule it draws — hours unset in words, a failed register
 * named with "Read again", offline ticks marked as from the last read (never
 * live), and "N of 3" never a bigger denominator for a register this build
 * does not read.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { DayLine } from './DayLine';
import type { DayRegister, HouseDayRead } from '../../lib/mudavym/dayRead';
import type { HouseDayState } from '../../lib/mudavym/useHouseDay';

const shellOn = vi.hoisted(() => ({ current: true }));
const dayState = vi.hoisted(() => ({
  current: {
    last: null,
    reading: false,
    failure: null,
    offline: false,
    readNow: vi.fn(),
  } as HouseDayState,
}));

vi.mock('../../lib/mudavym/useMudavymDesign', () => ({
  useMudavymDesign: () => shellOn.current,
}));
vi.mock('../../lib/mudavym/useHouseDay', () => ({
  useHouseDay: () => dayState.current,
}));
vi.mock('../../contexts/AuthContext', async () => {
  const React = await import('react');
  const AuthContext = React.createContext<unknown>({ activeRestaurantId: 'r-1' });
  return { AuthContext };
});

function mount() {
  return render(
    <MemoryRouter>
      <DayLine />
    </MemoryRouter>,
  );
}

const T = '2026-09-21T14:02:11Z';

function read(registers: DayRegister[], overrides: Partial<HouseDayRead> = {}): HouseDayRead {
  return {
    readAt: T,
    house: { id: 'r-1', timezone: 'America/Chicago' },
    hours: { state: 'recorded', windows: [{ startAt: '2026-09-21T16:00:00Z', endAt: '2026-09-22T04:00:00Z' }] },
    registers,
    ...overrides,
  };
}

const CALENDAR: DayRegister = {
  key: 'calendar',
  state: 'answered',
  readAt: T,
  ms: 5,
  count: 1,
  complete: true,
  ticks: [{ id: 'e-1', at: '2026-09-21T19:00:00Z', label: 'Kermit Lynch tasting', href: '/calendar?event=e-1' }],
};
const DELIVERY: DayRegister = {
  key: 'deliveryArrived',
  state: 'answered',
  readAt: T,
  ms: 5,
  count: 1,
  complete: true,
  ticks: [{ id: 'delivery-o-1', at: '2026-09-21T16:00:00Z', label: 'Order ORD-1 — counted at the door', href: '/orders?highlight=o-1' }],
};
const REMINDERS_DOWN: DayRegister = {
  key: 'reminders',
  state: 'unreadable',
  readAt: T,
  ms: 8000,
  status: null,
  sentence: "Today's reminders did not answer within 8 s.",
};

beforeEach(() => {
  // The now mark reads the device's clock; pin it between the two fixture
  // ticks (16:00Z and 19:00Z) so every test sees the same line.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-21T17:30:00Z'));
  shellOn.current = true;
  dayState.current = { last: null, reading: false, failure: null, offline: false, readNow: vi.fn() };
});
afterEach(() => {
  vi.useRealTimers();
});

describe('the shell gate', () => {
  it('renders nothing when the shell is off', () => {
    shellOn.current = false;
    const { container } = mount();
    expect(container.textContent).toBe('');
  });
});

describe('before the first read lands', () => {
  it('says it is reading', () => {
    mount();
    expect(screen.getByText('Reading the day…')).toBeTruthy();
  });

  it('offline before any read: says it will read on return, not a blank line', () => {
    dayState.current = { ...dayState.current, offline: true };
    mount();
    expect(screen.getByText(/will read on return/)).toBeTruthy();
  });

  it('a failed first read names the failure with a working "Read again"', () => {
    const readNow = vi.fn();
    dayState.current = { ...dayState.current, failure: { at: T, status: 503, sentence: 'The day line could not be read (503).' }, readNow };
    mount();
    expect(screen.getByText(/could not be read \(503\)/)).toBeTruthy();
    screen.getByText('Read again').click();
    expect(readNow).toHaveBeenCalledTimes(1);
  });
});

/**
 * "Count what's built" — the founder, 2026-09-21, on the day line. The head is
 * "N of 3": the three registers this build reads, with no placeholder row and
 * no bigger denominator for the sketch's other three (deliveries expected,
 * shifts, the market), which are not built.
 */
describe("count what's built", () => {
  const REMINDERS_UP: DayRegister = {
    key: 'reminders',
    state: 'answered',
    readAt: T,
    ms: 5,
    count: 0,
    complete: true,
    ticks: [],
  };

  it('the three built registers read "3 of 3", and nothing unbuilt is drawn', () => {
    dayState.current = { ...dayState.current, last: read([DELIVERY, CALENDAR, REMINDERS_UP]) };
    const { container } = mount();
    expect(screen.getByText(/3 of 3 registers/)).toBeTruthy();
    const text = container.textContent ?? '';
    expect(text).not.toMatch(/of 6/);
    expect(text).not.toMatch(/not built/i);
    expect(text).not.toMatch(/market|shifts|expected/i);
  });

  it('one of the three down reads "2 of 3 · 1 not read" — still out of three', () => {
    dayState.current = { ...dayState.current, last: read([DELIVERY, CALENDAR, REMINDERS_DOWN]) };
    mount();
    expect(screen.getByText(/2 of 3 registers · 1 not read/)).toBeTruthy();
  });
});

describe('a landed read', () => {
  it('draws every tick, oldest first, and the head counts registers not acts', () => {
    dayState.current = { ...dayState.current, last: read([CALENDAR, DELIVERY]) };
    mount();
    expect(screen.getByText('Order ORD-1 — counted at the door')).toBeTruthy();
    expect(screen.getByText('Kermit Lynch tasting')).toBeTruthy();
    expect(screen.getByText(/2 of 2 registers/)).toBeTruthy();
    const items = screen.getAllByRole('listitem').map((li) => li.textContent);
    expect(items[0]).toContain('Order ORD-1'); // 16:00 before 19:00
  });

  it('a register that did not answer is named, not silently dropped', () => {
    dayState.current = { ...dayState.current, last: read([CALENDAR, REMINDERS_DOWN]) };
    mount();
    expect(screen.getByText(/1 of 2 registers · 1 not read/)).toBeTruthy();
    expect(screen.getByText(/did not answer within 8 s/)).toBeTruthy();
  });

  it('hours not set: says so in words, and the ticks still draw', () => {
    dayState.current = {
      ...dayState.current,
      last: read([CALENDAR], { hours: { state: 'not_recorded', windows: [], sentence: 'Hours not set — no prep, doors or close today.' } }),
    };
    mount();
    expect(screen.getByText('Hours not set — no prep, doors or close today.')).toBeTruthy();
    expect(screen.getByText('Kermit Lynch tasting')).toBeTruthy();
  });

  it('offline with a last read: the ticks are marked as from the last read, never live', () => {
    dayState.current = { ...dayState.current, last: read([CALENDAR]), offline: true };
    mount();
    expect(screen.getByText(/from 09:02 · offline/)).toBeTruthy();
    const list = document.querySelector('.mdv-dayline__ticks');
    expect(list?.getAttribute('data-stale')).toBe('true');
  });

  it('a tick opens to its record', () => {
    dayState.current = { ...dayState.current, last: read([CALENDAR]) };
    mount();
    const link = screen.getByRole('link', { name: /Kermit Lynch tasting/ });
    expect(link.getAttribute('href')).toBe('/calendar?event=e-1');
  });
});

describe('now, and what is behind or ahead of it', () => {
  it('marks now by the device clock between the tick behind it and the one ahead', () => {
    dayState.current = { ...dayState.current, last: read([CALENDAR, DELIVERY]) };
    mount();
    const items = Array.from(document.querySelectorAll('.mdv-dayline__ticks > li'));
    expect(items.map((li) => li.className || 'tick')).toEqual(['tick', 'mdv-dayline__now', 'tick']);
    expect(items[0].textContent).toContain('Order ORD-1'); // 16:00Z, behind now
    expect(items[2].textContent).toContain('Kermit Lynch tasting'); // 19:00Z, ahead
    // 17:30Z in the house's zone (America/Chicago, CDT) is 12:30.
    expect(items[1].textContent).toContain('12:30');
    expect(items[1].getAttribute('aria-label')).toMatch(/by this device's clock/);
  });

  it('offline: now is hollow and says so, the head says it will read on return', () => {
    dayState.current = { ...dayState.current, last: read([CALENDAR, DELIVERY]), offline: true };
    mount();
    const now = document.querySelector('.mdv-dayline__now');
    expect(now?.getAttribute('data-offline')).toBe('true');
    expect(now?.textContent).toContain('now · offline');
    expect(screen.getByText(/offline · will read on return/)).toBeTruthy();
  });

  it('a register that did not answer carries a working "Read again" (online only)', () => {
    const readNow = vi.fn();
    dayState.current = { ...dayState.current, last: read([CALENDAR, REMINDERS_DOWN]), readNow };
    const { unmount } = mount();
    screen.getByText('Read again').click();
    expect(readNow).toHaveBeenCalledTimes(1);
    unmount();
    dayState.current = { ...dayState.current, offline: true };
    mount();
    expect(screen.queryByText('Read again')).toBeNull();
  });

  it('no ticks and a register down: never "nothing on the line" as if the day were read whole', () => {
    dayState.current = { ...dayState.current, last: read([REMINDERS_DOWN]) };
    mount();
    expect(screen.queryByText('Nothing on the line yet today.')).toBeNull();
    expect(screen.getByText('Nothing on the line from the registers that answered.')).toBeTruthy();
  });
});
