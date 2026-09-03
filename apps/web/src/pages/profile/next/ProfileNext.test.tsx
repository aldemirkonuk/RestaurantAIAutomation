/**
 * ProfileNext render contract — second pass, 2026-09-03.
 *
 * What these assert, in the order the brief asks for them:
 *
 *  1. the happy render — seven registers, and the founder's named additions
 *     (MCP servers, payment types, security) as first-class ones;
 *  2. every honesty state — a failed account read, a failed restaurant read, an
 *     unreadable connection register, an unreadable MCP register and an
 *     unreadable payment register each say WHICH register failed, and none of
 *     them degrades into an empty list that would read as "nothing here";
 *  3. the two registers built this pass — the MCP register lists, adds and
 *     revokes for real; the payment register opens its form and DISABLES the
 *     submit with the provider's stated reason, and never reports a save;
 *  4. the security register — one session row built from evidence, and three
 *     protections rendered `Not built` with no toggle that could turn nothing on;
 *  5. the plan is a figure now, and still an em dash when it was not read;
 *  6. delete-account is hold-to-approve, inert until DELETE is typed.
 *
 * The two tests that would be easiest to write vacuously are written the hard
 * way on purpose: the empty-MCP and empty-payment cases each assert the SENTENCE
 * that distinguishes "nothing recorded" from "nothing readable", not merely that
 * a list rendered nothing — which a scaffold would also satisfy.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { cleanup, render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const mockData = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));

vi.mock('./useProfileNextData', () => ({
  useProfileNextData: () => mockData.current,
}));

import ProfileNext from './ProfileNext';

const deleteAccount = vi.fn(() => Promise.resolve());
const saveRestaurant = vi.fn(() => Promise.resolve());
const addMcpServer = vi.fn(() => Promise.resolve());
const revokeMcpServer = vi.fn(() => Promise.resolve());
const removePaymentMethod = vi.fn(() => Promise.resolve());
const refetchMe = vi.fn();
const refetchLocation = vi.fn();
const refetchMcp = vi.fn();
const refetchPayments = vi.fn();
const signOut = vi.fn(() => Promise.resolve());

const MCP_ROW = {
  id: 'm1',
  name: 'House POS bridge',
  url: 'https://mcp.house.example',
  scopes: ['inventory:read', 'orders:read'],
  createdAt: '2026-09-01T09:00:00.000Z',
  lastUsedAt: null,
  revokedAt: null,
  status: 'active' as const,
};

function base(over: Record<string, unknown> = {}) {
  return {
    user: { userId: 'u1', email: 'chef@house.example', name: 'Aldemir Konuk', role: 'owner', restaurantId: 'r1' },
    role: 'owner',
    isManagerOrOwner: true,
    activeRestaurantId: 'r1',
    memberships: [{ id: 'r1', name: 'Ada Lokantası', city: 'İzmir', chain_id: null, chain_name: null }],
    switchRestaurant: vi.fn(),
    theme: 'system',
    setTheme: vi.fn(),

    meState: 'ok',
    meError: null,
    phone: '+90 555 000 0000',
    hasPassword: true,
    linked: { google: true, microsoft: false },
    credentialCount: 2,
    refetchMe,

    locationState: 'ok',
    locationError: null,
    location: {
      name: 'Ada Lokantası',
      city: 'İzmir',
      billingEmail: 'billing@ada.example',
      billingPhone: '',
      subscriptionTier: 'pilot',
    },
    refetchLocation,

    workspaceState: 'ok',
    workspaceError: null,
    workspace: [
      {
        id: 'google_drive',
        label: 'Google Drive',
        providerLabel: 'Google',
        description: 'Save exports and menu scans to a folder in your Drive.',
        state: 'connected',
        account: 'chef@house.example',
        connectedAt: '2026-08-30T10:00:00.000Z',
        grantedScopes: ['https://www.googleapis.com/auth/drive.file'],
        requestedScopes: [],
        notRequested: [],
        blockedReason: null,
      },
      {
        id: 'excel',
        label: 'Microsoft Excel',
        providerLabel: 'Microsoft',
        description: 'Export inventory and reports to Excel on OneDrive.',
        state: 'unavailable',
        account: null,
        connectedAt: null,
        grantedScopes: [],
        requestedScopes: [{ scope: 'Files.ReadWrite', label: 'Create workbooks', reason: 'To write reports.' }],
        notRequested: ['Reading your Outlook mail'],
        blockedReason: 'Microsoft OAuth is not configured on this deployment.',
      },
    ],
    connectionsUnreadable: false,
    connectedWorkspaceCount: 1,
    refetchWorkspace: vi.fn(),

    mcpState: 'ok',
    mcpError: null,
    mcpServers: [MCP_ROW],
    refetchMcp,

    paymentsState: 'ok',
    paymentsError: null,
    paymentMethods: [],
    paymentProvider: {
      id: 'stripe',
      connected: false,
      reason:
        'Stripe is not connected — no provider credential is configured in this deployment, so no payment method can be taken or charged.',
    },
    refetchPayments,

    session: {
      device: 'Chrome on macOS',
      signedInAt: '2026-09-03T08:00:00.000Z',
      expiresAt: '2026-09-03T08:15:00.000Z',
      readable: true,
    },
    signOut,

    saveAccount: vi.fn(() => Promise.resolve()),
    changePassword: vi.fn(() => Promise.resolve()),
    unlinkProvider: vi.fn(() => Promise.resolve()),
    refreshLinked: vi.fn(() => Promise.resolve()),
    disconnectWorkspace: vi.fn(() => Promise.resolve()),
    saveRestaurant,
    saveBillingContact: vi.fn(() => Promise.resolve()),
    addMcpServer,
    revokeMcpServer,
    removePaymentMethod,
    leaveRestaurant: vi.fn(() => Promise.resolve()),
    deleteAccount,
    ...over,
  };
}

function draw() {
  return render(
    <MemoryRouter>
      <ProfileNext />
    </MemoryRouter>,
  );
}

/**
 * The card-shaped block a row title sits in.
 *
 * Matches on every element carrying the text and keeps the ones inside a
 * `.pf-row`, because a word like "Plan" legitimately appears twice on this page
 * — once as a standing fact and once as a row — and the test should name the row
 * rather than force the page to rename the fact.
 */
function rowFor(title: string | RegExp): HTMLElement {
  const rows = screen
    .getAllByText(title)
    .map((el) => el.closest('div.pf-row'))
    .filter((el): el is HTMLElement => el !== null);
  expect(rows.length).toBeGreaterThan(0);
  return rows[0];
}

beforeEach(() => {
  vi.clearAllMocks();
  mockData.current = base();
});

describe('ProfileNext — the ledger', () => {
  it('opens on the account, in the product’s own voice, tallying only registers that answered', () => {
    draw();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Aldemir Konuk');
    expect(
      screen.getByText(
        /Two ways in, one workspace connected, one model-context server declared, nothing on file that can bill you\./,
      ),
    ).toBeInTheDocument();
  });

  it('carries seven registers, with the founder’s three asks as first-class ones', () => {
    draw();
    for (const register of [
      'Who you are',
      'What protects this account',
      'What is connected to you',
      'Model context',
      'How the house pays',
      'The house',
      'Ruled off',
    ]) {
      expect(screen.getByRole('heading', { name: register })).toBeInTheDocument();
    }
  });

  it('omits a register’s clause from the opening line rather than counting it as zero', () => {
    mockData.current = base({ mcpState: 'error', mcpError: 'boom', mcpServers: [] });
    draw();
    expect(screen.queryByText(/model-context server declared/)).not.toBeInTheDocument();
    expect(screen.getByText(/Two ways in, one workspace connected, nothing on file that can bill you\./)).toBeInTheDocument();
  });
});

describe('ProfileNext — linked accounts (real)', () => {
  it('shows the live Google link with a working unlink, and Microsoft honestly unconnectable', () => {
    draw();
    const google = rowFor('Google');
    expect(within(google).getByText('Connected')).toBeInTheDocument();
    expect(within(google).getByRole('button', { name: 'Unlink' })).toBeEnabled();

    const microsoft = rowFor('Microsoft');
    expect(within(microsoft).getByRole('button', { name: 'Connect' })).toBeDisabled();
    expect(within(microsoft).getByText(/no sign-in button anywhere in the app/)).toBeInTheDocument();
  });

  it('states the last-credential rule before the click instead of after the failure', () => {
    mockData.current = base({ hasPassword: false, linked: { google: true, microsoft: false }, credentialCount: 1 });
    draw();
    const google = rowFor('Google');
    expect(within(google).getByRole('button', { name: 'Unlink' })).toBeDisabled();
    expect(within(google).getByText(/only sign-in method/)).toBeInTheDocument();
  });
});

describe('ProfileNext — security', () => {
  it('builds the one session row it can prove, from the token this browser holds', () => {
    draw();
    const row = rowFor('This browser');
    expect(within(row).getAllByText(/Chrome on macOS/).length).toBeGreaterThan(0);
    expect(within(row).getByRole('button', { name: 'Sign out of this browser' })).toBeEnabled();
    fireEvent.click(within(row).getByRole('button', { name: 'Sign out of this browser' }));
    expect(signOut).toHaveBeenCalledTimes(1);
  });

  it('calls the session unknown when no token could be read, rather than signed out', () => {
    mockData.current = base({
      session: { device: null, signedInAt: null, expiresAt: null, readable: false },
    });
    draw();
    const row = rowFor('This browser');
    expect(within(row).getAllByText('—').length).toBeGreaterThan(0);
    expect(within(row).getByText(/holding no readable token/)).toBeInTheDocument();
  });

  it('renders every missing protection as Not built with a reason, and never as a toggle', () => {
    draw();
    for (const [title, control] of [
      ['Other devices', 'Sign out everywhere'],
      ['Two-factor authentication', 'Turn on two-factor'],
      ['Passkeys', 'Add a passkey'],
      ['API tokens', 'Create a token'],
    ] as const) {
      const row = rowFor(title);
      expect(within(row).getByText('Not built')).toBeInTheDocument();
      expect(within(row).getByRole('button', { name: control })).toBeDisabled();
    }
    // the specific claims, so a reworded reason cannot silently become vaguer
    expect(rowFor('Other devices').textContent).toMatch(/keeps no session register/);
    expect(rowFor('Two-factor authentication').textContent).toMatch(/No second factor exists in the gateway/);
    expect(rowFor('API tokens').textContent).toMatch(/issues no personal API tokens/);
    // and there is no checkbox or switch anywhere that could pretend to arm one
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it('keeps the password form reachable from the sign-in rail’s Change password', () => {
    draw();
    expect(screen.getByLabelText('New password')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Change password' })).toBeEnabled();
  });
});

describe('ProfileNext — the model-context register (built this pass)', () => {
  it('lists a declared server with its scopes, and its last call as a dash', () => {
    draw();
    const row = rowFor('House POS bridge');
    expect(within(row).getByText('Connected')).toBeInTheDocument();
    fireEvent.click(within(row).getByRole('button', { name: 'Scopes and dates' }));
    expect(within(row).getByText('inventory:read')).toBeInTheDocument();
    expect(within(row).getByText(/— nothing has called it/)).toBeInTheDocument();
  });

  it('adds a server through the real write, with the scopes it parsed', async () => {
    draw();
    fireEvent.click(screen.getByRole('button', { name: 'Add a server' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Supplier catalogue' } });
    fireEvent.change(screen.getByLabelText('Endpoint'), {
      target: { value: 'https://catalogue.example.com' },
    });
    fireEvent.change(screen.getByLabelText('Scopes granted'), {
      target: { value: 'catalogue:read, prices:read' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Declare server' }));

    await waitFor(() => expect(addMcpServer).toHaveBeenCalledTimes(1));
    expect(addMcpServer).toHaveBeenCalledWith({
      name: 'Supplier catalogue',
      url: 'https://catalogue.example.com',
      scopes: ['catalogue:read', 'prices:read'],
    });
  });

  it('refuses to submit a server with no endpoint, before any write', () => {
    draw();
    fireEvent.click(screen.getByRole('button', { name: 'Add a server' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'No endpoint' } });
    expect(screen.getByRole('button', { name: 'Declare server' })).toBeDisabled();
    expect(addMcpServer).not.toHaveBeenCalled();
  });

  it('revokes a server through the real write', async () => {
    draw();
    fireEvent.click(within(rowFor('House POS bridge')).getByRole('button', { name: 'Revoke' }));
    await waitFor(() => expect(revokeMcpServer).toHaveBeenCalledWith('m1'));
  });

  it('keeps a revoked row on the register rather than dropping it', () => {
    mockData.current = base({
      mcpServers: [{ ...MCP_ROW, status: 'revoked', revokedAt: '2026-09-03T10:00:00.000Z' }],
    });
    draw();
    const revoked = rowFor('House POS bridge');
    expect(within(revoked).getByText('Unavailable')).toBeInTheDocument();
    expect(within(revoked).getByText(/does not become indistinguishable/)).toBeInTheDocument();
    expect(within(revoked).queryByRole('button', { name: 'Revoke' })).not.toBeInTheDocument();
  });

  it('says an empty register is reporting nothing, not failing to answer', () => {
    mockData.current = base({ mcpServers: [] });
    draw();
    expect(screen.getByText(/reporting nothing, not the register failing to answer/)).toBeInTheDocument();
  });

  it('says an unread register is unread, and offers the retry', () => {
    mockData.current = base({ mcpState: 'error', mcpError: 'Network Error', mcpServers: [] });
    draw();
    expect(
      screen.getByText(/model-context register could not be read \(Network Error\)/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/reporting nothing, not the register failing to answer/)).not.toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: 'Try again' })[0]);
    expect(refetchMcp).toHaveBeenCalled();
  });
});

describe('ProfileNext — the payment register (built this pass)', () => {
  it('opens the Add form and disables the submit with the provider’s own reason', () => {
    draw();
    fireEvent.click(screen.getByRole('button', { name: 'Add a card' }));
    expect(screen.getByLabelText('Kind')).toBeInTheDocument();
    expect(screen.getByLabelText('Last four digits')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save payment method' })).toBeDisabled();
    expect(
      screen.getByText('Stripe is not connected — this saves nothing until it is.'),
    ).toBeInTheDocument();
  });

  it('offers the four kinds a Stripe-backed account would have', () => {
    draw();
    fireEvent.click(screen.getByRole('button', { name: 'Add a card' }));
    const kinds = screen.getByLabelText('Kind') as HTMLSelectElement;
    const labels = Array.from(kinds.options).map((o) => o.textContent);
    expect(labels).toEqual([
      'Card',
      'Bank account (ACH direct debit)',
      'Apple Pay',
      'Invoice terms (net 30)',
    ]);
  });

  it('says the register is empty because no provider is connected, not because nobody added a card', () => {
    draw();
    expect(
      screen.getByText(/no payment provider is connected to this deployment/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Stripe is not connected — no provider credential is configured/),
    ).toBeInTheDocument();
  });

  it('says the register is UNREAD when the read failed, and claims nothing about it', () => {
    mockData.current = base({
      paymentsState: 'error',
      paymentsError: 'boom',
      paymentMethods: [],
      paymentProvider: null,
    });
    draw();
    expect(screen.getByText(/payment register could not be read \(boom\)/)).toBeInTheDocument();
    expect(screen.queryByText(/no payment provider is connected to this deployment/)).not.toBeInTheDocument();
  });

  it('names the plan now that the endpoint returns it', () => {
    draw();
    const plan = rowFor('Plan');
    expect(within(plan).getByText('Pilot')).toBeInTheDocument();
    expect(within(plan).getByText('Connected')).toBeInTheDocument();
    expect(screen.queryByText(/Plan: Free/)).not.toBeInTheDocument();
    cleanup();
  });

  it('still renders the plan as a dash when the restaurant record was not read', () => {
    mockData.current = base({ locationState: 'error', locationError: 'boom', location: null });
    draw();
    const plan = rowFor('Plan');
    expect(within(plan).getAllByText('—').length).toBeGreaterThanOrEqual(2);
    expect(within(plan).getByText(/unknown rather than free/)).toBeInTheDocument();
    expect(within(plan).queryByText('Pilot')).not.toBeInTheDocument();
  });
});

describe('ProfileNext — honesty states', () => {
  it('says which register failed when the account record cannot be read, and refuses to write a phone nobody read', () => {
    mockData.current = base({
      meState: 'error',
      meError: 'Network Error',
      phone: '',
      hasPassword: null,
      linked: null,
      credentialCount: null,
    });
    draw();
    expect(screen.getByText(/The account record could not be read \(Network Error\)/)).toBeInTheDocument();
    expect(screen.getByLabelText('Phone')).toBeDisabled();
    expect(screen.getByText(/Saving will not touch it/)).toBeInTheDocument();
    expect(screen.queryByText(/ways in/)).not.toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: 'Try again' })[0]);
    expect(refetchMe).toHaveBeenCalled();
  });

  it('leaves the restaurant fields empty and unsaveable when the record could not be read', () => {
    mockData.current = base({ locationState: 'error', locationError: 'boom', location: null });
    draw();
    expect(screen.getByText(/the cached branch name would have looked like an answer/)).toBeInTheDocument();
    const nameField = screen.getByLabelText('Restaurant name') as HTMLInputElement;
    expect(nameField).toBeDisabled();
    expect(nameField.value).toBe('');
    expect(screen.getByRole('button', { name: 'Save restaurant' })).toBeDisabled();
    expect(saveRestaurant).not.toHaveBeenCalled();
  });

  it('calls an unreadable connection register unknown, never "not connected"', () => {
    mockData.current = base({
      connectionsUnreadable: true,
      connectedWorkspaceCount: null,
      workspace: [
        {
          id: 'google_drive',
          label: 'Google Drive',
          providerLabel: 'Google',
          description: 'Save exports to Drive.',
          state: 'unknown',
          account: null,
          connectedAt: null,
          grantedScopes: [],
          requestedScopes: [],
          notRequested: [],
          blockedReason: 'The connection register could not be read, so this row makes no claim either way.',
        },
      ],
    });
    draw();
    expect(screen.getByText(/The connection register did not answer/)).toBeInTheDocument();
    const drive = rowFor('Google Drive');
    expect(within(drive).queryByText('Not connected')).not.toBeInTheDocument();
    expect(within(drive).getByText('—')).toBeInTheDocument();
  });

  it('renders permission-denied as a server rule now that the endpoint enforces one', () => {
    mockData.current = base({ role: 'staff', isManagerOrOwner: false, locationState: 'idle', location: null });
    draw();
    expect(screen.getByText('Restaurant record')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save restaurant' })).not.toBeInTheDocument();

    const record = rowFor('Restaurant record');
    expect(within(record).getByText(/Your role here is Staff/)).toBeInTheDocument();
    expect(within(record).getByText(/the server refuses both for anyone else/)).toBeInTheDocument();
    // the pre-fix wording — which credited the PAGE with withholding the record —
    // must be gone, because the gateway does the withholding now
    expect(screen.queryByText(/this page does not fetch the record/)).not.toBeInTheDocument();
    expect(screen.queryByText(/open to any member of the organisation/)).not.toBeInTheDocument();

    // and a staff member cannot open a payment form that the server would refuse
    expect(screen.getByRole('button', { name: 'Add a card' })).toBeDisabled();
  });
});

describe('ProfileNext — the one irreversible act', () => {
  it('keeps the hold inert until DELETE is typed, then deletes on the completed hold', () => {
    draw();
    const hold = screen.getByRole('button', { name: 'Hold to delete this account' });
    expect(hold).toBeDisabled();
    expect(screen.getByText(/The hold does nothing until DELETE is typed/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Type DELETE to arm the seal'), {
      target: { value: 'DELETE' },
    });
    expect(hold).toBeEnabled();

    fireEvent.keyDown(hold, { key: 'Enter' });
    expect(deleteAccount).not.toHaveBeenCalled();
    expect(screen.getByText('Enter again to approve')).toBeInTheDocument();
    fireEvent.keyDown(hold, { key: 'Enter' });
    expect(deleteAccount).toHaveBeenCalledTimes(1);
  });
});
