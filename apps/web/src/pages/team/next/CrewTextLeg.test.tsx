import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * The crew text control, in its three states (ADR 0121).
 *
 * The founder's line on 2026-09-05 was *"a crew text exists and build it
 * next"*, and the brief's requirement was that the control be **disabled with
 * the sentence** when no sender exists. These four tests are that requirement,
 * plus the fourth thing a read can be: unknown.
 *
 * Each assertion is about a specific way this control could lie —
 *   * by looking live when nothing can send,
 *   * by letting a manager appear to consent on somebody's behalf,
 *   * by rendering a failed read as "this house has no sender",
 *   * by printing a zero it never measured.
 */

const readout = vi.hoisted(() => ({
  current: null as any,
}));

vi.mock('../../../services/api/team', () => ({
  getTextSenders: () => Promise.resolve(readout.current),
}));

// The control keys its read by the active house (ADR 0051); the test gives it one.
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({
    activeRestaurantId: 'r1',
    activeRole: 'owner',
    user: { id: 'u1', restaurantId: 'r1', role: 'owner' },
  }),
}));

import { CrewTextLeg } from './TeamOverlays';

function draw() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <CrewTextLeg recipientCount={4} />
    </QueryClientProvider>,
  );
}

const connectedWhatsapp = {
  id: 's1',
  channel: 'whatsapp' as const,
  path: 'bring_your_own' as const,
  state: 'connected' as const,
  identity: '+905550000000',
  market: 'TR',
  lastProbeAt: null,
};

const base = (over: Record<string, unknown> = {}) => ({
  senders: { whatsapp: null, sms: null },
  readable: true,
  reason: null,
  transport: {
    built: false,
    words: 'No provider credential for a per-house sender exists on this deployment.',
  },
  myConsent: { consent: null, readable: true, reason: null },
  crewConsents: 0,
  ...over,
});

describe('CrewTextLeg — the crew text, in three states', () => {
  beforeEach(() => {
    readout.current = base();
  });

  it('state 1 — no sender: the control is off and the sentence names why', async () => {
    draw();
    const button = await screen.findByRole('button', { name: 'Also text them' });
    expect(button).toBeDisabled();
    expect(
      screen.getByText(/This house has no text sender of its own/),
    ).toBeInTheDocument();
    // The reason a shared number is not offered as an easy alternative, stated
    // where the manager is standing.
    expect(screen.getByText(/silences the platform for\s+every house on it/)).toBeInTheDocument();
  });

  it('state 2 — a sender and nobody consented: still off, and it is not the manager’s to fix', async () => {
    readout.current = base({
      senders: { whatsapp: connectedWhatsapp, sms: null },
      crewConsents: 0,
    });
    draw();
    const button = await screen.findByRole('button', { name: 'Also text them' });
    expect(button).toBeDisabled();
    expect(
      screen.getByText(/nobody can\s+agree on their behalf/),
    ).toBeInTheDocument();
  });

  it('state 3 — a sender and consents: live, and it names who is NOT reached', async () => {
    readout.current = base({
      senders: { whatsapp: connectedWhatsapp, sms: null },
      crewConsents: 2,
    });
    draw();
    const button = await screen.findByRole('button', { name: 'Also text 2 of 4' });
    expect(button).not.toBeDisabled();
    // The four minus two are not hidden: the receipt says so person by person.
    expect(screen.getByText(/The rest are reached on the inbox and the phone only/)).toBeInTheDocument();
    // And the transport is still not built, which the sentence carries from the
    // SERVER rather than inventing.
    expect(
      screen.getByText(/No provider credential for a per-house sender exists/),
    ).toBeInTheDocument();
  });

  it('a failed read is unknown, and never "this house has no sender"', async () => {
    readout.current = base({ readable: false, reason: 'connection reset' });
    draw();
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/could not be read/),
    );
    expect(screen.getByRole('alert')).toHaveTextContent(/connection reset/);
    expect(screen.getByRole('alert')).toHaveTextContent(/unknown — not no/);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('a staff caller sees no crew count rather than a zero nobody measured', async () => {
    readout.current = base({
      senders: { whatsapp: connectedWhatsapp, sms: null },
      crewConsents: null,
    });
    draw();
    expect(
      await screen.findByText(/that count is a\s+manager’s to see|manager's to see/),
    ).toBeInTheDocument();
    // `null` must not fall through to the "ready" state and claim a send.
    expect(screen.getByRole('button')).toBeDisabled();
  });
});
