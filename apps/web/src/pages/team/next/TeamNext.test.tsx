/**
 * TeamNext contracts — the three founder additions derive honestly:
 * suggested cover is a fair-rotation pick (free that day, role match, fewest
 * hours); an unparseable gap period disables Assign with the reason; an
 * expired cert blocks that member's shifts and the page says the schedule
 * should not publish; labour-off is withheld in words, never a zero.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const api = vi.hoisted(() => ({
  week: {} as Record<string, unknown>,
  members: [] as unknown[],
  certs: [] as unknown[],
}));

vi.mock('../../../services/api/team', () => ({
  getWeek: () => Promise.resolve(api.week),
  getTeamMembers: () => Promise.resolve(api.members),
  getCertifications: () => Promise.resolve(api.certs),
  createShift: vi.fn(() => Promise.resolve({})),
  broadcast: vi.fn(() => Promise.resolve({})),
}));

import TeamNext from './TeamNext';
import { useTeamNextData } from './useTeamNextData';

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

describe('useTeamNextData derivations', () => {
  it('suggests the free, role-matching member with the fewest hours', async () => {
    api.members = [member('m1', 'Busy', 'Line cook'), member('m2', 'Light', 'Line cook'), member('m3', 'Occupied', 'Line cook')];
    api.week = weekPayload({
      shifts: [
        shift('m1', '2026-09-01'), // 6h already
        shift('m1', '2026-09-02'),
        shift('m3', '2026-09-05'), // busy ON the gap day
      ],
      coverage: {
        totalGaps: 1,
        days: [
          { date: '2026-09-05', staffed: 1, openShifts: 2, status: 'gap', gaps: [{ role: 'line', period: '17:00–23:00', staffed: 1, required: 3 }] },
        ],
      },
    });
    const result = await settled(() => useTeamNextData(new Date('2026-09-02T12:00:00')));
    expect(result.current.gaps).toHaveLength(1);
    expect(result.current.gaps[0].unfilled).toBe(2);
    expect(result.current.gaps[0].suggested?.name).toBe('Light'); // 0h beats Busy's 12h; Occupied is on that day
  });

  it('an expired cert blocks that member’s shifts; expiring blocks none yet', async () => {
    api.members = [member('m1', 'Ayşe', 'Sommelier')];
    api.week = weekPayload({ shifts: [shift('m1', '2026-09-01'), shift('m1', '2026-09-03')] });
    api.certs = [
      { id: 'c1', member_id: 'm1', cert_type: 'food-handler', issued_at: null, expires_at: '2026-08-20', doc_url: null, status: 'expired' },
      { id: 'c2', member_id: 'm1', cert_type: 'alcohol-service', issued_at: null, expires_at: '2026-09-04', doc_url: null, status: 'expiring' },
    ];
    const result = await settled(() => useTeamNextData(new Date('2026-09-02T12:00:00')));
    const byId = Object.fromEntries(result.current.certBlocks.map((b) => [b.cert.id, b.blockedShifts]));
    expect(byId.c1).toBe(2);
    expect(byId.c2).toBe(0);
    expect(result.current.blockedTotal).toBe(2);
  });
});

describe('TeamNext rendering', () => {
  it('withholds the labour figure in words when tracking is off', async () => {
    render(<TeamNext />, { wrapper });
    expect(await screen.findByText(/Labour tracking is off/)).toBeInTheDocument();
    expect(screen.getByText(/withheld number, not a zero/)).toBeInTheDocument();
  });

  it('disables Assign with the reason when the period carries no clock times', async () => {
    api.members = [member('m2', 'Light', 'Line cook')];
    api.week = weekPayload({
      coverage: {
        totalGaps: 1,
        days: [
          { date: '2026-09-05', staffed: 0, openShifts: 1, status: 'gap', gaps: [{ role: 'line', period: 'dinner service', staffed: 0, required: 1 }] },
        ],
      },
    });
    render(<TeamNext />, { wrapper });
    const btn = await screen.findByRole('button', { name: 'Assign' });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute('title', expect.stringContaining('no clock times'));
  });

  it('says the schedule should not publish while shifts are blocked', async () => {
    api.members = [member('m1', 'Ayşe', 'Sommelier')];
    api.week = weekPayload({ shifts: [shift('m1', '2026-09-01')] });
    api.certs = [
      { id: 'c1', member_id: 'm1', cert_type: 'food-handler', issued_at: null, expires_at: '2026-08-20', doc_url: null, status: 'expired' },
    ];
    render(<TeamNext />, { wrapper });
    expect(await screen.findByText(/should not be published as it stands/)).toBeInTheDocument();
  });
});
