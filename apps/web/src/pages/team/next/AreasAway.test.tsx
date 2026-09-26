/**
 * The Areas sheet and the Away card on /team (ADR 0218): what they draw from
 * a readout, and what they send. The network module is replaced; the sheet
 * and the card are the units under test and run for real.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const api = vi.hoisted(() => ({
  setArea: vi.fn(async () => ({ changed: true, receipt: { audited: true, notified: false } })),
  setMembership: vi.fn(async () => ({ membership: {}, receipts: [] })),
  removeMembership: vi.fn(async () => ({ removed: true, receipt: { audited: true, notified: false } })),
  setAway: vi.fn(async () => ({ window: {}, receipt: null })),
  endAway: vi.fn(async () => ({ ended: true, receipt: null })),
}));

vi.mock('../../../services/api/areas', async (orig) => {
  const real: any = await orig();
  return { ...real, ...api };
});

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ activeRestaurantId: 'r1', user: { userId: 'u-owner', restaurantId: 'r1', role: 'owner' } }),
}));

import { AreasSheet } from './AreasSheet';
import { AwayCard, HouseAwayCard } from './AwayCard';
import { RosterSheet } from './RosterSheet';
import { CrewNoteSheet } from './TeamOverlays';
import { mayChangeAway, type AreasReadout, type AwayReadout, type AwayView } from '../../../services/api/areas';
import type { TeamMember } from '../../../services/api/team';

function wrap(children: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

const member = (id: string, name: string, userId: string | null): TeamMember =>
  ({
    id,
    restaurant_id: 'r1',
    user_id: userId,
    display_name: name,
    email: null,
    phone: null,
    avatar_url: null,
    position: null,
    employment_type: 'full_time',
    home_location: null,
    hourly_wage: null,
    skills: [],
    hire_date: null,
    status: 'active',
    notes: null,
    role: 'staff',
    accountLinked: !!userId,
  }) as TeamMember;

const ROSTER = [member('m1', 'Ayşe', 'u1'), member('m2', 'Mert', 'u2'), member('m3', 'Can', null)];

const READOUT: AreasReadout = {
  role: 'owner',
  canManage: true,
  inUse: true,
  areas: [
    { kind: 'kitchen', name: 'Kitchen', defaultName: 'Kitchen', enabled: true, members: 1, leads: 1 },
    { kind: 'bar', name: 'Pass', defaultName: 'Bar', enabled: true, members: 1, leads: 0 },
    { kind: 'floor', name: 'Floor', defaultName: 'Floor', enabled: false, members: 0, leads: 0 },
    { kind: 'cellar', name: 'Cellar', defaultName: 'Cellar', enabled: true, members: 0, leads: 0 },
    { kind: 'receiving', name: 'Receiving', defaultName: 'Receiving', enabled: true, members: 0, leads: 0 },
    { kind: 'management', name: 'Management', defaultName: 'Management', enabled: true, members: 0, leads: 0 },
  ],
  memberships: [
    { memberId: 'm1', userId: 'u1', kind: 'kitchen', lead: true },
    { memberId: 'm3', userId: null, kind: 'bar', lead: false },
  ],
  mine: { memberId: null, areas: [], leadOf: [] },
};

const AWAY: AwayView = { userId: 'u1', from: '2026-09-21', until: '2026-09-28', activeNow: true, setBySelf: true };

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockClear();
});

describe('the Areas sheet', () => {
  function open() {
    return render(
      wrap(
        <AreasSheet
          readout={READOUT}
          failed={false}
          roster={ROSTER}
          awayByUser={new Map([['u1', AWAY]])}
          today="2026-09-22"
          onClose={() => undefined}
        />,
      ),
    );
  }

  // The Sheet renders into a portal on document.body, not into the render root.
  it('draws all six areas, the house’s own names, who is in each and who leads', () => {
    open();
    const container = document.body;
    expect(container.querySelectorAll('[data-area]')).toHaveLength(6);
    const kitchen = container.querySelector('[data-area="kitchen"]') as HTMLElement;
    expect(within(kitchen).getByText('lead')).toBeTruthy();
    // Ayşe is Away: her name carries the marker, not a strike-through.
    expect(kitchen.querySelector('.mdv-away[data-away="now"]')).toBeTruthy();
    const bar = container.querySelector('[data-area="bar"]') as HTMLElement;
    expect((within(bar).getByRole('textbox') as HTMLInputElement).value).toBe('Pass');
    expect(within(bar).getByText(/No account yet/)).toBeTruthy();
    const floor = container.querySelector('[data-area="floor"]') as HTMLElement;
    expect(within(floor).getByText(/goes to the whole house/)).toBeTruthy();
    const cellar = container.querySelector('[data-area="cellar"]') as HTMLElement;
    expect(within(cellar).getByText(/go to the owners and managers/)).toBeTruthy();
    // The switch says what pressing it does.
    expect(within(floor).getByRole('button', { name: 'Turn on' })).toBeTruthy();
    expect(within(cellar).getByRole('button', { name: 'Turn off' })).toBeTruthy();
  });

  it('sends the lead mark, the removal and an addition for that area only', async () => {
    open();
    const container = document.body;
    const kitchen = container.querySelector('[data-area="kitchen"]') as HTMLElement;
    fireEvent.click(within(kitchen).getByRole('button', { name: 'Remove lead' }));
    await vi.waitFor(() => expect(api.setMembership).toHaveBeenCalledWith('kitchen', 'm1', { lead: false }));

    fireEvent.click(within(kitchen).getByRole('button', { name: 'Remove' }));
    await vi.waitFor(() => expect(api.removeMembership).toHaveBeenCalledWith('kitchen', 'm1'));

    const cellar = container.querySelector('[data-area="cellar"]') as HTMLElement;
    fireEvent.change(within(cellar).getByRole('combobox'), { target: { value: 'm2' } });
    fireEvent.click(within(cellar).getByRole('button', { name: 'Add' }));
    await vi.waitFor(() => expect(api.setMembership).toHaveBeenCalledWith('cellar', 'm2', {}));

    const floor = container.querySelector('[data-area="floor"]') as HTMLElement;
    fireEvent.click(within(floor).getByRole('button', { name: 'Turn on' }));
    await vi.waitFor(() => expect(api.setArea).toHaveBeenCalledWith('floor', { name: undefined, enabled: true }));
  });

  it('says an unreadable file is unknown, not empty', () => {
    render(
      wrap(
        <AreasSheet
          readout={null}
          failed
          roster={ROSTER}
          awayByUser={new Map()}
          today={null}
          onClose={() => undefined}
        />,
      ),
    );
    expect(screen.getByRole('alert').textContent).toMatch(/unknown — not empty/);
  });

  // Last call, 2026-09-21: with nobody in any area the ladder's step 0 sends a
  // labelled alert to everyone, so an empty area must not claim "owners and
  // managers" — that is only true once somebody is in a switched-on area.
  it('says an empty area’s alerts go to everyone while nobody is in any area', () => {
    render(
      wrap(
        <AreasSheet
          readout={{ ...READOUT, inUse: false, memberships: [] }}
          failed={false}
          roster={ROSTER}
          awayByUser={new Map()}
          today="2026-09-22"
          onClose={() => undefined}
        />,
      ),
    );
    const cellar = document.body.querySelector('[data-area="cellar"]') as HTMLElement;
    expect(within(cellar).getByText(/While nobody is in any area, Cellar alerts go to everyone/)).toBeTruthy();
    expect(within(cellar).queryByText(/owners and managers/)).toBeNull();
  });

  it('says an unreadable Away file is unknown, not "nobody is away"', () => {
    render(
      wrap(
        <AreasSheet
          readout={READOUT}
          failed={false}
          roster={ROSTER}
          awayByUser={new Map()}
          today={null}
          awayFailed
          onClose={() => undefined}
        />,
      ),
    );
    expect(screen.getByRole('alert').textContent).toMatch(/Away dates could not be read/);
  });
});

describe('the Away card', () => {
  it('lets an owner set someone’s dates and says it goes in the house log', async () => {
    render(
      wrap(
        <AwayCard userId="u2" personLabel="Mert" window={null} today="2026-09-22" failed={false} self={false} />,
      ),
    );
    expect(screen.getByText('Mert is not away.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Set Away dates' }));
    expect(screen.getByText(/written in the house log/)).toBeTruthy();
    const [from, until] = screen.getAllByDisplayValue(/.*/).filter((el) => (el as HTMLInputElement).type === 'date');
    fireEvent.change(from, { target: { value: '2026-09-23' } });
    fireEvent.change(until, { target: { value: '2026-09-26' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Away dates' }));
    await vi.waitFor(() =>
      expect(api.setAway).toHaveBeenCalledWith('u2', { from: '2026-09-23', until: '2026-09-26' }),
    );
  });

  it('lets the person end their own Away now', async () => {
    render(wrap(<AwayCard userId="u1" personLabel="Ayşe" window={AWAY} today="2026-09-22" failed={false} self />));
    expect(screen.getByText(/skip you on these days/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'End Away now' }));
    await vi.waitFor(() => expect(api.endAway).toHaveBeenCalledWith('u1'));
  });

  it('never offers a reason field — dates only', () => {
    render(
      wrap(<AwayCard userId="u2" personLabel="Mert" window={null} today="2026-09-22" failed={false} self={false} />),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Set Away dates' }));
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(document.querySelectorAll('input')).toHaveLength(2);
  });

  it('offers nothing to set for a roster row with no account — no alert can reach them anyway', () => {
    render(
      wrap(<AwayCard userId={null} personLabel="Can" window={null} today="2026-09-22" failed={false} self={false} />),
    );
    expect(screen.getByText(/no account yet/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Set Away dates' })).toBeNull();
  });

  it('says an unreadable Away file is unknown, not "not away"', () => {
    render(wrap(<AwayCard userId="u2" personLabel="Mert" window={null} today={null} failed self={false} />));
    expect(screen.getByRole('alert').textContent).toMatch(/unknown/);
    expect(screen.queryByText('Mert is not away.')).toBeNull();
  });
});

describe('the roster list', () => {
  const house = (over: Partial<{ awayFailed: boolean }> = {}) => ({
    areas: READOUT,
    areasFailed: false,
    away: over.awayFailed ? null : { today: '2026-09-22', canManage: true, windows: [AWAY] },
    awayFailed: over.awayFailed ?? false,
    awayByUser: over.awayFailed ? new Map() : new Map([['u1', AWAY]]),
  });
  const sheet = (h: ReturnType<typeof house>) =>
    render(
      wrap(
        <RosterSheet
          members={ROSTER}
          membersFailed={false}
          shifts={[]}
          certs={[]}
          timeOff={[]}
          wageVisible={false}
          house={h}
          onClose={() => undefined}
          onEdit={() => undefined}
          onAdd={() => undefined}
        />,
      ),
    );

  it('marks the person who is Away on their row', () => {
    sheet(house());
    expect(document.body.querySelector('.mdv-away[data-away="now"]')).toBeTruthy();
    expect(screen.queryByText(/Away dates could not be read/)).toBeNull();
  });

  // Last call, 2026-09-21: with no marker anywhere, a failed Away read looked
  // exactly like "nobody is away".
  it('says an unreadable Away file is unknown, rather than drawing every name unmarked', () => {
    sheet(house({ awayFailed: true }));
    expect(document.body.querySelector('.mdv-away')).toBeNull();
    expect(screen.getByRole('alert').textContent).toMatch(/Away dates could not be read/);
  });
});

/* ── round 2 (the founder's "Take all seven", 2026-09-21) ─────────────── */

describe('only an owner sets or ends an owner’s Away (round-2 answer 7)', () => {
  it('is the whole matrix: self always; owners anyone; managers anyone but an owner; staff nobody else', () => {
    expect(mayChangeAway({ role: 'staff', self: true }, 'staff')).toBe(true);
    expect(mayChangeAway({ role: 'manager', self: true }, 'manager')).toBe(true);
    expect(mayChangeAway({ role: 'owner', self: false }, 'owner')).toBe(true);
    expect(mayChangeAway({ role: 'owner', self: false }, 'staff')).toBe(true);
    expect(mayChangeAway({ role: 'manager', self: false }, 'staff')).toBe(true);
    expect(mayChangeAway({ role: 'manager', self: false }, 'manager')).toBe(true);
    expect(mayChangeAway({ role: 'manager', self: false }, 'owner')).toBe(false);
    expect(mayChangeAway({ role: 'manager', self: false }, 'Owner')).toBe(false);
    expect(mayChangeAway({ role: 'staff', self: false }, 'staff')).toBe(false);
    expect(mayChangeAway({ role: undefined, self: false }, 'staff')).toBe(false);
  });

  it('shows an owner’s dates to a manager with no control to change them, and says who can', () => {
    render(
      wrap(
        <AwayCard
          userId="u-own"
          personLabel="Deniz"
          window={{ ...AWAY, userId: 'u-own' }}
          today="2026-09-22"
          failed={false}
          self={false}
          canChange={false}
        />,
      ),
    );
    expect(screen.getByText(/Only an owner can set or end an owner’s Away dates|Only an owner can set or end an owner's Away dates/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Change dates' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'End Away now' })).toBeNull();
  });

  it('on the roster, a manager opening an owner’s row gets the dates and no control; an owner gets the control', () => {
    const OWNER_AWAY: AwayView = { userId: 'u-own', from: '2026-09-21', until: '2026-09-28', activeNow: true, name: 'Deniz' };
    const ownerRow = { ...member('m-own', 'Deniz', 'u-own'), role: 'owner' } as TeamMember;
    const open = (readerRole: 'manager' | 'owner') => {
      const view = render(
        wrap(
          <RosterSheet
            members={[ownerRow]}
            membersFailed={false}
            shifts={[]}
            certs={[]}
            timeOff={[]}
            wageVisible={false}
            house={{
              areas: { ...READOUT, role: readerRole },
              areasFailed: false,
              away: { today: '2026-09-22', role: readerRole, canManage: true, windows: [OWNER_AWAY] },
              awayFailed: false,
              awayByUser: new Map([['u-own', OWNER_AWAY]]),
            }}
            onClose={() => undefined}
            onEdit={() => undefined}
            onAdd={() => undefined}
          />,
        ),
      );
      const row = document.body.querySelector('.tm-rrow__btn') as HTMLButtonElement;
      fireEvent.click(row);
      return view;
    };
    const asManager = open('manager');
    expect(screen.getByText(/Only an owner can set or end an owner.s Away dates/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Change dates' })).toBeNull();
    asManager.unmount();
    open('owner');
    expect(screen.queryByText(/Only an owner can set or end an owner.s Away dates/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Change dates' })).toBeTruthy();
  });

  it('keeps the controls on a manager’s own card', () => {
    render(
      wrap(
        <AwayCard userId="u1" personLabel="Ayşe" window={AWAY} today="2026-09-22" failed={false} self canChange={false} />,
      ),
    );
    expect(screen.getByRole('button', { name: 'End Away now' })).toBeTruthy();
  });
});

describe('staff see a colleague’s quiet Away marker (round-2 answer 5)', () => {
  const readout = (over: Partial<AwayReadout> = {}): AwayReadout => ({
    today: '2026-09-22',
    role: 'staff',
    canManage: false,
    namesReadable: true,
    windows: [
      { userId: 'u-me', from: '2026-09-21', until: '2026-09-23', activeNow: true, setBySelf: true, name: 'Ayşe' },
      { userId: 'u2', from: '2026-09-21', until: '2026-09-28', activeNow: true, name: 'Mert' },
      // A staff reader never meets this one at all (round-3 answer 3,
      // 2026-09-22): it has not started. Present in the fixture to prove the
      // card withholds it even if a future response ever carried it.
      { userId: 'u3', from: '2026-10-02', until: '2026-10-05', activeNow: false, name: 'Can' },
    ],
    ...over,
  });

  it('draws an under-way colleague’s marker with their name and dates, and leaves the reader’s own to their card', () => {
    render(wrap(<HouseAwayCard away={readout()} failed={false} selfId="u-me" />));
    expect(screen.getByText('Mert')).toBeTruthy();
    expect(screen.getByText(/Away until/)).toBeTruthy();
    expect(screen.queryByText('Ayşe')).toBeNull();
    expect(document.body.querySelectorAll('.mdv-away')).toHaveLength(1);
    // Dates only: no reason and no "set by".
    expect(document.body.textContent).not.toMatch(/because|reason|sick|set by/i);
  });

  it('never draws a colleague’s window that has not started yet (round-3 answer 3, 2026-09-22)', () => {
    render(wrap(<HouseAwayCard away={readout()} failed={false} selfId="u-me" />));
    expect(screen.queryByText('Can')).toBeNull();
    expect(screen.queryByText(/Away from/)).toBeNull();
  });

  it('draws an owner or manager’s upcoming colleague window too — only staff wait for it to start', () => {
    render(
      wrap(
        <HouseAwayCard
          away={readout({ role: 'manager', canManage: true })}
          failed={false}
          selfId="u-me"
        />,
      ),
    );
    expect(screen.getByText('Mert')).toBeTruthy();
    expect(screen.getByText('Can')).toBeTruthy();
    expect(screen.getByText(/Away from/)).toBeTruthy();
    expect(document.body.querySelectorAll('.mdv-away')).toHaveLength(2);
  });

  it('draws nothing while no colleague’s window is one a staff reader may see', () => {
    const { container } = render(
      wrap(<HouseAwayCard away={readout({ windows: [readout().windows[0], readout().windows[2]] })} failed={false} selfId="u-me" />),
    );
    expect(container.textContent).toBe('');
  });

  it('says a failed read is unknown, never "nobody is away"', () => {
    render(wrap(<HouseAwayCard away={null} failed selfId="u-me" />));
    expect(screen.getByRole('alert').textContent).toMatch(/unknown/);
  });

  it('says the names could not be read rather than drawing nameless markers, counting only what a staff reader may see', () => {
    render(
      wrap(
        <HouseAwayCard
          away={readout({
            namesReadable: false,
            windows: readout().windows.map((w) => ({ ...w, name: null })),
          })}
          failed={false}
          selfId="u-me"
        />,
      ),
    );
    // Only the one under-way colleague (u2) counts for a staff reader; u3
    // (upcoming) is withheld before the count is taken, and never says
    // "about to be" for staff.
    expect(screen.getByRole('alert').textContent).toMatch(/One colleague is away, but the names could not be read/);
    expect(document.body.querySelector('.mdv-away')).toBeNull();
  });

  it('says "or about to be" for an owner or manager, whose count includes the upcoming window', () => {
    render(
      wrap(
        <HouseAwayCard
          away={readout({
            role: 'manager',
            canManage: true,
            namesReadable: false,
            windows: readout().windows.map((w) => ({ ...w, name: null })),
          })}
          failed={false}
          selfId="u-me"
        />,
      ),
    );
    expect(screen.getByRole('alert').textContent).toMatch(/2 colleagues are away or about to be/);
  });
});

describe('a note to someone Away tells the sender before it is sent (round-2 answer 3)', () => {
  const note = (awayByUser?: Map<string, AwayView>, awayToday: string | null = '2026-09-22') =>
    render(
      wrap(
        <CrewNoteSheet
          members={ROSTER}
          membersFailed={false}
          only={null}
          weekStart="2026-09-21"
          scheduleId={null}
          awayByUser={awayByUser}
          awayToday={awayToday}
          onClose={() => undefined}
          onSent={() => undefined}
        />,
      ),
    );

  it('names who is away until when, and says the note waits for them', () => {
    note(new Map([['u1', AWAY]]));
    const hint = screen.getByTestId('note-waits-for-away');
    // The reader's own locale words the day ("28 Sep" or "Sep 28").
    expect(hint.textContent).toMatch(/Ayşe is away until (28 Sep|Sep 28)\./);
    expect(hint.textContent).toMatch(/waits and reaches them when they are back/);
    expect(hint.textContent).not.toMatch(/Mert/);
  });

  it('says nothing for a window that has not begun: a note sent now is not held for it', () => {
    note(new Map([['u1', { ...AWAY, from: '2026-09-25', activeNow: false }]]));
    expect(screen.queryByTestId('note-waits-for-away')).toBeNull();
  });

  it('says nothing while Away has not answered', () => {
    note(new Map([['u1', AWAY]]), null);
    expect(screen.queryByTestId('note-waits-for-away')).toBeNull();
  });
});
