/**
 * The founder's five answers on the page — ADR 0215, 2026-09-21, "Take all
 * five" (the options he picked, bundled):
 *
 *   B1  a shift over 4 hours with no break recorded is counted with the Labour
 *       Law 4857 Art. 68 minimum, shown as ASSUMED, and whoever edits the shift
 *       can record the real one;
 *   S1  only the owner switches labour-cost tracking off or changes the target;
 *   L3  whoever approves leave marks it paid or unpaid, and a person may say so
 *       on their own request.
 *
 * (R1, the five-year wage record, and L2, leave kept as days, have no page of
 * their own: R1 is proved in the gateway spec and on PGlite, L2 by
 * `TeamPay.test.tsx`'s paid-leave case.)
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, within, configure } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode } from 'react';

configure({ asyncUtilTimeout: 5000 });

const api = vi.hoisted(() => ({
  week: {} as Record<string, unknown>,
  settings: {} as Record<string, unknown>,
  myWeek: {} as Record<string, unknown>,
  createShift: vi.fn((..._args: unknown[]) => Promise.resolve({})),
  updateShift: vi.fn((..._args: unknown[]) => Promise.resolve({})),
  createTimeOff: vi.fn((..._args: unknown[]) => Promise.resolve({})),
  updateTeamSettings: vi.fn((..._args: unknown[]) => Promise.resolve({})),
}));

vi.mock('../../../services/api/team', () => ({
  getTeamNotes: () =>
    Promise.resolve({ weekStart: '2026-08-31', notes: [], readable: true, reason: null }),
  createTeamNote: vi.fn(() => Promise.resolve({})),
  openTeamNote: vi.fn(() => Promise.resolve({ recorded: true, alreadyOpen: false })),
  getTextSenders: () =>
    Promise.resolve({
      senders: { whatsapp: null, sms: null },
      readable: true,
      reason: null,
      transport: { built: false, words: 'No provider credential.' },
      myConsent: { consent: null, readable: true, reason: null },
      crewConsents: 0,
    }),
  getTimeOff: () => Promise.resolve([]),
  getMyWeek: () => Promise.resolve(api.myWeek),
  getMemberPerformance: () => Promise.resolve({ hasData: false }),
  createSchedule: vi.fn(() => Promise.resolve({ id: 'sch1' })),
  publishSchedule: vi.fn(() => Promise.resolve({})),
  copyWeek: vi.fn(() => Promise.resolve({})),
  acknowledgeSchedule: vi.fn(() => Promise.resolve({})),
  assignCover: vi.fn(() => Promise.resolve({})),
  createTimeOff: api.createTimeOff,
  reviewTimeOff: vi.fn(() => Promise.resolve({})),
  updateShift: api.updateShift,
  deleteShift: vi.fn(() => Promise.resolve(undefined)),
  reportCallout: vi.fn(() => Promise.resolve({})),
  offerCover: vi.fn(() => Promise.resolve({})),
  createTeamMember: vi.fn(() => Promise.resolve({})),
  updateTeamMember: vi.fn(() => Promise.resolve({})),
  deleteTeamMember: vi.fn(() => Promise.resolve(undefined)),
  ingestSales: vi.fn(() => Promise.resolve({})),
  ingestSalesBatch: vi.fn(() => Promise.resolve({})),
  getWeek: () => Promise.resolve(api.week),
  getTeamMembers: () => Promise.resolve([]),
  getCertifications: () => Promise.resolve([]),
  getCoverageTemplates: () => Promise.resolve([]),
  createCoverageTemplate: vi.fn(() => Promise.resolve({})),
  createShift: api.createShift,
  broadcast: vi.fn(() => Promise.resolve({})),
  getTeamSettings: () => Promise.resolve(api.settings),
  updateTeamSettings: api.updateTeamSettings,
}));

vi.mock('../../../services/api/client', () => ({
  apiClient: {
    get: () =>
      Promise.resolve({
        data: { entries: [], readable: true, reason: null, oldestAt: null, recordingSince: '2026-09-03' },
      }),
  },
}));

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({
    activeRestaurantId: 'r1',
    activeRole: 'owner',
    user: { id: 'u1', restaurantId: 'r1', role: 'owner' },
  }),
}));

import TeamNext from './TeamNext';
import { ShiftSheet } from './ShiftSheet';
import { WeekGrid } from './WeekGrid';
import { MyShiftsNext } from './MyShiftsNext';
import { TeamLaborSettings } from '../../../components/team/TeamLaborSettings';
import {
  art68MinimumBreak,
  breakCounted,
  breakUnderMinimum,
  fmtBreak,
  workedHours,
} from './tm-format';

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

const baseShift = {
  id: 's1',
  restaurant_id: 'r1',
  schedule_id: 'sch1',
  member_id: null,
  shift_date: '2026-09-07',
  start_time: '09:00',
  end_time: '19:00',
  role: null,
  shift_type: 'am',
  state: 'open',
  note: null,
  shift_breaks: [],
};

beforeEach(() => {
  api.createShift.mockClear();
  api.updateShift.mockClear();
  api.createTimeOff.mockClear();
  api.updateTeamSettings.mockClear();
  api.week = {
    schedule: { id: 'sch1', restaurant_id: 'r1', week_start: '2026-08-31', status: 'draft', published_at: null },
    shifts: [],
    coverage: { days: [], totalGaps: 0 },
    labor: { enabled: false, totalHours: 0 },
    receipts: [],
    settings: { restaurant_id: 'r1', labor_tracking_enabled: true, labor_target_pct: null, configured: false },
  };
});

// ── B1: the rule the grid and the week share with the gateway ────────────────

describe('B1 — a shift over 4 hours with nothing recorded has the legal minimum, assumed', () => {
  const at = (start_time: string, end_time: string, over: Record<string, unknown> = {}) => ({
    start_time,
    end_time,
    ...over,
  });

  it('keys the minimum on the worked time the break leaves', () => {
    expect(art68MinimumBreak(255)).toBe(15);
    expect(art68MinimumBreak(256)).toBe(30);
    expect(art68MinimumBreak(480)).toBe(30); // an 8-hour shift is 7.5 hours of work
    expect(art68MinimumBreak(481)).toBe(60);
  });

  it('assumes only over 4 hours, and only when nothing is on record', () => {
    expect(breakCounted(at('09:00', '13:00'))).toEqual({ minutes: 0, assumed: false });
    expect(breakCounted(at('09:00', '17:00'))).toEqual({ minutes: 30, assumed: true });
    expect(breakCounted(at('09:00', '19:00', { recorded_break_min: 0 }))).toEqual({ minutes: 0, assumed: false });
    expect(workedHours(at('09:00', '17:00'))).toBe(7.5);
  });

  it('says the break as a fact, and flags one under the minimum', () => {
    expect(fmtBreak(at('09:00', '17:00'))).toBe('30 min · assumed');
    expect(fmtBreak(at('09:00', '17:00', { recorded_break_min: 45 }))).toBe('45 min');
    expect(fmtBreak(at('09:00', '17:00', { recorded_break_min: 0 }))).toBe('none taken');
    expect(fmtBreak(at('09:00', '12:00'))).toBe('none');
    expect(breakUnderMinimum(at('09:00', '19:00', { recorded_break_min: 30 }))).toBe(true); // 9.5h of work owes 60
    expect(breakUnderMinimum(at('09:00', '19:00', { recorded_break_min: 60 }))).toBe(false);
    expect(breakUnderMinimum(at('09:00', '19:00'))).toBe(false); // assumed is the minimum
    // Keyed on the work the break leaves: 8h with 30 min recorded is 7.5h of
    // work, which owes 30, so it is not under.
    expect(breakUnderMinimum(at('09:00', '17:00', { recorded_break_min: 30 }))).toBe(false);
  });

  it('names an assumed break and a short one in the compliance lens, and the break on the shift', () => {
    const member = {
      id: 'm1',
      restaurant_id: 'r1',
      display_name: 'Sam',
      role: 'staff',
      position: 'Server',
      employment_type: 'full_time',
      avatar_url: null,
      status: 'active',
    };
    const mk = (id: string, shift_date: string, over: Record<string, unknown> = {}) => ({
      ...baseShift,
      id,
      member_id: 'm1',
      state: 'scheduled',
      role: 'Bar',
      shift_date,
      ...over,
    });
    render(
      <WeekGrid
        weekStart="2026-08-31"
        shifts={[
          mk('g1', '2026-08-31'),
          mk('g2', '2026-09-01', { recorded_break_min: 30 }),
          mk('g3', '2026-09-02', { recorded_break_min: 60 }),
        ] as never}
        members={[member] as never}
        membersFailed={false}
        certs={[]}
        coverage={[]}
        weekFailed={false}
        engineIdle
        lens="compliance"
        labourEnabled
        moneyVisible={false}
        money={null}
        scheduleId="sch1"
        onEditShift={() => {}}
        onChanged={() => {}}
      />,
      { wrapper },
    );
    // 10h with nothing recorded: assumed. 10h with 30 recorded: 9.5h of work
    // owes 60, so short. 10h with 60 recorded: nothing to flag.
    expect(screen.getAllByText('break assumed · not recorded')).toHaveLength(1);
    expect(screen.getAllByText('break under the legal minimum')).toHaveLength(1);
    expect(screen.getAllByText('Bar')).toHaveLength(1);
    fireEvent.click(screen.getByText('break assumed · not recorded'));
    expect(screen.getByText('60 min · assumed')).toBeInTheDocument();
  });

  it('duplicates a shift with its break on record, and one with none as none', async () => {
    const member = { id: 'm1', restaurant_id: 'r1', display_name: 'Sam', role: 'staff', position: 'Server', employment_type: 'full_time', avatar_url: null, status: 'active' };
    const mk = (id: string, shift_date: string, role: string, over: Record<string, unknown> = {}) => ({
      ...baseShift, id, member_id: 'm1', state: 'scheduled', role, shift_date, ...over,
    });
    render(
      <WeekGrid
        weekStart="2026-08-31"
        shifts={[mk('d1', '2026-08-31', 'Bar', { recorded_break_min: 45 }), mk('d2', '2026-09-01', 'Floor')] as never}
        members={[member] as never}
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
        onEditShift={() => {}}
        onChanged={() => {}}
      />,
      { wrapper },
    );
    fireEvent.contextMenu(screen.getByText('Bar'));
    fireEvent.click(screen.getByText('Duplicate onto the same day'));
    await vi.waitFor(() => expect(api.createShift).toHaveBeenCalledTimes(1));
    expect(api.createShift.mock.calls[0][0]).toMatchObject({ shiftDate: '2026-08-31', breakMinutes: 45 });
    fireEvent.contextMenu(screen.getByText('Floor'));
    fireEvent.click(screen.getByText('Duplicate onto the same day'));
    await vi.waitFor(() => expect(api.createShift).toHaveBeenCalledTimes(2));
    expect('breakMinutes' in (api.createShift.mock.calls[1][0] as object)).toBe(false);
  });

  it('shows the assumed minimum live in the shift editor, and records nothing when left empty', async () => {
    render(
      <ShiftSheet target={{ date: '2026-09-07' }} members={[]} scheduleId="sch1" onClose={() => {}} onChanged={() => {}} />,
      { wrapper },
    );
    // Default new shift is 17:00-22:00: 5 hours, so 30 minutes assumed.
    expect(screen.getByText(/counted with a 30-minute break: the legal minimum/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add the shift' }));
    await vi.waitFor(() => expect(api.createShift).toHaveBeenCalled());
    expect('breakMinutes' in (api.createShift.mock.calls[0][0] as object)).toBe(false);
  });

  it('records the break an editor types, and warns when it is under the minimum', async () => {
    render(
      <ShiftSheet target={{ shift: baseShift as never }} members={[]} scheduleId="sch1" onClose={() => {}} onChanged={() => {}} />,
      { wrapper },
    );
    const field = screen.getByLabelText('Break, in minutes');
    fireEvent.change(field, { target: { value: '30' } });
    expect(screen.getByText(/under the legal minimum of 60 minutes/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save the shift' }));
    await vi.waitFor(() => expect(api.updateShift).toHaveBeenCalled());
    expect(api.updateShift.mock.calls[0][1]).toMatchObject({ breakMinutes: 30 });
  });

  it('names the minimum owed for the work a short break leaves, not a different minimum for the shift', () => {
    // An 8-hour shift complies with 30 minutes (7.5 h of work); a 20-minute
    // break leaves 7h40m of work, which is owed 60. "60 for this shift" would
    // contradict the 30 the empty field says.
    render(
      <ShiftSheet
        target={{ shift: { ...baseShift, start_time: '09:00', end_time: '17:00' } as never }}
        members={[]}
        scheduleId="sch1"
        onClose={() => {}}
        onChanged={() => {}}
      />,
      { wrapper },
    );
    expect(screen.getByText(/counted with a 30-minute break: the legal minimum/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Break, in minutes'), { target: { value: '20' } });
    expect(
      screen.getByText(/under the legal minimum of 60 minutes for the 7\.7h of work it leaves \(Art\. 68\)/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/minutes for this shift/)).not.toBeInTheDocument();
  });

  it('clears a recorded break when the editor empties it', async () => {
    render(
      <ShiftSheet
        target={{ shift: { ...baseShift, recorded_break_min: 45 } as never }}
        members={[]}
        scheduleId="sch1"
        onClose={() => {}}
        onChanged={() => {}}
      />,
      { wrapper },
    );
    const field = screen.getByLabelText('Break, in minutes') as HTMLInputElement;
    expect(field.value).toBe('45');
    fireEvent.change(field, { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save the shift' }));
    await vi.waitFor(() => expect(api.updateShift).toHaveBeenCalled());
    expect(api.updateShift.mock.calls[0][1]).toMatchObject({ breakMinutes: null });
  });

  it('refuses a break as long as the shift before it is sent', () => {
    render(
      <ShiftSheet target={{ shift: baseShift as never }} members={[]} scheduleId="sch1" onClose={() => {}} onChanged={() => {}} />,
      { wrapper },
    );
    fireEvent.change(screen.getByLabelText('Break, in minutes'), { target: { value: '600' } });
    expect(screen.getByRole('button', { name: 'Save the shift' })).toBeDisabled();
    expect(screen.getByText(/less than the shift's 600/)).toBeInTheDocument();
  });

  it('tells the week how much of its break time is assumed', async () => {
    api.week = {
      ...api.week,
      labor: {
        enabled: true,
        moneyVisible: false,
        totalHours: 15,
        breakHours: 1,
        assumedBreakHours: 1,
        assumedBreakShifts: 2,
        overtime: [],
      },
    };
    render(<TeamNext />, { wrapper });
    const labour = await screen.findByRole('region', { name: 'Labour cost' });
    expect(
      await within(labour).findByText(/2 shifts have no break recorded, so each is counted with the legal minimum break \(assumed, 1h in all\)/),
    ).toBeInTheDocument();
  });
});

// ── S1: the owner's switches ─────────────────────────────────────────────────

describe('S1 — a manager is not offered what only the owner may change', () => {
  it('locks the switch-off and the target for a manager, and says why', async () => {
    api.settings = {
      restaurant_id: 'r1',
      labor_tracking_enabled: true,
      labor_target_pct: 30,
      mayChange: { trackingOff: false, trackingOn: true, target: false },
    };
    render(<TeamLaborSettings />, { wrapper });
    const toggle = await screen.findByRole('button', { name: 'Labor cost tracking' });
    expect(toggle).toBeDisabled();
    expect(screen.getByText('Only the owner can switch labour-cost tracking off.')).toBeInTheDocument();
    expect(screen.getByLabelText('Labor target percent')).toBeDisabled();
    expect(screen.getByText('Only the owner can change the labour target.')).toBeInTheDocument();
  });

  it('leaves both open to the owner', async () => {
    api.settings = {
      restaurant_id: 'r1',
      labor_tracking_enabled: true,
      labor_target_pct: 30,
      mayChange: { trackingOff: true, trackingOn: true, target: true },
    };
    render(<TeamLaborSettings />, { wrapper });
    const toggle = await screen.findByRole('button', { name: 'Labor cost tracking' });
    expect(toggle).not.toBeDisabled();
    expect(screen.getByLabelText('Labor target percent')).not.toBeDisabled();
    fireEvent.click(toggle);
    await vi.waitFor(() => expect(api.updateTeamSettings).toHaveBeenCalledWith({ laborTrackingEnabled: false }));
  });
});

// ── L3: the person asking may say paid or unpaid ─────────────────────────────

describe('L3 — a person may say whether their own leave is paid', () => {
  beforeEach(() => {
    api.myWeek = {
      member: { id: 'm1', display_name: 'Sam' },
      schedule: null,
      mine: [],
      open: [],
      acknowledged: false,
    };
  });

  it('files the request as not yet said when left to the manager', async () => {
    render(<MyShiftsNext />, { wrapper });
    fireEvent.click(await screen.findByRole('button', { name: 'Ask for this week off' }));
    await vi.waitFor(() => expect(api.createTimeOff).toHaveBeenCalled());
    expect('leaveType' in (api.createTimeOff.mock.calls[0][0] as object)).toBe(false);
  });

  it('files the type the person picked', async () => {
    render(<MyShiftsNext />, { wrapper });
    await screen.findByRole('button', { name: 'Ask for this week off' });
    fireEvent.change(screen.getByLabelText('Paid or unpaid?'), { target: { value: 'paid' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ask for this week off' }));
    await vi.waitFor(() => expect(api.createTimeOff).toHaveBeenCalled());
    expect(api.createTimeOff.mock.calls[0][0]).toMatchObject({ memberId: 'm1', leaveType: 'paid' });
  });
});
