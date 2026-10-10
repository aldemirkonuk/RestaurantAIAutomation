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
  timeOff: [] as Record<string, unknown>[],
  withdrawTimeOff: vi.fn((..._a: unknown[]) => Promise.resolve({})),
  acknowledgeSchedule: vi.fn((..._a: unknown[]) => Promise.resolve({ acknowledged: true })),
  createTimeOff: vi.fn((..._a: unknown[]) => Promise.resolve({})),
  /** The house's zone once read; `undefined` on the first render, as in life. */
  zone: null as string | null,
}));

vi.mock('../../../services/api/team', () => ({
  getMyWeek: () => Promise.resolve(api.myWeek),
  getTeamNotes: () => Promise.resolve({ notes: [], readable: true }),
  openTeamNote: vi.fn(),
  acknowledgeSchedule: api.acknowledgeSchedule,
  assignCover: api.assignCover,
  createTimeOff: api.createTimeOff,
  getTimeOff: () => Promise.resolve(api.timeOff),
  withdrawTimeOff: api.withdrawTimeOff,
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
vi.mock('@/lib/houseZone', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/houseZone')>();
  const React = await import('react');
  return {
    ...real,
    useHouseZone: () => {
      const [z, setZ] = React.useState<string | null | undefined>(undefined);
      React.useEffect(() => setZ(api.zone), []);
      return z;
    },
  };
});

import { MyShiftsNext } from './MyShiftsNext';
import { houseToday } from '@/lib/houseZone';
import { todayIso } from './tm-format';

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

describe('a time-off request still waiting can be taken back (F-936)', () => {
  it('offers Withdraw on a waiting request only, and sends it', async () => {
    api.myWeek = {
      member: { id: 'm-1', display_name: 'Sam' },
      schedule: { id: 's1', week_start: '2026-09-07', status: 'published' },
      mine: [],
      open: [],
    };
    api.timeOff = [
      { id: 't-wait', member_id: 'm-1', start_date: '2026-09-09', end_date: '2026-09-09', status: 'pending' },
      { id: 't-done', member_id: 'm-1', start_date: '2026-09-01', end_date: '2026-09-01', status: 'approved' },
      { id: 't-back', member_id: 'm-1', start_date: '2026-08-20', end_date: '2026-08-20', status: 'withdrawn' },
    ];
    mount();
    const buttons = await screen.findAllByRole('button', { name: 'Withdraw it' });
    expect(buttons).toHaveLength(1);
    expect(screen.getByText(/· withdrawn/)).toBeTruthy();
    fireEvent.click(buttons[0]);
    await vi.waitFor(() => expect(api.withdrawTimeOff).toHaveBeenCalledWith('t-wait'));
    api.timeOff = [];
  });
});

describe('"I have seen it" (F-1005)', () => {
  const week = (member: { id: string; display_name: string } | null) => ({
    member,
    schedule: { id: 's1', week_start: '2026-09-07', status: 'published' },
    acknowledged: false,
    mine: [],
    open: [],
  });

  it('is not offered to someone with no roster row, who has nothing to confirm', async () => {
    api.myWeek = week(null);
    mount();
    await screen.findAllByText('Off');
    expect(screen.queryByRole('button', { name: /I have seen it/ })).toBeNull();
  });

  it('says in the gateway’s words when it was not recorded', async () => {
    api.myWeek = week({ id: 'm-1', display_name: 'Sam' });
    api.acknowledgeSchedule.mockRejectedValueOnce({
      response: { status: 500, data: { message: 'Could not let your manager know you have seen the schedule. Please try again.' } },
    });
    mount();
    fireEvent.click(await screen.findByRole('button', { name: /I have seen it/ }));
    expect(await screen.findByText(/Could not let your manager know/)).toBeTruthy();
  });
});

describe('the same days asked for twice (F-1006)', () => {
  it('shows the gateway naming the request that already holds them', async () => {
    api.myWeek = {
      member: { id: 'm-1', display_name: 'Sam' },
      schedule: { id: 's1', week_start: '2026-09-07', status: 'published' },
      acknowledged: true,
      mine: [],
      open: [],
    };
    api.createTimeOff.mockRejectedValueOnce({
      response: {
        status: 409,
        data: { message: 'These days are already in a request for 2026-09-09 that is waiting for a decision. Nothing new was sent.' },
      },
    });
    mount();
    fireEvent.click(await screen.findByRole('button', { name: /Ask for/ }));
    expect(await screen.findByText(/already in a request for 2026-09-09/)).toBeTruthy();
  });
});

describe('shift times on the house’s clock (F-1007)', () => {
  const week = (country?: string) => ({
    member: { id: 'm-1', display_name: 'Sam' },
    schedule: { id: 's1', week_start: '2026-09-07', status: 'published' },
    acknowledged: true,
    // On the week the page opens on, so its chip is drawn.
    mine: [shift('sh-1', { member_id: 'm-1', state: 'scheduled', shift_date: todayIso(new Date()) })],
    open: [],
    ...(country ? { country } : {}),
  });

  it('prints 24-hour time in a Turkish house', async () => {
    api.myWeek = week('Turkey');
    mount();
    expect(await screen.findByText('17:00–23:00')).toBeTruthy();
  });

  it('keeps the short form where no country is known', async () => {
    api.myWeek = week();
    mount();
    expect(await screen.findByText('5p–11p')).toBeTruthy();
  });
});

describe('the time-off form opens on the house’s day (F-1008)', () => {
  it('moves from the device’s day to the house’s once the zone is read', async () => {
    // Kiritimati and Pago Pago are 25 hours apart: one of them is always on a
    // different day from the device.
    const device = todayIso(new Date());
    const zone = ['Pacific/Kiritimati', 'Pacific/Pago_Pago'].find(
      (z) => todayIso(houseToday(z)) !== device,
    )!;
    api.zone = zone;
    api.myWeek = {
      member: { id: 'm-1', display_name: 'Sam' },
      schedule: { id: 's1', week_start: '2026-09-07', status: 'published' },
      acknowledged: true,
      mine: [],
      open: [],
    };
    try {
      mount();
      const first = (await screen.findByLabelText('First day off')) as HTMLInputElement;
      const last = screen.getByLabelText('Last day off') as HTMLInputElement;
      const house = todayIso(houseToday(zone));
      await vi.waitFor(() => expect(first.value).toBe(house));
      expect(last.value).toBe(house);
    } finally {
      api.zone = null;
    }
  });

  it('asks for both days when one is cleared, not "comes before the first" (F-1019)', async () => {
    api.myWeek = {
      member: { id: 'm-1', display_name: 'Sam' },
      schedule: { id: 's1', week_start: '2026-09-07', status: 'published' },
      acknowledged: true,
      mine: [],
      open: [],
    };
    mount();
    const first = await screen.findByLabelText('First day off');
    fireEvent.change(first, { target: { value: '' } });
    expect(screen.getByRole('alert')).toHaveTextContent('Pick both days.');
    fireEvent.change(first, { target: { value: '2099-01-02' } });
    fireEvent.change(screen.getByLabelText('Last day off'), { target: { value: '2099-01-01' } });
    expect(screen.getByRole('alert')).toHaveTextContent(/comes before the first/);
  });
});
