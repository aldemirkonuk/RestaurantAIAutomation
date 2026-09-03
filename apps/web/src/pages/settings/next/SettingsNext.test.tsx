/**
 * SettingsNext render contract.
 *
 * The verdict this page answers is KEEP (Editorial) + "there should be more",
 * and "more" was defined as substance per setting rather than more switches.
 * These tests hold the things that would make that claim false if they
 * regressed:
 *
 *  1. the legacy ten `?tab=` registers stay deep-linkable in both directions,
 *     under their legacy names, with `cellar` appended;
 *  2. every setting carries its provenance line — where it is kept, WHAT the
 *     date is a date of, and when, or an em dash saying why there is none;
 *  3. the Features register renders ONE control per registry-ACTIVE flag the
 *     GATEWAY returned (including the Mudavym redesign group) and lists the
 *     switch-less capabilities without controls;
 *  4. `enable_ai_autonomous_send` is granted by the hold-to-approve ceremony
 *     and revoked by one plain button — it is never a toggle;
 *
 *  plus the honesty states: a failed read says which register failed, a 403
 *  says it was refused, and a setting nothing reads shows its stored value
 *  with no control.
 *
 * THE SECOND-PASS ADDITIONS
 * -------------------------
 * The audit found five false claims of ABSENCE, so five tests now pin the
 * opposite of each: quiet hours keeps a real switch (it is read by the alerting
 * agent), a member shows a GRANTED date, an invite shows an ISSUED date, a chain
 * and a branch each show their own last-changed date. A test that only checked
 * "an em dash appears" would have passed against every one of those bugs.
 *
 * The data hook is mocked, so nothing here touches the network. None of these
 * assertions would pass against the scaffold this file replaced.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';

const mock = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));

vi.mock('./useSettingsNextData', async () => {
  const actual = await vi.importActual<typeof import('./useSettingsNextData')>('./useSettingsNextData');
  return { ...actual, useSettingsNextData: () => mock.current };
});

// Transient legacy modals — mounted by the team/locations registers, and not
// under test here.
vi.mock('@/components/team/InviteTeamDialog', () => ({ InviteTeamDialog: () => null }));
vi.mock('@/components/team/TeamLaborSettings', () => ({ TeamLaborSettings: () => null }));
vi.mock('@/components/team/TeamGoalsSettings', () => ({ TeamGoalsSettings: () => null }));
vi.mock('@/components/locations/AddLocationDialog', () => ({ AddLocationDialog: () => null }));
vi.mock('@/components/locations/CreateChainDialog', () => ({ CreateChainDialog: () => null }));
vi.mock('@/components/locations/AssignToChainDialog', () => ({ AssignToChainDialog: () => null }));
vi.mock('@/components/locations/EditLocationChainDialog', () => ({ EditLocationChainDialog: () => null }));

// The Cellar register mounts the cellar rebuild's own control and its own
// react-query hook. Both are tested where they live
// (`pages/cellar/next/CellarRegisters.test.tsx`); what this file owns is that
// Settings mounts them rather than growing a second implementation, and that a
// failed readout still reaches the reader as words.
const cellar = vi.hoisted(() => ({
  current: {
    data: null as unknown,
    loading: false,
    error: null as string | null,
    save: { mutateAsync: vi.fn(), isPending: false, error: null },
    refetch: vi.fn(),
  },
}));
vi.mock('@/pages/cellar/next/useCellarNextData', () => ({ useCellarRegisters: () => cellar.current }));
vi.mock('@/pages/cellar/next/cellar-next.css', () => ({}));

import SettingsNext from './SettingsNext';

function remote(data: unknown, status = 'ok') {
  return { status, data, error: status === 'error' ? 'gateway unreachable' : null, reload: vi.fn(), set: vi.fn() };
}

const saveFlag = vi.fn();
const savePrefs = vi.fn();
const saveNotif = vi.fn();

/** Three days back — renders as "3 days ago" through `fmtWhen`. */
const THREE_DAYS_AGO = new Date(Date.now() - 3 * 86_400_000).toISOString();

function notifPrefs(over: Record<string, unknown> = {}) {
  return {
    userId: 'u1', email: true, push: true, sms: false,
    categories: { inventory: true, orders: true, calendar: true, system: true, ai: true },
    lowStock: { enabled: true, instantFirstAlert: true, criticalImmediate: true, digestFrequency: 'daily', digestTime: '12:00' },
    quietHours: { enabled: false, startTime: '22:00', endTime: '08:00' },
    ordersMode: 'both', reportsMode: 'both', updatedAt: null,
    ...over,
  };
}

function base(over: Record<string, unknown> = {}) {
  return {
    restaurantId: 'r1',
    userId: 'u1',
    role: 'owner',
    canManage: true,
    isOwner: true,
    locations: [],
    refreshBranches: vi.fn(),
    team: remote({ members: [], invites: [], invitesDenied: false }),
    flags: remote({}),
    ical: remote({ token: 'tok' }),
    sender: remote(null),
    chains: remote([]),
    pos: remote({ providers: { summary: { total: 0, byTier: {}, byStatus: {} }, providers: [] }, status: null, statusError: null }),
    prefs: remote({ preferences: {}, updatedAt: null }),
    notif: remote(null, 'idle'),
    integrations: remote({ catalog: [], connections: [] }),
    writer: { busy: null, failed: null, run: vi.fn(), clear: vi.fn() },
    saveFlag, savePrefs, saveNotif,
    saveSender: vi.fn(), sendTestEmail: vi.fn(), regenerateIcal: vi.fn(),
    setMemberRole: vi.fn(), removeMember: vi.fn(), revokeInvite: vi.fn(), disconnectIntegration: vi.fn(),
    ...over,
  };
}

/** Renders the live URL so the `?tab=` write-back is assertable, not assumed. */
function Where() {
  const loc = useLocation();
  return <output data-testid="where">{`${loc.pathname}${loc.search}`}</output>;
}

function mount(url = '/settings') {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <SettingsNext />
      <Where />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mock.current = base();
  cellar.current = {
    data: null,
    loading: false,
    error: null,
    save: { mutateAsync: vi.fn(), isPending: false, error: null },
    refetch: vi.fn(),
  };
});

describe('SettingsNext — the editorial spine', () => {
  it('opens on a contents page naming every register and where each is kept', () => {
    mount();
    const nav = screen.getByRole('navigation', { name: /settings registers/i });
    expect(within(nav).getAllByRole('button')).toHaveLength(11);
    // The legacy ten, under their legacy names, plus the eleventh.
    for (const label of ['Team', 'Services', 'Email', 'Notifications', 'Locations', 'Measurement', 'Map', 'Features', 'POS', 'Calendar', 'Cellar']) {
      expect(within(nav).getByText(label)).toBeInTheDocument();
    }
    expect(screen.getByText(/seven kept for this restaurant, three on your account, one in this browser only/i)).toBeInTheDocument();
    // The standing honesty statement: nothing on this page records an author.
    expect(screen.getByText(/no table on this page carries an author column/i)).toBeInTheDocument();
  });

  it('honours a ?tab= deep link, and writes the tab back when a register is opened', () => {
    mount('/settings?tab=measurement');
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Measurement & recipes');
    expect(screen.getByTestId('where')).toHaveTextContent('/settings?tab=measurement');
    fireEvent.click(within(screen.getByRole('navigation', { name: /settings registers/i })).getByText('Map'));
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Map');
    expect(screen.getByTestId('where')).toHaveTextContent('/settings?tab=map');
  });

  it('carries the mudavym token scope on its own root, and takes a forced ground', () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/settings']}>
        <SettingsNext ground="charcoal" />
      </MemoryRouter>,
    );
    const root = container.querySelector('.mudavym');
    expect(root).not.toBeNull();
    expect(root).toHaveAttribute('data-ground', 'charcoal');
  });

  it('sends staff away without pretending the settings are empty', () => {
    mock.current = base({ role: 'staff' });
    mount();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Ask a manager');
    expect(screen.queryByRole('navigation', { name: /settings registers/i })).not.toBeInTheDocument();
  });
});

describe('SettingsNext — features', () => {
  const flags = {
    enable_ai_negotiation: true,
    enable_ai_autonomous_send: false,
    mudavym_design_settings: false,
    mudavym_design_calendar: true,
  };

  it('renders one control per ACTIVE flag the gateway returned, grouped as the redesign', () => {
    mock.current = base({ flags: remote(flags) });
    mount('/settings?tab=features');
    expect(screen.getByText(/Mudavym redesign · 2 pages/i)).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: /Settings — Mudavym design/i })).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByRole('switch', { name: /Calendar — Mudavym design/i })).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(screen.getByRole('switch', { name: /Settings — Mudavym design/i }));
    expect(saveFlag).toHaveBeenCalledWith('mudavym_design_settings', true);
  });

  it('lists switch-less capabilities without a control', () => {
    mock.current = base({ flags: remote(flags) });
    mount('/settings?tab=features');
    const noSwitch = screen.getAllByText('no switch');
    expect(noSwitch.length).toBeGreaterThan(0);
    // and none of them is a control
    for (const el of noSwitch) expect(el.tagName).not.toBe('BUTTON');
  });

  it('grants autonomous sending only through the hold ceremony, never a toggle', () => {
    mock.current = base({ flags: remote(flags) });
    mount('/settings?tab=features');
    expect(screen.queryByRole('switch', { name: /Send AI replies without my approval/i })).not.toBeInTheDocument();
    const hold = screen.getByRole('button', { name: /Hold to allow AI to send/i });
    // Keyboard path: arm, then confirm.
    fireEvent.keyDown(hold, { key: 'Enter' });
    expect(saveFlag).not.toHaveBeenCalled();
    fireEvent.keyDown(hold, { key: 'Enter' });
    expect(saveFlag).toHaveBeenCalledWith('enable_ai_autonomous_send', true);
  });

  it('revokes autonomous sending with one plain button — the cheap direction', () => {
    mock.current = base({ flags: remote({ ...flags, enable_ai_autonomous_send: true }) });
    mount('/settings?tab=features');
    fireEvent.click(screen.getByRole('button', { name: /Stop sending on its own/i }));
    expect(saveFlag).toHaveBeenCalledWith('enable_ai_autonomous_send', false);
  });

  it('says a failed read in words, and never as an empty register', () => {
    mock.current = base({ flags: remote(null, 'error') });
    mount('/settings?tab=features');
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(/could not be read/i);
    expect(alert).toHaveTextContent(/this is not an empty register/i);
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
  });

  it('says a refusal is a refusal', () => {
    mock.current = base({ chains: remote(null, 'denied') });
    mount('/settings?tab=locations');
    expect(screen.getByText(/Chains were not opened for your role/i)).toBeInTheDocument();
  });
});

describe('SettingsNext — provenance and unknowns', () => {
  it('dates a setting the gateway dates, and em-dashes one it does not', () => {
    mock.current = base({ notif: remote(notifPrefs({ updatedAt: THREE_DAYS_AGO })) });
    mount('/settings?tab=notifications');
    expect(screen.getAllByText(/kept · your account/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/3 days ago/).length).toBeGreaterThan(0);

    // The features register has no changed-at column at all — em dash, with the
    // reason, and never a fabricated "just now".
    mock.current = base({ flags: remote({ enable_ai_negotiation: true, enable_ai_autonomous_send: false }) });
    mount('/settings?tab=features');
    const dashes = screen.getAllByText(/— the settings row has no changed-at column/);
    expect(dashes.length).toBeGreaterThan(0);
    expect(screen.queryByText(/changed · just now/)).not.toBeInTheDocument();
  });

  it('shows a preference nothing reads as a record, with no switch', () => {
    mock.current = base({
      notif: remote(notifPrefs({
        categories: { inventory: true, orders: false, calendar: true, system: true, ai: true },
      })),
    });
    mount('/settings?tab=notifications');
    // Push: stored, but nothing sends it — no control anywhere for it.
    expect(screen.queryByRole('switch', { name: /^Push/i })).not.toBeInTheDocument();
    expect(screen.getByText(/Nothing in the product sends a push notification/i)).toBeInTheDocument();
    expect(screen.getByText(/push-is-not-resolved-here/)).toBeInTheDocument();
    // Email and SMS are real, so they keep their switches.
    expect(screen.getByRole('switch', { name: /Email notifications/i })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: /SMS notifications/i })).toBeInTheDocument();
    // The category that is off is shown as a stored value, not as a switch.
    expect(screen.getAllByText('stored: off').length).toBe(1);
    expect(screen.getAllByText('stored: on').length).toBeGreaterThanOrEqual(5);
  });

  it('keeps a real switch on quiet hours, because the alerting agent reads it', () => {
    // The audit's BLOCKER 1: the first pass rendered this as a dead record on a
    // three-runtime grep. `notification_agent._is_quiet_hours` reads the very
    // row this page writes, so removing the control was a capability loss
    // justified by an unchecked claim.
    mock.current = base({
      notif: remote(notifPrefs({ quietHours: { enabled: true, startTime: '23:00', endTime: '07:00' } })),
    });
    mount('/settings?tab=notifications');
    const toggle = screen.getByRole('switch', { name: /^Quiet hours$/i });
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    // The window itself is editable only while the switch is on.
    expect(screen.getByLabelText(/Quiet hours start/i)).toHaveValue('23:00');
    fireEvent.click(toggle);
    expect(saveNotif).toHaveBeenCalledWith('quiet.enabled', {
      quietHours: { enabled: false, startTime: '23:00', endTime: '07:00' },
    });
    // And it is honest about the half that does NOT honour it.
    expect(screen.getByText(/consult this window and sends on its own clock/i)).toBeInTheDocument();
  });

  it('says what each date is a date OF — granted for access, issued for an invite', () => {
    mock.current = base({
      team: remote({
        members: [{ user_id: 'u1', role: 'owner', users: { name: 'Deniz', email: 'd@x.com' }, created_at: THREE_DAYS_AGO }],
        invites: [{ id: 'i1', code: 'ABC123', role: 'manager', expires_at: new Date(Date.now() + 5 * 86_400_000).toISOString(), created_at: THREE_DAYS_AGO }],
        invitesDenied: false,
      }),
    });
    mount('/settings?tab=team');
    expect(screen.getByText(/granted · 3 days ago/i)).toBeInTheDocument();
    expect(screen.getByText(/issued · 3 days ago/i)).toBeInTheDocument();
    // "granted" is not "changed", and the row says where a change WOULD be filed.
    expect(screen.getByText(/no column records a later change to this access/i)).toBeInTheDocument();
    expect(screen.getByText(/member_role_changed/)).toBeInTheDocument();
  });

  it('shows the chain and branch dates the gateway now returns', () => {
    mock.current = base({
      chains: remote([{ id: 'c1', name: 'Harbour Group', updated_at: THREE_DAYS_AGO }]),
      locations: [
        { id: 'r1', name: 'Kadikoy', city: 'Istanbul', chain_id: 'c1', chain_name: 'Harbour Group', updated_at: THREE_DAYS_AGO },
        { id: 'r2', name: 'Besiktas', city: null, chain_id: null, chain_name: null },
      ],
    });
    mount('/settings?tab=locations');
    // One for the chain, one for the branch that carries a date.
    expect(screen.getAllByText(/changed · 3 days ago/i).length).toBe(2);
    // The branch with no date on it gets an em dash naming why — never a
    // substituted date, and never the other branch's.
    expect(screen.getByText(/reached your session without one/i)).toBeInTheDocument();
  });

  it('does not fabricate an empty roster out of a failed read', () => {
    mount('/settings?tab=team');
    expect(screen.getByText(/either a branch with nobody on it/i)).toBeInTheDocument();
  });

  it('says out loud that the measurement register never leaves this browser', () => {
    mount('/settings?tab=measurement');
    expect(screen.getAllByText(/Kept in this browser only/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/kept · this browser/i).length).toBeGreaterThan(0);
  });

  it('does not promise the calendar feed subscribes anywhere', () => {
    mount('/settings?tab=calendar');
    expect(screen.getByText(/No external calendar client has ever been observed subscribing/i)).toBeInTheDocument();
    expect(screen.getByText('Untested')).toBeInTheDocument();
    expect(screen.getByText(/Content-Disposition: attachment/)).toBeInTheDocument();
  });

  it('arms a destructive regeneration before it fires', () => {
    const regenerateIcal = vi.fn();
    mock.current = base({ regenerateIcal });
    mount('/settings?tab=calendar');
    fireEvent.click(screen.getByRole('button', { name: /^Regenerate$/ }));
    expect(regenerateIcal).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /Yes, break the old address/i }));
    expect(regenerateIcal).toHaveBeenCalled();
  });

  it('mounts the cellar rebuild’s own register control rather than a second copy', () => {
    cellar.current = {
      ...cellar.current,
      data: {
        restaurantId: 'r1',
        registers: [
          { id: 'wines', carried: true, decidedBy: 'confirmed', confidence: 'high', basis: '1,284 bottles in the books.', evidence: { inventoryRows: 1284, menuRows: 96, catalogueRows: 0, nameOnly: false }, needsEvidence: false },
          { id: 'whiskey', carried: false, decidedBy: 'inferred', confidence: 'low', basis: 'The books suggest this.', evidence: { inventoryRows: 0, menuRows: 38, catalogueRows: 0, nameOnly: true }, needsEvidence: false },
        ],
        carried: ['wines'],
        decidedBy: 'mixed',
        awaitingConfirmation: false,
        needsEvidence: [],
        sources: {
          answers: { readable: true, reason: null, rows: 2 },
          inventory: { readable: true, reason: null, rows: 1284 },
          menu: { readable: true, reason: null, rows: 96 },
          cocktails: { readable: true, reason: null, rows: 0 },
          catalogue: { readable: true, reason: null, rows: 0 },
        },
        unmappedKinds: {},
        unmappedCatalogueTypes: {},
      },
    };
    mount('/settings?tab=cellar');
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Cellar registers');
    expect(screen.getByTestId('registers-control')).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: /Wines register/i })).toHaveAttribute('aria-checked', 'true');
    // Settings supplies the settings-shaped facts around it, and does not
    // invent a date the readout does not carry.
    expect(screen.getByText(/the readout carries no date for each answer/i)).toBeInTheDocument();
  });

  it('says a failed cellar readout in words, never as seven registers switched off', () => {
    cellar.current = { ...cellar.current, data: null, error: 'HTTP 500' };
    mount('/settings?tab=cellar');
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(/could not be read/i);
    expect(alert).toHaveTextContent(/it is\s*unread/i);
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
  });

  it('stamps no client-side date on the POS connector', () => {
    // Audit NIT 8: the first pass wrote `new Date()` into the stored blob and
    // read it back as provenance. The row now carries the record's own date.
    mock.current = base({
      prefs: remote({ preferences: { posConfig: { activeProvider: 'toast' } }, updatedAt: THREE_DAYS_AGO }),
      pos: remote({
        providers: { summary: { total: 1, byTier: {}, byStatus: {} }, providers: [{ key: 'toast', name: 'Toast', status: 'live', authModel: 'oauth_2', docsUrl: null }] },
        status: null,
        statusError: null,
      }),
    });
    mount('/settings?tab=pos');
    expect(screen.getByText(/shared with every other setting kept on your account/i)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/POS connector/i), { target: { value: 'toast' } });
    expect(savePrefs).toHaveBeenCalledWith('pos', { posConfig: { activeProvider: 'toast' } });
  });
});
