/**
 * Hours on the house's clock (F-1462 = F-1481 = F-1487): the gateway prices a
 * shift on the hours really worked (`pay-rules.ts` `hoursBetween`, F-1367),
 * so a DST night is 9 hours in Detroit on 2026-10-31. The grid, the shift's
 * facts and the payroll export now count the same 9, not the wall clock's 8.
 *
 * F-1482: Germany's 10-hour day is the working day, so a split shift's two
 * halves add up. F-1489: the former-staff record prints days on the house's
 * calendar and shift times on its clock.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createRef, type ReactNode } from 'react';

const api = vi.hoisted(() => ({
  zone: null as string | null,
  exportTable: vi.fn((..._args: unknown[]) => Promise.resolve(undefined)),
  getFormerStaff: vi.fn(),
}));

vi.mock('@/lib/houseZone', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/houseZone')>()),
  getHouseZone: () => api.zone,
  useHouseZone: () => api.zone,
}));

vi.mock('../../../services/api/team', () => ({
  createShift: vi.fn(() => Promise.resolve({})),
  deleteShift: vi.fn(() => Promise.resolve(undefined)),
  offerCover: vi.fn(() => Promise.resolve({})),
  reportCallout: vi.fn(() => Promise.resolve({})),
  getFormerStaff: api.getFormerStaff,
}));

vi.mock('../../../services/api/client', () => ({
  apiClient: { get: vi.fn(), post: vi.fn() },
  getErrorMessage: (e: unknown) => String(e),
  isUnconfirmedWrite: () => false,
}));

vi.mock('../../../lib/tableExport', () => ({ exportTable: api.exportTable }));

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({
    activeRestaurantId: 'r1',
    activeRole: 'owner',
    user: { userId: 'u1', restaurantId: 'r1', role: 'owner' },
  }),
}));

import { WeekGrid } from './WeekGrid';
import { ExportPopover } from './TeamOverlays';
import { FormerStaffSheet } from './FormerStaff';
import { ShiftClockProvider } from './tm-bits';
import { LABOUR_RULES, shiftHours, workedHours } from './tm-format';

function houseWrapper(locale: string) {
  return function HouseWrapper({ children }: { children: ReactNode }) {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return (
      <QueryClientProvider client={qc}>
        <ShiftClockProvider locale={locale}>{children}</ShiftClockProvider>
      </QueryClientProvider>
    );
  };
}

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

const shift = (over: Record<string, unknown>) => ({
  id: 's1',
  restaurant_id: 'r1',
  schedule_id: 'sch1',
  member_id: 'm1',
  shift_date: '2026-10-31',
  start_time: '22:00',
  end_time: '06:00',
  role: 'Bar',
  shift_type: 'pm',
  state: 'scheduled',
  note: null,
  shift_breaks: [],
  recorded_break_min: 0,
  ...over,
});

function grid(shifts: unknown[], weekStart: string, lens: 'labour' | 'compliance', zone: string | null) {
  return (
    <WeekGrid
      weekStart={weekStart}
      shifts={shifts as never}
      members={[member] as never}
      membersFailed={false}
      certs={[]}
      coverage={[]}
      weekFailed={false}
      engineIdle
      lens={lens}
      labourEnabled
      moneyVisible={false}
      money={null}
      scheduleId="sch1"
      onEditShift={() => {}}
      onChanged={() => {}}
      zone={zone}
    />
  );
}

beforeEach(() => {
  api.zone = null;
  api.exportTable.mockClear();
  api.getFormerStaff.mockReset();
});

describe('a DST night counts the hours really worked, as the gateway prices it (F-1462, F-1481, F-1487)', () => {
  it('reads start and end on the house clock when the shift day and zone are known', () => {
    const on = (date: string, zone: string) => ({ date, zone });
    // Fall back: the gateway's own case (labour-country.spec.ts), 9 hours.
    expect(shiftHours('22:00', '06:00', on('2026-10-31', 'America/Detroit'))).toBe(9);
    // Spring forward: an hour is lost.
    expect(shiftHours('22:00', '06:00', on('2026-03-07', 'America/Detroit'))).toBe(7);
    // An ordinary night, and no zone at all: the wall clock.
    expect(shiftHours('22:00', '06:00', on('2026-10-24', 'America/Detroit'))).toBe(8);
    expect(shiftHours('22:00', '06:00')).toBe(8);
    // Berlin falls back on 2026-10-25: 9 hours, 8.5 worked after Germany's
    // 30 minutes — the gateway's probe figure.
    const berlin = { start_time: '22:00', end_time: '06:00', shift_date: '2026-10-24' };
    expect(workedHours(berlin, LABOUR_RULES.DE, 'Europe/Berlin')).toBe(8.5);
  });

  it("shows 9h on the grid's chip in a Detroit house, not the wall clock's 8h", () => {
    api.zone = 'America/Detroit';
    render(grid([shift({})], '2026-10-26', 'labour', 'America/Detroit'), {
      wrapper: houseWrapper('en-Latn-US'),
    });
    expect(screen.getAllByText('9h').length).toBeGreaterThan(0);
    expect(screen.queryByText('8h')).toBeNull();
  });

  it('hands payroll 9 hours for the same night', () => {
    api.zone = 'America/Detroit';
    render(
      <ExportPopover
        anchorRef={createRef<HTMLElement>()}
        weekStart="2026-10-26"
        shifts={[shift({})] as never}
        members={[]}
        moneyVisible={false}
        money={null}
        onClose={() => {}}
      />,
      { wrapper: houseWrapper('en-Latn-US') },
    );
    fireEvent.click(screen.getByRole('button', { name: /CSV/ }));
    const cols = (api.exportTable.mock.calls[0][0] as {
      columns: { header: string; value: (s: unknown) => unknown }[];
    }).columns;
    expect(cols.find((c) => c.header === 'Hours worked')?.value(shift({}))).toBe(9);
  });
});

describe("Germany's 10-hour day is the whole working day (F-1482)", () => {
  it('flags a split shift whose two halves pass 10 hours, and not a day under it', () => {
    const split = [
      shift({ id: 'a', shift_date: '2026-09-07', start_time: '08:00', end_time: '13:00' }),
      shift({ id: 'b', shift_date: '2026-09-07', start_time: '16:00', end_time: '22:00' }),
      // Another day, 9 hours in all: under the line.
      shift({ id: 'c', shift_date: '2026-09-08', start_time: '08:00', end_time: '12:00' }),
      shift({ id: 'd', shift_date: '2026-09-08', start_time: '17:00', end_time: '22:00' }),
    ];
    render(grid(split, '2026-09-07', 'compliance', null), { wrapper: houseWrapper('de-Latn-DE') });
    // Both shifts of the 11-hour day carry it; neither of the 9-hour day's.
    expect(screen.getAllByText('over 10h in a day · review')).toHaveLength(2);
  });
});

describe('the former-staff record is on the house calendar and clock (F-1489)', () => {
  it('prints a late-night removal on the house day, and shift times as /team does', async () => {
    api.zone = 'Europe/Istanbul';
    api.getFormerStaff.mockResolvedValue({
      retentionYears: 5,
      // Not dollars: the money guard counts a pinned 'USD' (ADR 0117 Q25); this
      // test is about the house's day and clock, not its money.
      money: { currency: 'EUR', country: 'United States', readable: true },
      people: [
        {
          memberId: 'm-gone',
          name: 'Gus',
          position: 'Server',
          // 01:30 on 10 Sept in Istanbul; the UTC slice said the 9th.
          leftAt: '2026-09-09T22:30:00.000Z',
          keptUntil: '2031-09-09T22:30:00.000Z',
          shifts: [
            {
              id: 'g1',
              shift_date: '2026-09-01',
              start_time: '17:00:00',
              end_time: '23:30:00',
              state: 'scheduled',
              role: null,
              workedHours: 6.5,
              labor_cost: 130,
            },
          ],
          totals: { shiftsWorked: 1, workedHours: 6.5, cost: 130, unpricedShifts: 0 },
          leave: [],
          wageChanges: [
            { old_wage: 18, new_wage: 20, currency: 'EUR', changed_by_role: 'owner', changed_at: '2026-01-04T21:30:00.000Z' },
          ],
          credentials: [],
        },
      ],
    });
    render(<FormerStaffSheet onClose={() => {}} />, { wrapper: houseWrapper('en-Latn-US') });
    const row = await screen.findByTestId('former-m-gone');
    expect(row).toHaveTextContent(/Removed 10 Sept? 2026/);
    expect(row).toHaveTextContent(/kept until 10 Sept? 2031/);
    expect(row).toHaveTextContent(/Wage: 5 Jan 2026/);
    expect(row).toHaveTextContent('5p–11:30p');
    expect(row).not.toHaveTextContent('17:00:00');
  });
});
