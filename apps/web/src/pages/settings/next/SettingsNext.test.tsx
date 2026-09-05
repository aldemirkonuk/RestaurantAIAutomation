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

/**
 * The collapse gate (2026-09-04). OFF by default, so every test written before
 * this pass keeps measuring the shipping page unchanged.
 */
const design = vi.hoisted(() => ({ connections: false }));
vi.mock('@/lib/mudavym/useMudavymDesign', () => ({
  useMudavymDesign: (page: string) => (page === 'connections' ? design.connections : false),
  MUDAVYM_PAGES: [] as const,
}));

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
    vendorTerms: remote(vendorTermsRegister()),
    thresholds: remote(thresholdsRegister()),
    ledger: remote(ledgerRegister()),
    houseCurrency: remote(currencyRegister()),
    writer: { busy: null, failed: null, run: vi.fn(), clear: vi.fn() },
    saveFlag, savePrefs, saveNotif,
    saveSender: vi.fn(), sendTestEmail: vi.fn(), regenerateIcal: vi.fn(),
    setMemberRole: vi.fn(), removeMember: vi.fn(), revokeInvite: vi.fn(), disconnectIntegration: vi.fn(),
    saveVendorTerms, saveThreshold, saveCurrency,
    ...over,
  };
}

/* ── The fourth pass's three registers ───────────────────────────────────── */

const saveVendorTerms = vi.fn(() => Promise.resolve(true));
const saveThreshold = vi.fn(() => Promise.resolve(true));
const saveCurrency = vi.fn(() => Promise.resolve(true));

/**
 * The currency readout as `GET /settings/currency` returns it.
 *
 * The default fixture is the state ELEVEN of the fourteen production houses are
 * in as of 2026-09-05: no code recorded, in a country the app's own table can
 * offer a default for. A fixture that started from a recorded code would have
 * let the "not recorded" branch — the whole reason this register exists — go
 * untested.
 */
function currencyRegister(over: Record<string, unknown> = {}) {
  return {
    restaurantId: 'r1',
    code: null,
    country: 'Türkiye',
    readable: true,
    reason: null,
    statedAt: null,
    statedBy: null,
    ...over,
  };
}

/**
 * A vendor-terms readout shaped exactly as the gateway returns one.
 *
 * Every cell carries a source, because that is the contract the register
 * renders against — a cell with a value and no source must not be
 * constructible, in a fixture any more than in production.
 */
function vendorTermsRegister(over: Record<string, unknown> = {}) {
  return {
    restaurantId: 'r1',
    vendors: [
      {
        providerId: 'p1',
        providerName: 'Anadolu Şarapçılık',
        ordersInWindow: 214,
        lastOrderedAt: THREE_DAYS_AGO,
        deliveryWeekdays: {
          value: [1, 3, 5], source: 'inferred', n: 214, confidence: 'high',
          basis: '214 signed arrivals',
        },
        orderCutoff: {
          value: { time: '14:00', offsetDays: 1 }, source: 'stated',
          statedBy: { userId: 'u9', name: 'Selin Kara' }, statedAt: THREE_DAYS_AGO,
          contradiction: null,
        },
        minimumOrder: {
          value: 2500, source: 'inferred', n: 96, confidence: 'high',
          basis: '96 delivered orders with a cost — the smallest they have ACCEPTED',
        },
        // ADR 0116 dropped `providers.lead_time_days DEFAULT 7` and NULLed every
        // row that carried it, so the server no longer emits the "indistinguishable
        // from the default" reason at all — a NULL is the unasked question and a
        // number is a term. This fixture matches what the gateway returns now.
        leadTimeDays: {
          value: null, source: 'unknown',
          reason: 'no delivered order in the window carries both a request and a delivery date',
        },
        paymentTerms: {
          value: null, source: 'unknown',
          reason: 'no table records when a vendor invoice was raised or settled',
        },
        notes: null,
        statedBy: { userId: 'u9', name: 'Selin Kara' },
        statedAt: THREE_DAYS_AGO,
      },
    ],
    currency: { code: 'TRY', isColumnDefault: false },
    zone: { zone: 'Europe/Istanbul', isColumnDefault: false },
    windowDays: 365,
    sources: {
      providers: { readable: true, reason: null, rows: 1 },
      statedTerms: { readable: true, reason: null, rows: 1 },
      orders: { readable: true, reason: null, rows: 214 },
    },
    ...over,
  };
}

/**
 * The one path that enforces the thresholds — mirrors `ENFORCED_AT` in
 * `apps/api-gateway/src/settings/approval-thresholds.service.ts`. Written out
 * rather than imported, because a web test that imported a gateway constant
 * would pass even if the gateway stopped sending the field.
 */
const ENFORCED_AT =
  'apps/api-gateway/src/procurement/procurement.service.ts approveOrder → assertApprovalAllowed';

function thresholdsRegister(over: Record<string, unknown> = {}) {
  return {
    restaurantId: 'r1',
    thresholds: [
      {
        rule: 'manager_ceiling', enabled: true, amountLimit: 15000, percentLimit: null,
        requiredRole: 'owner',
        setBy: { userId: 'u9', name: 'Deniz Aksoy' }, updatedAt: THREE_DAYS_AGO,
      },
    ],
    policyEmpty: false,
    readable: true,
    reason: null,
    retrospective: {
      counts: [
        { rule: 'manager_ceiling', tested: 118, wouldHaveFired: 23 },
        { rule: 'new_vendor', tested: 118, wouldHaveFired: 4 },
        { rule: 'price_jump', tested: 0, wouldHaveFired: 0 },
      ],
      ordersRead: 118, windowDays: 365, readable: true, reason: null,
      caveat: 'Counted over the last 365 days only.',
    },
    enforcement: {
      // ADR 0116. The register renders its opening sentence from THIS array, so
      // the fixture is the whole difference between the page claiming a gate and
      // the page admitting there is none. `enforcedByNothing()` below drives the
      // other branch.
      enforcedBy: [ENFORCED_AT],
      wouldBeEnforcedAt: ENFORCED_AT,
      note: 'approveOrder reads the order, reads these rules, resolves the actor\'s role and refuses the seal with the rule and the number in words.',
    },
    ...over,
  };
}

function ledgerRegister(over: Record<string, unknown> = {}) {
  return {
    restaurantId: 'r1',
    entries: [
      {
        id: 'a1', occurredAt: THREE_DAYS_AGO, action: 'feature_flag_changed',
        register: 'features', entityType: 'restaurant_feature_flag', entityId: 'r1',
        subject: 'enable_ai_autonomous_send',
        actor: { userId: 'u9', name: 'Deniz Aksoy', email: 'd@example.com' },
        fields: { enable_ai_autonomous_send: { from: false, to: true } },
      },
    ],
    readable: true,
    reason: null,
    oldestAt: THREE_DAYS_AGO,
    recordingSince: '2026-09-03',
    ...over,
  };
}

/**
 * Renders the live URL so the `?tab=` write-back is assertable, not assumed.
 *
 * The fragment is part of it since the collapse: a redirect that reached
 * `/connections` but dropped `#till` would look identical here otherwise, and
 * landing at the top of a long list is exactly the failure the anchors exist to
 * prevent.
 */
function Where() {
  const loc = useLocation();
  return <output data-testid="where">{`${loc.pathname}${loc.search}${loc.hash}`}</output>;
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
  design.connections = false;
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
    expect(within(nav).getAllByRole('button')).toHaveLength(15);
    // The legacy ten under their legacy names, plus cellar, plus the three the
    // fourth pass added. Every one of these is still a live `?tab=` id.
    for (const label of ['Team', 'Services', 'Email', 'Notifications', 'Locations', 'Measurement', 'Map', 'Features', 'POS', 'Calendar', 'Cellar', 'Vendor terms', 'Approval thresholds', 'What changed here', 'Currency']) {
      expect(within(nav).getByText(label)).toBeInTheDocument();
    }
    // The contents column now reads in GROUPS, so the headings must be there —
    // a flat fourteen-row list is the thing this pass was asked to fix.
    for (const heading of ['The house', 'How it buys', 'What it does on its own', 'Yours', 'The record']) {
      expect(within(nav).getByText(heading)).toBeInTheDocument();
    }
    expect(screen.getByText(/eleven kept for this restaurant, three on your account, one in this browser only/i)).toBeInTheDocument();
    // The standing honesty statement, now that FOUR registers DO record an
    // author: it names which four — Currency joined them 2026-09-05 — and
    // admits the other eight still do not.
    expect(screen.getByText(/Four of these registers now record/i)).toBeInTheDocument();
    expect(screen.getByText(/other eight write through services this pass did not touch/i)).toBeInTheDocument();
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

  it('gives the house-inbox reader its own row, naming what ON means', () => {
    mock.current = base({ flags: remote({ ...flags, enable_house_inbox_read: false }) });
    mount('/settings?tab=features');
    const toggle = screen.getByRole('switch', { name: /Read this house's mailbox/i });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByText(/reads the mail in the account somebody here connected/i)).toBeInTheDocument();
    fireEvent.click(toggle);
    expect(saveFlag).toHaveBeenCalledWith('enable_house_inbox_read', true);
  });

  // 2026-09-05: `PUT /settings/feature-flags` runs `assertCanManageRestaurant`,
  // so the route refuses a member who is neither owner nor manager. The state
  // under test is `role: null` — a role that could not be RESOLVED — because
  // staff never reach this page at all (the gate above it sends them to "Ask a
  // manager"), so a staff fixture would prove nothing about these controls.
  // Disabled, not hidden: a switch you cannot see is one you cannot plan around.
  it('renders every feature control disabled, with the reason, for a non-manager', () => {
    mock.current = base({
      canManage: false,
      role: null,
      flags: remote({ ...flags, enable_house_inbox_read: false }),
    });
    mount('/settings?tab=features');

    expect(screen.getByText(/Only an owner or a manager of this restaurant may change this/i))
      .toBeInTheDocument();
    for (const sw of screen.getAllByRole('switch')) expect(sw).toBeDisabled();
    expect(screen.getByRole('button', { name: /Hold to allow AI to send/i })).toBeDisabled();
    // The values stay legible.
    expect(screen.getByRole('switch', { name: /Calendar — Mudavym design/i }))
      .toHaveAttribute('aria-checked', 'true');
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

/**
 * THE FOURTH PASS — the three registers the founder asked to be built for real.
 *
 * Every test below pins the OPPOSITE of the plausible wrong behaviour, because
 * each of these registers has a shape that would look right while lying:
 *
 *  - a lead time of "7 days" read straight off `providers.lead_time_days`,
 *    which is that column's DEFAULT and therefore proves nothing;
 *  - an inferred cutoff printed as a time rather than as the bracket the
 *    evidence actually supports;
 *  - an inferred "minimum" printed as a minimum rather than as the upper bound
 *    it is;
 *  - a threshold register that lets an owner believe a ceiling is holding when
 *    nothing in the gateway reads it;
 *  - an audit trail whose empty list reads as "nobody changed anything" rather
 *    than "recording started on this date".
 */
describe('SettingsNext — vendor terms', () => {
  it('renders an unknown lead time as an em dash with the reason beside it', () => {
    mount('/settings?tab=vendor-terms');
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Vendor terms');
    // ADR 0116 dropped the column default, so the gateway no longer emits the
    // "indistinguishable from the default" reason at all — an unknown lead time
    // now says why the INFERENCE could not run. The em dash and the reason
    // beside it are what this test is really for; the reason's wording moved.
    expect(screen.queryByText('7 days')).not.toBeInTheDocument();
    const cells = screen.getAllByText('—');
    expect(cells.length).toBeGreaterThan(0);
    expect(
      screen.getByTitle(/no delivered order in the window carries both a request and a delivery date/i),
    ).toBeInTheDocument();
    // And the old escape hatch is gone from the page's copy.
    expect(screen.queryByTitle(/column default \(providers\.lead_time_days\)/i)).not.toBeInTheDocument();
  });

  it('shows a stated cutoff with the day it closes on, and names who said so', () => {
    mount('/settings?tab=vendor-terms');
    expect(screen.getByText('14:00, the day before')).toBeInTheDocument();
    expect(screen.getByTitle(/stated/i)).toBeInTheDocument();
  });

  it('states an inferred minimum as an upper bound, never as the minimum', () => {
    mount('/settings?tab=vendor-terms');
    // The leading ≤ is the whole claim: every order in the books is one the
    // vendor accepted, so the smallest proves the floor is at most that.
    expect(screen.getByText(/≤/)).toBeInTheDocument();
    expect(
      screen.getByText(/every order in the books is one the vendor\s+accepted/i),
    ).toBeInTheDocument();
  });

  it('carries the receipt count and the confidence on every inferred cell', () => {
    mount('/settings?tab=vendor-terms');
    expect(screen.getByText('inferred · 214 · high')).toBeInTheDocument();
    expect(screen.getByText('inferred · 96 · high')).toBeInTheDocument();
  });

  it('says the stated-terms book could not be READ rather than showing nothing stated', () => {
    mock.current = base({
      vendorTerms: remote(
        vendorTermsRegister({
          sources: {
            providers: { readable: true, reason: null, rows: 1 },
            statedTerms: { readable: false, reason: 'the table is not present on this database', rows: null },
            orders: { readable: true, reason: null, rows: 214 },
          },
        }),
      ),
    });
    mount('/settings?tab=vendor-terms');
    expect(
      screen.getByText(/book of stated terms could not be read/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/not\s+a house that has stated nothing/i)).toBeInTheDocument();
  });

  it('sends ONLY the field the person touched — an untouched field is absent, not null', async () => {
    mount('/settings?tab=vendor-terms');
    fireEvent.click(screen.getByRole('button', { name: 'Record' }));
    fireEvent.change(screen.getByLabelText(/Closes at/i), { target: { value: '11:30' } });
    fireEvent.click(screen.getByRole('button', { name: /Record what they said/i }));
    expect(saveVendorTerms).toHaveBeenCalledTimes(1);
    const [providerId, body] = saveVendorTerms.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(providerId).toBe('p1');
    expect(body).toEqual({ orderCutoffTime: '11:30' });
    // The gateway reads an explicit null as "withdraw the statement", so an
    // untouched field must never appear in the payload at all.
    expect(Object.keys(body)).not.toContain('deliveryWeekdays');
    expect(Object.keys(body)).not.toContain('paymentTerms');
  });

  it('does not seed the editor from an inference — a guess must not become the house’s word', () => {
    mount('/settings?tab=vendor-terms');
    fireEvent.click(screen.getByRole('button', { name: 'Record' }));
    // Delivery weekdays are INFERRED for this vendor, so no day is pressed and
    // the button that would record them stays inert until somebody chooses.
    const monday = screen.getByRole('button', { name: 'Monday' });
    expect(monday).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: /Record what they said/i })).toBeDisabled();
  });
});

describe('SettingsNext — approval thresholds', () => {
  /**
   * REGRESSION OF ADR 0116, inverted rather than deleted.
   *
   * This used to assert "Nothing stops an order yet", which was true for two
   * passes. What matters is not which sentence the page shows but that it shows
   * the one the SERVER's `enforcement.enforcedBy` implies — the field is
   * measured, so the page tells the truth in both directions without either
   * sentence being authored for the state it describes. Both branches are
   * tested; testing only one would let the page hard-code either claim.
   */
  it('says it is ENFORCED, and names the path that enforces it', () => {
    mount('/settings?tab=thresholds');
    expect(screen.getByText(/Enforced\./i)).toBeInTheDocument();
    expect(screen.getByText(new RegExp(ENFORCED_AT.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))).toBeInTheDocument();
    expect(screen.queryByText(/Nothing stops an order yet/i)).not.toBeInTheDocument();
  });

  it('goes BACK to admitting nothing stops an order if the gate is ever removed', () => {
    mock.current = base({
      thresholds: remote(
        thresholdsRegister({
          enforcement: {
            enforcedBy: [],
            wouldBeEnforcedAt: ENFORCED_AT,
            note: 'approveOrder writes status without consulting a role or an amount.',
          },
        }),
      ),
    });
    mount('/settings?tab=thresholds');
    expect(screen.getByText(/Nothing stops an order yet/i)).toBeInTheDocument();
    expect(screen.queryByText(/^Enforced\.$/)).not.toBeInTheDocument();
  });

  it('lets an owner or manager set a rule', () => {
    mount('/settings?tab=thresholds');
    expect(screen.getAllByRole('button', { name: /Set it|Change it/ })[0]).not.toBeDisabled();
    expect(screen.queryByText(/Only an owner or a manager/i)).not.toBeInTheDocument();
  });

  it('DISABLES the editor for a role that could not be read, with the reason in words', () => {
    // The founder's call: "only certain high tier like manager or owner can
    // adjust it". The server refuses either way (`threshold-writes-are-role-
    // gated.spec.ts`, 7 cases); this is the courtesy half.
    //
    // The state under test is `role: null` — a person whose role could not be
    // RESOLVED, which `AuthContext` produces both when `/auth/me/role` fails and
    // when the person has no access row. It is deliberately not `role: 'staff'`:
    // staff never reach this page at all (`SettingsNext.tsx:142` sends them to
    // "Ask a manager"), so a staff fixture would have tested the gate above it
    // and proved nothing about this control. An unresolved role IS reachable,
    // and it is the case that matters — a role nobody could read must not be
    // able to raise a ceiling.
    //
    // Disabled, not hidden: the rule and its number stay legible, because a
    // limit you cannot see is one you cannot plan around.
    mock.current = base({ canManage: false, role: null });
    mount('/settings?tab=thresholds');

    expect(screen.getAllByText(/Only an owner or a manager of this restaurant may set a threshold/i)[0])
      .toBeInTheDocument();
    for (const b of screen.getAllByRole('button', { name: /Set it|Change it/ })) {
      expect(b).toBeDisabled();
    }
    // The rule and its number are still on the page.
    expect(screen.getByText('23 of 118')).toBeInTheDocument();
  });

  it('staff never see the register at all — the page gate is above this control', () => {
    // Stated so the test above cannot be misread as "staff see a disabled
    // editor". They see "Ask a manager" and no register.
    mock.current = base({ canManage: false, role: 'staff' });
    mount('/settings?tab=thresholds');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Ask a manager');
    expect(screen.queryByText(/Only an owner or a manager of this restaurant may set a threshold/i))
      .not.toBeInTheDocument();
  });

  it('shows how often each rule WOULD have fired, with its denominator', () => {
    mount('/settings?tab=thresholds');
    expect(screen.getByText('23 of 118')).toBeInTheDocument();
    expect(screen.getByText('4 of 118')).toBeInTheDocument();
  });

  it('names who set a rule and when', () => {
    mount('/settings?tab=thresholds');
    expect(screen.getByText(/set by Deniz Aksoy · 3 days ago/i)).toBeInTheDocument();
  });

  it('distinguishes a house that set no rule from one that chose "anyone, any amount"', () => {
    mock.current = base({
      thresholds: remote(thresholdsRegister({ thresholds: [], policyEmpty: true })),
    });
    mount('/settings?tab=thresholds');
    expect(screen.getByText(/has set no rule at all/i)).toBeInTheDocument();
    expect(screen.getByText(/different from having\s+chosen/i)).toBeInTheDocument();
  });

  it('refuses to set a rule with no number, rather than writing one that cannot fire', () => {
    mock.current = base({
      thresholds: remote(thresholdsRegister({ thresholds: [], policyEmpty: true })),
    });
    mount('/settings?tab=thresholds');
    // Both the amount rule and the percent rule say it, and both are refused.
    expect(screen.getAllByText(/A rule with no number cannot fire/i)).toHaveLength(2);
    const setButtons = screen.getAllByRole('button', { name: /Set it/i });
    expect(setButtons).toHaveLength(3);
    // Two of the three need a number and are refused without one; the
    // first-order rule needs none and stays settable.
    expect(setButtons.filter((b) => (b as HTMLButtonElement).disabled)).toHaveLength(2);
  });

  it('records a changed ceiling through the writer', () => {
    mount('/settings?tab=thresholds');
    const amount = screen.getByDisplayValue('15000');
    fireEvent.change(amount, { target: { value: '20000' } });
    fireEvent.click(screen.getAllByRole('button', { name: /Change it/i })[0]);
    expect(saveThreshold).toHaveBeenCalledWith('manager_ceiling', {
      enabled: true,
      amountLimit: 20000,
      percentLimit: null,
      requiredRole: 'owner',
    });
  });
});

describe('SettingsNext — the settings record', () => {
  it('ends a line at a person, and shows what the value was before', () => {
    mount('/settings?tab=ledger');
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('What changed here');
    expect(screen.getByText('Feature: enable_ai_autonomous_send')).toBeInTheDocument();
    expect(screen.getByText('Deniz Aksoy')).toBeInTheDocument();
    expect(screen.getByText('off')).toBeInTheDocument();
    expect(screen.getByText('on')).toBeInTheDocument();
  });

  it('says when recording began, so an empty list is not read as a quiet house', () => {
    mock.current = base({
      ledger: remote(ledgerRegister({ entries: [], oldestAt: null })),
    });
    mount('/settings?tab=ledger');
    expect(screen.getByText(/2026-09-03/)).toBeInTheDocument();
    expect(screen.getByText(/left no row anywhere and cannot be recovered/i)).toBeInTheDocument();
    expect(screen.getByText(/it is empty, not unreadable/i)).toBeInTheDocument();
  });

  it('says an unreadable log could not be READ, not that nothing changed', () => {
    mock.current = base({
      ledger: remote(ledgerRegister({ entries: [], readable: false, reason: 'connection reset' })),
    });
    mount('/settings?tab=ledger');
    expect(screen.getByRole('alert')).toHaveTextContent(/could not be read — connection reset/i);
    expect(screen.getByText(/not a house where nothing has changed/i)).toBeInTheDocument();
  });

  it('names the registers whose changes it does NOT cover, so their silence means nothing', () => {
    mount('/settings?tab=ledger');
    expect(screen.getByText(/Eight registers write through services this pass did not touch/i)).toBeInTheDocument();
    for (const label of ['Email sign-off', 'Locations & chains', 'Cellar registers']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   THE COLLAPSE, 2026-09-04 — "Move the registers and collapse the four tabs."

   ADR 0114 justified `/connections` on a surface count that FELL; until this
   landed it had risen — a new route PLUS fourteen tabs. Fourteen become eleven
   registers and one line out.

   Every test above runs with the flag OFF and is unchanged, which is this
   pass's proof that production is untouched. These flip it.
   ═══════════════════════════════════════════════════════════════════════════ */

describe('the collapse — four connection tabs become one line', () => {
  beforeEach(() => {
    design.connections = true;
  });

  it('drops exactly the four connection registers and keeps the other ten', () => {
    mount();
    const nav = screen.getByRole('navigation', { name: /settings registers/i });
    expect(within(nav).getAllByRole('button')).toHaveLength(11);
    for (const gone of ['Services', 'Email', 'POS', 'Calendar']) {
      expect(within(nav).queryByText(gone)).not.toBeInTheDocument();
    }
    for (const kept of [
      'Team', 'Notifications', 'Locations', 'Measurement', 'Map', 'Features',
      'Cellar', 'Vendor terms', 'Approval thresholds', 'What changed here',
      'Currency',
    ]) {
      expect(within(nav).getByText(kept)).toBeInTheDocument();
    }
  });

  it('counts the registers actually on the page, not the id set', () => {
    mount();
    // Eleven tabs plus the one line out. The tally beside it counts the same
    // eleven, and drops a clause whose count reached zero rather than printing
    // "none". The numbers moved by one on 2026-09-05 when the Currency register
    // was added; they are derived, so this line is the only place that says so.
    expect(screen.getByText(/^Eleven registers — /)).toBeInTheDocument();
    expect(screen.queryByText(/Fifteen registers/)).not.toBeInTheDocument();
  });

  it('offers one line out, naming the four registers it replaces', () => {
    mount();
    const nav = screen.getByRole('navigation', { name: /settings registers/i });
    const link = within(nav).getByRole('link', { name: /Connections — what acts for this house/ });
    expect(link).toHaveAttribute('href', '/connections');
    expect(
      within(nav).getByText(/Services, POS, Email and Calendar were four registers here/),
    ).toBeInTheDocument();
    expect(within(nav).getByText(/Managers and owners only\./)).toBeInTheDocument();
  });

  it('sends every one of the four `?tab=` deep links to its own register, not to the top', () => {
    for (const [tab, anchor] of [
      ['services', 'grants'],
      ['pos', 'till'],
      ['email', 'sender'],
      ['calendar', 'feed'],
    ] as const) {
      const view = mount(`/settings?tab=${tab}`);
      expect(screen.getByTestId('where')).toHaveTextContent(`/connections#${anchor}`);
      view.unmount();
    }
  });

  it('recognises a collapsed id rather than silently opening the default register', () => {
    // The ids stay in `SECTION_IDS` for exactly this reason. Dropping them
    // would make `?tab=pos` an unrecognised parameter, and an unrecognised
    // parameter opens Team — a bookmark quietly changing what it opens.
    const view = mount('/settings?tab=pos');
    expect(screen.getByTestId('where')).toHaveTextContent('/connections#till');
    view.unmount();
  });

  it('keeps the four tabs when the route does not exist', () => {
    design.connections = false;
    mount('/settings?tab=pos');
    const nav = screen.getByRole('navigation', { name: /settings registers/i });
    expect(within(nav).getAllByRole('button')).toHaveLength(15);
    expect(screen.getByTestId('where')).toHaveTextContent('/settings?tab=pos');
    expect(within(nav).queryByRole('link', { name: /Connections/ })).not.toBeInTheDocument();
  });
});
