/**
 * The offline banner: gated like every shell chrome piece, and — with the
 * shell on — honest that a queued change is NOT a confirmed one (sketch
 * 103's standing rule, applied to this aggregate banner; see the file's own
 * doc comment for what a per-record ladder would still need).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

type SyncState = {
  isOnline: boolean;
  isSyncing: boolean;
  pendingCount: number;
  lastError: string | null;
  notSentCount?: number;
  stillTryingCount?: number;
  retryNotSent?: () => Promise<unknown>;
  discardNotSent?: () => Promise<number>;
};

const syncState = vi.hoisted(() => ({
  current: { isOnline: true, isSyncing: false, pendingCount: 0, lastError: null } as SyncState,
}));

vi.mock('../../hooks/useSyncManager', () => ({
  useSyncManager: () => syncState.current,
}));

import { AppOfflineBanner } from './AppOfflineBanner';
import { clearMudavymDesignCache } from '../../lib/mudavym/useMudavymDesign';

beforeEach(() => {
  clearMudavymDesignCache();
  window.localStorage.clear();
  syncState.current = { isOnline: true, isSyncing: false, pendingCount: 0, lastError: null };
});
afterEach(() => window.localStorage.clear());

describe("shell off (the QA override '0' -- since 2026-09-25 the only way to legacy)", () => {
  beforeEach(() => window.localStorage.setItem('mudavym.design.shell', '0'));

  it('renders nothing while online with nothing pending (legacy OfflineBanner behaviour)', () => {
    const { container } = render(<AppOfflineBanner />);
    expect(container.textContent).toBe('');
  });

  it('offline: legacy wording ("will sync"), unchanged', () => {
    syncState.current = { isOnline: false, isSyncing: false, pendingCount: 2, lastError: null };
    render(<AppOfflineBanner />);
    expect(screen.getByText(/will sync when you're back online/)).toBeTruthy();
  });
});

describe('shell on (the default: live in code since 2026-09-25, no override, no flag row)', () => {

  it('offline with nothing queued: says so, not "will sync"', () => {
    syncState.current = { isOnline: false, isSyncing: false, pendingCount: 0, lastError: null };
    render(<AppOfflineBanner />);
    expect(screen.getByText('Offline')).toBeTruthy();
    expect(screen.getByText(/nothing is queued/)).toBeTruthy();
    expect(screen.queryByText(/will sync/)).toBeNull();
  });

  it('offline with a queue: never claims it is sent or confirmed', () => {
    syncState.current = { isOnline: false, isSyncing: false, pendingCount: 3, lastError: null };
    render(<AppOfflineBanner />);
    expect(screen.getByText(/3 changes queued on this device — not sent, not/)).toBeTruthy();
  });

  it('back online and sending: queued, sent, still not confirmed', () => {
    syncState.current = { isOnline: true, isSyncing: true, pendingCount: 1, lastError: null };
    render(<AppOfflineBanner />);
    expect(screen.getByText('Sending')).toBeTruthy();
    expect(screen.getByText(/not yet confirmed/)).toBeTruthy();
  });

  it('a send that failed: says so in words, never silently "will sync"', () => {
    syncState.current = {
      isOnline: true,
      isSyncing: false,
      pendingCount: 1,
      lastError: 'The house could not be reached.',
    };
    render(<AppOfflineBanner />);
    expect(screen.getByText('Could not send')).toBeTruthy();
    expect(screen.getByText(/The house could not be reached\./)).toBeTruthy();
    expect(screen.getByRole('alert')).toBeTruthy();
  });

  it('online, nothing pending, no error: renders nothing (same happy path as legacy)', () => {
    syncState.current = { isOnline: true, isSyncing: false, pendingCount: 0, lastError: null };
    const { container } = render(<AppOfflineBanner />);
    expect(container.textContent).toBe('');
  });
});

describe('not sent (ADR 0241, OD-203 (a)): a refused change is kept and named, never dropped', () => {
  it('names the parked changes, and Try again / Discard reach the queue', () => {
    const retryNotSent = vi.fn().mockResolvedValue({});
    const discardNotSent = vi.fn().mockResolvedValue(2);
    syncState.current = {
      isOnline: true,
      isSyncing: false,
      pendingCount: 0,
      lastError: null,
      notSentCount: 2,
      retryNotSent,
      discardNotSent,
    };
    render(<AppOfflineBanner />);
    expect(screen.getByRole('alert').textContent).toMatch(/Not sent.*2 changes could not be saved and are kept on this device/);

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(retryNotSent).toHaveBeenCalledTimes(1);

    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false);
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(discardNotSent).not.toHaveBeenCalled();
    confirm.mockReturnValueOnce(true);
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(discardNotSent).toHaveBeenCalledTimes(1);
    confirm.mockRestore();
  });

  it('a change that keeps failing is "still trying", with a way to try now', () => {
    const retryNotSent = vi.fn().mockResolvedValue({});
    syncState.current = {
      isOnline: true,
      isSyncing: false,
      pendingCount: 1,
      lastError: null,
      stillTryingCount: 1,
      retryNotSent,
    };
    render(<AppOfflineBanner />);
    expect(screen.getByText('Still trying')).toBeTruthy();
    expect(screen.getByText(/retried until the house takes it/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Try now' }));
    expect(retryNotSent).toHaveBeenCalledTimes(1);
  });
});
