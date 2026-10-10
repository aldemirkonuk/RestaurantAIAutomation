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
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode } from 'react';

const api = vi.hoisted(() => ({
  createShift: vi.fn((..._args: unknown[]) => Promise.resolve({})),
  offerCover: vi.fn((..._args: unknown[]) => Promise.resolve({ offered: 1, notified: 1 })),
}));

vi.mock('../../../services/api/team', () => ({
  createShift: api.createShift,
  deleteShift: vi.fn(() => Promise.resolve(undefined)),
  offerCover: api.offerCover,
  reportCallout: vi.fn(() => Promise.resolve({})),
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

function grid(shifts: unknown[], onEditShift = vi.fn()) {
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
    />
  );
}

beforeEach(() => {
  api.createShift.mockClear();
  api.offerCover.mockClear();
});

describe('F-398 — a cover offer is sent once', () => {
  it('spends the button once the offer went out', async () => {
    render(grid([shift('s1')]), { wrapper });
    fireEvent.click(screen.getByText('Bar'));
    fireEvent.click(screen.getByRole('button', { name: 'Offer cover to 1' }));
    await vi.waitFor(() => expect(api.offerCover).toHaveBeenCalledTimes(1));
    const spent = await screen.findByRole('button', { name: 'Cover offered' });
    expect(spent).toBeDisabled();
    fireEvent.click(spent);
    expect(api.offerCover).toHaveBeenCalledTimes(1);
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
