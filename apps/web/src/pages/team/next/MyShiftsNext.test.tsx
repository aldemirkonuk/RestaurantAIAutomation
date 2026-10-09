/**
 * My Shifts — what a staff member is shown of a week (F-506, F-507).
 *
 * A draft week used to render its shifts as the person's real ones with no
 * draft word, because the note keyed on `schedule === null` while every week
 * with shifts has a (draft) schedule row. And a refused claim said "it is still
 * open for someone else" whatever the gateway's reason was.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const api = vi.hoisted(() => ({
  myWeek: {} as Record<string, unknown>,
  assignCover: vi.fn(),
}));

vi.mock('../../../services/api/team', () => ({
  getMyWeek: () => Promise.resolve(api.myWeek),
  getTeamNotes: () => Promise.resolve({ notes: [], readable: true }),
  openTeamNote: vi.fn(),
  acknowledgeSchedule: vi.fn(),
  assignCover: api.assignCover,
  createTimeOff: vi.fn(),
}));
vi.mock('./useTeamNextData', () => ({ useActiveRestaurantId: () => 'r-1' }));
vi.mock('./useHouseAreas', () => ({
  useHouseAreas: () => ({
    areas: null,
    away: null,
    awayFailed: false,
    areasFailed: false,
    awayByUser: new Map(),
  }),
}));
vi.mock('./AwayCard', () => ({ AwayCard: () => null, HouseAwayCard: () => null }));
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { userId: 'u-1', name: 'Sam' } }),
}));
vi.mock('@/components/mudavym', () => ({ Wordmark: () => null }));

import { MyShiftsNext } from './MyShiftsNext';

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MyShiftsNext />
    </QueryClientProvider>,
  );
}

const shift = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  shift_date: '2026-09-08',
  start_time: '17:00',
  end_time: '23:00',
  state: 'open',
  role: 'Bar',
  ...extra,
});

beforeEach(() => {
  api.assignCover.mockReset();
});

describe('a week its manager has not published', () => {
  it('says the week is not out yet, and no day reads as Off', async () => {
    api.myWeek = {
      member: { id: 'm-1', display_name: 'Sam' },
      schedule: { id: 's1', week_start: '2026-09-07', status: 'draft' },
      mine: [],
      open: [],
    };
    mount();
    expect(await screen.findByText(/has not published this week yet/)).toBeTruthy();
    expect(screen.queryByText('Off')).toBeNull();
    expect(screen.getAllByText(/not out yet/).length).toBe(7);
  });

  it('shows no draft shift as the person’s own or as one to take', async () => {
    // An older gateway still sends the draft's rows; the page must not use them.
    api.myWeek = {
      member: { id: 'm-1', display_name: 'Sam' },
      schedule: { id: 's1', week_start: '2026-09-07', status: 'draft' },
      mine: [shift('sh-mine', { member_id: 'm-1', state: 'scheduled' })],
      open: [shift('sh-open')],
    };
    mount();
    await screen.findByText(/has not published this week yet/);
    expect(screen.queryByText('Take it')).toBeNull();
    expect(document.querySelector('.tm-chip')).toBeNull();
  });
});

describe('a published week', () => {
  it('shows the shifts with no draft note, and a refused claim in the gateway’s words', async () => {
    api.myWeek = {
      member: { id: 'm-1', display_name: 'Sam' },
      schedule: { id: 's1', week_start: '2026-09-07', status: 'published' },
      acknowledged: true,
      mine: [],
      open: [shift('sh-open')],
    };
    api.assignCover.mockRejectedValue({
      response: { data: { message: "This shift has already ended, so it can't be taken now." } },
    });
    mount();
    fireEvent.click(await screen.findByText('Take it'));
    expect(await screen.findByText(/already ended/)).toBeTruthy();
    expect(screen.queryByText(/has not published this week yet/)).toBeNull();
  });
});
