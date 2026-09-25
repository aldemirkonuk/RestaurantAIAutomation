/**
 * The owner's hold-to-accept of the house's data-and-privacy terms
 * (ADR 0207 round 5). Every case here is a way this control could turn Jev
 * on for a house without the owner actually proving the hold:
 *
 *  1. minting the seal at the END of the gesture instead of the start;
 *  2. accepting anyway when the mint failed;
 *  3. reporting acceptance when the gateway refused it;
 *  4. a dismissable caller (Settings) closing on demand while the sign-in
 *     gate's own non-dismissable use stays truly unclosable — Esc and an
 *     outside click do nothing when `dismissable={false}`.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { DataTermsAcceptSheet } from './DataTermsAcceptSheet';
import type { DataTermsReadout } from '../../services/api/dataTerms';

const sealMock = vi.hoisted(() => vi.fn<() => Promise<string | null>>(async () => 'terms-seal-token'));
type AcceptReceipt = {
  accepted: true;
  version: number;
  switchTurnedOn: boolean;
  audited: boolean;
  auditReason: string | null;
};
type Accept = (version: number, digest: string, challenge: string | null) => Promise<AcceptReceipt>;
const acceptMock = vi.hoisted(() =>
  vi.fn<Accept>(async () => ({ accepted: true, version: 1, switchTurnedOn: true, audited: true, auditReason: null })),
);
vi.mock('../../services/api/dataTerms', () => ({
  issueDataTermsSealChallenge: () => sealMock(),
  acceptDataTerms: (version: number, digest: string, challenge: string | null) =>
    acceptMock(version, digest, challenge),
}));

const invalidateMock = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('../../hooks/queries/useDataTerms', () => ({
  useInvalidateDataTerms: () => invalidateMock,
}));

function readout(over: Partial<DataTermsReadout> = {}): DataTermsReadout {
  return {
    readable: true,
    reason: null,
    version: 1,
    digest: 'a'.repeat(64),
    statements: [
      {
        key: 'jev-tone-scoring',
        kind: 'fact',
        text: 'Jev (TypeSafe) reads the latest part of a vendor message, names and sensitive topics removed.',
        evidence: ['apps/api-gateway/src/vendor-tone/jev-tone.client.ts'],
      },
      {
        key: 'responsibility',
        kind: 'term',
        text: 'The house remains responsible for its own records.',
        evidence: [],
      },
    ],
    subprocessors: [
      { name: 'TypeSafe (Jev)', host: 'api.typesafe.ai', what: 'masked vendor mail', when: 'switch on', masked: true },
    ],
    changedSince: {},
    acceptance: null,
    current: false,
    jev: { enabled: false, effective: false, pausedBecause: null },
    ...over,
  };
}

function mount(over: Partial<DataTermsReadout> = {}, props: Partial<{ dismissable: boolean; onClose: () => void; onAccepted: () => void }> = {}) {
  const onClose = props.onClose ?? vi.fn();
  const onAccepted = props.onAccepted ?? vi.fn();
  render(
    <MemoryRouter>
      <DataTermsAcceptSheet
        readout={readout(over)}
        dismissable={props.dismissable ?? false}
        onClose={onClose}
        onAccepted={onAccepted}
      />
    </MemoryRouter>,
  );
  return { onClose, onAccepted };
}

const hold = () => {
  const btn = screen.getByRole('button', { name: /hold to accept/i });
  fireEvent.keyDown(btn, { key: 'Enter' });
  fireEvent.keyDown(btn, { key: 'Enter' });
};

beforeEach(() => {
  sealMock.mockReset();
  sealMock.mockResolvedValue('terms-seal-token');
  acceptMock.mockReset();
  acceptMock.mockResolvedValue({ accepted: true, version: 1, switchTurnedOn: true, audited: true, auditReason: null });
  invalidateMock.mockReset();
  invalidateMock.mockResolvedValue(undefined);
});

describe('what it shows', () => {
  it('renders the gateway’s own fact and term statements, verbatim, and nothing it invented', () => {
    mount();
    expect(
      screen.getByText(/Jev \(TypeSafe\) reads the latest part of a vendor message/),
    ).toBeInTheDocument();
    expect(screen.getByText(/The house remains responsible for its own records\./)).toBeInTheDocument();
    expect(screen.getByText(/TypeSafe \(Jev\)/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /privacy page/i })).toHaveAttribute('href', '/privacy');
  });

  it('names who accepted a prior version when re-asking after a change', () => {
    mount({
      current: false,
      acceptance: { version: 1, acceptedAt: '2026-09-20T00:00:00Z', acceptedBy: { userId: 'u', name: 'Aldemir' } },
      version: 2,
      changedSince: { '2': ['Jev now also removes account numbers.'] },
    });
    expect(screen.getByText(/Last accepted version 1 by Aldemir on 2026-09-20/)).toBeInTheDocument();
    expect(screen.getByText(/Jev now also removes account numbers\./)).toBeInTheDocument();
  });
});

describe('the seal is minted when the hold begins', () => {
  it('mints, then carries the token onto the accept call', async () => {
    const { onAccepted } = mount();
    hold();
    await vi.waitFor(() => expect(acceptMock).toHaveBeenCalled());
    expect(sealMock).toHaveBeenCalled();
    expect(acceptMock).toHaveBeenCalledWith(1, 'a'.repeat(64), 'terms-seal-token');
    await vi.waitFor(() => expect(onAccepted).toHaveBeenCalled());
    expect(invalidateMock).toHaveBeenCalled();
  });

  it('accepts nothing when the mint returns no token', async () => {
    sealMock.mockResolvedValue(null);
    const { onAccepted } = mount();
    hold();
    await vi.waitFor(() => expect(sealMock).toHaveBeenCalled());
    expect(acceptMock).not.toHaveBeenCalled();
    expect(onAccepted).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(/nothing was accepted/i);
  });

  it('reports nothing accepted, and prints the gateway’s own words, when the accept call is refused', async () => {
    acceptMock.mockRejectedValue(new Error('The terms changed while you were reading them.'));
    const { onAccepted } = mount();
    hold();
    await vi.waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('The terms changed while you were reading them.'),
    );
    expect(onAccepted).not.toHaveBeenCalled();
    expect(invalidateMock).not.toHaveBeenCalled();
  });
});

describe('dismissability', () => {
  it('shows no close control, and Esc changes nothing, when it is not dismissable', () => {
    const { onClose } = mount({}, { dismissable: false });
    expect(screen.queryByRole('button', { name: /put it down/i })).toBeNull();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
    // Still on screen — "must accept to continue".
    expect(screen.getByRole('button', { name: /hold to accept/i })).toBeInTheDocument();
  });

  it('shows a close control, and calls onClose, when it is dismissable', () => {
    const { onClose } = mount({}, { dismissable: true });
    fireEvent.click(screen.getByRole('button', { name: /put it down/i }));
    expect(onClose).toHaveBeenCalled();
  });
});
