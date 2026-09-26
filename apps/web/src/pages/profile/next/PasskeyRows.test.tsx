/**
 * PasskeyRows — ADR 0222 (Proposed), ADR 0134 §7 ("Passkey + paste").
 *
 * The API module is mocked at its boundary; the ceremony itself is proven in
 * the gateway's `passkeys.service.spec.ts` against a software authenticator.
 * These assert what the person sees: three states for the list, a reason in
 * words for every disabled control, a recent sign-in or an emailed code before
 * a passkey is added (founder 2026-09-25, item 29 -- it replaced the typed
 * password), a removed passkey kept on the record, and a closed device prompt
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
  sendStepUpCode: vi.fn(),
  StepUpRequired: class StepUpRequired extends Error {},
}));
const { StepUpRequired } = api;

vi.mock('../../../services/api/passkeys', () => ({
  PASSKEYS_QUERY_KEY: ['passkeys'],
  getPasskeys: () => (api.getFails ? Promise.reject(new Error('gateway down')) : Promise.resolve(api.readout)),
  passkeysSupported: () => api.supported,
  addPasskey: (...a: unknown[]) => api.addPasskey(...a),
  removePasskey: (...a: unknown[]) => api.removePasskey(...a),
  checkPasskey: (...a: unknown[]) => api.checkPasskey(...a),
  sendStepUpCode: (...a: unknown[]) => api.sendStepUpCode(...a),
  StepUpRequired: api.StepUpRequired,
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

function draw() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={qc}>
      <PasskeyRows />
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

  it('says plainly when none has been added, that a passkey signs you in, and that it approves nothing yet', async () => {
    draw();
    expect(await screen.findByText(/No passkey has been added/)).toBeInTheDocument();
    expect(screen.getByText(/A passkey signs you in on mudavym.com/)).toBeInTheDocument();
    expect(screen.getByText(/does not approve anything yet/)).toBeInTheDocument();
    expect(screen.getByText(/Lost the device\? Sign in with your email or password and remove it here/)).toBeInTheDocument();
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

  it('an account with no password (Google only) may add one -- nothing asks it to set a password', async () => {
    draw();
    expect(await screen.findByRole('button', { name: 'Add a passkey' })).toBeEnabled();
    expect(screen.queryByText(/Set a password first/)).not.toBeInTheDocument();
  });

  it('a browser that cannot make passkeys is named as the reason', async () => {
    api.supported = false;
    draw();
    expect(await screen.findByText(/This browser cannot make a passkey/)).toBeInTheDocument();
    expect(within(row('Passkeys')).getByRole('button', { name: 'Add a passkey' })).toBeDisabled();
  });
});

describe('PasskeyRows — adding, removing, checking', () => {
  it('on a recent sign-in, goes straight to the device -- no password, no code', async () => {
    api.addPasskey.mockResolvedValue({ passkey: LIVE, audited: true, auditReason: null, notified: true });
    draw();
    fireEvent.click(await screen.findByRole('button', { name: 'Add a passkey' }));
    expect(screen.queryByLabelText('Your current password')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('The code we emailed you')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Name it (optional)'), { target: { value: 'Work laptop' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue on this device' }));
    await screen.findByText(/Passkey added\. It signs you in on this device from now on\./);
    expect(api.addPasskey).toHaveBeenCalledWith({ nickname: 'Work laptop', emailCode: undefined });
    expect(api.sendStepUpCode).not.toHaveBeenCalled();
  });

  it('on an older sign-in, emails a code, asks for it in a one-time-code field, then adds', async () => {
    api.addPasskey
      .mockRejectedValueOnce(new StepUpRequired('You signed in more than ten minutes ago.'))
      .mockResolvedValueOnce({ passkey: LIVE, audited: true, auditReason: null, notified: true });
    api.sendStepUpCode.mockResolvedValue({ sent: true, sentTo: 'm•••@example.com', expiresInSeconds: 600 });
    draw();
    fireEvent.click(await screen.findByRole('button', { name: 'Add a passkey' }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue on this device' }));

    const field = await screen.findByLabelText('The code we emailed you');
    expect(api.sendStepUpCode).toHaveBeenCalledTimes(1);
    expect(field).toHaveAttribute('autocomplete', 'one-time-code');
    expect(field).toHaveAttribute('inputmode', 'numeric');
    expect(screen.getByText(/emailed a six-digit code to m•••@example.com/)).toBeInTheDocument();

    const go = screen.getByRole('button', { name: 'Continue on this device' });
    expect(go).toBeDisabled();
    fireEvent.change(field, { target: { value: '042 917' } });
    expect(go).toBeEnabled();
    fireEvent.click(go);
    await screen.findByText(/Passkey added\./);
    expect(api.addPasskey).toHaveBeenLastCalledWith({ nickname: '', emailCode: '042 917' });
  });

  it('can ask for a new code, and says when one could not be sent', async () => {
    api.addPasskey.mockRejectedValue(new StepUpRequired('stale'));
    api.sendStepUpCode
      .mockResolvedValueOnce({ sent: true, sentTo: 'm•••@example.com', expiresInSeconds: 600 })
      .mockRejectedValueOnce(new Error('mail is down'));
    draw();
    fireEvent.click(await screen.findByRole('button', { name: 'Add a passkey' }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue on this device' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Send a new code' }));
    expect(await screen.findByText(/No code was sent — mail is down/)).toBeInTheDocument();
    expect(api.sendStepUpCode).toHaveBeenCalledTimes(2);
  });

  it('says a change that was not written to the trail', async () => {
    api.addPasskey.mockResolvedValue({ passkey: LIVE, audited: false, auditReason: 'insert refused', notified: false });
    draw();
    fireEvent.click(await screen.findByRole('button', { name: 'Add a passkey' }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue on this device' }));
    expect(await screen.findByText(/not written to the trail — insert refused/)).toBeInTheDocument();
  });

  it('describes a closed device prompt as that, not as a fault', async () => {
    api.addPasskey.mockRejectedValue(Object.assign(new Error('The operation either timed out or was not allowed.'), { name: 'NotAllowedError' }));
    draw();
    fireEvent.click(await screen.findByRole('button', { name: 'Add a passkey' }));
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
