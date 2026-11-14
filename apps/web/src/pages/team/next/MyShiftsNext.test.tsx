/**
 * My Shifts never reports a week it does not know as a week off
 * (QA round 4, B1 and H2).
 *
 *  - A failed `my-week` read says it failed and offers a retry; no day says
 *    "Off".
 *  - An unpublished week, whose shifts the gateway withholds from staff
 *    (`draftsWithheld`), says "Not published yet" on each day, never "Off".
 *  - An owner or manager who lands here sees each unpublished shift marked
 *    draft.
 * The control: a published week with nothing on a day still says "Off".
 */

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

// A plain function, not a spy: the page's query owns the rejection, and a
// spy's own bookkeeping of a rejected result is reported as unhandled.
const api = vi.hoisted(() => ({
  myWeek: (() => Promise.resolve({})) as (weekStart: string) => Promise<unknown>,
  assign: (() => Promise.resolve({})) as () => Promise<unknown>,
}));

vi.mock('../../../services/api/team', () => ({
  getMyWeek: (weekStart: string) => api.myWeek(weekStart),
  acknowledgeSchedule: vi.fn(() => Promise.resolve({ acknowledged: true })),
  assignCover: () => api.assign(),
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

  it('an unpublished week withheld from staff says "Not published yet", never Off', async () => {
    api.myWeek = async () => ({
      member,
      schedule: null,
      mine: [],
      open: [],
      acknowledged: false,
      published: false,
      draftsWithheld: true,
    });
    wrap(<MyShiftsNext />);
    expect(await screen.findAllByText('Not published yet')).toHaveLength(7);
    expect(screen.queryByText('Off')).toBeNull();
    expect(screen.getByText(/has not published this week yet/)).toBeTruthy();
  });

  it('an owner or manager here sees an unpublished shift marked draft', async () => {
    api.myWeek = async () => ({
      member,
      schedule: { id: 's1', week_start: WEEK, status: 'draft' },
      mine: [
        {
          id: 'sh1',
          shift_date: WEEK,
          start_time: '09:00',
          end_time: '17:00',
          role: 'server',
          shift_type: 'regular',
          state: 'scheduled',
          draft: true,
        },
      ],
      open: [],
      acknowledged: false,
      published: false,
      draftsWithheld: false,
    });
    wrap(<MyShiftsNext />);
    expect(await screen.findByText(/server · draft/)).toBeTruthy();
    expect(screen.getByText(/Shifts marked draft may still change/)).toBeTruthy();
  });

  it('control: a published week with nothing on a day still says Off', async () => {
    api.myWeek = async () => ({
      member,
      schedule: { id: 's1', week_start: WEEK, status: 'published' },
      mine: [],
      open: [],
      acknowledged: true,
      published: true,
      draftsWithheld: false,
    });
    wrap(<MyShiftsNext />);
    expect(await screen.findAllByText('Off')).toHaveLength(7);
    expect(screen.queryByText('Not published yet')).toBeNull();
  });

  // r29 walk: the gateway sends a cover shift's note to staff ("Cover for Sam
  // Rivera, who called out"; the call-out reason stays on the original), but
  // the list of open shifts never printed it.
  it('an open shift a staff member can pick up shows its own note', async () => {
    api.myWeek = async () => ({
      member,
      schedule: { id: 's1', week_start: WEEK, status: 'published' },
      mine: [],
      open: [
        {
          id: 'sh-cover',
          shift_date: WEEK,
          start_time: '17:00',
          end_time: '23:00',
          role: 'Floor',
          shift_type: 'open',
          state: 'open',
          note: 'Cover for Sam Rivera, who called out',
          draft: false,
        },
        {
          id: 'sh-plain',
          shift_date: WEEK,
          start_time: '12:00',
          end_time: '16:00',
          role: 'Patio',
          shift_type: 'open',
          state: 'open',
          note: null,
          draft: false,
        },
      ],
      acknowledged: true,
      published: true,
      draftsWithheld: false,
    });
    wrap(<MyShiftsNext />);
    expect(await screen.findByText('Cover for Sam Rivera, who called out')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Take it' })).toHaveLength(2);
  });

  // r29 walk: a refused claim printed only "The shift was not claimed" while
  // the gateway's 403 said why and what to do.
  describe('a refused claim says why', () => {
    const week = async () => ({
      member,
      schedule: { id: 's1', week_start: WEEK, status: 'published' },
      mine: [],
      open: [
        { id: 'sh-bar', shift_date: WEEK, start_time: '12:00', end_time: '16:00', role: 'Bartender', shift_type: 'open', state: 'open', note: null, draft: false },
      ],
      acknowledged: true,
      published: true,
      draftsWithheld: false,
    });
    const SAID =
      'This shift is for Bartender, and your position and skills on the team do not list it. A manager can still give it to you. Nothing was changed.';

    it("prints the gateway's sentence", async () => {
      api.myWeek = week;
      api.assign = () => Promise.reject(Object.assign(new Error('Request failed with status code 403'), { response: { status: 403, data: { message: SAID } } }));
      wrap(<MyShiftsNext />);
      fireEvent.click(await screen.findByRole('button', { name: 'Take it' }));
      expect(await screen.findByText(SAID)).toBeTruthy();
      expect(screen.queryByText(/still open for someone else/)).toBeNull();
    });

    it('with no sentence (offline) it keeps the fixed line', async () => {
      api.myWeek = week;
      api.assign = () => Promise.reject(new Error('Network Error'));
      wrap(<MyShiftsNext />);
      fireEvent.click(await screen.findByRole('button', { name: 'Take it' }));
      expect(await screen.findByText(/The shift was not claimed — it is still open for someone else\./)).toBeTruthy();
    });
  });
});
