/**
 * SettingsNext render contract.
 *
 * The verdict this page answers is KEEP (Editorial) + "there should be more",
 * and "more" was defined as substance per setting rather than more switches.
 * These tests hold the four things that would make that claim false if they
 * regressed:
 *
 *  1. the ten `?tab=` registers stay deep-linkable in both directions;
 *  2. every setting carries its provenance line — where it is kept, and when it
 *     was last written or an em dash saying why there is no date;
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
 * The data hook is mocked, so nothing here touches the network. None of these
 * assertions would pass against the scaffold this file replaced.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';

const mock = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));

vi.mock('./useSettingsNextData', () => ({
  useSettingsNextData: () => mock.current,
}));

// Transient legacy modals — mounted by the team/locations registers, and not
// under test here.
vi.mock('@/components/team/InviteTeamDialog', () => ({ InviteTeamDialog: () => null }));
vi.mock('@/components/team/TeamLaborSettings', () => ({ TeamLaborSettings: () => null }));
vi.mock('@/components/team/TeamGoalsSettings', () => ({ TeamGoalsSettings: () => null }));
vi.mock('@/components/locations/AddLocationDialog', () => ({ AddLocationDialog: () => null }));
vi.mock('@/components/locations/CreateChainDialog', () => ({ CreateChainDialog: () => null }));
vi.mock('@/components/locations/AssignToChainDialog', () => ({ AssignToChainDialog: () => null }));
vi.mock('@/components/locations/EditLocationChainDialog', () => ({ EditLocationChainDialog: () => null }));

import SettingsNext from './SettingsNext';

function remote(data: unknown, status = 'ok') {
  return { status, data, error: status === 'error' ? 'gateway unreachable' : null, reload: vi.fn(), set: vi.fn() };
}

const saveFlag = vi.fn();
const savePrefs = vi.fn();
const saveNotif = vi.fn();

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
});

describe('SettingsNext — the editorial spine', () => {
  it('opens on a contents page naming all ten registers and where each is kept', () => {
    mount();
    const nav = screen.getByRole('navigation', { name: /settings registers/i });
    expect(within(nav).getAllByRole('button')).toHaveLength(10);
    for (const label of ['Team', 'Services', 'Email', 'Notifications', 'Locations', 'Measurement', 'Map', 'Features', 'POS', 'Calendar']) {
      expect(within(nav).getByText(label)).toBeInTheDocument();
    }
    expect(screen.getByText(/six kept for this restaurant, three on your account, one in this browser only/i)).toBeInTheDocument();
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
    const when = new Date(Date.now() - 3 * 86_400_000).toISOString();
    mock.current = base({
      notif: remote({
        userId: 'u1', email: true, push: true, sms: false,
        categories: { inventory: true, orders: true, calendar: true, system: true, ai: true },
        lowStock: { enabled: true, instantFirstAlert: true, criticalImmediate: true, digestFrequency: 'daily', digestTime: '12:00' },
        ordersMode: 'both', reportsMode: 'both', updatedAt: when,
      }),
    });
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
      notif: remote({
        userId: 'u1', email: true, push: true, sms: false,
        categories: { inventory: true, orders: false, calendar: true, system: true, ai: true },
        lowStock: { enabled: true, instantFirstAlert: true, criticalImmediate: true, digestFrequency: 'daily', digestTime: '12:00' },
        ordersMode: 'both', reportsMode: 'both', updatedAt: null,
      }),
    });
    mount('/settings?tab=notifications');
    // Push: stored, but nothing sends it — no control anywhere for it.
    expect(screen.queryByRole('switch', { name: /^Push/i })).not.toBeInTheDocument();
    expect(screen.getByText(/Nothing in the product sends a push notification/i)).toBeInTheDocument();
    expect(screen.getByText(/push-is-not-resolved-here/)).toBeInTheDocument();
    // Email and SMS are real, so they keep their switches.
    expect(screen.getByRole('switch', { name: /Email notifications/i })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: /SMS notifications/i })).toBeInTheDocument();
    // The category that is off is shown as a stored value, not as a switch —
    // as is the quiet-hours record beside it.
    expect(screen.getAllByText('stored: off').length).toBeGreaterThanOrEqual(2);
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
});
