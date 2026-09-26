/**
 * /team, ADR 0215 round 4 — the founder's answers of 2026-09-25 (item 19) on
 * the page: the owner's pay switch on a manager's row ("Pay visibility only"),
 * a manager with pay access offered their own wage with the owner told (round 5
 * item 32, which replaced round 4's refusal), and the owner-only former-staff
 * history ("Owner-only history") with honest states.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const api = vi.hoisted(() => ({
  setMemberPayAccess: vi.fn(),
  getFormerStaff: vi.fn(),
  updateTeamMember: vi.fn((..._a: unknown[]) => Promise.resolve({})),
}));

vi.mock('../../../services/api/team', () => ({
  createTeamMember: vi.fn(() => Promise.resolve({})),
  deleteTeamMember: vi.fn(() => Promise.resolve(undefined)),
  updateTeamMember: api.updateTeamMember,
  setMemberPayAccess: api.setMemberPayAccess,
  getFormerStaff: api.getFormerStaff,
  getMemberPerformance: () => Promise.resolve({ hasData: false }),
}));

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({
    activeRestaurantId: 'r1',
    activeRole: 'owner',
    user: { userId: 'u-owner', restaurantId: 'r1', role: 'owner' },
  }),
}));

import { MemberSheet } from './RosterSheet';
import { FormerStaffSheet } from './FormerStaff';
import { TeamRecordSection } from './TeamRecord';

function wrap(children: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

const member = (over: Record<string, unknown> = {}) => ({
  id: 'm-mgr',
  restaurant_id: 'r1',
  user_id: 'u-mgr',
  display_name: 'Moe',
  email: null,
  phone: null,
  avatar_url: null,
  position: 'Manager',
  employment_type: 'full_time',
  home_location: null,
  hourly_wage: 30,
  skills: [],
  hire_date: null,
  status: 'active',
  notes: null,
  role: 'manager',
  accountLinked: true,
  ...over,
});

beforeEach(() => {
  api.setMemberPayAccess.mockReset();
  api.getFormerStaff.mockReset();
  api.updateTeamMember.mockClear();
});

describe('the pay switch on a manager’s row', () => {
  it('is offered to the owner on a manager, shows its state, and switches it', async () => {
    api.setMemberPayAccess.mockResolvedValue({
      memberId: 'm-mgr',
      payAccess: true,
      changed: true,
      audited: true,
      notified: true,
    });
    const onChanged = vi.fn();
    render(
      wrap(
        <MemberSheet
          member={member({ payAccess: false }) as never}
          moneyVisible
          viewerIsOwner
          viewerUserId="u-owner"
          ownerCount={1}
          onClose={() => {}}
          onChanged={onChanged}
        />,
      ),
    );
    const box = screen.getByRole('checkbox', { name: 'Sees and sets pay' });
    expect(box).not.toBeChecked();
    expect(screen.getByTestId('pay-access')).toHaveTextContent(/their own too, and then you are told/);
    fireEvent.click(box);
    await waitFor(() => expect(api.setMemberPayAccess).toHaveBeenCalledWith('m-mgr', true));
    await waitFor(() => expect(screen.getByRole('checkbox', { name: 'Sees and sets pay' })).toBeChecked());
    expect(onChanged).toHaveBeenCalled();
  });

  it('says an unread switch is unread and offers no control', () => {
    render(
      wrap(
        <MemberSheet
          member={member({ payAccess: null }) as never}
          moneyVisible
          viewerIsOwner
          viewerUserId="u-owner"
          ownerCount={1}
          onClose={() => {}}
          onChanged={() => {}}
        />,
      ),
    );
    expect(screen.queryByRole('checkbox', { name: 'Sees and sets pay' })).toBeNull();
    expect(screen.getByTestId('pay-access')).toHaveTextContent(/could not be read/);
  });

  it('is not offered on a staff row, nor to a manager', () => {
    const { unmount } = render(
      wrap(
        <MemberSheet
          member={member({ role: 'staff', user_id: 'u-staff' }) as never}
          moneyVisible
          viewerIsOwner
          viewerUserId="u-owner"
          ownerCount={1}
          onClose={() => {}}
          onChanged={() => {}}
        />,
      ),
    );
    expect(screen.queryByTestId('pay-access')).toBeNull();
    unmount();
    render(
      wrap(
        <MemberSheet
          member={member({ id: 'm-mgr2', user_id: 'u-mgr2' }) as never}
          moneyVisible
          viewerIsOwner={false}
          viewerUserId="u-mgr"
          ownerCount={1}
          onClose={() => {}}
          onChanged={() => {}}
        />,
      ),
    );
    expect(screen.queryByTestId('pay-access')).toBeNull();
  });

  it('shows a switched-on manager a colleague’s wage field, and their own with the owner told (round 5)', () => {
    const { unmount } = render(
      wrap(
        <MemberSheet
          member={member({ id: 'm-staff', user_id: 'u-staff', role: 'staff', hourly_wage: 20 }) as never}
          moneyVisible
          viewerUserId="u-mgr"
          ownerCount={1}
          onClose={() => {}}
          onChanged={() => {}}
        />,
      ),
    );
    expect(screen.getByDisplayValue('20')).toBeInTheDocument();
    expect(screen.queryByTestId('own-wage-note')).toBeNull();
    unmount();
    render(
      wrap(
        <MemberSheet
          member={member() as never}
          moneyVisible
          viewerUserId="u-mgr"
          ownerCount={1}
          onClose={() => {}}
          onChanged={() => {}}
        />,
      ),
    );
    const field = screen.getByDisplayValue('30');
    expect(screen.getByTestId('own-wage-note')).toHaveTextContent(/an owner of this house is told/);
    fireEvent.change(field, { target: { value: '35' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    return waitFor(() => {
      expect(api.updateTeamMember).toHaveBeenCalled();
      const body = api.updateTeamMember.mock.calls[0][1] as Record<string, unknown>;
      expect(body.hourlyWage).toBe(35);
    });
  });

  it('says so, and stays open, when the owner could not be told of a manager’s own wage', async () => {
    api.updateTeamMember.mockResolvedValueOnce({ ownWage: { audited: true, ownersNotified: 0, ownersFound: null } });
    const onClose = vi.fn();
    render(
      wrap(
        <MemberSheet
          member={member() as never}
          moneyVisible
          viewerUserId="u-mgr"
          ownerCount={1}
          onClose={onClose}
          onChanged={() => {}}
        />,
      ),
    );
    fireEvent.change(screen.getByDisplayValue('30'), { target: { value: '35' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText(/could not be read, so none was told/)).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('tells the owner, before a removal, what is kept and what is not', () => {
    render(
      wrap(
        <MemberSheet
          member={member({ role: 'staff' }) as never}
          moneyVisible
          viewerIsOwner
          viewerUserId="u-owner"
          ownerCount={1}
          onClose={() => {}}
          onChanged={() => {}}
        />,
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(screen.getByText(/kept for five years, for an owner only/)).toHaveTextContent(
      /availability is not kept/,
    );
  });
});

const PERSON = {
  memberId: 'm-gone',
  name: 'Gus',
  position: 'Server',
  leftAt: '2026-09-10T12:00:00.000Z',
  keptUntil: '2031-09-10T12:00:00.000Z',
  shifts: [
    {
      id: 'g1',
      shift_date: '2026-09-01',
      start_time: '09:00',
      end_time: '17:00',
      state: 'scheduled',
      role: null,
      workedHours: 7.5,
      labor_cost: 150,
    },
  ],
  totals: { shiftsWorked: 1, workedHours: 7.5, cost: 150, unpricedShifts: 0 },
  leave: [{ id: 't', start_date: '2026-08-20', end_date: '2026-08-21', status: 'approved', leave_type: 'paid' }],
  wageChanges: [
    { old_wage: null, new_wage: 20, currency: 'TRY', changed_by_role: 'owner', changed_at: '2026-01-05T00:00:00.000Z' },
  ],
  credentials: [
    { id: 'c', cert_type: 'food_handler', issued_at: '2025-01-01', expires_at: '2027-01-01', doc_url: null, status: 'valid' },
  ],
};
const MONEY = { currency: 'TRY', country: 'Türkiye', readable: true };

describe('the former-staff history', () => {
  it('lists each person who left with what is kept, and when it ends', async () => {
    api.getFormerStaff.mockResolvedValue({ retentionYears: 5, money: MONEY, people: [PERSON] });
    render(wrap(<FormerStaffSheet onClose={() => {}} />));
    const row = await screen.findByTestId('former-m-gone');
    expect(row).toHaveTextContent('Gus');
    expect(row).toHaveTextContent(/kept until 10 Sept 2031|kept until 10 Sep 2031/);
    expect(row).toHaveTextContent(/1 worked shift, 7.5h worked/);
    expect(row).toHaveTextContent(/paid/);
    expect(row).toHaveTextContent(/food handler/);
    expect(screen.getByTestId('former-staff')).not.toHaveTextContent(/could not be read/);
  });

  it('says a name that was not recorded, and a cost that cannot be known, as such', async () => {
    api.getFormerStaff.mockResolvedValue({
      retentionYears: 5,
      money: MONEY,
      people: [{ ...PERSON, name: null, totals: { shiftsWorked: 2, workedHours: 15, cost: null, unpricedShifts: 1 } }],
    });
    render(wrap(<FormerStaffSheet onClose={() => {}} />));
    const row = await screen.findByTestId('former-m-gone');
    expect(row).toHaveTextContent('Name not recorded');
    expect(row).toHaveTextContent(/cost unknown \(1 shift had no wage on file\)/);
  });

  it('says nobody has left when nobody has, and a failed read as a failure', async () => {
    api.getFormerStaff.mockResolvedValueOnce({ retentionYears: 5, money: MONEY, people: [] });
    const { unmount } = render(wrap(<FormerStaffSheet onClose={() => {}} />));
    expect(await screen.findByTestId('former-staff-empty')).toBeInTheDocument();
    unmount();
    api.getFormerStaff.mockRejectedValueOnce(new Error('Request failed with status code 500'));
    render(wrap(<FormerStaffSheet onClose={() => {}} />));
    expect(
      await screen.findByText(/could not be read \(Request failed with status code 500\)/),
    ).toHaveTextContent(/not nobody/);
    expect(screen.queryByTestId('former-staff-empty')).toBeNull();
  });

  it('is offered to the owner only', () => {
    const props = {
      labourEnabled: true,
      moneyVisible: true,
      target: { pct: 30, why: '', source: 'stored' } as never,
      settingsUpdatedAt: null,
      settingsConfigured: true,
      coverageRuleCount: 0,
      certsOnFile: 0,
      onOpenTrail: () => {},
    };
    const open = vi.fn();
    const { unmount } = render(
      wrap(<TeamRecordSection {...props} viewerIsOwner onOpenFormerStaff={open} />),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Open the former-staff history' }));
    expect(open).toHaveBeenCalled();
    unmount();
    render(wrap(<TeamRecordSection {...props} viewerIsOwner={false} onOpenFormerStaff={open} />));
    expect(screen.queryByRole('button', { name: 'Open the former-staff history' })).toBeNull();
  });
});
