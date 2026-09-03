/**
 * ProfileNext render contract.
 *
 * What these assert, in the order the brief asks for them:
 *
 *  1. the happy render — the four registers, and the founder's three additions
 *     (sign-in / model context / payment) present as first-class sections;
 *  2. every honesty state — a failed account read and a failed restaurant read
 *     say which register could not be read and disable the write that would
 *     otherwise carry a value nobody read; an unreadable connection register
 *     renders "unknown", not "not connected"; unknowns are em dashes;
 *  3. the founder's named requirements — MCPs and payments render with their
 *     shape and with every control disabled (no fake Connect), linked accounts
 *     carry the real Google/Microsoft state and the last-credential rule;
 *  4. delete-account is hold-to-approve, and the hold is inert until DELETE is
 *     typed.
 *
 * None of these would pass against the scaffold, and none would pass against a
 * page that drew an unbuilt section as a working one.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const mockData = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));

vi.mock('./useProfileNextData', () => ({
  useProfileNextData: () => mockData.current,
}));

import ProfileNext from './ProfileNext';

const deleteAccount = vi.fn(() => Promise.resolve());
const saveRestaurant = vi.fn(() => Promise.resolve());
const refetchMe = vi.fn();
const refetchLocation = vi.fn();

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
    location: { name: 'Ada Lokantası', city: 'İzmir', billingEmail: 'billing@ada.example', billingPhone: '' },
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

    saveAccount: vi.fn(() => Promise.resolve()),
    changePassword: vi.fn(() => Promise.resolve()),
    unlinkProvider: vi.fn(() => Promise.resolve()),
    refreshLinked: vi.fn(() => Promise.resolve()),
    disconnectWorkspace: vi.fn(() => Promise.resolve()),
    saveRestaurant,
    saveBillingContact: vi.fn(() => Promise.resolve()),
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

/** The card-shaped block a row title sits in. */
function rowFor(title: string): HTMLElement {
  const heading = screen.getByText(title);
  const row = heading.closest('div.pf-row');
  expect(row).not.toBeNull();
  return row as HTMLElement;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockData.current = base();
});

describe('ProfileNext — the ledger', () => {
  it('opens on the account, in the product’s own voice, counting only what it read', () => {
    draw();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Aldemir Konuk');
    expect(screen.getByText(/Two ways in, one workspace connected, nothing yet that can bill you\./)).toBeInTheDocument();
    // the four registers
    expect(screen.getByRole('heading', { name: 'Who you are' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'What is connected to you' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'The house' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Ruled off' })).toBeInTheDocument();
  });

  it('carries the founder’s three additions as first-class rails of one register', () => {
    draw();
    for (const rail of ['Sign-in', 'Workspace', 'Model context', 'Payment']) {
      expect(screen.getByRole('heading', { name: rail })).toBeInTheDocument();
    }
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

describe('ProfileNext — the two sections with no backend', () => {
  it('renders MCPs with their shape and no control that could appear to work', () => {
    draw();
    const mcp = rowFor('Model-context servers');
    expect(within(mcp).getByText('Not built')).toBeInTheDocument();
    expect(within(mcp).getByRole('button', { name: 'Add a server' })).toBeDisabled();
    fireEvent.click(within(mcp).getByRole('button', { name: 'Show the shape' }));
    expect(within(mcp).getByText('Tools exposed')).toBeInTheDocument();
    expect(within(mcp).getByText(/What it will let you do/)).toBeInTheDocument();
  });

  it('renders payment with a disabled instrument and an em-dash plan, never a "Free" label', () => {
    draw();
    const method = rowFor('Payment method');
    expect(within(method).getByText('Not built')).toBeInTheDocument();
    expect(within(method).getByRole('button', { name: 'Add a payment method' })).toBeDisabled();

    const plan = rowFor('Plan');
    // both the chip and the figure are the dash — the plan is unknown, not zero
    expect(within(plan).getAllByText('—').length).toBeGreaterThanOrEqual(2);
    expect(within(plan).getByText(/no endpoint returns it to the browser/)).toBeInTheDocument();
    expect(screen.queryByText(/Plan: Free/)).not.toBeInTheDocument();
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
    // no fabricated credential count in the opening line
    expect(screen.queryByText(/ways in/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
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

  it('renders permission-denied rather than hiding the section from staff', () => {
    mockData.current = base({ role: 'staff', isManagerOrOwner: false, locationState: 'idle', location: null });
    draw();
    expect(screen.getByText('Restaurant record')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save restaurant' })).not.toBeInTheDocument();
    // The copy must credit the PAGE, not the server, with withholding the record:
    // `getLocation` gates on org membership only (gap G8), so claiming the server
    // hides it would be the same class of untruth the page exists to remove.
    const record = rowFor('Restaurant record');
    expect(within(record).getByText(/Your role here is Staff/)).toBeInTheDocument();
    expect(within(record).getByText(/this page does not fetch the record/)).toBeInTheDocument();
    expect(within(record).getByText(/open to any member of the organisation/)).toBeInTheDocument();
    const billing = rowFor('Billing contact');
    expect(within(billing).getByText(/server refuses the write for anyone else/)).toBeInTheDocument();
    expect(within(billing).getByText(/this page's choice/)).toBeInTheDocument();
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

    // keyboard path: the first Enter arms, the second commits
    fireEvent.keyDown(hold, { key: 'Enter' });
    expect(deleteAccount).not.toHaveBeenCalled();
    expect(screen.getByText('Enter again to approve')).toBeInTheDocument();
    fireEvent.keyDown(hold, { key: 'Enter' });
    expect(deleteAccount).toHaveBeenCalledTimes(1);
  });
});
