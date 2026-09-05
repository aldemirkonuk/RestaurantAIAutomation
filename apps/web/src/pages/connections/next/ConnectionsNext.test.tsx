/**
 * ConnectionsNext render contract.
 *
 * Every test here fails if the page is replaced by a scaffold, and every one
 * pins something the founder decided or something ADR 0020 forbids:
 *
 *   - the role gate refuses in WORDS, and says the server refuses too;
 *   - the ledger sentence never claims "nothing can spend" off an unread
 *     register — the single most reassuring, most dangerous line on the page;
 *   - a failed read NAMES its register and carries the gateway's own sentence,
 *     rather than rendering as an empty list;
 *   - an unknown is an em dash, never a zero;
 *   - the four columns are on every row, and a row with no control says who
 *     can stop it;
 *   - "house declares, each person consents" and "per-tool grant plus the seal
 *     on every write" are both visible on a model-context row;
 *   - a manager can stop the house using a personal grant but is never offered
 *     a way to revoke it, and is never offered an approval.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

const mockData = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));

vi.mock('./useConnectionsNextData', () => ({
  useConnectionsNextData: () => mockData.current,
}));

/**
 * Stripe.js, stubbed at the LOADER.
 *
 * The real module injects a `<script>` from `js.stripe.com` and hands back
 * whatever `window.Stripe` becomes; in jsdom that is a network call that never
 * resolves. Stubbing the loader rather than the panel keeps the panel itself —
 * its four phases, its copy and its hold — under test, which is the half that
 * can regress.
 */
const stripeJs = vi.hoisted(() => {
  const element = { mount: vi.fn(), unmount: vi.fn(), destroy: vi.fn(), on: vi.fn() };
  const elements = {
    create: vi.fn(() => element),
    getElement: vi.fn(() => element),
    submit: vi.fn(async () => ({}) as { error?: { message?: string } }),
  };
  const instance = {
    elements: vi.fn(() => elements),
    confirmSetup: vi.fn(async () => ({
      setupIntent: { id: 'seti_1', status: 'succeeded' },
    })),
  };
  return { element, elements, instance, loadStripe: vi.fn(async () => instance) };
});

vi.mock('../../../components/mudavym/stripe-js', () => ({
  loadStripe: stripeJs.loadStripe,
  stripePublishableKey: () => 'pk_test_stub',
}));

import ConnectionsNext from './ConnectionsNext';

/**
 * A register as the page consumes it.
 *
 * Deliberately loose: these tests substitute one register's shape for another's
 * (a POS status becomes an unread register, a server list becomes an error), and
 * a narrowly-inferred fixture would make each of those a type error about the
 * TEST rather than a statement about the page.
 */
interface Reg {
  data: unknown;
  loading: boolean;
  error: string | null;
  refused: boolean;
}

const reg = (data: unknown, over: Partial<Reg> = {}): Reg => ({
  data,
  loading: false,
  error: null,
  refused: false,
  ...over,
});

interface Tally {
  house: number | null;
  persons: number | null;
  canSpend: number | null;
  mayCallATool: number | null;
  mayWrite: number | null;
  publicToAnyone: number | null;
  houseHasLetGoOf: number | null;
}

interface Fixture {
  /** So a fixture can be handed to the hoisted mock, which is keyed loosely. */
  [key: string]: unknown;
  restaurantId: string;
  userId: string;
  role: string;
  isManager: boolean;
  pos: Reg;
  provider: Reg;
  payments: Reg;
  sender: Reg;
  ical: Reg;
  mcp: Reg;
  mcpRuntime: Reg;
  houseGrants: Reg;
  catalog: Reg;
  tally: Tally;
  regenerateFeed: unknown;
  setHouseGrantAccess: unknown;
  setConsent: unknown;
  /** Mints the one-time seal when a re-consent hold begins. */
  grantSeal: unknown;
  grantTool: unknown;
  revokeTool: unknown;
  probeServer: unknown;
  /** Mints the one-time seal when a payment hold begins. */
  paymentSeal: unknown;
  setDefaultPayment: unknown;
  removePayment: unknown;
  /* `CardPanelClient` — what the shared card panel asks this hook for. */
  createSetupIntent: unknown;
  syncPayments: unknown;
  /** The BROWSER's half of the Stripe credential. Null is a state, not a gap. */
  stripePublishableKey: string | null;
}

const setHouseGrantAccess = { mutate: vi.fn(), isPending: false };
const setConsent = { mutate: vi.fn(), isPending: false };
const probeServer = { mutate: vi.fn(), isPending: false };
const regenerateFeed = { mutate: vi.fn(), isPending: false };

function base(): Fixture {
  return {
    restaurantId: 'r1',
    userId: 'u1',
    role: 'owner',
    isManager: true,
    pos: reg({ unavailable: false, totalChecks: 41208, sources: [], windowDays: 30 }),
    provider: reg({
      connected: false,
      mode: null,
      reason: 'STRIPE_SECRET_KEY is not set',
      secrets: { secretKey: false },
      webhookLastReceivedAt: null,
      webhookReason: 'No signed delivery has ever been authenticated here.',
    }),
    payments: reg({ provider: { connected: false, mode: null, reason: null }, methods: [] }),
    sender: reg({
      address: 'notifications@wineops.ai',
      scope: 'deployment',
      configuredBy: 'GMAIL_SENDER_EMAIL',
      resolvedFromProfile: false,
      perHouse: { supported: false, reason: 'No per-restaurant sender exists.' },
    }),
    ical: reg({ token: 'abc123' }),
    mcp: reg([]),
    mcpRuntime: reg({
      secretStorage: { configured: true, reason: null },
      invocation: { enabled: true, reason: 'A tool runs only if a manager granted it by name.' },
      probeTimeoutMs: 8000,
    }),
    houseGrants: reg({ grants: [], unattributed: 0 }),
    catalog: reg([]),
    tally: {
      house: 3,
      persons: 0,
      canSpend: 0,
      mayCallATool: 0,
      mayWrite: 0,
      publicToAnyone: 1,
      houseHasLetGoOf: 0,
    },
    regenerateFeed,
    setHouseGrantAccess,
    setConsent,
    // Resolves a token by default, so a test that completes the gesture without
    // caring about the seal does not silently exercise the failure path.
    grantSeal: vi.fn(async () => 'tok-default'),
    grantTool: { mutate: vi.fn(), isPending: false },
    revokeTool: { mutate: vi.fn(), isPending: false },
    probeServer,
    // Same rule as `grantSeal`: resolves a token by default so a test that
    // completes a payment gesture does not silently take the failure path.
    paymentSeal: vi.fn(async () => 'tok-pay'),
    setDefaultPayment: {
      mutate: vi.fn(),
      isPending: false,
      isError: false,
      error: null,
      variables: undefined,
    },
    removePayment: {
      mutate: vi.fn(),
      isPending: false,
      isError: false,
      error: null,
      variables: undefined,
    },
    createSetupIntent: vi.fn(async () => ({
      clientSecret: 'seti_1_secret_x',
      setupIntentId: 'seti_1',
      livemode: false,
    })),
    syncPayments: vi.fn(async () => ({
      syncedAt: '2026-09-05T08:00:00.000Z',
      kept: 1,
      removed: 0,
      note: null,
    })),
    // Null by DEFAULT, because that is what this deployment's bundle holds. A
    // fixture that shipped a key would make every other test render a card form
    // the product cannot open, and would hide the reason sentence that matters
    // most here.
    stripePublishableKey: null,
  };
}

/** One instrument as `GET /payment-methods` returns it. */
const instrument = (over: Record<string, unknown> = {}) => ({
  id: 'pm-1',
  brand: 'visa',
  last4: '4242',
  expMonth: 4,
  expYear: 2029,
  isDefault: false,
  ...over,
});

const server = (over: Record<string, unknown> = {}) => ({
  id: 's1',
  name: 'Toast bridge',
  url: 'https://mcp.example.test/toast',
  scopes: ['checks:read'],
  createdAt: '2026-09-01T00:00:00.000Z',
  lastUsedAt: null,
  lastProbeAt: null,
  revokedAt: null,
  status: 'active',
  declaredBy: 'u-hasan',
  declaredByName: 'Hasan Demir',
  hasSecret: true,
  secretSetAt: '2026-09-01T00:00:00.000Z',
  consent: { given: false, at: null, liveCount: 0 },
  toolGrants: [],
  probe: null,
  ...over,
});

/** One tool as the last probe recorded it, annotations and all. */
const listed = (
  name: string,
  annotations: Record<string, unknown> | null,
) => ({
  name,
  title: null,
  description: null,
  annotations: annotations
    ? {
        readOnlyHint: null,
        destructiveHint: null,
        idempotentHint: null,
        openWorldHint: null,
        ...annotations,
      }
    : null,
});

const probeWith = (tools: unknown[]) => ({
  status: 'ok',
  detail: `Connected. ${tools.length} tools listed.`,
  serverName: 'toast',
  serverVersion: '1',
  protocolVersion: '2025-06-18',
  tools,
  toolCount: tools.length,
});

/** One grant, with the declaration it was made against. */
const granted = (toolName: string, over: Record<string, unknown> = {}) => ({
  toolName,
  writes: false,
  declaredRead: true,
  declaredAnnotations: null,
  classificationSource: 'declared',
  needsReconsentAt: null,
  needsReconsentReason: null,
  toolListHash: 'abc',
  lastSeal: null,
  grantedBy: 'u1',
  grantedByName: 'Hasan',
  grantedAt: '2026-09-03T00:00:00.000Z',
  ...over,
});

const grant = (over: Record<string, unknown> = {}) => ({
  connectionId: 'c1',
  integrationId: 'google_drive',
  provider: 'google',
  label: 'Google Drive',
  ownerUserId: 'u-selin',
  ownerName: 'Selin Kara',
  ownerEmail: 'selin@example.test',
  account: 'selin@example.test',
  scopes: ['drive.file'],
  connectedAt: '2026-08-22T00:00:00.000Z',
  tokenExpiresAt: null,
  houseAccess: { revoked: false, at: null, by: null, byName: null, reason: null },
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  mockData.current = base();
});

describe('who may look', () => {
  it('refuses a non-manager in words, and says the server refuses as well', () => {
    mockData.current = { ...base(), isManager: false, role: 'staff' };
    render(<ConnectionsNext />);

    expect(
      screen.getByText(/this page is for managers and owners/i),
    ).toBeInTheDocument();
    // The distinction that matters: not merely a hidden page.
    expect(screen.getByText(/refused at the server/i)).toBeInTheDocument();
    expect(screen.queryByText(/what the house pays with/i)).not.toBeInTheDocument();
  });
});

describe('the ledger sentence', () => {
  it('says nothing can spend only when it MEASURED zero', () => {
    render(<ConnectionsNext />);
    expect(screen.getByText(/nothing here can spend money today/i)).toBeInTheDocument();
    expect(screen.getByText(/none may call a tool/i)).toBeInTheDocument();
  });

  it('refuses to say it when the payment register did not answer', () => {
    const d = base();
    d.tally = { ...d.tally, canSpend: null };
    d.payments = reg(null, { error: 'connection reset' });
    mockData.current = d;
    render(<ConnectionsNext />);

    // The whole point. A failed read must not produce the most reassuring
    // sentence on the page.
    expect(screen.queryByText(/nothing here can spend money today/i)).not.toBeInTheDocument();
    expect(
      screen.getByText(/whether anything here can spend is unknown/i),
    ).toBeInTheDocument();
  });

  it('renders an unread count as an em dash, never as zero', () => {
    const d = base();
    d.tally = { ...d.tally, persons: null };
    mockData.current = d;
    const { container } = render(<ConnectionsNext />);

    const tally = container.querySelectorAll('.cx-tally-n');
    const values = Array.from(tally).map((n) => n.textContent);
    expect(values).toContain('—');
  });
});

describe('a register that could not be read', () => {
  it('is NAMED, and carries the gateway’s own sentence', () => {
    const d = base();
    d.mcp = reg(null, { error: 'The model-context register could not be read: deadlock detected' });
    mockData.current = d;
    render(<ConnectionsNext />);

    expect(screen.getByText(/the model-context register could not be read\./i)).toBeInTheDocument();
    expect(screen.getByText(/deadlock detected/)).toBeInTheDocument();
    // Not an empty list pretending nothing is declared.
    expect(screen.getByText(/silence is not the same as nothing/i)).toBeInTheDocument();
  });

  it('says so differently when the refusal is about the reader', () => {
    const d = base();
    d.payments = reg(null, {
      error: 'Only managers and owners can see how the house pays',
      refused: true,
    });
    mockData.current = d;
    render(<ConnectionsNext />);

    expect(screen.getByText(/refused this read for your role/i)).toBeInTheDocument();
  });

  it('does not turn a dead POS read into "0 checks"', () => {
    const d = base();
    d.pos = reg({ unavailable: true, totalChecks: null, sources: null, windowDays: 30 });
    mockData.current = d;
    render(<ConnectionsNext />);

    expect(screen.getByText(/could not be read, so this is silence rather than zero/i)).toBeInTheDocument();
    expect(screen.queryByText('0 checks')).not.toBeInTheDocument();
  });
});

describe('the one row, four columns and no fifth', () => {
  it('gives a row with no live control a sentence saying who can stop it', () => {
    render(<ConnectionsNext />);

    // The till: there is no disconnect endpoint anywhere on pos-hub.
    const disconnect = screen.getByRole('button', { name: 'Disconnect' });
    expect(disconnect).toBeDisabled();
    expect(
      screen.getByText(/no disconnect endpoint exists/i),
    ).toBeInTheDocument();
  });

  it('states that no public page exists for a house rather than drawing one', () => {
    render(<ConnectionsNext />);
    expect(screen.getByText(/public page for this house/i)).toBeInTheDocument();
    expect(screen.getByText(/its table has no restaurant column at all/i)).toBeInTheDocument();
  });

  it('offers the calendar feed as a real address and a real regenerate', () => {
    render(<ConnectionsNext />);
    fireEvent.click(screen.getByRole('button', { name: 'Regenerate' }));
    expect(regenerateFeed.mutate).toHaveBeenCalled();
  });
});

describe('house declares, each person consents', () => {
  it('names the declarer, shows the consent state, and offers only the reader’s own consent', () => {
    const d = base();
    d.mcp = reg([server()]);
    mockData.current = d;
    render(<ConnectionsNext />);

    expect(screen.getByText(/declared by hasan demir/i)).toBeInTheDocument();
    expect(screen.getByText(/you have not consented/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Consent' }));
    expect(setConsent.mutate).toHaveBeenCalledWith({ id: 's1', given: true });
  });

  it('says an attachment whose declarer is gone is still the house’s', () => {
    const d = base();
    d.mcp = reg([server({ declaredBy: null, declaredByName: null })]);
    mockData.current = d;
    render(<ConnectionsNext />);

    expect(screen.getByText(/declared by an account since deleted/i)).toBeInTheDocument();
  });

  it('says nothing about the tools of a server that has never listed any', () => {
    const d = base();
    d.mcp = reg([server()]);
    mockData.current = d;
    render(<ConnectionsNext />);

    // Not an empty list, which would read as "it offers nothing".
    expect(
      screen.getByText(/has not answered with a tool list, so what it offers is unknown/i),
    ).toBeInTheDocument();
  });

  it('marks a granted write tool on the row', () => {
    const d = base();
    d.mcp = reg([
      server({
        consent: { given: true, at: '2026-09-02T00:00:00.000Z', liveCount: 2 },
        probe: probeWith([listed('place_order', { readOnlyHint: false })]),
        toolGrants: [granted('place_order', { writes: true, declaredRead: false })],
      }),
    ]);
    d.tally = { ...d.tally, mayCallATool: 1, mayWrite: 1 };
    mockData.current = d;
    render(<ConnectionsNext />);

    expect(
      screen.getByText(
        'place_order — the server declares it changes things · granted as a write, behind the seal · never called behind a seal',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(/can write outside/i)).toBeInTheDocument();
    // And the ledger sentence stops saying "none may call a tool".
    expect(screen.queryByText(/none may call a tool/i)).not.toBeInTheDocument();
  });

  /* ── server-declared, manager-confirmed, re-consent on change ────────── */

  it('shows a listed tool nobody granted as refused rather than omitting it', () => {
    const d = base();
    d.mcp = reg([
      server({ probe: probeWith([listed('drop_table', { readOnlyHint: false })]) }),
    ]);
    mockData.current = d;
    render(<ConnectionsNext />);

    expect(
      screen.getByText(
        'drop_table — the server declares it changes things · not granted',
      ),
    ).toBeInTheDocument();
  });

  it('says when a tool counts as a write because the server declared NOTHING', () => {
    const d = base();
    d.mcp = reg([server({ probe: probeWith([listed('mystery', null)]) })]);
    mockData.current = d;
    render(<ConnectionsNext />);

    expect(
      screen.getByText(/the server declares nothing about it, so it counts as a write/i),
    ).toBeInTheDocument();
  });

  it('names a manager override as an override, not as the server’s own word', () => {
    const d = base();
    d.mcp = reg([
      server({
        probe: probeWith([listed('list_checks', { readOnlyHint: true })]),
        toolGrants: [
          granted('list_checks', {
            writes: true,
            declaredRead: true,
            classificationSource: 'manager_override',
            // A redeemed one-time challenge, not a claimed boolean.
            lastSeal: 'proven',
          }),
        ],
      }),
    ]);
    mockData.current = d;
    render(<ConnectionsNext />);

    expect(
      screen.getByText(
        'list_checks — the server declares it read-only · granted as a write by a manager overriding the server · last seal: proven',
      ),
    ).toBeInTheDocument();
  });

  it('does not let an unchecked seal borrow a proven one’s word', () => {
    // "sealed" was true of a redeemed one-time challenge AND of a boolean the
    // client set on itself. Printing one word for both is how the weaker one
    // borrows the stronger one's credibility.
    const d = base();
    d.mcp = reg([
      server({
        probe: probeWith([listed('place_order', { readOnlyHint: false })]),
        toolGrants: [
          granted('place_order', {
            writes: true,
            declaredRead: false,
            lastSeal: 'asserted',
          }),
        ],
      }),
    ]);
    mockData.current = d;
    render(<ConnectionsNext />);

    expect(
      screen.getByText(/last seal: asserted, never checked/i),
    ).toBeInTheDocument();
  });

  it('states what changed on a suspended grant, and offers re-consent behind the seal', async () => {
    const d = base();
    const grantTool = { mutate: vi.fn(), isPending: false };
    const grantSeal = vi.fn(async () => 'tok-reconsent');
    d.grantTool = grantTool;
    d.grantSeal = grantSeal;
    d.mcp = reg([
      server({
        consent: { given: true, at: '2026-09-02T00:00:00.000Z', liveCount: 1 },
        // The server now says it is NOT read-only. It said the opposite when
        // the grant was made.
        probe: probeWith([listed('list_checks', { readOnlyHint: false })]),
        toolGrants: [
          granted('list_checks', {
            writes: false,
            declaredRead: true,
            needsReconsentAt: '2026-09-04T09:00:00.000Z',
            needsReconsentReason: 'the server changed readOnlyHint true to false',
          }),
        ],
      }),
    ]);
    mockData.current = d;
    render(<ConnectionsNext />);

    expect(
      screen.getByText(
        /Needs re-consent — list_checks: the server changed readOnlyHint true to false/i,
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(/1 needs re-consent/i)).toBeInTheDocument();
    expect(
      screen.getByText(/list_checks — .* · granted, SUSPENDED until re-consent/),
    ).toBeInTheDocument();

    // A HOLD, not a click (audit, 2026-09-04). One press ARMS the gesture and
    // mints the seal; nothing is sent. That is the assertion this control used
    // to make on its own behalf, and the point of the fix is that a single
    // click can no longer make it.
    const button = screen.getByRole('button', {
      name: 'Re-consent list_checks as a write',
    });
    fireEvent.keyDown(button, { key: 'Enter' });
    await waitFor(() => expect(grantSeal).toHaveBeenCalledTimes(1));
    expect(grantSeal).toHaveBeenCalledWith({
      id: 's1',
      tool: 'list_checks',
      writes: true,
    });
    expect(grantTool.mutate).not.toHaveBeenCalled();

    // Completing the gesture sends the grant, carrying the REDEEMED-ONCE token
    // and no `sealed` flag — whether it was sealed is the gateway's finding,
    // not this page's claim. And it re-grants against what the server says NOW.
    fireEvent.keyDown(button, { key: 'Enter' });
    await waitFor(() =>
      expect(grantTool.mutate).toHaveBeenCalledWith({
        id: 's1',
        tool: 'list_checks',
        writes: true,
        challenge: 'tok-reconsent',
      }),
    );
  });

  it('sends nothing when the seal cannot be issued', async () => {
    const d = base();
    const grantTool = { mutate: vi.fn(), isPending: false };
    d.grantTool = grantTool;
    // The gateway refused to mint one — the tool is no longer grantable, the
    // role changed, the register is down. Whatever the cause, the honest
    // outcome is that nothing is granted and the row says so.
    d.grantSeal = vi.fn(async () => null);
    d.mcp = reg([
      server({
        probe: probeWith([listed('list_checks', { readOnlyHint: false })]),
        toolGrants: [
          granted('list_checks', {
            writes: false,
            declaredRead: true,
            needsReconsentAt: '2026-09-04T09:00:00.000Z',
            needsReconsentReason: 'the server changed readOnlyHint true to false',
          }),
        ],
      }),
    ]);
    mockData.current = d;
    render(<ConnectionsNext />);

    const button = screen.getByRole('button', {
      name: 'Re-consent list_checks as a write',
    });
    fireEvent.keyDown(button, { key: 'Enter' });
    fireEvent.keyDown(button, { key: 'Enter' });

    expect(
      await screen.findByText(/the seal could not be issued — nothing sent/i),
    ).toBeInTheDocument();
    expect(grantTool.mutate).not.toHaveBeenCalled();
  });

  it('does not dress an unsealed action in the seal', () => {
    // The calendar feed's "Regenerate" wore the seal's ring while being an
    // ordinary click, so the seal meant "this matters" on one row and "this was
    // proven" on another. Only a hold-to-approve renders the seal now.
    const d = base();
    d.ical = reg({ token: 'tok-abc' });
    mockData.current = d;
    render(<ConnectionsNext />);

    const regenerate = screen.getByRole('button', { name: /^Regenerate/ });
    expect(regenerate.className).not.toContain('is-seal');
  });

  it('reports a never-probed server as never called, not as healthy', () => {
    const d = base();
    d.mcp = reg([server()]);
    mockData.current = d;
    const { container } = render(<ConnectionsNext />);

    const rows = container.querySelectorAll('.cx-row.is-nested');
    expect(rows.length).toBe(1);
    expect(within(rows[0] as HTMLElement).getAllByText(/never called/i).length).toBeGreaterThan(0);
  });
});

describe('a manager may see, not approve', () => {
  it('names the owner of a personal grant and offers to stop the house using it', () => {
    const d = base();
    d.houseGrants = reg({ grants: [grant()], unattributed: 0 });
    mockData.current = d;
    render(<ConnectionsNext />);

    expect(screen.getByText(/selin kara's/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /stop the house using it/i }));
    expect(setHouseGrantAccess.mutate).toHaveBeenCalledWith({
      connectionId: 'c1',
      houseUses: false,
    });
  });

  it('never offers to revoke somebody else’s grant, and never offers an approval', () => {
    const d = base();
    d.houseGrants = reg({ grants: [grant()], unattributed: 0 });
    mockData.current = d;
    render(<ConnectionsNext />);

    expect(screen.queryByRole('button', { name: /^revoke/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /approve/i })).not.toBeInTheDocument();
    expect(
      screen.getByText(/only selin kara can revoke the grant itself/i),
    ).toBeInTheDocument();
  });

  it('counts the grants that carry no recorded restaurant rather than dropping them', () => {
    const d = base();
    d.houseGrants = reg({ grants: [], unattributed: 2 });
    mockData.current = d;
    render(<ConnectionsNext />);

    expect(screen.getByText(/carry no recorded restaurant/i)).toBeInTheDocument();
    expect(screen.getByText(/they still work/i)).toBeInTheDocument();
  });

  it('draws an unconnected catalogue entry at the same weight as a live row', () => {
    const d = base();
    d.catalog = reg([
      {
        id: 'excel',
        provider: 'microsoft',
        label: 'Microsoft Excel',
        providerLabel: 'Microsoft',
        description: 'Write inventory workbooks.',
        available: true,
        unavailableReason: null,
      },
    ]);
    mockData.current = d;
    const { container } = render(<ConnectionsNext />);

    expect(screen.getByText('Microsoft Excel')).toBeInTheDocument();
    expect(screen.getByText(/must not look smaller than one they have/i)).toBeInTheDocument();
    // Same component, so the same four columns.
    const rows = Array.from(container.querySelectorAll('.cx-row'));
    const excel = rows.find((r) => r.textContent?.includes('Microsoft Excel'));
    expect(excel?.querySelectorAll('.cx-col-h').length).toBe(2);
    expect(excel?.querySelector('.cx-ctl-note')).toBeTruthy();
  });

  /**
   * Until 2026-09-04 both of these rows printed the same two hard-coded lines —
   * "Create and edit files it made" and "Never mail, never other documents" —
   * which are Drive's promise and are false for the send-only mailbox. The
   * bullets now come from each integration's own catalogue entry, so the test
   * is one render with both rows on it.
   */
  it('gives each unconnected integration ITS OWN permission bullets, never a neighbour’s', () => {
    const d = base();
    d.catalog = reg([
      {
        id: 'google_drive',
        provider: 'google',
        label: 'Google Drive',
        providerLabel: 'Google',
        description: 'Save exports to a folder in your Drive.',
        available: true,
        unavailableReason: null,
        scopes: [
          {
            scope: 'https://www.googleapis.com/auth/drive.file',
            label: 'Create and manage files WineOps puts in your Drive',
          },
        ],
        notRequested: ['Your Gmail messages'],
      },
      {
        id: 'gmail_send',
        provider: 'google',
        label: 'Gmail — sending only',
        providerLabel: 'Google',
        description: 'Letters leave from your own mailbox.',
        available: true,
        unavailableReason: null,
        scopes: [
          {
            scope: 'https://www.googleapis.com/auth/gmail.send',
            label: 'Send mail as you — and nothing else',
          },
        ],
        notRequested: ['Reading, searching or listing any message in your mailbox'],
      },
    ]);
    mockData.current = d;
    const { container } = render(<ConnectionsNext />);

    const rows = Array.from(container.querySelectorAll('.cx-row'));
    const scopeOf = (title: string) =>
      rows.find((r) => r.textContent?.includes(title))?.querySelector('.cx-scope')?.textContent ??
      '';

    const driveScope = scopeOf('Google Drive');
    expect(driveScope).toContain('Create and manage files WineOps puts in your Drive');
    expect(driveScope).toContain('Your Gmail messages');

    const gmailScope = scopeOf('Gmail — sending only');
    expect(gmailScope).toContain('Send mail as you');
    expect(gmailScope).toContain('Reading, searching or listing any message in your mailbox');
    // The three ways the old hard-coded pair was wrong about this integration.
    expect(gmailScope).not.toMatch(/files/i);
    expect(gmailScope).not.toMatch(/never mail/i);
    expect(gmailScope).not.toMatch(/other documents/i);
  });

  it('shows the em dash rather than a guessed permission when the catalogue carries no scopes', () => {
    const d = base();
    d.catalog = reg([
      {
        id: 'gmail_send',
        provider: 'google',
        label: 'Gmail — sending only',
        providerLabel: 'Google',
        description: 'Letters leave from your own mailbox.',
        available: true,
        unavailableReason: null,
      },
    ]);
    mockData.current = d;
    const { container } = render(<ConnectionsNext />);

    const row = Array.from(container.querySelectorAll('.cx-row')).find((r) =>
      r.textContent?.includes('Gmail — sending only'),
    );
    const scope = row?.querySelector('.cx-scope');
    expect(scope?.querySelector('ul')).toBeNull();
    expect(scope?.textContent).toContain('—');
  });

  it('describes a live personal grant by the scopes THAT grant holds', () => {
    const d = base();
    d.houseGrants = reg({
      grants: [
        grant({
          integrationId: 'gmail_send',
          label: 'Gmail — sending only',
          scopes: ['https://www.googleapis.com/auth/gmail.send'],
        }),
      ],
      unattributed: 0,
    });
    d.catalog = reg([
      {
        id: 'gmail_send',
        provider: 'google',
        label: 'Gmail — sending only',
        providerLabel: 'Google',
        description: 'Letters leave from your own mailbox.',
        available: true,
        unavailableReason: null,
        scopes: [
          {
            scope: 'https://www.googleapis.com/auth/gmail.send',
            label: 'Send mail as you — and nothing else',
          },
        ],
        notRequested: ['Reading, searching or listing any message in your mailbox'],
      },
    ]);
    mockData.current = d;
    const { container } = render(<ConnectionsNext />);

    const row = Array.from(container.querySelectorAll('.cx-row')).find((r) =>
      r.textContent?.includes("Selin Kara's"),
    );
    const scope = row?.querySelector('.cx-scope')?.textContent ?? '';
    expect(scope).toContain('Send mail as you');
    expect(scope).not.toMatch(/files it made/i);
    expect(scope).not.toMatch(/cannot touch their mail/i);
  });
});

describe('the sender identity', () => {
  it('says the address is the deployment’s and the control is not available', () => {
    render(<ConnectionsNext />);

    expect(screen.getByText(/shared, not yours/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /use our own address/i })).toBeDisabled();
    expect(screen.getByText(/no per-restaurant sender exists/i)).toBeInTheDocument();
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   THE COLLAPSE, 2026-09-04 — what arrived here when `/profile` and `/settings`
   gave things up. Anchors for four retired `?tab=` links, and the two manager
   acts that would otherwise have been deleted rather than moved.
   ═══════════════════════════════════════════════════════════════════════════ */

describe('the collapse — anchors and the acts that moved', () => {
  it('answers every fragment a retired `?tab=` link now redirects to', () => {
    const d = base();
    d.mcp = reg([server()]);
    mockData.current = d;
    const { container } = render(<ConnectionsNext />);

    // A fragment nothing answers to is a link that silently does nothing, so
    // each anchor must exist on the rendered page, not merely in the mapping.
    for (const anchor of ['attached', 'till', 'sender', 'feed', 'servers', 'payment', 'grants', 'deployment']) {
      expect(container.querySelector(`#${anchor}`)).not.toBeNull();
    }
  });

  it('offers declaring a server here, and no longer points at /profile for it', () => {
    const d = base();
    d.mcp = reg([server()]);
    mockData.current = d;
    render(<ConnectionsNext />);

    expect(screen.getByRole('button', { name: /declare a server/i })).toBeEnabled();
    expect(screen.queryByText(/it is on \/profile until this register moves fully/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Revoking the attachment itself is a manager action on \/profile/i)).not.toBeInTheDocument();
  });

  it('refuses to submit a declaration that could not be stored, and says what is missing', () => {
    const d = base();
    d.mcp = reg([server()]);
    mockData.current = d;
    render(<ConnectionsNext />);

    fireEvent.click(screen.getByRole('button', { name: /declare a server/i }));
    expect(screen.getByRole('button', { name: 'Declare server' })).toBeDisabled();
    expect(
      screen.getByText(/A name of at least two characters and an http\(s\) endpoint are needed\./),
    ).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'House bridge' } });
    fireEvent.change(screen.getByLabelText('Endpoint'), { target: { value: 'https://mcp.example.test' } });
    expect(screen.getByRole('button', { name: 'Declare server' })).toBeEnabled();
  });

  it('disables the credential field with the deployment’s own reason, never a blank one', () => {
    const d = base();
    d.mcp = reg([server()]);
    d.mcpRuntime = reg({
      secretStorage: {
        configured: false,
        reason: 'MCP_CONNECTION_SECRET_KEY is not set, so a secret cannot be stored or read.',
      },
      invocation: { enabled: true, reason: 'A tool runs only if a manager granted it by name.' },
      probeTimeoutMs: 8000,
    });
    mockData.current = d;
    render(<ConnectionsNext />);

    fireEvent.click(screen.getByRole('button', { name: /declare a server/i }));
    // Disabled AND carrying the server's own sentence — a field that accepted a
    // secret the deployment would drop is worse than no field.
    expect(screen.getByLabelText('Credential')).toBeDisabled();
    expect(screen.getAllByText(/MCP_CONNECTION_SECRET_KEY is not set/).length).toBeGreaterThan(0);
  });

  it('says nothing about storing a credential when the deployment did not report', () => {
    const d = base();
    d.mcp = reg([server()]);
    d.mcpRuntime = reg(null, { error: 'the runtime register did not answer' });
    mockData.current = d;
    render(<ConnectionsNext />);

    fireEvent.click(screen.getByRole('button', { name: /declare a server/i }));
    expect(screen.getByLabelText('Credential')).toBeDisabled();
    expect(
      screen.getByText(/did not report whether it can store a credential/),
    ).toBeInTheDocument();
  });

  it('puts revoking behind the seal, once per live server', () => {
    const d = base();
    d.mcp = reg([server(), server({ id: 's2', name: 'Square bridge', status: 'revoked' })]);
    mockData.current = d;
    render(<ConnectionsNext />);

    expect(screen.getByRole('button', { name: 'Hold to revoke Toast bridge' })).toBeInTheDocument();
    // A revoked row keeps its place in the register and gains no second revoke.
    expect(screen.queryByRole('button', { name: 'Hold to revoke Square bridge' })).not.toBeInTheDocument();
  });

  it('names the credential that is missing, not a page that no longer holds the panel', () => {
    // The collapse's subtraction, re-pinned from the other side (2026-09-05).
    // This test used to assert the control was disabled BECAUSE the panel had
    // not been ported — a claim about our own backlog, printed to an operator.
    // The control is still disabled in this fixture, and the sentence is now
    // about the deployment: a provider is connected, the bundle has no key.
    const d = base();
    d.payments = reg({
      provider: { connected: true, reason: null },
      methods: [],
    });
    mockData.current = d;
    render(<ConnectionsNext />);

    expect(screen.getByRole('button', { name: 'Add a card' })).toBeDisabled();
    expect(
      screen.getByText(/VITE_STRIPE_PUBLISHABLE_KEY is not set in this web bundle/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/has not been rebuilt here yet/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Adding a card happens on \/profile/)).not.toBeInTheDocument();
  });

  it("prefers the gateway's own reason when the provider itself is unkeyed", () => {
    const d = base();
    d.payments = reg({
      provider: {
        connected: false,
        reason: 'STRIPE_SECRET_KEY is not set on this deployment.',
      },
      methods: [],
    });
    mockData.current = d;
    render(<ConnectionsNext />);

    expect(screen.getByRole('button', { name: 'Add a card' })).toBeDisabled();
    // The gateway's sentence, so the disabled control and the 503 the create
    // path would answer with say the same thing.
    expect(
      screen.getByText(/STRIPE_SECRET_KEY is not set on this deployment\./),
    ).toBeInTheDocument();
  });
});

/**
 * G-C9's other half — the card panel is HERE, and it is the same one.
 *
 * The collapse moved Register II to this page and left `StripeCardPanel` on
 * `/profile`, so adding a card had no home at all while the flag was on. The
 * panel is now `components/mudavym/StripeCardPanel`, rendered by both pages.
 *
 * Every test below pins something that would otherwise rot quietly:
 *   - the button exists in exactly ONE place at a time;
 *   - opening it asks the GATEWAY for a SetupIntent before it fetches a script,
 *     so a refusal is the provider's sentence and not a loading state;
 *   - the panel says, in words, that adding a card is NOT sealed — the one
 *     payment act with no redeemed token (G-PAY-SETUP), and the thing a reader
 *     would otherwise assume from the hold's appearance;
 *   - a completed hold reconciles against the provider rather than drawing the
 *     row from the confirmation.
 */
describe('the card panel is on this page, and claims no seal it never redeems', () => {
  const keyed = (over: Record<string, unknown> = {}) => {
    const d = base();
    d.payments = reg({
      provider: { connected: true, reason: null },
      methods: [],
    });
    d.stripePublishableKey = 'pk_test_stub';
    return { ...d, ...over };
  };

  it('opens the provider’s own card fields from the empty register’s control', async () => {
    const d = keyed();
    mockData.current = d;
    render(<ConnectionsNext />);

    const add = screen.getByRole('button', { name: 'Add a card' });
    expect(add).not.toBeDisabled();
    fireEvent.click(add);

    expect(await screen.findByText('Add a card', { selector: 'h3' })).toBeInTheDocument();
    // The intent is minted BEFORE Stripe.js is fetched: a gateway that refuses
    // must produce its own sentence, not a script that loads and then has
    // nothing to confirm.
    await waitFor(() => expect(d.createSetupIntent).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(stripeJs.loadStripe).toHaveBeenCalledWith('pk_test_stub'));
  });

  it('says the add is not sealed, while the two row acts are', async () => {
    const d = keyed();
    mockData.current = d;
    render(<ConnectionsNext />);
    fireEvent.click(screen.getByRole('button', { name: 'Add a card' }));

    // Scoped to the panel's own note, so the assertion cannot be satisfied by
    // the word appearing anywhere else on the page later.
    const note = await screen.findByText(/not a seal the server/i);
    expect(note.textContent).toMatch(/G-PAY-SETUP/);
    // And nothing minted a challenge for it — a `create` token would be one no
    // request ever spends.
    expect(d.paymentSeal).not.toHaveBeenCalled();
  });

  it('reconciles against the provider on a completed hold, rather than drawing the row itself', async () => {
    const d = keyed();
    mockData.current = d;
    render(<ConnectionsNext />);
    fireEvent.click(screen.getByRole('button', { name: 'Add a card' }));

    const hold = await screen.findByRole('button', {
      name: 'Hold to put this card on file',
    });
    await waitFor(() => expect(hold).not.toBeDisabled());
    fireEvent.keyDown(hold, { key: 'Enter' });
    fireEvent.keyDown(hold, { key: 'Enter' });

    await waitFor(() => expect(stripeJs.instance.confirmSetup).toHaveBeenCalled());
    await waitFor(() => expect(d.syncPayments).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/reconciled against the provider/)).toBeInTheDocument();
  });

  it('shows the provider’s own refusal when the intent cannot be minted, and stores nothing', async () => {
    const d = keyed({
      createSetupIntent: vi.fn(async () => {
        throw new Error('Stripe is not configured on this deployment.');
      }),
    });
    mockData.current = d;
    render(<ConnectionsNext />);
    fireEvent.click(screen.getByRole('button', { name: 'Add a card' }));

    expect(
      await screen.findByText(/Stripe is not configured on this deployment\./),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/no\s+instrument was created at the provider/i),
    ).toBeInTheDocument();
    expect(stripeJs.loadStripe).not.toHaveBeenCalled();
  });

  it('offers the add in exactly one place — the row when empty, the bar when not', () => {
    const empty = keyed();
    mockData.current = empty;
    const { unmount } = render(<ConnectionsNext />);
    expect(screen.getAllByRole('button', { name: 'Add a card' })).toHaveLength(1);
    expect(
      screen.getByRole('button', { name: 'Add a card' }).closest('.cx-row'),
    ).not.toBeNull();
    unmount();

    const withOne = keyed();
    withOne.payments = reg({
      provider: { connected: true, reason: null },
      methods: [instrument()],
    });
    mockData.current = withOne;
    render(<ConnectionsNext />);
    expect(screen.getAllByRole('button', { name: 'Add a card' })).toHaveLength(1);
    expect(
      screen.getByRole('button', { name: 'Add a card' }).closest('.cx-add'),
    ).not.toBeNull();
  });
});

/**
 * G-PAY-SEAL and half of G-C9 — Register II can act again, and every act is
 * held.
 *
 * The collapse moved the payment register here and left both controls
 * disabled, because the client that performed them stayed on `/profile`. They
 * are back, and they arrive sealed: ADR 0110's addendum made
 * `PATCH /payment-methods/:id/default` and `DELETE /payment-methods/:id`
 * redeem a one-time token, so a plain button here would be a control that
 * always fails. Each test pins one half of that.
 */
describe('the payment register acts, and every act is held', () => {
  const withCard = (over: Record<string, unknown> = {}) => {
    const d = base();
    d.payments = reg({
      provider: { connected: true, reason: null },
      methods: [instrument()],
    });
    return { ...d, ...over };
  };

  it('mints the seal when the hold BEGINS, and sends nothing yet', async () => {
    const d = withCard();
    mockData.current = d;
    render(<ConnectionsNext />);

    const hold = screen.getByRole('button', { name: 'Charge this first' });
    fireEvent.keyDown(hold, { key: 'Enter' });

    await waitFor(() => expect(d.paymentSeal).toHaveBeenCalledTimes(1));
    expect(d.paymentSeal).toHaveBeenCalledWith({ act: 'set_default', methodId: 'pm-1' });
    expect(
      (d.setDefaultPayment as { mutate: ReturnType<typeof vi.fn> }).mutate,
    ).not.toHaveBeenCalled();
  });

  it('carries the minted seal on the write, and seals each act separately', async () => {
    const d = withCard();
    mockData.current = d;
    render(<ConnectionsNext />);

    const charge = screen.getByRole('button', { name: 'Charge this first' });
    fireEvent.keyDown(charge, { key: 'Enter' });
    fireEvent.keyDown(charge, { key: 'Enter' });
    await waitFor(() =>
      expect(
        (d.setDefaultPayment as { mutate: ReturnType<typeof vi.fn> }).mutate,
      ).toHaveBeenCalledWith({ methodId: 'pm-1', challenge: 'tok-pay' }),
    );

    const remove = screen.getByRole('button', { name: 'Remove' });
    fireEvent.keyDown(remove, { key: 'Enter' });
    await waitFor(() =>
      expect(d.paymentSeal).toHaveBeenCalledWith({ act: 'remove', methodId: 'pm-1' }),
    );
  });

  it('removes nothing when the seal cannot be minted, and says why', async () => {
    const d = withCard({ paymentSeal: vi.fn(async () => null) });
    mockData.current = d;
    render(<ConnectionsNext />);

    const remove = screen.getByRole('button', { name: 'Remove' });
    fireEvent.keyDown(remove, { key: 'Enter' });
    fireEvent.keyDown(remove, { key: 'Enter' });

    expect(
      await screen.findByText(/the seal could not be issued — nothing sent/i),
    ).toBeInTheDocument();
    expect(
      (d.removePayment as { mutate: ReturnType<typeof vi.fn> }).mutate,
    ).not.toHaveBeenCalled();
  });

  it("reports a refused write on its own row, in the gateway's own sentence", () => {
    const refusal =
      'That seal has already been spent. A seal is good for exactly one act, so a repeat is a second approval rather than a retry — nothing was changed.';
    const d = base();
    d.payments = reg({
      provider: { connected: true, reason: null },
      methods: [instrument(), instrument({ id: 'pm-2', last4: '1881' })],
    });
    d.removePayment = {
      mutate: vi.fn(),
      isPending: false,
      isError: true,
      error: { response: { status: 403, data: { message: refusal } } },
      variables: { methodId: 'pm-2' },
    };
    mockData.current = d;
    const { container } = render(<ConnectionsNext />);

    const alerts = container.querySelectorAll('.cx-ctl-alert');
    // On ONE row, and the row it was refused for.
    expect(alerts.length).toBe(1);
    expect(alerts[0].textContent).toContain('already been spent');
    const refusedRow = alerts[0].closest('.cx-row') as HTMLElement;
    expect(within(refusedRow).getByText(/ending 1881/)).toBeInTheDocument();
  });

  it('offers no "charge this first" while the provider is not connected', () => {
    const d = base();
    d.payments = reg({
      provider: { connected: false, reason: 'STRIPE_SECRET_KEY is not set' },
      methods: [instrument()],
    });
    mockData.current = d;
    render(<ConnectionsNext />);

    // Preferring an instrument is a fact about the Stripe customer, and there
    // is no customer to state it to. Removal survives, because a row can
    // outlive the credential that created it — and it is LIVE, which is the
    // half of G-C9 this closes: the collapse left it disabled with a note
    // saying the client had not been rebuilt here.
    expect(screen.queryByRole('button', { name: 'Charge this first' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove' })).not.toBeDisabled();
  });

  it('never offers a second "charge this first" on the instrument already charged first', () => {
    const d = base();
    d.payments = reg({
      provider: { connected: true, reason: null },
      methods: [instrument({ isDefault: true })],
    });
    mockData.current = d;
    render(<ConnectionsNext />);

    expect(screen.queryByRole('button', { name: 'Charge this first' })).not.toBeInTheDocument();
    expect(screen.getByText('Charged first')).toBeInTheDocument();
    // The row is still actionable: the chip states what it IS, not that the
    // register has gone read-only.
    expect(screen.getByRole('button', { name: 'Remove' })).not.toBeDisabled();
  });
});
