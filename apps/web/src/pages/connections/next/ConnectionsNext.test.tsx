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
import { render, screen, fireEvent, within } from '@testing-library/react';

const mockData = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));

vi.mock('./useConnectionsNextData', () => ({
  useConnectionsNextData: () => mockData.current,
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
  grantTool: unknown;
  revokeTool: unknown;
  probeServer: unknown;
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
    grantTool: { mutate: vi.fn(), isPending: false },
    revokeTool: { mutate: vi.fn(), isPending: false },
    probeServer,
  };
}

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

  it('states what changed on a suspended grant, and offers re-consent behind the seal', () => {
    const d = base();
    const grantTool = { mutate: vi.fn(), isPending: false };
    d.grantTool = grantTool;
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

    // Behind the seal, and re-granting against what the server says NOW — a
    // write — rather than carrying the old read classification forward.
    const button = screen.getByRole('button', {
      name: 'Re-consent list_checks as a write',
    });
    expect(button.className).toContain('is-seal');
    fireEvent.click(button);
    expect(grantTool.mutate).toHaveBeenCalledWith({
      id: 's1',
      tool: 'list_checks',
      writes: true,
      sealed: true,
    });
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
});

describe('the sender identity', () => {
  it('says the address is the deployment’s and the control is not available', () => {
    render(<ConnectionsNext />);

    expect(screen.getByText(/shared, not yours/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /use our own address/i })).toBeDisabled();
    expect(screen.getByText(/no per-restaurant sender exists/i)).toBeInTheDocument();
  });
});
