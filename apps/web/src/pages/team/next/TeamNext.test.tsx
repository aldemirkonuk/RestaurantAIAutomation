/**
 * TeamNext contracts — the three founder additions derive honestly:
 * suggested cover is a fair-rotation pick (free that day, role match, fewest
 * hours); an unparseable gap period disables Assign with the reason; an
 * expired cert blocks that member's shifts and the page says the schedule
 * should not publish; labour-off is withheld in words, never a zero.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const api = vi.hoisted(() => ({
  week: {} as Record<string, unknown>,
  members: [] as unknown[],
  certs: [] as unknown[],
  templates: [{ id: 't1', role: 'line', day_of_week: null, shift_period: 'pm', min_staff: 1 }] as unknown[],
  createShift: vi.fn(() => Promise.resolve({})),
}));

vi.mock('../../../services/api/team', () => ({
  getWeek: () => Promise.resolve(api.week),
  getTeamMembers: () => Promise.resolve(api.members),
  getCertifications: () => Promise.resolve(api.certs),
  getCoverageTemplates: () => Promise.resolve(api.templates),
  createCoverageTemplate: vi.fn(() => Promise.resolve({})),
  createShift: api.createShift,
  broadcast: vi.fn(() => Promise.resolve({})),
}));

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({
    activeRestaurantId: 'r1',
    activeRole: 'owner',
    user: { id: 'u1', restaurantId: 'r1', role: 'owner' },
  }),
}));

vi.mock('../command/MyShifts', () => ({ MyShifts: () => <div>My Shifts</div> }));

import TeamNext from './TeamNext';
import { useTeamNextData } from './useTeamNextData';
import { mondayOf } from './tm-format';

const member = (id: string, name: string, position: string, extra: Record<string, unknown> = {}) => ({
  id,
  restaurant_id: 'r1',
  user_id: null,
  display_name: name,
  email: null,
  phone: null,
  avatar_url: null,
  position,
  employment_type: 'hourly',
  home_location: null,
  hourly_wage: null,
  skills: [],
  hire_date: null,
  status: 'active',
  notes: null,
  role: 'staff',
  accountLinked: false,
  ...extra,
});

const shift = (memberId: string | null, date: string, start = '17:00', end = '23:00') => ({
  id: `s-${memberId}-${date}-${start}`,
  restaurant_id: 'r1',
  schedule_id: 'sch1',
  member_id: memberId,
  shift_date: date,
  start_time: start,
  end_time: end,
  role: 'line',
  shift_type: 'regular',
  state: 'assigned',
  note: null,
  labor_cost: null,
});

function weekPayload(over: Record<string, unknown> = {}) {
  return {
    schedule: { id: 'sch1', restaurant_id: 'r1', week_start: '2026-08-31', status: 'draft', published_at: null },
    shifts: [],
    coverage: { days: [], totalGaps: 0 },
    labor: { enabled: false, totalHours: 0 },
    receipts: [],
    settings: { restaurant_id: 'r1', labor_tracking_enabled: false, wage_visible: false, labor_target_pct: 0 },
    ...over,
  };
}

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

async function settled<T>(hook: () => T): Promise<{ current: T }> {
  const r = renderHook(hook, { wrapper });
  await vi.waitFor(() => {
    const cur = r.result.current as { hasData: boolean };
    if (!cur.hasData) throw new Error('not settled');
  });
  return r.result;
}

beforeEach(() => {
  api.week = weekPayload();
  api.members = [];
  api.certs = [];
});

describe('mondayOf', () => {
  it('anchors on the local calendar date with UTC-only arithmetic', () => {
    expect(mondayOf(new Date(2026, 8, 2, 12, 0))).toBe('2026-08-31'); // Wed noon
    expect(mondayOf(new Date(2026, 8, 6, 23, 30))).toBe('2026-08-31'); // Sun, late evening
    expect(mondayOf(new Date(2026, 8, 7, 0, 10))).toBe('2026-09-07'); // Mon, just after midnight
  });
});

describe('useTeamNextData derivations', () => {
  it('suggests the free, exact-role member with the fewest hours, with copied times', async () => {
    api.members = [
      member('m1', 'Busy', 'line'),
      member('m2', 'Light', 'line'),
      member('m3', 'Occupied', 'line'),
      member('m4', 'Wrong', 'Airline'), // exact-match rule: never suggested for "line"
    ];
    api.week = weekPayload({
      shifts: [
        shift('m1', '2026-09-01'), // 6h already
        shift('m1', '2026-09-02'),
        shift('m3', '2026-09-05'), // busy ON the gap day
      ],
      coverage: {
        totalGaps: 1,
        days: [
          // real coverage rules speak "am"/"pm", never clock times
          { date: '2026-09-05', staffed: 1, openShifts: 2, status: 'gap', gaps: [{ role: 'line', period: 'pm', staffed: 1, required: 3 }] },
        ],
      },
    });
    const result = await settled(() => useTeamNextData(new Date('2026-09-02T12:00:00')));
    expect(result.current.gaps).toHaveLength(1);
    expect(result.current.gaps[0].unfilled).toBe(2);
    expect(result.current.gaps[0].suggested?.name).toBe('Light'); // 0h beats Busy's 12h; Occupied is on that day
    // times are copied from the same-day pm line shift, provenance stated
    expect(result.current.gaps[0].times).toEqual({
      start: '17:00',
      end: '23:00',
      source: "times from this day's line shifts",
    });
  });

  it('counts the week a lapsed member is scheduled for — the exposure, not a link', async () => {
    api.members = [member('m1', 'Ayşe', 'Sommelier')];
    api.week = weekPayload({ shifts: [shift('m1', '2026-09-01'), shift('m1', '2026-09-03')] });
    api.certs = [
      { id: 'c1', member_id: 'm1', cert_type: 'food-handler', issued_at: null, expires_at: '2026-08-20', doc_url: null, status: 'expired' },
      { id: 'c2', member_id: 'm1', cert_type: 'alcohol-service', issued_at: null, expires_at: '2026-09-04', doc_url: null, status: 'expiring' },
    ];
    const result = await settled(() => useTeamNextData(new Date('2026-09-02T12:00:00')));
    const byId = Object.fromEntries(
      result.current.certExposures.map((b) => [b.cert.id, b.shiftsThisWeek]),
    );
    // Both rows report the same fact: this member works 2 shifts this week.
    // Nothing here claims either credential is required for either shift.
    expect(byId.c1).toBe(2);
    expect(byId.c2).toBe(2);
    // The countable claim is people, not shifts, and only for a lapsed card.
    expect(result.current.exposedMembers).toBe(1);
  });
});

describe('TeamNext rendering', () => {
  it('withholds the labour figure in words when tracking is off', async () => {
    render(<TeamNext />, { wrapper });
    expect(await screen.findByText(/Labour tracking is off/)).toBeInTheDocument();
    expect(screen.getByText(/withheld number, not a zero/)).toBeInTheDocument();
  });

  it('disables Assign with an on-screen reason when no shift exists to copy times from', async () => {
    api.members = [member('m2', 'Light', 'line')];
    api.week = weekPayload({
      coverage: {
        totalGaps: 1,
        days: [
          { date: '2026-09-05', staffed: 0, openShifts: 1, status: 'gap', gaps: [{ role: 'line', period: 'pm', staffed: 0, required: 1 }] },
        ],
      },
    });
    render(<TeamNext />, { wrapper });
    const btn = await screen.findByRole('button', { name: 'Assign' });
    expect(btn).toBeDisabled();
    expect(screen.getByText(/no shift of this role to copy times from/)).toBeInTheDocument();
  });

  it('assigns with the camelCase payload the gateway DTO requires', async () => {
    api.createShift.mockClear();
    api.members = [member('m2', 'Light', 'line')];
    api.week = weekPayload({
      shifts: [shift('m9', '2026-09-01', '16:00', '22:00')],
      coverage: {
        totalGaps: 1,
        days: [
          { date: '2026-09-05', staffed: 0, openShifts: 1, status: 'gap', gaps: [{ role: 'line', period: 'pm', staffed: 0, required: 1 }] },
        ],
      },
    });
    render(<TeamNext />, { wrapper });
    const btn = await screen.findByRole('button', { name: 'Assign' });
    expect(btn).toBeEnabled();
    fireEvent.click(btn);
    await vi.waitFor(() => expect(api.createShift).toHaveBeenCalled());
    expect(api.createShift).toHaveBeenCalledWith({
      scheduleId: 'sch1',
      shiftDate: '2026-09-05',
      startTime: '16:00',
      endTime: '22:00',
      role: 'line',
      memberId: 'm2',
    });
  });

  it('names the exposure before publishing without inventing a credential-to-shift link', async () => {
    api.members = [member('m1', 'Ayşe', 'Sommelier')];
    api.week = weekPayload({ shifts: [shift('m1', '2026-09-01')] });
    api.certs = [
      { id: 'c1', member_id: 'm1', cert_type: 'food-handler', issued_at: null, expires_at: '2026-08-20', doc_url: null, status: 'expired' },
    ];
    render(<TeamNext />, { wrapper });
    expect(
      await screen.findByText(/which shifts require it is not recorded/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/1 person is/)).toBeInTheDocument();
  });
});
