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
  deleteTeamMember: vi.fn((..._a: unknown[]) => Promise.resolve({} as Record<string, unknown>)),
  getHandoverPreview: vi.fn((..._a: unknown[]) => Promise.resolve({} as Record<string, unknown>)),
}));

vi.mock('../../../services/api/team', () => ({
  createTeamMember: vi.fn(() => Promise.resolve({})),
  deleteTeamMember: api.deleteTeamMember,
  getHandoverPreview: api.getHandoverPreview,
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
  api.deleteTeamMember.mockReset();
  api.getHandoverPreview.mockReset();
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
    // ADR 0215 item 26 (founder item 93): what has not started goes back to
    // the open pool; what is kept is the PAST shifts, not every shift.
    expect(screen.getByText(/kept for five years, for an owner only/)).toHaveTextContent(
      /shifts that have not started yet go back to the open pool.*Their past shifts, leave/,
    );
    // The founder, 2026-09-28: a shift being worked right now is cut at the
    // removal minute (ADR 0215 item 26's 2026-09-28 bracket).
    expect(screen.getByText(/kept for five years, for an owner only/)).toHaveTextContent(
      /working right now is cut at this minute: the part worked stays theirs, paid for the time worked, and the rest of it goes to the open pool/,
    );
  });

  function removeWith(receipt: Record<string, unknown>) {
    api.deleteTeamMember.mockResolvedValue(receipt);
    const onClose = vi.fn();
    const onChanged = vi.fn();
    render(
      wrap(
        <MemberSheet
          member={member({ role: 'staff' }) as never}
          moneyVisible
          viewerIsOwner
          viewerUserId="u-owner"
          ownerCount={1}
          onClose={onClose}
          onChanged={onChanged}
        />,
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove and revoke access' }));
    return { onClose, onChanged };
  }

  it('closes after a removal judged on the house\'s own clock, with nothing to say', async () => {
    const { onClose, onChanged } = removeWith({
      shiftsOpened: 2,
      shiftsSplit: 1,
      shiftsUnjudged: 0,
      clock: { zone: 'Europe/Istanbul', source: 'house' },
    });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(onChanged).toHaveBeenCalled();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('says when the removal was judged on this device\'s clock, and waits to be closed', async () => {
    const { onClose, onChanged } = removeWith({
      shiftsSplit: 1,
      shiftsUnjudged: 0,
      clock: { zone: 'Europe/Istanbul', source: 'device' },
    });
    const note = await screen.findByRole('status');
    expect(note).toHaveTextContent(/no time zone set.*this device's clock \(Europe\/Istanbul\).*Set the restaurant's time zone in Settings/);
    expect(onChanged).toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('names the shifts it could not judge with no clock at all', async () => {
    const { onClose } = removeWith({
      shiftsSplit: 0,
      shiftsUnjudged: 2,
      clock: { zone: null, source: 'none' },
    });
    const note = await screen.findByRole('status');
    expect(note).toHaveTextContent(/2 shifts of theirs may already have started.*kept with them, whole/);
    expect(onClose).not.toHaveBeenCalled();
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

// ADR 0215 item 27 (founder, 2026-09-28): "'Replace with' picker"; checks
// "refuse overlap warn rest but owner has a say to change it into warn all
// four to allow double booking". The page only shows what the gateway's
// checks said; it never decides a check itself. Fails on 8dd9bfeaf: there is
// no picker there, and the removal sends no hand-over.
describe('"Replace with" on the remove dialog', () => {
  const sam = member({ id: 'm-sam', user_id: 'u-sam', display_name: 'Sam', position: 'Server', role: 'staff' });
  const leaving = member({ id: 'm-gone', user_id: 'u-gone', display_name: 'Gone', role: 'staff' });

  function openRemove(preview: Record<string, unknown>) {
    api.getHandoverPreview.mockResolvedValue(preview);
    api.deleteTeamMember.mockResolvedValue({ shiftsOpened: 1, shiftsHandedOver: 1, clock: { zone: 'Europe/Istanbul', source: 'house' } });
    const onClose = vi.fn();
    render(
      wrap(
        <MemberSheet
          member={leaving as never}
          roster={[leaving, sam] as never}
          moneyVisible
          viewerIsOwner
          viewerUserId="u-owner"
          ownerCount={1}
          onClose={onClose}
          onChanged={vi.fn()}
        />,
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    return { onClose };
  }
  const shiftOf = (id: string, checks: unknown[] = [], over: Record<string, unknown> = {}) => ({
    id,
    part: 'whole',
    shift_date: '2026-09-24',
    start_time: '09:00',
    end_time: '17:00',
    role: 'Server',
    checks,
    ...over,
  });

  it('lists everyone else on the roster, and with nobody chosen removes as before (open pool)', async () => {
    openRemove({ doubleBooking: 'refuse', unjudged: 0, shifts: [] });
    const picker = screen.getByRole('combobox', { name: 'Replace with' });
    expect(Array.from((picker as HTMLSelectElement).options).map((o) => o.textContent)).toEqual([
      'The open pool (nobody yet)',
      'Sam — Server',
    ]);
    fireEvent.click(screen.getByRole('button', { name: 'Remove and revoke access' }));
    await waitFor(() => expect(api.deleteTeamMember).toHaveBeenCalledWith('m-gone', undefined, null));
    expect(api.getHandoverPreview).not.toHaveBeenCalled();
  });

  it('hands the ticked shifts to the chosen person; an unticked one stays for the open pool', async () => {
    openRemove({ doubleBooking: 'refuse', unjudged: 0, shifts: [shiftOf('thu'), shiftOf('fri', [], { shift_date: '2026-09-25', part: 'rest' })] });
    fireEvent.change(screen.getByRole('combobox', { name: 'Replace with' }), { target: { value: 'm-sam' } });
    await waitFor(() => expect(api.getHandoverPreview).toHaveBeenCalledWith('m-gone', 'm-sam'));
    const boxes = await screen.findAllByRole('checkbox');
    await waitFor(() => expect(boxes.every((b) => (b as HTMLInputElement).checked)).toBe(true));
    expect(screen.getByText(/the rest of the shift they are on now/)).toBeInTheDocument();
    fireEvent.click(boxes[1]);
    fireEvent.click(screen.getByRole('button', { name: 'Remove and hand over 1 shift' }));
    await waitFor(() =>
      expect(api.deleteTeamMember).toHaveBeenCalledWith('m-gone', undefined, { to: 'm-sam', shiftIds: ['thu'], accept: [] }),
    );
  });

  it('a refused shift (an overlap, double booking off) cannot be ticked and says it goes to the open pool', async () => {
    openRemove({
      doubleBooking: 'refuse',
      unjudged: 0,
      shifts: [shiftOf('thu', [{ code: 'overlap', level: 'refuse', message: 'They already have a shift at this time.' }]), shiftOf('fri')],
    });
    fireEvent.change(screen.getByRole('combobox', { name: 'Replace with' }), { target: { value: 'm-sam' } });
    const boxes = await screen.findAllByRole('checkbox');
    expect(boxes[0]).toBeDisabled();
    expect(boxes[0]).not.toBeChecked();
    expect(screen.getByText(/Goes to the open pool: They already have a shift at this time/)).toBeInTheDocument();
    expect(screen.getByText(/Double booking is off in this house/)).toBeInTheDocument();
    await waitFor(() => expect(boxes[1]).toBeChecked());
    fireEvent.click(screen.getByRole('button', { name: 'Remove and hand over 1 shift' }));
    await waitFor(() =>
      expect(api.deleteTeamMember).toHaveBeenCalledWith('m-gone', undefined, { to: 'm-sam', shiftIds: ['fri'], accept: [] }),
    );
  });

  // CI run 36728755317 sent `null` from a button that already read "Remove and
  // hand over 1 shift": the removal read the hand-over React Query had been
  // given one render earlier (it takes a new mutationFn in an effect, after
  // the paint). On a slow runner React's scheduler runs out of its 5ms slice
  // between the paint and the effects and lets the test click in between.
  // Here every slice runs out (the clock jumps 10ms a read) and the click
  // lands the moment the label changes, so the gap fails every time instead
  // of once in a while. Fails on 597f728d9.
  it('sends what the button says, even when clicked the moment it says it', async () => {
    let t = 0;
    const clock = vi.spyOn(performance, 'now').mockImplementation(() => (t += 10));
    let clicked = false;
    const watch = new MutationObserver(() => {
      const go = screen.queryByRole('button', { name: 'Remove and hand over 1 shift' });
      if (!go || (go as HTMLButtonElement).disabled) return;
      watch.disconnect();
      fireEvent.click(go);
      clicked = true;
    });
    // Restored whatever happens, so a red run cannot leave the next test
    // with a jumping clock or a stray click.
    try {
      openRemove({ doubleBooking: 'refuse', unjudged: 0, shifts: [shiftOf('fri')] });
      watch.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true });
      fireEvent.change(screen.getByRole('combobox', { name: 'Replace with' }), { target: { value: 'm-sam' } });
      await waitFor(() => expect(clicked).toBe(true));
    } finally {
      watch.disconnect();
      clock.mockRestore();
    }
    await waitFor(() =>
      expect(api.deleteTeamMember).toHaveBeenCalledWith('m-gone', undefined, { to: 'm-sam', shiftIds: ['fri'], accept: [] }),
    );
  });

  it('a warning must be acknowledged before the removal is sent, and its code goes with it', async () => {
    openRemove({
      doubleBooking: 'warn',
      unjudged: 0,
      shifts: [shiftOf('thu', [{ code: 'time_off', level: 'warn', message: 'They have approved time off on this day.' }])],
    });
    fireEvent.change(screen.getByRole('combobox', { name: 'Replace with' }), { target: { value: 'm-sam' } });
    expect(await screen.findByText(/Warning: They have approved time off on this day/)).toBeInTheDocument();
    const go = await screen.findByRole('button', { name: 'Remove and hand over 1 shift' });
    expect(go).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: /I have read the warnings/ }));
    expect(go).not.toBeDisabled();
    fireEvent.click(go);
    await waitFor(() =>
      expect(api.deleteTeamMember).toHaveBeenCalledWith('m-gone', undefined, { to: 'm-sam', shiftIds: ['thu'], accept: ['time_off'] }),
    );
  });

  it("says the gateway's refusal in its own words", async () => {
    openRemove({ doubleBooking: 'refuse', unjudged: 0, shifts: [shiftOf('thu')] });
    api.deleteTeamMember.mockRejectedValue({ response: { status: 409, data: { message: 'Some of these shifts cannot go to the person you chose, so nobody was removed.' } } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Replace with' }), { target: { value: 'm-sam' } });
    const go = await screen.findByRole('button', { name: 'Remove and hand over 1 shift' });
    fireEvent.click(go);
    expect(await screen.findByText(/cannot go to the person you chose, so nobody was removed/)).toBeInTheDocument();
  });
});
