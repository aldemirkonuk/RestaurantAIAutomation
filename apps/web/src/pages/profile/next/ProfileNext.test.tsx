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
const probeMcpServer = vi.fn(() => Promise.resolve());
const setMcpSecret = vi.fn(() => Promise.resolve());
const removePaymentMethod = vi.fn(() => Promise.resolve());
const setDefaultPaymentMethod = vi.fn(() => Promise.resolve());
const syncPayments = vi.fn(
  (): Promise<{ syncedAt: string; kept: number; removed: number; note: string | null }> =>
    Promise.resolve({
      syncedAt: '2026-09-03T12:00:00.000Z',
      kept: 1,
      removed: 0,
      note: null,
    }),
);
const createSetupIntent = vi.fn(() =>
  Promise.resolve({ clientSecret: 'seti_1_secret', setupIntentId: 'seti_1', livemode: false }),
);
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
  lastProbeAt: null,
  revokedAt: null,
  status: 'active' as const,
  hasSecret: false,
  secretSetAt: null,
  /** Never probed. The register must claim nothing about it. */
  probe: null as null | Record<string, unknown>,
};

/** What a successful handshake leaves on the row. */
const MCP_PROBED = {
  ...MCP_ROW,
  lastProbeAt: '2026-09-03T11:00:00.000Z',
  lastUsedAt: '2026-09-03T11:00:01.000Z',
  probe: {
    status: 'ok',
    detail: 'Connected. 2 tools listed.',
    serverName: 'Toast bridge',
    serverVersion: '3.1.0',
    protocolVersion: '2025-06-18',
    tools: [
      { name: 'stock_on_hand', title: 'Stock on hand', description: null },
      { name: 'open_orders', title: null, description: null },
    ],
    toolCount: 2,
  },
};

const MCP_RUNTIME = {
  secretStorage: {
    configured: false,
    reason:
      'MCP_CONNECTION_SECRET_KEY is not set, so a model-context server secret cannot be stored or read.',
  },
  invocation: {
    enabled: false,
    reason:
      'Tools can be listed but not called. Calling one could commit this restaurant to money, which is the subject of the commitment guardrail (ADR 0013); that decision comes before the code, so no invocation path exists in this gateway.',
  },
  probeTimeoutMs: 8000,
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
    mcpRuntime: MCP_RUNTIME,
    refetchMcp,

    paymentsState: 'ok',
    paymentsError: null,
    paymentMethods: [],
    paymentProvider: {
      id: 'stripe',
      connected: false,
      reason:
        'Stripe is not connected — STRIPE_SECRET_KEY is not set on this deployment, so no payment method can be taken and none could exist to list.',
      mode: null,
      secretKeyPresent: false,
      webhookSecretPresent: false,
      apiVersion: '2024-06-20',
      webhookLastReceivedAt: null,
      webhookLastEventType: null,
      webhookReason:
        'STRIPE_WEBHOOK_SECRET is not set, so every delivery is refused and this register only changes when someone is looking at it.',
    },
    refetchPayments,
    stripePublishableKey: null,

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
    probeMcpServer,
    setMcpSecret,
    removePaymentMethod,
    setDefaultPaymentMethod,
    syncPayments,
    createSetupIntent,
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
  it('claims NOTHING about a server nobody has checked', () => {
    // The chip is an em dash, not `Connected`. A declaration is not a
    // measurement, and the whole runtime pass exists to keep those apart.
    draw();
    const row = rowFor('House POS bridge');
    expect(within(row).getByText('—')).toBeInTheDocument();
    expect(within(row).getByText(/has never been checked/)).toBeInTheDocument();

    fireEvent.click(within(row).getByRole('button', { name: 'Scopes, tools and dates' }));
    expect(within(row).getByText('inventory:read')).toBeInTheDocument();
    expect(within(row).getByText(/it has never been called/)).toBeInTheDocument();
    expect(within(row).getByText(/it has never answered/)).toBeInTheDocument();
    // Tools are what a handshake returns, so an unchecked server has a dash
    // rather than an empty list that would read as "it offers none".
    expect(within(row).getByText(/the server has not been asked/)).toBeInTheDocument();
  });

  it('calls the server when asked, through the real write', async () => {
    draw();
    fireEvent.click(
      within(rowFor('House POS bridge')).getByRole('button', { name: 'Check the server' }),
    );
    await waitFor(() => expect(probeMcpServer).toHaveBeenCalledWith('m1'));
  });

  it('shows what answered: the name, the version, and the tool names', () => {
    mockData.current = base({ mcpServers: [MCP_PROBED] });
    draw();
    const row = rowFor('House POS bridge');
    expect(within(row).getByText('Connected')).toBeInTheDocument();
    expect(within(row).getByText('Connected. 2 tools listed.')).toBeInTheDocument();

    fireEvent.click(within(row).getByRole('button', { name: 'Scopes, tools and dates' }));
    expect(within(row).getByText(/Toast bridge 3\.1\.0/)).toBeInTheDocument();
    expect(within(row).getByText('stock_on_hand')).toBeInTheDocument();
    expect(within(row).getByText('open_orders')).toBeInTheDocument();
  });

  it('says a listed tool cannot be CALLED, in the gateway’s own words', () => {
    mockData.current = base({ mcpServers: [MCP_PROBED] });
    draw();
    const row = rowFor('House POS bridge');
    fireEvent.click(within(row).getByRole('button', { name: 'Scopes, tools and dates' }));
    expect(within(row).getByText(/commitment guardrail \(ADR 0013\)/)).toBeInTheDocument();
    // And there is no control that would call one.
    expect(within(row).queryByRole('button', { name: /stock_on_hand/ })).not.toBeInTheDocument();
    expect(within(row).queryByRole('button', { name: /Run|Call|Invoke/ })).not.toBeInTheDocument();
  });

  it('does not move “last answered” when the server did not answer', () => {
    // The two-timestamp rule, on screen: a failed check is a call that
    // happened and an answer that did not.
    mockData.current = base({
      mcpServers: [
        {
          ...MCP_ROW,
          lastProbeAt: '2026-09-03T11:00:00.000Z',
          lastUsedAt: null,
          probe: {
            status: 'unreachable',
            detail: 'nothing answered within the 8000ms left of the probe’s time budget.',
            serverName: null,
            serverVersion: null,
            protocolVersion: null,
            tools: null,
            toolCount: null,
          },
        },
      ],
    });
    draw();
    const row = rowFor('House POS bridge');
    expect(within(row).getByText('Unavailable')).toBeInTheDocument();
    expect(within(row).getByText(/nothing answered within/)).toBeInTheDocument();

    fireEvent.click(within(row).getByRole('button', { name: 'Scopes, tools and dates' }));
    // The call happened; the answer did not. Two columns, two sentences.
    expect(within(row).queryByText(/it has never been called/)).not.toBeInTheDocument();
    expect(within(row).getByText(/it has never answered/)).toBeInTheDocument();
  });

  it('says a stored credential could not be read, rather than calling anonymously', () => {
    mockData.current = base({
      mcpServers: [
        {
          ...MCP_ROW,
          hasSecret: true,
          secretSetAt: '2026-09-02T09:00:00.000Z',
          lastProbeAt: '2026-09-03T11:00:00.000Z',
          probe: {
            status: 'unconfigured',
            detail:
              'MCP_CONNECTION_SECRET_KEY is not set, so a model-context server secret cannot be stored or read.',
            serverName: null,
            serverVersion: null,
            protocolVersion: null,
            tools: null,
            toolCount: null,
          },
        },
      ],
    });
    draw();
    const row = rowFor('House POS bridge');
    // Rendered as the row's reason, beside the credential field's own hint.
    expect(
      within(row).getAllByText(/MCP_CONNECTION_SECRET_KEY is not set/).length,
    ).toBeGreaterThan(0);
  });

  it('disables the credential field, with the deployment’s reason, when no key is configured', () => {
    draw();
    const row = rowFor('House POS bridge');
    fireEvent.click(within(row).getByRole('button', { name: 'Scopes, tools and dates' }));
    expect(within(row).getByLabelText('Credential')).toBeDisabled();
    expect(
      within(row).getAllByText(/MCP_CONNECTION_SECRET_KEY is not set/).length,
    ).toBeGreaterThan(0);
    expect(setMcpSecret).not.toHaveBeenCalled();
  });

  it('stores a credential when the deployment says it can', async () => {
    mockData.current = base({
      mcpRuntime: {
        ...MCP_RUNTIME,
        secretStorage: { configured: true, reason: null },
      },
    });
    draw();
    const row = rowFor('House POS bridge');
    fireEvent.click(within(row).getByRole('button', { name: 'Scopes, tools and dates' }));
    fireEvent.change(within(row).getByLabelText('Credential'), {
      target: { value: 'the-house-token' },
    });
    fireEvent.click(within(row).getByRole('button', { name: 'Store credential' }));
    await waitFor(() =>
      expect(setMcpSecret).toHaveBeenCalledWith('m1', 'the-house-token'),
    );
  });

  it('disables the credential field when the deployment did not report its state', () => {
    // Not `{configured: false}` by default: "we never asked" and "there is no
    // key" are different sentences, and only one of them names a variable.
    mockData.current = base({ mcpRuntime: null });
    draw();
    const row = rowFor('House POS bridge');
    fireEvent.click(within(row).getByRole('button', { name: 'Scopes, tools and dates' }));
    expect(within(row).getByLabelText('Credential')).toBeDisabled();
    expect(
      within(row).getAllByText(/did not report whether it can store a credential/).length,
    ).toBeGreaterThan(0);
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
      // No key configured in this fixture, so no credential is offered at all.
      secret: undefined,
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

/**
 * Register V — the provider path (third pass, ADR 0110).
 *
 * The tests that would be easiest to write vacuously are written the hard way:
 * the unconfigured case asserts the NAME of the missing variable and that no
 * typeable field exists, and the connected-with-a-webhook-secret case asserts
 * the sentence that separates "configured" from "working". Both pass trivially
 * against a page that merely renders nothing.
 */
const CONNECTED_PROVIDER = {
  id: 'stripe',
  connected: true,
  reason: null,
  mode: 'test' as const,
  secretKeyPresent: true,
  webhookSecretPresent: true,
  apiVersion: '2024-06-20',
  webhookLastReceivedAt: null,
  webhookLastEventType: null,
  webhookReason:
    'STRIPE_WEBHOOK_SECRET is set, but no signed delivery has ever arrived at this deployment. Until one does, a card removed at Stripe would go on showing here.',
};

const CARD_ROW = {
  id: 'pm-row-1',
  kind: 'card' as const,
  brand: 'visa',
  last4: '4242',
  exp: '04/2029',
  isDefault: true,
  provider: 'stripe',
  createdAt: '2026-09-01T09:00:00.000Z',
  providerType: 'card',
  syncedAt: '2026-09-03T11:00:00.000Z',
  livemode: false,
};

describe('ProfileNext — the payment register (the provider path)', () => {
  it('opens the panel with NO typeable field, and names the secret that is missing', () => {
    draw();
    fireEvent.click(screen.getByRole('button', { name: 'Add a card' }));

    // The four hand-typed fields of the second pass are GONE, not disabled.
    // They described a create path the provider build replaced, and leaving
    // them would put the register one env var from an operator-typed row.
    expect(screen.queryByLabelText('Kind')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Last four digits')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Brand or bank')).not.toBeInTheDocument();

    expect(
      screen.getByRole('button', { name: 'Hold to put this card on file' }),
    ).toBeDisabled();
    expect(
      screen.getByText(/STRIPE_SECRET_KEY is not set on the gateway/),
    ).toBeInTheDocument();
    expect(createSetupIntent).not.toHaveBeenCalled();
  });

  it('names the BROWSER’s missing key when the gateway is ready and the bundle is not', () => {
    mockData.current = base({
      paymentProvider: CONNECTED_PROVIDER,
      stripePublishableKey: null,
    });
    draw();
    fireEvent.click(screen.getByRole('button', { name: 'Add a card' }));

    expect(
      screen.getByText(/VITE_STRIPE_PUBLISHABLE_KEY is not set in this web bundle/),
    ).toBeInTheDocument();
    // and it must NOT blame the gateway, which is configured
    expect(
      screen.queryByText(/STRIPE_SECRET_KEY is not set on the gateway/),
    ).not.toBeInTheDocument();
    expect(createSetupIntent).not.toHaveBeenCalled();
  });

  it('says the register is empty because no provider is connected, not because nobody added a card', () => {
    draw();
    expect(
      screen.getByText(/no payment provider credential is configured on this deployment/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/STRIPE_SECRET_KEY is not set on this deployment/),
    ).toBeInTheDocument();
  });

  it('does not wear the "Not built" chip — the register IS built, only the credential is missing', () => {
    draw();
    const empty = rowFor('No payment method on file');
    expect(within(empty).getByText('Provider not connected')).toBeInTheDocument();
    expect(within(empty).queryByText('Not built')).not.toBeInTheDocument();
    // and the four rows that genuinely have no code behind them still do, so
    // the two states stay visually distinguishable on one page
    expect(within(rowFor('Two-factor authentication')).getByText('Not built')).toBeInTheDocument();
    expect(within(empty).getByText(/it is not unbuilt/)).toBeInTheDocument();
  });

  it('offers to add one, without the "Provider not connected" chip, once a provider is connected', () => {
    mockData.current = base({ paymentProvider: CONNECTED_PROVIDER });
    draw();
    const empty = rowFor('No payment method on file');
    expect(within(empty).getByText('Not connected')).toBeInTheDocument();
    expect(within(empty).queryByText('Provider not connected')).not.toBeInTheDocument();
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
    expect(
      screen.queryByText(/no payment provider credential is configured on this deployment/),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/The provider did not report its state \(boom\)/)).toBeInTheDocument();
  });
});

describe('ProfileNext — the provider row is the honesty seam', () => {
  it('says a webhook secret that has never had a delivery is NOT working', () => {
    mockData.current = base({ paymentProvider: CONNECTED_PROVIDER });
    draw();
    const row = rowFor('Stripe');
    expect(within(row).getByText('Connected')).toBeInTheDocument();
    expect(
      within(row).getByText(/no signed delivery has ever arrived at this deployment/),
    ).toBeInTheDocument();
    // the subtitle prints the missing delivery as a dash, not as a date
    expect(within(row).getByText(/last delivery/)).toBeInTheDocument();
  });

  it('drops the warning once a delivery is on record, and names the event', () => {
    mockData.current = base({
      paymentProvider: {
        ...CONNECTED_PROVIDER,
        webhookLastReceivedAt: '2026-09-03T10:30:00.000Z',
        webhookLastEventType: 'payment_method.attached',
        webhookReason: null,
      },
    });
    draw();
    const row = rowFor('Stripe');
    expect(
      within(row).queryByText(/no signed delivery has ever arrived/),
    ).not.toBeInTheDocument();
    fireEvent.click(within(row).getByRole('button', { name: 'Show the three secrets' }));
    expect(
      within(row).getByText(/payment_method\.attached/),
    ).toBeInTheDocument();
  });

  it('names all three secrets, in the process each one lives in', () => {
    mockData.current = base({ paymentProvider: CONNECTED_PROVIDER });
    draw();
    const row = rowFor('Stripe');
    fireEvent.click(within(row).getByRole('button', { name: 'Show the three secrets' }));

    expect(within(row).getByText('STRIPE_SECRET_KEY')).toBeInTheDocument();
    expect(within(row).getByText('STRIPE_WEBHOOK_SECRET')).toBeInTheDocument();
    expect(within(row).getByText('VITE_STRIPE_PUBLISHABLE_KEY')).toBeInTheDocument();
    // the browser key is absent in the fixture and must be reported as such
    expect(within(row).getByText(/NOT set \(web bundle, at build time\)/)).toBeInTheDocument();
  });

  it('reconciles against the provider on demand, and reports what it dropped', async () => {
    syncPayments.mockResolvedValueOnce({
      syncedAt: '2026-09-03T12:00:00.000Z',
      kept: 0,
      removed: 1,
      note: '1 instrument(s) were on file here and no longer exist at the provider; they have been dropped.',
    });
    mockData.current = base({ paymentProvider: CONNECTED_PROVIDER });
    draw();
    fireEvent.click(screen.getByRole('button', { name: /Reconcile now/ }));
    await waitFor(() => expect(syncPayments).toHaveBeenCalled());
    expect(
      await screen.findByText(/no longer exist at the provider/),
    ).toBeInTheDocument();
  });

  it('offers no reconcile at all while no provider is connected', () => {
    draw();
    expect(screen.queryByRole('button', { name: /Reconcile now/ })).not.toBeInTheDocument();
  });
});

describe('ProfileNext — a stored instrument says how stale it is', () => {
  it('prints when the row was last confirmed against the provider', () => {
    mockData.current = base({
      paymentProvider: CONNECTED_PROVIDER,
      paymentMethods: [CARD_ROW],
    });
    draw();
    const row = rowFor(/Card · visa/);
    expect(within(row).getByText(/Confirmed against the provider on/)).toBeInTheDocument();
    expect(within(row).getByText(/•••• 4242/)).toBeInTheDocument();
  });

  it('says a row has NEVER been confirmed rather than implying it is current', () => {
    mockData.current = base({
      paymentProvider: CONNECTED_PROVIDER,
      paymentMethods: [{ ...CARD_ROW, syncedAt: null }],
    });
    draw();
    const row = rowFor(/Card · visa/);
    expect(
      within(row).getByText(/Never confirmed against the provider since it was written/),
    ).toBeInTheDocument();
  });

  it('files an instrument our four kinds do not span as itself, not as a card', () => {
    mockData.current = base({
      paymentProvider: CONNECTED_PROVIDER,
      paymentMethods: [
        { ...CARD_ROW, kind: 'other' as const, brand: null, providerType: 'cashapp' },
      ],
    });
    draw();
    expect(screen.getByText(/Instrument · cashapp/)).toBeInTheDocument();
    expect(screen.queryByText(/^Card · cashapp/)).not.toBeInTheDocument();
  });

  it('lets a manager choose which instrument is charged first, once a provider is connected', async () => {
    mockData.current = base({
      paymentProvider: CONNECTED_PROVIDER,
      paymentMethods: [{ ...CARD_ROW, isDefault: false }],
    });
    draw();
    fireEvent.click(screen.getByRole('button', { name: 'Charge this first' }));
    await waitFor(() => expect(setDefaultPaymentMethod).toHaveBeenCalledWith('pm-row-1'));
    expect(
      await screen.findByText(/The provider now charges this instrument first/),
    ).toBeInTheDocument();
  });

  it('offers no "charge this first" while no provider is connected — there is nothing to charge', () => {
    mockData.current = base({ paymentMethods: [{ ...CARD_ROW, isDefault: false }] });
    draw();
    expect(screen.queryByRole('button', { name: 'Charge this first' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove' })).toBeInTheDocument();
  });
});

describe('ProfileNext — the plan is a figure', () => {
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
