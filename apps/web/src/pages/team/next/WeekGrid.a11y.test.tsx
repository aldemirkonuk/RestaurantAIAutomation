/**
 * The week grid without a mouse, and on a phone (sim S59, F-398..F-401).
 *
 * - F-398 Offer cover pushes "Shift available" to real people, and nothing
 *   records the offer: once sent, the button for that shift is spent.
 * - F-399 At 375px the grid scrolls sideways; the name column must hold still,
 *   or a chip (a time and a station) no longer says who.
 * - F-400 Duplicate lived only in the right-click menu.
 * - F-401 Adding a shift removes the `+` that opened the sheet, and deleting
 *   one removes the chip; focus must come back to the cell, never <body>.
 *
 * What it cannot cover: jsdom paints nothing, so F-399 is proved on the
 * shipped stylesheet's computed values, not on pixels.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode } from 'react';

const api = vi.hoisted(() => ({
  createShift: vi.fn((..._args: unknown[]) => Promise.resolve({})),
  offerCover: vi.fn((..._args: unknown[]) => Promise.resolve({ offered: 1, notified: 1 })),
  reportCallout: vi.fn((..._args: unknown[]) => Promise.resolve({ callout: {}, open: { id: 'o-new' } })),
}));

vi.mock('../../../services/api/team', () => ({
  createShift: api.createShift,
  deleteShift: vi.fn(() => Promise.resolve(undefined)),
  offerCover: api.offerCover,
  reportCallout: api.reportCallout,
  getMemberPerformance: () => Promise.resolve({ hasData: false }),
}));

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({
    activeRestaurantId: 'r1',
    activeRole: 'owner',
    user: { id: 'u1', restaurantId: 'r1', role: 'owner' },
  }),
}));

import { WeekGrid } from './WeekGrid';
import { fmtDayShort, todayIso } from './tm-format';
import { houseToday } from '@/lib/houseZone';

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

const sam = { id: 'm1', restaurant_id: 'r1', display_name: 'Sam', role: 'staff', position: 'Server', employment_type: 'full_time', avatar_url: null, status: 'active', skills: [], accountLinked: true };
const ada = { ...sam, id: 'm2', display_name: 'Ada' };

const shift = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  restaurant_id: 'r1',
  schedule_id: 'sch1',
  member_id: 'm1',
  shift_date: '2026-08-31',
  start_time: '09:00',
  end_time: '17:00',
  role: 'Bar',
  shift_type: 'am',
  state: 'scheduled',
  note: null,
  shift_breaks: [],
  ...over,
});

function grid(shifts: unknown[], onEditShift = vi.fn(), published = true) {
  return (
    <WeekGrid
      weekStart="2026-08-31"
      shifts={shifts as never}
      members={[sam, ada] as never}
      membersFailed={false}
      certs={[]}
      coverage={[]}
      weekFailed={false}
      engineIdle
      lens="coverage"
      labourEnabled
      moneyVisible={false}
      money={null}
      scheduleId="sch1"
      onEditShift={onEditShift}
      onChanged={() => {}}
      published={published}
    />
  );
}

beforeEach(() => {
  api.createShift.mockClear();
  api.offerCover.mockClear();
  api.reportCallout.mockClear();
  // The week's shifts are still ahead (F-1224): the device clock stands in
  // for the house's, as it does with no zone.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-08-30T12:00:00'));
});
afterEach(() => {
  vi.useRealTimers();
});

/** A called-out shift and the open cover slot its call-out opened. */
const calledOut = () => [
  shift('s1', { state: 'callout' }),
  shift('o1', { member_id: null, state: 'open', shift_type: 'open' }),
];

describe('F-398 — a cover offer is sent once', () => {
  it('spends the button once the offer went out', async () => {
    render(grid(calledOut()), { wrapper });
    fireEvent.click(screen.getAllByText('Bar')[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Offer cover to 1' }));
    await vi.waitFor(() => expect(api.offerCover).toHaveBeenCalledTimes(1));
    const spent = await screen.findByRole('button', { name: 'Cover offered' });
    expect(spent).toBeDisabled();
    fireEvent.click(spent);
    expect(api.offerCover).toHaveBeenCalledTimes(1);
  });
});

describe('F-1113 — "Tap to claim" names a shift someone can claim', () => {
  it('offers nothing while the shift is still held, and says why', () => {
    render(grid([shift('s1')]), { wrapper });
    fireEvent.click(screen.getByText('Bar'));
    expect(screen.getByRole('button', { name: 'Offer cover to 1' })).toBeDisabled();
    expect(screen.getByText(/Sam still holds this shift/)).toBeInTheDocument();
  });

  it("after a call-out, offers the open slot, never the called-out row", async () => {
    render(grid(calledOut()), { wrapper });
    fireEvent.click(screen.getAllByText('Bar')[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Offer cover to 1' }));
    await vi.waitFor(() => expect(api.offerCover).toHaveBeenCalledTimes(1));
    expect(api.offerCover.mock.calls[0][0]).toBe('o1');
    // The person who called out is not the one asked to cover.
    expect(api.offerCover.mock.calls[0][1]).toEqual(['m2']);
  });
});

describe('F-1116 — a call-out is reported once', () => {
  it('carries an idempotency key', async () => {
    render(grid([shift('s1')]), { wrapper });
    fireEvent.click(screen.getByText('Bar'));
    fireEvent.click(screen.getByRole('button', { name: 'Report a call-out' }));
    await vi.waitFor(() => expect(api.reportCallout).toHaveBeenCalledTimes(1));
    expect(api.reportCallout.mock.calls[0][0]).toBe('s1');
    expect(api.reportCallout.mock.calls[0][3]).toMatch(/^callout:/);
  });

  it('offers no second call-out on a shift already called out', () => {
    render(grid(calledOut()), { wrapper });
    fireEvent.click(screen.getAllByText('Bar')[0]);
    expect(screen.queryByRole('button', { name: 'Report a call-out' })).toBeNull();
  });
});

describe('F-400 — Duplicate without a right-click', () => {
  it('is on the selected shift, for a tap or a key', async () => {
    render(grid([shift('s1')]), { wrapper });
    fireEvent.click(screen.getByText('Bar'));
    fireEvent.click(screen.getByRole('button', { name: 'Duplicate onto the same day' }));
    await vi.waitFor(() => expect(api.createShift).toHaveBeenCalledTimes(1));
    expect(api.createShift.mock.calls[0][0]).toMatchObject({ shiftDate: '2026-08-31', memberId: 'm1' });
  });
});

describe('F-401 — focus comes back to the cell, never <body>', () => {
  it('lands on the new shift after an add removed the + that opened the sheet', () => {
    const onEditShift = vi.fn();
    const { rerender } = render(grid([], onEditShift), { wrapper });
    const add = screen.getAllByRole('button', { name: /^Add a shift for Sam on/ })[0];
    add.focus();
    fireEvent.click(add);
    expect(onEditShift).toHaveBeenCalled();
    // The sheet held focus, then closed; the week re-reads with the new shift.
    (document.activeElement as HTMLElement | null)?.blur();
    rerender(grid([shift('new')], onEditShift));
    expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement?.textContent).toContain('Bar');
  });

  it('lands on the empty cell’s + after a delete removed the chip', () => {
    const onEditShift = vi.fn();
    const { rerender } = render(grid([shift('s1')], onEditShift), { wrapper });
    fireEvent.click(screen.getByText('Bar'));
    fireEvent.click(screen.getByRole('button', { name: 'Edit shift' }));
    (document.activeElement as HTMLElement | null)?.blur();
    rerender(grid([], onEditShift));
    expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement?.getAttribute('aria-label')).toMatch(/^Add a shift for Sam on/);
  });
});

describe('F-399 — the name column holds still at phone width', () => {
  it('pins the member cell and the corner head to the left', () => {
    const css = readFileSync(join(__dirname, 'team-next.css'), 'utf8');
    const style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);
    try {
      render(grid([shift('s1')]), { wrapper });
      const cell = document.querySelector('.tm-membercell') as HTMLElement;
      const corner = document.querySelector('.tm-row > .tm-dayhead') as HTMLElement;
      for (const el of [cell, corner]) {
        const cs = getComputedStyle(el);
        expect(cs.position).toBe('sticky');
        expect(cs.left).toBe('0px');
      }
    } finally {
      style.remove();
    }
  });
});

describe('F-1073 — the grid marks the house’s today, not the device’s', () => {
  it('lights the column of the day it is at the house', () => {
    const device = todayIso(new Date());
    const zone = ['Pacific/Kiritimati', 'Pacific/Pago_Pago'].find(
      (z) => todayIso(houseToday(z)) !== device,
    )!;
    const house = todayIso(houseToday(zone));
    const monday = (iso: string) => {
      const d = new Date(`${iso}T00:00:00`);
      d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
      return todayIso(d);
    };
    const { container } = render(
      <WeekGrid
        weekStart={monday(house)}
        shifts={[]}
        members={[sam] as never}
        membersFailed={false}
        certs={[]}
        coverage={[]}
        weekFailed={false}
        engineIdle
        lens="coverage"
        labourEnabled
        moneyVisible={false}
        money={null}
        scheduleId="sch1"
        onEditShift={vi.fn()}
        onChanged={() => {}}
        zone={zone}
      />,
      { wrapper },
    );
    const lit = container.querySelectorAll('.tm-dayhead[data-today="true"]');
    expect(lit).toHaveLength(1);
    expect(lit[0].querySelector('.tm-dayhead__n')?.textContent).toBe(fmtDayShort(house));
  });
});

describe('F-1224 — no call-out or offer where nobody could take the shift', () => {
  it('offers neither on a week not yet published, and says why', () => {
    render(grid(calledOut().concat(shift('s2', { shift_date: '2026-09-01' })), vi.fn(), false), {
      wrapper,
    });
    fireEvent.click(screen.getAllByText('Bar')[0]);
    expect(screen.queryByRole('button', { name: /^Offer cover/ })).toBeNull();
    expect(screen.getByText(/not published yet/)).toBeInTheDocument();
    fireEvent.click(screen.getAllByText('Bar')[1]);
    expect(screen.queryByRole('button', { name: 'Report a call-out' })).toBeNull();
  });

  it('offers neither on a shift that is over, in the panel or the menu', () => {
    vi.setSystemTime(new Date('2026-08-31T18:00:00'));
    render(grid([shift('s1')]), { wrapper });
    const chip = screen.getByText('Bar');
    fireEvent.click(chip);
    expect(screen.queryByRole('button', { name: 'Report a call-out' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Offer cover/ })).toBeNull();
    expect(screen.getByText(/This shift is over/)).toBeInTheDocument();
    fireEvent.contextMenu(chip);
    expect(screen.queryByText('Report a call-out')).toBeNull();
    expect(screen.queryByText('Offer cover')).toBeNull();
  });
});

describe('F-1225 — an offer says whom it reached, and is never sent to nobody', () => {
  it('names how many were asked and who has no account', async () => {
    api.offerCover.mockResolvedValueOnce({ offered: 2, notified: 1, noAccount: 1 } as never);
    render(grid(calledOut()), { wrapper });
    fireEvent.click(screen.getAllByText('Bar')[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Offer cover to 1' }));
    expect(await screen.findByText(/Asked 1 person just now/)).toBeInTheDocument();
    expect(screen.getByText(/1 person picked has no account/)).toBeInTheDocument();
  });

  it('says nobody was reached when the offer landed on no bell', async () => {
    api.offerCover.mockResolvedValueOnce({ offered: 1, notified: 0, noAccount: 0 } as never);
    render(grid(calledOut()), { wrapper });
    fireEvent.click(screen.getAllByText('Bar')[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Offer cover to 1' }));
    expect(await screen.findByText(/Nobody could be reached/)).toBeInTheDocument();
  });

  it('greys the menu’s Offer cover when nobody is free', () => {
    // Ada is busy that day, and Sam called out: nobody is left to ask.
    render(
      grid([...calledOut(), shift('a1', { member_id: 'm2', start_time: '18:00', end_time: '22:00' })]),
      { wrapper },
    );
    fireEvent.contextMenu(screen.getAllByText('Bar')[0]);
    // The menu's item and the opened detail's button both say it, both greyed.
    const items = screen.getAllByText('Nobody is free to cover').map((t) => t.closest('button'));
    expect(items).toHaveLength(2);
    for (const item of items) expect(item).toBeDisabled();
    expect(api.offerCover).not.toHaveBeenCalled();
  });
});

describe('F-1231 — the shift detail opens where a phone can see it', () => {
  it('holds the detail to the visible left edge of the scrolling grid', () => {
    const css = readFileSync(join(__dirname, 'team-next.css'), 'utf8');
    const style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);
    try {
      render(grid([shift('s1')]), { wrapper });
      fireEvent.click(screen.getByText('Bar'));
      const cs = getComputedStyle(document.querySelector('.tm-expand') as HTMLElement);
      expect(cs.position).toBe('sticky');
      expect(cs.left).toBe('0px');
      expect(css).toMatch(/\.tm-expand \{[^}]*width: 100cqw/);
    } finally {
      style.remove();
    }
  });
});
