/**
 * Every owner, at their next sign-in (ADR 0207 round 5, question 19, the
 * founder's pick over the recommended "only to turn Jev on"). This file
 * tests the GATE's own decision of whether to show the sheet at all —
 * `DataTermsAcceptSheet.test.tsx` covers the sheet itself.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { DataTermsSignInGate } from './DataTermsSignInGate';
import type { DataTermsReadout } from '../../services/api/dataTerms';

const roleMock = vi.hoisted(() => ({ current: 'owner' as 'owner' | 'manager' | 'staff' | null }));
vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ activeRole: roleMock.current }),
}));

const dataTermsMock = vi.hoisted(() => ({
  data: undefined as DataTermsReadout | undefined,
  lastEnabled: undefined as boolean | undefined,
}));
vi.mock('../../hooks/queries/useDataTerms', () => ({
  useDataTerms: (enabled: boolean) => {
    dataTermsMock.lastEnabled = enabled;
    return { data: dataTermsMock.data };
  },
  useInvalidateDataTerms: () => vi.fn(),
}));

function readout(over: Partial<DataTermsReadout> = {}): DataTermsReadout {
  return {
    readable: true,
    reason: null,
    version: 1,
    digest: 'a'.repeat(64),
    statements: [
      { key: 'jev-tone-scoring', kind: 'fact', text: 'Jev reads masked vendor mail.', evidence: ['x'] },
    ],
    subprocessors: [],
    changedSince: {},
    acceptance: null,
    current: false,
    jev: { enabled: false, effective: false, pausedBecause: null },
    ...over,
  };
}

function mount() {
  render(
    <MemoryRouter>
      <DataTermsSignInGate />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  roleMock.current = 'owner';
  dataTermsMock.data = undefined;
  dataTermsMock.lastEnabled = undefined;
});

describe('who is even asked', () => {
  it.each(['manager', 'staff', null] as const)('never reads the terms for %s, and shows nothing', (role) => {
    roleMock.current = role;
    mount();
    expect(dataTermsMock.lastEnabled).toBe(false);
    expect(screen.queryByRole('button', { name: /hold to accept/i })).toBeNull();
  });

  it('reads the terms for an owner', () => {
    mount();
    expect(dataTermsMock.lastEnabled).toBe(true);
  });
});

describe('when the sheet shows, and when it never does', () => {
  it('shows nothing while the read is in flight, or failed outright — never a block on the app', () => {
    dataTermsMock.data = undefined;
    mount();
    expect(screen.queryByRole('button', { name: /hold to accept/i })).toBeNull();
  });

  it('shows nothing for an unreadable store — Jev fails closed at the gateway, this gate does not fail closed on the app', () => {
    dataTermsMock.data = readout({ readable: false, reason: 'the acceptance table could not be read' });
    mount();
    expect(screen.queryByRole('button', { name: /hold to accept/i })).toBeNull();
  });

  it('shows nothing once the CURRENT version is already accepted', () => {
    dataTermsMock.data = readout({
      current: true,
      acceptance: { version: 1, acceptedAt: '2026-09-22T00:00:00Z', acceptedBy: { userId: 'u', name: 'Aldemir' } },
    });
    mount();
    expect(screen.queryByRole('button', { name: /hold to accept/i })).toBeNull();
  });

  it('meets the owner with a non-dismissable sheet when the current version is not accepted', () => {
    dataTermsMock.data = readout();
    mount();
    expect(screen.getByRole('button', { name: /hold to accept/i })).toBeInTheDocument();
    // "Must accept to continue" — no way to put this one down.
    expect(screen.queryByRole('button', { name: /put it down/i })).toBeNull();
  });

  it('meets the owner again after a version bump, even though a PRIOR version was accepted', () => {
    dataTermsMock.data = readout({
      version: 2,
      current: false,
      acceptance: { version: 1, acceptedAt: '2026-09-01T00:00:00Z', acceptedBy: { userId: 'u', name: 'Aldemir' } },
    });
    mount();
    expect(screen.getByRole('button', { name: /hold to accept/i })).toBeInTheDocument();
  });
});
