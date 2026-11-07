/**
 * My Shifts never reports a week it does not know as a week off
 * (QA round 4, B1).
 *
 *  - A failed `my-week` read (the gateway now answers one with a 500, not an
 *    empty week) says it failed and offers a retry; no day says "Off".
 * The control: a published week with nothing on a day still says "Off".
 */

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

// A plain function, not a spy: the page's query owns the rejection, and a
// spy's own bookkeeping of a rejected result is reported as unhandled.
const api = vi.hoisted(() => ({
  myWeek: (() => Promise.resolve({})) as (weekStart: string) => Promise<unknown>,
}));

vi.mock('../../../services/api/team', () => ({
  getMyWeek: (weekStart: string) => api.myWeek(weekStart),
  acknowledgeSchedule: vi.fn(() => Promise.resolve({ acknowledged: true })),
  assignCover: vi.fn(() => Promise.resolve({})),
  createTimeOff: vi.fn(() => Promise.resolve({})),
  getTeamNotes: () => Promise.resolve({ notes: [], readable: true, reason: null }),
  openTeamNote: vi.fn(() => Promise.resolve({})),
}));
vi.mock('./useTeamNextData', () => ({ useActiveRestaurantId: () => 'r-alpha' }));
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { userId: 'u-staff', name: 'Ana' } }),
}));
vi.mock('./useHouseAreas', () => ({
  useHouseAreas: () => ({
    areas: null,
    areasFailed: false,
    away: null,
    awayFailed: false,
    awayByUser: new Map(),
  }),
}));
vi.mock('./AwayCard', () => ({ AwayCard: () => null, HouseAwayCard: () => null }));

import { MyShiftsNext } from './MyShiftsNext';
import { mondayOf } from './tm-format';

function wrap(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

const WEEK = mondayOf(new Date());
const member = { id: 'm-staff', display_name: 'Ana' };

describe('MyShiftsNext', () => {

  it('a failed read says so and offers a retry; no day reads as Off', async () => {
    api.myWeek = () => Promise.reject(new Error("Could not read this week's shifts"));
    wrap(<MyShiftsNext />);
    expect(await screen.findByText(/Your week could not be loaded/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
    expect(screen.queryByText('Off')).toBeNull();
  });

  it('control: a published week with nothing on a day still says Off', async () => {
    api.myWeek = async () => ({
      member,
      schedule: { id: 's1', week_start: WEEK, status: 'published' },
      mine: [],
      open: [],
      acknowledged: true,
    });
    wrap(<MyShiftsNext />);
    expect(await screen.findAllByText('Off')).toHaveLength(7);
    expect(screen.queryByText('Not published yet')).toBeNull();
  });
});
