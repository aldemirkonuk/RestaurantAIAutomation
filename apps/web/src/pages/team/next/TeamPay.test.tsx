/**
 * /team pay defects on the page — ADR 0215. The founder, 2026-09-21: "Fix /team
 * first"; wages and labour cost "Owner only" (managers see hours but not money).
 *
 * Every assertion that names a currency, a 45-hour line, a withheld figure or a
 * leave type fails against origin/main 9cfc4e96d, where `fmtMoneyWhole` was
 * a US-dollar formatter pinned to the en-US locale, the review line was 40
 * hours, and the page decided wage visibility from the `wage_visible` switch.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, within, configure } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createRef, type ReactNode } from 'react';

configure({ asyncUtilTimeout: 5000 });

const api = vi.hoisted(() => ({
  week: {} as Record<string, unknown>,
  members: [] as unknown[],
  reviewTimeOff: vi.fn((..._args: unknown[]) => Promise.resolve({})),
  createTimeOff: vi.fn((..._args: unknown[]) => Promise.resolve({})),
  exportTable: vi.fn((..._args: unknown[]) => Promise.resolve(undefined)),
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
  getMyWeek: () => Promise.resolve({}),
  getMemberPerformance: () => Promise.resolve({ hasData: false }),
  createSchedule: vi.fn(() => Promise.resolve({ id: 'sch1' })),
  publishSchedule: vi.fn(() => Promise.resolve({})),
  copyWeek: vi.fn(() => Promise.resolve({})),
  acknowledgeSchedule: vi.fn(() => Promise.resolve({})),
  assignCover: vi.fn(() => Promise.resolve({})),
  createTimeOff: api.createTimeOff,
  reviewTimeOff: api.reviewTimeOff,
  updateShift: vi.fn(() => Promise.resolve({})),
  deleteShift: vi.fn(() => Promise.resolve(undefined)),
  reportCallout: vi.fn(() => Promise.resolve({})),
  offerCover: vi.fn(() => Promise.resolve({})),
  createTeamMember: vi.fn(() => Promise.resolve({})),
  updateTeamMember: vi.fn(() => Promise.resolve({})),
  deleteTeamMember: vi.fn(() => Promise.resolve(undefined)),
  ingestSales: vi.fn(() => Promise.resolve({})),
  ingestSalesBatch: vi.fn(() => Promise.resolve({})),
  getWeek: () => Promise.resolve(api.week),
  getTeamMembers: () => Promise.resolve(api.members),
  getCertifications: () => Promise.resolve([]),
  getCoverageTemplates: () => Promise.resolve([]),
  createCoverageTemplate: vi.fn(() => Promise.resolve({})),
  createShift: vi.fn(() => Promise.resolve({})),
  broadcast: vi.fn(() => Promise.resolve({})),
}));

vi.mock('../../../services/api/client', () => ({
  apiClient: {
    get: () =>
      Promise.resolve({
        data: { entries: [], readable: true, reason: null, oldestAt: null, recordingSince: '2026-09-03' },
      }),
  },
}));

vi.mock('../../../lib/tableExport', () => ({ exportTable: api.exportTable }));

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({
    activeRestaurantId: 'r1',
    activeRole: 'owner',
    user: { id: 'u1', restaurantId: 'r1', role: 'owner' },
  }),
}));

vi.mock('./MyShiftsNext', () => ({ MyShiftsNext: () => <div>My Shifts</div> }));

const house = vi.hoisted(() => ({ group: null as '.' | ',' | null }));
vi.mock('../../../hooks/useHouseGroupMark', () => ({ useHouseGroupMark: () => house.group }));

import TeamNext from './TeamNext';
import {
  copyWeek,
  createShift,
  deleteShift,
  updateTeamMember,
} from '../../../services/api/team';
import { MemberSheet, RosterSheet } from './RosterSheet';
import { WeekGrid } from './WeekGrid';
import { CopyWeekPanel, ExportPopover, TimeOffSheet } from './TeamOverlays';
import { ShiftSheet } from './ShiftSheet';
import {
  fmtHours,
  fmtMoneyExact,
  fmtMoneyWhole,
  houseLocale,
  WEEKLY_REVIEW_HOURS,
  workedHours,
} from './tm-format';

const TRY_HOUSE = { currency: 'TRY', country: 'Türkiye', readable: true };

function weekPayload(over: Record<string, unknown> = {}) {
  return {
    schedule: { id: 'sch1', restaurant_id: 'r1', week_start: '2026-08-31', status: 'draft', published_at: null },
    shifts: [],
    coverage: { days: [], totalGaps: 0 },
    labor: { enabled: false, totalHours: 0 },
    receipts: [],
    settings: { restaurant_id: 'r1', labor_tracking_enabled: true, labor_target_pct: null, configured: false },
    ...over,
  };
}

const member = (over: Record<string, unknown> = {}) => ({
  id: 'm1',
  restaurant_id: 'r1',
  user_id: 'u-1',
  display_name: 'Ayşe Yılmaz',
  email: null,
  phone: null,
  avatar_url: null,
  position: 'Server',
  employment_type: 'full_time',
  home_location: null,
  skills: [],
  hire_date: null,
  status: 'active',
  notes: null,
  role: 'staff',
  accountLinked: true,
  linkedUser: null,
  ...over,
});

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  api.week = weekPayload();
  api.members = [];
  api.reviewTimeOff.mockClear();
  api.exportTable.mockClear();
});

// ── (1) money in the house's currency and locale ─────────────────────────────

describe('money is printed in the house currency, never in dollars', () => {
  it('prints a Turkish house in lira, grouped the Turkish way', () => {
    const s = fmtMoneyWhole(12345.6, TRY_HOUSE);
    expect(s).toContain('₺');
    expect(s).toContain('12.346');
    expect(s).not.toContain('$');
  });

  it('prints a British house in pounds', () => {
    expect(fmtMoneyWhole(12345.6, { currency: 'GBP', country: 'United Kingdom', readable: true })).toBe(
      '£12,346',
    );
  });

  it('says the currency is not recorded rather than choosing one', () => {
    const s = fmtMoneyWhole(1200, { currency: null, country: 'Türkiye', readable: true });
    expect(s).toMatch(/currency not recorded/);
    expect(s).not.toMatch(/[$₺£€]/);
  });

  it('says the currency could not be read when the read failed', () => {
    expect(fmtMoneyWhole(1200, { currency: null, country: null, readable: false })).toMatch(
      /currency could not be read/,
    );
  });

  it('prints a wage to the currency’s own minor units', () => {
    expect(fmtMoneyExact(146.8, TRY_HOUSE)).toContain('146,80');
  });

  it('derives the locale from the country, with no table of locales', () => {
    expect(houseLocale('Türkiye')).toBe('tr-Latn-TR');
    expect(houseLocale(null)).toBeUndefined();
  });

  it('prints the owner’s week total in the house’s money', async () => {
    api.week = weekPayload({
      labor: {
        enabled: true,
        moneyVisible: true,
        totalHours: 45,
        totalCost: 12345,
        costComplete: true,
        pricedShifts: 5,
        unpricedShifts: 0,
        targetPct: null,
        overtime: [],
        leave: { readable: true, paid: [], paidDays: 0, unknownTypeDays: 0 },
      },
      money: TRY_HOUSE,
    });
    render(<TeamNext />, { wrapper });
    const labour = await screen.findByRole('region', { name: 'Labour cost' });
    expect(await within(labour).findByText(/₺12\.345/)).toBeInTheDocument();
    expect(within(labour).queryByText(/\$/)).not.toBeInTheDocument();
    expect(within(labour).getByText(/Wages only/)).toBeInTheDocument();
  });
});

// ── (2) a manager sees hours, not money ──────────────────────────────────────

describe('a manager is shown hours and told the money is the owner’s', () => {
  it('shows worked hours and no figure', async () => {
    api.week = weekPayload({
      labor: { enabled: true, moneyVisible: false, totalHours: 45, breakHours: 5, overtime: [] },
    });
    render(<TeamNext />, { wrapper });
    const labour = await screen.findByRole('region', { name: 'Labour cost' });
    expect(await within(labour).findByText('45h')).toBeInTheDocument();
    expect(within(labour).getByText(/shown to the owner only/)).toBeInTheDocument();
    expect(within(labour).queryByText(/[$₺£€]/)).not.toBeInTheDocument();
  });

  it('does not offer a manager the wage field', () => {
    render(
      <MemberSheet member={member() as never} moneyVisible={false} ownerCount={1} onClose={() => {}} onChanged={() => {}} />,
      { wrapper },
    );
    expect(screen.queryByLabelText(/^Hourly wage/)).not.toBeInTheDocument();
    expect(screen.getByText(/the owner.s to see and to set/)).toBeInTheDocument();
  });

  it('offers the owner the wage field, and says each change is kept', () => {
    render(
      <MemberSheet member={member({ hourly_wage: 150 }) as never} moneyVisible ownerCount={1} onClose={() => {}} onChanged={() => {}} />,
      { wrapper },
    );
    expect(screen.getByLabelText(/^Hourly wage/)).toBeInTheDocument();
    expect(screen.getByText(/Each change is kept/)).toBeInTheDocument();
  });

  // F-358: a bare Number() made "12,50" NaN, which JSON sends as null — the
  // recorded wage was cleared. Now it is read the way the house writes it.
  it('reads a typed wage the way the house writes it', async () => {
    house.group = '.';
    render(
      <MemberSheet member={member({ hourly_wage: 150 }) as never} moneyVisible ownerCount={1} onClose={() => {}} onChanged={() => {}} />,
      { wrapper },
    );
    const wage = screen.getByLabelText(/^Hourly wage/);
    expect(wage).toHaveAttribute('inputmode', 'decimal');
    fireEvent.change(wage, { target: { value: '1.250,50' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await vi.waitFor(() =>
      expect(updateTeamMember).toHaveBeenCalledWith('m1', expect.objectContaining({ hourlyWage: 1250.5 })),
    );
    house.group = null;
  });

  it('holds Save on a wage that is not an amount, and says so', () => {
    render(
      <MemberSheet member={member({ hourly_wage: 150 }) as never} moneyVisible ownerCount={1} onClose={() => {}} onChanged={() => {}} />,
      { wrapper },
    );
    fireEvent.change(screen.getByLabelText(/^Hourly wage/), { target: { value: '12,5,0' } });
    expect(screen.getByRole('alert')).toHaveTextContent('is not an amount');
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('exports no cost column for a manager, and a currency-named one for the owner', async () => {
    const shifts = [
      {
        id: 's1', restaurant_id: 'r1', schedule_id: 'sch1', member_id: 'm1', shift_date: '2026-08-31',
        start_time: '09:00', end_time: '19:00', role: 'line', shift_type: 'am', state: 'scheduled', note: null,
        shift_breaks: [{ id: 'b1', shift_id: 's1', start_time: '13:00', duration_min: 60, covered_by: null }],
      },
    ];
    const anchor = createRef<HTMLElement>();
    const { unmount } = render(
      <ExportPopover anchorRef={anchor} weekStart="2026-08-31" shifts={shifts as never} members={[]} moneyVisible={false} money={null} onClose={() => {}} />,
      { wrapper },
    );
    fireEvent.click(screen.getByRole('button', { name: /CSV/ }));
    const managerCols = (api.exportTable.mock.calls[0][0] as { columns: { header: string; value: (s: unknown) => unknown }[] }).columns;
    expect(managerCols.some((c) => /cost/i.test(c.header))).toBe(false);
    // Hours are handed over (founder: "Hand hours over"), breaks taken out.
    const hours = managerCols.find((c) => c.header === 'Hours worked');
    expect(hours?.value(shifts[0])).toBe(9);
    unmount();

    render(
      <ExportPopover anchorRef={anchor} weekStart="2026-08-31" shifts={shifts as never} members={[]} moneyVisible money={TRY_HOUSE} onClose={() => {}} />,
      { wrapper },
    );
    fireEvent.click(screen.getByRole('button', { name: /CSV/ }));
    const ownerCols = (api.exportTable.mock.calls[1][0] as { columns: { header: string }[] }).columns;
    expect(ownerCols.map((c) => c.header)).toContain('Labour cost (TRY)');
  });
});

// ── (4) + the 45-hour review ─────────────────────────────────────────────────

describe('hours are worked hours, and over 45 is a review', () => {
  it('takes breaks out of a shift', () => {
    expect(
      workedHours({ start_time: '09:00', end_time: '19:00', shift_breaks: [{ duration_min: 60 }] }),
    ).toBe(9);
  });

  it('draws the review line at the Turkish week', () => {
    expect(WEEKLY_REVIEW_HOURS).toBe(45);
  });

  it('names the people over 45 worked hours as a review, with no price', async () => {
    api.members = [member()];
    api.week = weekPayload({
      labor: { enabled: true, moneyVisible: false, totalHours: 46, overtime: [{ memberId: 'm1', hours: 46 }] },
      country: 'Türkiye',
    });
    render(<TeamNext />, { wrapper });
    expect(await screen.findByText(/Over 45h worked — review before publishing/)).toBeInTheDocument();
    expect(screen.queryByText(/40h/)).not.toBeInTheDocument();
  });
});

// ── F-155 / F-1385 / F-1399: the house's country's rules (founder S195) ─────

describe("the review line and the cost note follow the house's country", () => {
  const ownerWeek = (country: string | null, overtime: unknown[] = []) =>
    weekPayload({
      labor: {
        enabled: true,
        moneyVisible: true,
        totalHours: 42,
        totalCost: 840,
        costComplete: true,
        pricedShifts: 5,
        unpricedShifts: 0,
        targetPct: null,
        overtime,
        leave: { readable: true, paid: [], paidDays: 0, unknownTypeDays: 0 },
      },
      country,
    });

  it('a US house reviews past the 40-hour week and never names SGK', async () => {
    api.members = [member()];
    api.week = ownerWeek('United States', [{ memberId: 'm1', hours: 42 }]);
    render(<TeamNext />, { wrapper });
    expect(await screen.findByText(/Over 40h worked — review before publishing/)).toBeInTheDocument();
    const labour = await screen.findByRole('region', { name: 'Labour cost' });
    expect(within(labour).getByText(/not employer taxes, meals or bonuses/)).toBeInTheDocument();
    expect(screen.queryByText(/SGK|45h|45 worked/)).not.toBeInTheDocument();
  });

  it('a Turkish house keeps the 45-hour week and SGK', async () => {
    api.week = ownerWeek('Türkiye');
    render(<TeamNext />, { wrapper });
    expect(await screen.findByText(/No one is scheduled over 45 worked hours/)).toBeInTheDocument();
    const labour = await screen.findByRole('region', { name: 'Labour cost' });
    expect(within(labour).getByText(/not SGK, meals or bonuses/)).toBeInTheDocument();
  });

  it('a GB house draws the line at 48', async () => {
    api.week = ownerWeek('United Kingdom');
    render(<TeamNext />, { wrapper });
    expect(await screen.findByText(/No one is scheduled over 48 worked hours/)).toBeInTheDocument();
  });

  it('a house whose country is not built in is told so, with no Turkish line', async () => {
    api.week = ownerWeek('France');
    render(<TeamNext />, { wrapper });
    expect(
      await screen.findByText(/Your country's working-time rules are not built in yet/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/SGK|over 45/)).not.toBeInTheDocument();
  });
});

// ── (6) paid leave ───────────────────────────────────────────────────────────

describe('paid leave is not a free week', () => {
  it('tells the owner how many paid-leave days sit outside the figure', async () => {
    api.week = weekPayload({
      labor: {
        enabled: true,
        moneyVisible: true,
        totalHours: 8,
        totalCost: 1200,
        costComplete: true,
        pricedShifts: 1,
        unpricedShifts: 0,
        targetPct: null,
        overtime: [],
        leave: { readable: true, paid: [{ memberId: 'm1', days: 2 }], paidDays: 2, unknownTypeDays: 1 },
      },
      money: TRY_HOUSE,
    });
    render(<TeamNext />, { wrapper });
    expect(await screen.findByText(/Also 2 days of paid leave this week, not in this figure/)).toBeInTheDocument();
    expect(screen.getByText(/1 day of approved leave are not marked paid or unpaid/)).toBeInTheDocument();
  });

  it('approves a request as paid, and says so on the row', async () => {
    render(
      <TimeOffSheet
        requests={[
          {
            id: 't1', member_id: 'm1', start_date: '2026-09-07', end_date: '2026-09-08', reason: null,
            status: 'pending', leave_type: 'unknown', reviewed_by: null, created_at: '2026-09-01',
          },
        ]}
        failed={false}
        members={[member()] as never}
        weekStart="2026-09-07"
        onClose={() => {}}
        onChanged={() => {}}
      />,
      { wrapper },
    );
    expect(screen.getByText(/paid or unpaid not said/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Approve as paid' }));
    // The row says what it showed, so a request decided since is refused (F-1034).
    await vi.waitFor(() =>
      expect(api.reviewTimeOff).toHaveBeenCalledWith('t1', 'approved', 'paid', undefined, 'pending'),
    );
  });

  // F-1034: another manager answered it first; the gateway's 409 is said in its
  // own words, not a guess about withdrawal.
  it('says in words that someone else already answered the request', async () => {
    api.reviewTimeOff.mockRejectedValueOnce({
      response: {
        status: 409,
        data: {
          message:
            'This request was answered or taken back while you had it open, so your answer was not saved and the person was not told again. Close and open Time off to see where it stands.',
        },
      },
    });
    render(
      <TimeOffSheet
        requests={[
          {
            id: 't1', member_id: 'm1', start_date: '2026-09-07', end_date: '2026-09-08', reason: null,
            status: 'pending', leave_type: 'unknown', reviewed_by: null, created_at: '2026-09-01',
          },
        ]}
        failed={false}
        members={[member()] as never}
        weekStart="2026-09-07"
        onClose={() => {}}
        onChanged={() => {}}
      />,
      { wrapper },
    );
    fireEvent.click(screen.getByRole('button', { name: 'Deny' }));
    expect(await screen.findByText(/answered or taken back while you had it open/)).toBeInTheDocument();
    expect(api.reviewTimeOff).toHaveBeenCalledWith('t1', 'denied', undefined, undefined, 'pending');
  });

  // F-936: the manager's form filed the whole week on screen, and an approved
  // request had no way back.
  it('files the days the manager picks, not the whole week', async () => {
    render(
      <TimeOffSheet
        requests={[]}
        failed={false}
        members={[member()] as never}
        weekStart="2026-09-07"
        onClose={() => {}}
        onChanged={() => {}}
      />,
      { wrapper },
    );
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'm1' } });
    fireEvent.change(screen.getByLabelText('First day off'), { target: { value: '2026-09-08' } });
    fireEvent.change(screen.getByLabelText('Last day off'), { target: { value: '2026-09-07' } });
    expect(screen.getByRole('alert')).toHaveTextContent(/comes before the first/);
    expect(screen.getByRole('button', { name: 'File it' })).toBeDisabled();
    // F-1019: a cleared date is not a reversed range.
    fireEvent.change(screen.getByLabelText('Last day off'), { target: { value: '' } });
    expect(screen.getByRole('alert')).toHaveTextContent('Pick both days.');
    fireEvent.change(screen.getByLabelText('Last day off'), { target: { value: '2026-09-08' } });
    fireEvent.click(screen.getByRole('button', { name: 'File it' }));
    await vi.waitFor(() =>
      expect(api.createTimeOff).toHaveBeenCalledWith(
        expect.objectContaining({ memberId: 'm1', startDate: '2026-09-08', endDate: '2026-09-08' }),
        undefined,
        expect.stringMatching(/^time-off:/),
      ),
    );
  });

  it('can turn down a request already approved, and says a withdrawn one in words', async () => {
    const row = {
      member_id: 'm1', start_date: '2026-09-07', end_date: '2026-09-08', reason: null,
      leave_type: 'paid' as const, reviewed_by: null, created_at: '2026-09-01',
    };
    render(
      <TimeOffSheet
        requests={[
          { ...row, id: 't-ok', status: 'approved' },
          { ...row, id: 't-back', status: 'withdrawn' },
        ]}
        failed={false}
        members={[member()] as never}
        weekStart="2026-09-07"
        onClose={() => {}}
        onChanged={() => {}}
      />,
      { wrapper },
    );
    expect(screen.getByText(/withdrawn by them/)).toBeInTheDocument();
    const turnDown = screen.getAllByRole('button', { name: 'Turn it down' });
    expect(turnDown).toHaveLength(1);
    fireEvent.click(turnDown[0]);
    await vi.waitFor(() =>
      expect(api.reviewTimeOff).toHaveBeenCalledWith('t-ok', 'denied', undefined, undefined, 'approved'),
    );
  });

  // F-1038: the decision moves the row, so the pressed button is gone.
  it('says the decision aloud and keeps focus in the sheet when the row moves', async () => {
    const pendingRow = {
      id: 't1', member_id: 'm1', start_date: '2026-09-07', end_date: '2026-09-08', reason: null,
      status: 'pending' as const, leave_type: 'unknown' as const, reviewed_by: null, created_at: '2026-09-01',
    };
    const sheet = (requests: (typeof pendingRow | Record<string, unknown>)[], onChanged = () => {}) => (
      <TimeOffSheet
        requests={requests as never}
        failed={false}
        members={[member()] as never}
        weekStart="2026-09-07"
        onClose={() => {}}
        onChanged={onChanged}
      />
    );
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { rerender } = render(
      <QueryClientProvider client={qc}>{sheet([pendingRow])}</QueryClientProvider>,
    );

    const approve = screen.getByRole('button', { name: 'Approve as paid' });
    expect(approve).toHaveAccessibleDescription('Ayşe Yılmaz');
    approve.focus();
    fireEvent.click(approve);
    await vi.waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('Ayşe Yılmaz: approved as paid.'),
    );

    // The page re-reads the file: the request is decided now.
    rerender(
      <QueryClientProvider client={qc}>
        {sheet([{ ...pendingRow, status: 'approved', leave_type: 'paid' }])}
      </QueryClientProvider>,
    );
    expect(screen.queryByRole('button', { name: 'Approve as paid' })).not.toBeInTheDocument();
    await vi.waitFor(() => expect(screen.getByRole('status')).toHaveFocus());
  });
});

// ── (item 71) an owner's pay is the owners', even from a manager who sees pay ──
// The founder, 2026-09-27 (ADR 0215 question 7), verbatim: "if owner taking
// money, manager can't see it". The gateway withholds an owner's wage and
// shift cost from a manager with pay access and marks the row
// `pay_withheld: 'owner'`; the page says whose it is and offers no field.

describe("an owner's pay is not shown or offered to a manager who sees pay", () => {
  const ownerRow = member({
    id: 'm-owner',
    user_id: 'u-owner',
    display_name: 'Ada',
    role: 'owner',
    position: 'Owner',
    pay_withheld: 'owner',
  });

  it('names the owner’s wage on the roster as the owner’s, and shows a colleague’s', () => {
    render(
      <RosterSheet
        members={[ownerRow, member({ hourly_wage: 20 })] as never}
        membersFailed={false}
        shifts={[]}
        certs={[]}
        timeOff={[]}
        moneyVisible
        money={TRY_HOUSE}
        house={{ areas: null, areasFailed: false, away: null, awayFailed: false, awayByUser: new Map() }}
        onClose={() => {}}
        onEdit={() => {}}
        onAdd={() => {}}
        onCertificates={() => undefined}
      />,
      { wrapper },
    );
    const [ownerBtn, staffBtn] = screen.getAllByRole('button', { expanded: false });
    fireEvent.click(ownerBtn);
    expect(screen.getByText(/the owner's — an owner's pay is seen by an owner only/)).toBeInTheDocument();
    fireEvent.click(staffBtn);
    expect(screen.getByText(/20,00/)).toBeInTheDocument();
  });

  it('offers no wage field on the owner’s row, and says why', () => {
    render(
      <MemberSheet member={ownerRow as never} moneyVisible viewerUserId="u-mgr" ownerCount={1} onClose={() => {}} onChanged={() => {}} />,
      { wrapper },
    );
    expect(screen.queryByLabelText(/^Hourly wage/)).not.toBeInTheDocument();
    expect(screen.getByTestId('owner-pay-note')).toHaveTextContent(/Only an owner sees or sets it/);
  });

  it('still offers the owner their own wage field', () => {
    render(
      <MemberSheet
        member={member({ id: 'm-owner', user_id: 'u-owner', role: 'owner', hourly_wage: 40 }) as never}
        moneyVisible
        viewerIsOwner
        viewerUserId="u-owner"
        ownerCount={1}
        onClose={() => {}}
        onChanged={() => {}}
      />,
      { wrapper },
    );
    expect(screen.getByDisplayValue('40')).toBeInTheDocument();
    expect(screen.queryByTestId('owner-pay-note')).not.toBeInTheDocument();
  });

  it('says the manager’s week total leaves the owner’s shifts out', async () => {
    api.week = weekPayload({
      labor: {
        enabled: true,
        moneyVisible: true,
        totalHours: 22.5,
        totalCost: 375,
        costComplete: true,
        pricedShifts: 2,
        unpricedShifts: 0,
        ownerShiftsLeftOut: 1,
        targetPct: null,
        overtime: [],
        leave: { readable: true, paid: [], paidDays: 0, unknownTypeDays: 0 },
      },
      money: TRY_HOUSE,
    });
    render(<TeamNext />, { wrapper });
    const labour = await screen.findByRole('region', { name: 'Labour cost' });
    expect(await within(labour).findByTestId('owner-pay-left-out')).toHaveTextContent(
      "Leaves out the owner's 1 shift: an owner's pay is seen by an owner only.",
    );
  });

  it('says nothing of the kind on the owner’s own week', async () => {
    api.week = weekPayload({
      labor: {
        enabled: true,
        moneyVisible: true,
        totalHours: 22.5,
        totalCost: 675,
        costComplete: true,
        pricedShifts: 3,
        unpricedShifts: 0,
        ownerShiftsLeftOut: 0,
        targetPct: null,
        overtime: [],
        leave: { readable: true, paid: [], paidDays: 0, unknownTypeDays: 0 },
      },
      money: TRY_HOUSE,
    });
    render(<TeamNext />, { wrapper });
    const labour = await screen.findByRole('region', { name: 'Labour cost' });
    await within(labour).findByText(/Wages only/);
    expect(within(labour).queryByTestId('owner-pay-left-out')).not.toBeInTheDocument();
  });

  it('shows the owner’s shift in the labour lens as hours, not “not priced”, and names whose it is', () => {
    const shiftRow = (id: string, member_id: string, over: Record<string, unknown> = {}) => ({
      id,
      restaurant_id: 'r1',
      schedule_id: 'sch1',
      member_id,
      shift_date: '2026-08-31',
      start_time: '09:00',
      end_time: '17:00',
      role: 'Bar',
      shift_type: 'morning',
      state: 'scheduled',
      note: null,
      shift_breaks: [],
      recorded_break_min: 30,
      ...over,
    });
    render(
      <WeekGrid
        weekStart="2026-08-31"
        shifts={[
          shiftRow('s-owner', 'm-owner', { pay_withheld: 'owner', end_time: '15:00' }),
          shiftRow('s-staff', 'm1', { labor_cost: 150, shift_date: '2026-09-01' }),
        ] as never}
        members={[ownerRow, member()] as never}
        membersFailed={false}
        certs={[]}
        coverage={[]}
        weekFailed={false}
        engineIdle
        lens="labour"
        labourEnabled
        moneyVisible
        money={TRY_HOUSE}
        scheduleId="sch1"
        onEditShift={() => {}}
        onChanged={() => {}}
      />,
      { wrapper },
    );
    expect(screen.queryByText(/not priced/)).not.toBeInTheDocument();
    // The chip's line under the labour lens: the owner's worked hours (6h span,
    // 30 min recorded), where a priced shift shows its cost.
    const chips = screen.getAllByText('5.5h');
    // Two: the person's week total, and the chip's own line.
    expect(chips).toHaveLength(2);
    fireEvent.click(chips[1]);
    expect(screen.getByText(/the owner's — an owner's pay is seen by an owner only/)).toBeInTheDocument();
  });
});

// ── F-583: Inactive is a label, not a suspension, and the sheet says so ──────

describe('the Status control says what Inactive does', () => {
  it('says Inactive does not stop sign-in, and that removal ends access', () => {
    render(
      <MemberSheet member={member({ status: 'inactive' }) as never} moneyVisible={false} ownerCount={1} onClose={() => {}} onChanged={() => {}} />,
      { wrapper },
    );
    expect(screen.getByText(/does not\s+stop them signing in/)).toBeInTheDocument();
    expect(screen.getByText(/to end their access,\s+remove them/)).toBeInTheDocument();
  });
});

// ── F-1117 / F-1118: a write whose answer was lost is not "unchanged" ─────────
//
// Copy last week, Duplicate, Delete and the manager's time-off form each said
// nothing had happened after a timeout or a 5xx, when the gateway may have
// done it. Each now says it may have landed, reads the page again, and a
// retry is answered as the first try's work, never as someone else's change.
describe('a lost answer is said as unknown, and the retry does not blame anyone else', () => {
  const lost = () =>
    Object.assign(new Error('timeout of 30000ms exceeded'), {
      isAxiosError: true,
      request: {},
      response: undefined,
    });
  const status = (code: number, message: string) =>
    Object.assign(new Error(`Request failed with status code ${code}`), {
      response: { status: code, data: { message } },
    });

  beforeEach(() => {
    vi.mocked(copyWeek).mockReset().mockResolvedValue({});
    vi.mocked(createShift).mockReset().mockResolvedValue({} as never);
    vi.mocked(deleteShift).mockReset().mockResolvedValue(undefined);
    api.createTimeOff.mockReset().mockResolvedValue({});
  });

  it('copy last week: says the copy may have landed, reads the week, and a refused retry is not "someone changed it" (F-1117)', async () => {
    vi.mocked(copyWeek)
      .mockRejectedValueOnce(lost())
      .mockRejectedValueOnce(
        status(409, 'The week of 2026-09-07 now has 3 shift(s), not the 0 you were shown, so someone changed it after you opened the page.'),
      );
    const onDone = vi.fn();
    // The desk keeps what went unanswered; the seal approves once, so a retry
    // is the panel opened again.
    const lostCopies = new Set<string>();
    const panel = () => (
      <CopyWeekPanel
        weekStart="2026-09-07"
        shiftsOnTarget={0}
        lostCopies={lostCopies}
        onClose={() => {}}
        onDone={onDone}
      />
    );
    // The seal's keyboard path: Enter arms it, Enter again approves.
    const press = () => {
      const die = screen.getByRole('button', { name: /Hold to copy last week/ });
      fireEvent.keyDown(die, { key: 'Enter' });
      fireEvent.keyDown(die, { key: 'Enter' });
    };
    const first = render(panel(), { wrapper });
    press();
    expect(await screen.findByText(/may already be copied in/)).toBeInTheDocument();
    expect(screen.queryByText(/Nothing was copied/)).not.toBeInTheDocument();
    expect(onDone).toHaveBeenCalledTimes(1);
    first.unmount();

    render(panel(), { wrapper });
    press();
    expect(await screen.findByText(/most likely by your own copy/)).toBeInTheDocument();
    expect(screen.queryByText(/someone changed it/)).not.toBeInTheDocument();
    expect(onDone).toHaveBeenCalledTimes(2);
  });

  it('time off filed by a manager: says it may be on file, reads the file again, and retries with the same key (F-1118)', async () => {
    api.createTimeOff.mockRejectedValue(status(504, 'Gateway Timeout'));
    const onChanged = vi.fn();
    render(
      <TimeOffSheet
        requests={[]}
        failed={false}
        members={[member()] as never}
        weekStart="2026-09-07"
        onClose={() => {}}
        onChanged={onChanged}
      />,
      { wrapper },
    );
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'm1' } });
    fireEvent.change(screen.getByLabelText('First day off'), { target: { value: '2026-09-08' } });
    fireEvent.change(screen.getByLabelText('Last day off'), { target: { value: '2026-09-08' } });
    const file = screen.getByRole('button', { name: 'File it' });
    fireEvent.click(file);
    expect(await screen.findByText(/may already be on file/)).toBeInTheDocument();
    expect(screen.queryByText(/The request was not filed/)).not.toBeInTheDocument();
    expect(screen.queryByText('Gateway Timeout')).not.toBeInTheDocument();
    expect(onChanged).toHaveBeenCalled();
    await vi.waitFor(() => expect(file).not.toBeDisabled());
    fireEvent.click(file);
    await vi.waitFor(() => expect(api.createTimeOff).toHaveBeenCalledTimes(2));
    const [a, b] = api.createTimeOff.mock.calls.map((c) => c[2]);
    expect(a).toMatch(/^time-off:/);
    expect(b).toBe(a);
  });

  it('the shift sheet: a lost delete may be done, and a retry that finds no shift is the delete done (F-1118)', async () => {
    vi.mocked(deleteShift)
      .mockRejectedValueOnce(status(502, 'Bad Gateway'))
      .mockRejectedValueOnce(status(404, 'Shift not found'));
    const onChanged = vi.fn();
    const onClose = vi.fn();
    render(
      <ShiftSheet
        target={{
          shift: {
            id: 'sh-9', schedule_id: 'sch1', member_id: null, shift_date: '2026-09-07',
            start_time: '09:00', end_time: '17:00', role: null, shift_type: 'open',
            state: 'open', note: null, shift_breaks: [],
          } as never,
        }}
        members={[]}
        scheduleId="sch1"
        onClose={onClose}
        onChanged={onChanged}
      />,
      { wrapper },
    );
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    const remove = screen.getByRole('button', { name: 'Remove the shift' });
    fireEvent.click(remove);
    expect(await screen.findByText(/may already be gone/)).toBeInTheDocument();
    expect(screen.queryByText(/still on the schedule/)).not.toBeInTheDocument();
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(vi.mocked(deleteShift).mock.calls[0][2]).toBe('shift-delete:sh-9');
    await vi.waitFor(() => expect(remove).not.toBeDisabled());
    fireEvent.click(remove);
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(screen.queryByText(/Shift not found/)).not.toBeInTheDocument();
  });

  it('the grid: a lost Duplicate may be on the schedule, and the retry sends the same key (F-1118)', async () => {
    vi.mocked(createShift).mockRejectedValue(lost());
    const onChanged = vi.fn();
    const { container } = render(
      <WeekGrid
        weekStart="2026-08-31"
        shifts={[
          {
            id: 's-1', restaurant_id: 'r1', schedule_id: 'sch1', member_id: 'm1',
            shift_date: '2026-08-31', start_time: '09:00', end_time: '17:00', role: 'Bar',
            shift_type: 'morning', state: 'scheduled', note: null, shift_breaks: [],
            recorded_break_min: 30,
          },
        ] as never}
        members={[member()] as never}
        membersFailed={false}
        certs={[]}
        coverage={[]}
        weekFailed={false}
        engineIdle
        lens="coverage"
        labourEnabled
        moneyVisible
        money={TRY_HOUSE}
        scheduleId="sch1"
        onEditShift={() => {}}
        onChanged={onChanged}
      />,
      { wrapper },
    );
    fireEvent.click(container.querySelector('.tm-chip') as HTMLElement);
    const dup = screen.getByRole('button', { name: 'Duplicate onto the same day' });
    fireEvent.click(dup);
    expect(await screen.findByText(/the copy may already be on the schedule/)).toBeInTheDocument();
    expect(screen.queryByText(/the week is unchanged/)).not.toBeInTheDocument();
    expect(onChanged).toHaveBeenCalled();
    await vi.waitFor(() => expect(dup).not.toBeDisabled());
    fireEvent.click(dup);
    await vi.waitFor(() => expect(createShift).toHaveBeenCalledTimes(2));
    const [a, b] = vi.mocked(createShift).mock.calls.map((c) => c[2]);
    expect(a).toMatch(/^shift-duplicate:/);
    expect(b).toBe(a);
  });
});

// ── F-1120: hours with the house's decimal mark ──────────────────────────────
describe('hours print with the house decimal mark', () => {
  it('says 7,5h in a Turkish house and 7.5h in an American one', () => {
    expect(fmtHours(7.5, houseLocale('Türkiye'))).toBe('7,5h');
    expect(fmtHours(7.5, houseLocale('United States'))).toBe('7.5h');
    expect(fmtHours(8, houseLocale('Türkiye'))).toBe('8h');
    expect(fmtHours(7.5)).toBe('7.5h');
  });
});
