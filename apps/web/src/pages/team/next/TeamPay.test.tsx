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
  createTimeOff: vi.fn(() => Promise.resolve({})),
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

import TeamNext from './TeamNext';
import { MemberSheet } from './RosterSheet';
import { ExportPopover, TimeOffSheet } from './TeamOverlays';
import {
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
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
    expect(screen.getByText(/the owner.s to see and to set/)).toBeInTheDocument();
  });

  it('offers the owner the wage field, and says each change is kept', () => {
    render(
      <MemberSheet member={member({ hourly_wage: 150 }) as never} moneyVisible ownerCount={1} onClose={() => {}} onChanged={() => {}} />,
      { wrapper },
    );
    expect(screen.getByRole('spinbutton')).toBeInTheDocument();
    expect(screen.getByText(/Each change is kept/)).toBeInTheDocument();
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
    expect(workedHours('09:00', '19:00', [{ duration_min: 60 }])).toBe(9);
  });

  it('draws the review line at the Turkish week', () => {
    expect(WEEKLY_REVIEW_HOURS).toBe(45);
  });

  it('names the people over 45 worked hours as a review, with no price', async () => {
    api.members = [member()];
    api.week = weekPayload({
      labor: { enabled: true, moneyVisible: false, totalHours: 46, overtime: [{ memberId: 'm1', hours: 46 }] },
    });
    render(<TeamNext />, { wrapper });
    expect(await screen.findByText(/Over 45h worked — review before publishing/)).toBeInTheDocument();
    expect(screen.queryByText(/40h/)).not.toBeInTheDocument();
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
    await vi.waitFor(() => expect(api.reviewTimeOff).toHaveBeenCalledWith('t1', 'approved', 'paid'));
  });
});
