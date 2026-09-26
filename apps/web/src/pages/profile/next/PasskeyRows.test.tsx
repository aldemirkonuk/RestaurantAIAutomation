/**
 * PasskeyRows — ADR 0222 (Proposed), ADR 0134 §7 ("Passkey + paste").
 *
 * The API module is mocked at its boundary; the ceremony itself is proven in
 * the gateway's `passkeys.service.spec.ts` against a software authenticator.
 * These assert what the person sees: three states for the list, a reason in
 * words for every disabled control, the password typed before a passkey is
 * added, a removed passkey kept on the record, and a closed device prompt
 * described as that rather than as a fault.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const api = vi.hoisted(() => ({
  readout: null as unknown,
  getFails: false,
  supported: true,
  addPasskey: vi.fn(),
  removePasskey: vi.fn(),
  checkPasskey: vi.fn(),
}));

vi.mock('../../../services/api/passkeys', () => ({
  PASSKEYS_QUERY_KEY: ['passkeys'],
  getPasskeys: () => (api.getFails ? Promise.reject(new Error('gateway down')) : Promise.resolve(api.readout)),
  passkeysSupported: () => api.supported,
  addPasskey: (...a: unknown[]) => api.addPasskey(...a),
  removePasskey: (...a: unknown[]) => api.removePasskey(...a),
  checkPasskey: (...a: unknown[]) => api.checkPasskey(...a),
}));

import { PasskeyRows, describePasskeyError } from './PasskeyRows';

const LIVE = {
  id: 'p1',
  nickname: 'Work laptop',
  createdAt: '2026-09-20T10:00:00.000Z',
  lastUsedAt: null,
  deviceType: 'multiDevice',
  backedUp: true,
  transports: ['internal'],
  rpId: 'mudavym.com',
  revokedAt: null,
};
const REVOKED = { ...LIVE, id: 'p2', nickname: 'Old phone', revokedAt: '2026-09-22T10:00:00.000Z' };

function readout(over: Record<string, unknown> = {}) {
  return { readable: true, reason: null, passkeys: [], eligible: true, eligibilityReason: null, ...over };
}

function draw(hasPassword: boolean | null = true) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={qc}>
      <PasskeyRows hasPassword={hasPassword} />
    </QueryClientProvider>,
  );
}

function row(title: string): HTMLElement {
  const el = screen.getAllByText(title).map((e) => e.closest('div.pf-row')).find(Boolean);
  expect(el).toBeTruthy();
  return el as HTMLElement;
}

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  api.readout = readout();
  api.getFails = false;
  api.supported = true;
});

describe('PasskeyRows — the list', () => {
  it('says an unreadable list could not be read, never that there are none', async () => {
    api.readout = readout({ readable: false, reason: 'relation missing' });
    draw();
    expect(await screen.findByText(/relation missing/)).toBeInTheDocument();
    expect(screen.getByText(/not the same as having none/)).toBeInTheDocument();
    expect(screen.queryByText(/No passkey has been added/)).not.toBeInTheDocument();
  });

  it('says a failed request the same way, with a retry', async () => {
    api.getFails = true;
    draw();
    expect(await screen.findByText(/gateway down/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
  });

  it('says plainly when none has been added, and that nothing asks for one yet', async () => {
    draw();
    expect(await screen.findByText(/No passkey has been added/)).toBeInTheDocument();
    expect(screen.getByText(/Nothing in Mudavym asks for a passkey yet/)).toBeInTheDocument();
    expect(within(row('Passkeys')).getByText('Not connected')).toBeInTheDocument();
  });

  it('keeps a removed passkey on the record, marked removed, with no control', async () => {
    api.readout = readout({ passkeys: [LIVE, REVOKED] });
    draw();
    await screen.findByText('Old phone');
    const old = row('Old phone');
    expect(within(old).getByText('Unavailable')).toBeInTheDocument();
    expect(within(old).getByText(/stays listed so the record is whole/)).toBeInTheDocument();
    expect(within(old).queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument();
    expect(within(row('Work laptop')).getByRole('button', { name: 'Remove' })).toBeEnabled();
    expect(within(row('Passkeys')).getByText('One passkey on this account.')).toBeInTheDocument();
  });
});

describe('PasskeyRows — who may add one, in words', () => {
  it('a staff member sees why, and the control is disabled', async () => {
    api.readout = readout({ eligible: false, eligibilityReason: 'Passkeys are for the house’s owners and managers.' });
    draw();
    const header = await waitFor(() => row('Passkeys'));
    await screen.findByText(/owners and managers/);
    expect(within(header).getByRole('button', { name: 'Add a passkey' })).toBeDisabled();
  });

  it('an account without a password is told to set one first', async () => {
    draw(false);
    expect(await screen.findByText(/Set a password first/)).toBeInTheDocument();
    expect(within(row('Passkeys')).getByRole('button', { name: 'Add a passkey' })).toBeDisabled();
  });

  it('a browser that cannot make passkeys is named as the reason', async () => {
    api.supported = false;
    draw();
    expect(await screen.findByText(/This browser cannot make a passkey/)).toBeInTheDocument();
    expect(within(row('Passkeys')).getByRole('button', { name: 'Add a passkey' })).toBeDisabled();
  });
});

describe('PasskeyRows — adding, removing, checking', () => {
  it('asks for the password (a field a password manager can fill), then adds and says so', async () => {
    api.addPasskey.mockResolvedValue({ passkey: LIVE, audited: true, auditReason: null, notified: true });
    draw();
    fireEvent.click(await screen.findByRole('button', { name: 'Add a passkey' }));
    const pw = screen.getByLabelText('Your current password');
    expect(pw).toHaveAttribute('autocomplete', 'current-password');
    expect(pw).not.toHaveAttribute('onpaste');
    const go = screen.getByRole('button', { name: 'Continue on this device' });
    expect(go).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Name it (optional)'), { target: { value: 'Work laptop' } });
    fireEvent.change(pw, { target: { value: 'hunter22' } });
    fireEvent.click(go);
    await screen.findByText(/Passkey added\./);
    expect(api.addPasskey).toHaveBeenCalledWith({ currentPassword: 'hunter22', nickname: 'Work laptop' });
  });

  it('says a change that was not written to the trail', async () => {
    api.addPasskey.mockResolvedValue({ passkey: LIVE, audited: false, auditReason: 'insert refused', notified: false });
    draw();
    fireEvent.click(await screen.findByRole('button', { name: 'Add a passkey' }));
    fireEvent.change(screen.getByLabelText('Your current password'), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue on this device' }));
    expect(await screen.findByText(/not written to the trail — insert refused/)).toBeInTheDocument();
  });

  it('describes a closed device prompt as that, not as a fault', async () => {
    api.addPasskey.mockRejectedValue(Object.assign(new Error('The operation either timed out or was not allowed.'), { name: 'NotAllowedError' }));
    draw();
    fireEvent.click(await screen.findByRole('button', { name: 'Add a passkey' }));
    fireEvent.change(screen.getByLabelText('Your current password'), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue on this device' }));
    expect(await screen.findByText('Nothing was added — the device prompt was closed or timed out.')).toBeInTheDocument();
  });

  it('removes only after a second, explicit click', async () => {
    api.readout = readout({ passkeys: [LIVE] });
    api.removePasskey.mockResolvedValue({ passkey: { ...LIVE, revokedAt: '2026-09-25T00:00:00.000Z' }, audited: true, auditReason: null, notified: true });
    draw();
    await screen.findByText('Work laptop');
    fireEvent.click(within(row('Work laptop')).getByRole('button', { name: 'Remove' }));
    expect(api.removePasskey).not.toHaveBeenCalled();
    fireEvent.click(within(row('Work laptop')).getByRole('button', { name: 'Yes, remove it' }));
    await screen.findByText(/Passkey removed\. It can no longer be used\./);
    expect(api.removePasskey).toHaveBeenCalledWith('p1');
  });

  it('checks a passkey and says it approved nothing', async () => {
    api.readout = readout({ passkeys: [LIVE] });
    api.checkPasskey.mockResolvedValue({ passkey: LIVE, audited: true, auditReason: null, notified: false });
    draw();
    fireEvent.click(await screen.findByRole('button', { name: 'Check a passkey' }));
    expect(await screen.findByText('Work laptop answered. Nothing was approved by it.')).toBeInTheDocument();
  });
});

describe('describePasskeyError', () => {
  it('names a passkey this device already holds', () => {
    expect(describePasskeyError({ name: 'InvalidStateError' }, 'Nothing was added')).toMatch(/already holds a passkey/);
  });
});
