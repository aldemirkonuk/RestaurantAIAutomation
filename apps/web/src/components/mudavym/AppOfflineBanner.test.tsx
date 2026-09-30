/**
 * The offline banner: gated like every shell chrome piece, and — with the
 * shell on — honest that a queued change is NOT a confirmed one (sketch
 * 103's standing rule, applied to this aggregate banner; see the file's own
 * doc comment for what a per-record ladder would still need).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

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

// The device-storage note reads lib/deviceStorage; its reads are replaced, its
// threshold logic (unsentWaitedTooLong, UNSENT_NUDGE_AFTER_MS) is the real one.
const storage = vi.hoisted(() => ({
  health: null as null | Record<string, unknown>,
  prompts: false,
  request: null as null | ReturnType<typeof import('vitest').vi.fn>,
}));
vi.mock('../../lib/deviceStorage', async (importActual) => {
  const actual = await importActual<typeof import('../../lib/deviceStorage')>();
  return {
    ...actual,
    readStorageHealth: async () =>
      storage.health ?? {
        persisted: true, usage: null, quota: null, pending: 0, parked: 0, oldestUnsentAt: null,
      },
    persistShowsAPrompt: () => storage.prompts,
    requestPersistence: (...a: unknown[]) => storage.request?.(...a) ?? Promise.resolve(null),
  };
});

import { AppOfflineBanner } from './AppOfflineBanner';
import { clearMudavymDesignCache } from '../../lib/mudavym/useMudavymDesign';

beforeEach(() => {
  clearMudavymDesignCache();
  window.localStorage.clear();
  syncState.current = { isOnline: true, isSyncing: false, pendingCount: 0, lastError: null };
  storage.health = null;
  storage.prompts = false;
  storage.request = null;
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

describe('device storage note (founder storage ruling 2026-09-29): unsent work waited or unprotected', () => {
  const DAY = 24 * 60 * 60 * 1000;
  const health = (over: Record<string, unknown>) => ({
    persisted: true, usage: null, quota: null, pending: 1, parked: 0,
    oldestUnsentAt: new Date(Date.now() - 1000), ...over,
  });

  it('says so when the oldest unsent change has waited over a day', async () => {
    syncState.current = { isOnline: false, isSyncing: false, pendingCount: 1, lastError: null };
    storage.health = health({ oldestUnsentAt: new Date(Date.now() - DAY - 60_000) });
    render(<AppOfflineBanner />);
    expect(
      await screen.findByText(/Some changes on this device have waited over a day to send/),
    ).toBeTruthy();
    expect(screen.getByText(/open with signal, or\s+tell a manager/)).toBeTruthy();
  });

  it('a parked change counts too: waited over a day, still named', async () => {
    syncState.current = {
      isOnline: true, isSyncing: false, pendingCount: 0, lastError: null, notSentCount: 1,
    };
    storage.health = health({ pending: 0, parked: 1, oldestUnsentAt: new Date(Date.now() - 2 * DAY) });
    render(<AppOfflineBanner />);
    expect(await screen.findByText(/waited over a day to send/)).toBeTruthy();
  });

  it('says nothing about waiting for a change under a day old on protected storage', async () => {
    syncState.current = { isOnline: false, isSyncing: false, pendingCount: 1, lastError: null };
    storage.health = health({});
    const { container } = render(<AppOfflineBanner />);
    await new Promise((r) => setTimeout(r, 0));
    expect(container.querySelector('[data-ux-key="shell.offline.device-storage"]')).toBeNull();
  });

  it('not persistent with unsent work: says the browser may clear it, with the Home Screen hint', async () => {
    syncState.current = { isOnline: false, isSyncing: false, pendingCount: 2, lastError: null };
    storage.health = health({ persisted: false, pending: 2 });
    render(<AppOfflineBanner />);
    expect(await screen.findByText(/This browser may clear changes that are not sent yet/)).toBeTruthy();
    expect(screen.getByText('Add to Home Screen')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Keep them on this device' })).toBeNull();
  });

  it('cannot be dismissed while storage is not persistent and work is unsent', async () => {
    syncState.current = { isOnline: false, isSyncing: false, pendingCount: 1, lastError: null };
    storage.health = health({ persisted: false });
    const { container, rerender } = render(<AppOfflineBanner />);
    const line = await screen.findByText('Add to Home Screen');
    // No control that hides it: the only buttons anywhere in it act on storage.
    const note = container.querySelector('[data-ux-key="shell.offline.device-storage"]')!;
    const names = [...note.querySelectorAll('button')].map((b) => b.textContent);
    expect(names.filter((n) => /dismiss|close|hide|later|got it|ok/i.test(n ?? ''))).toEqual([]);
    fireEvent.click(line);
    fireEvent.keyDown(note, { key: 'Escape' });
    rerender(<AppOfflineBanner />);
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.getByText('Add to Home Screen')).toBeTruthy();
  });

  it('goes away once the queue empties', async () => {
    syncState.current = { isOnline: false, isSyncing: false, pendingCount: 1, lastError: null };
    storage.health = health({ persisted: false });
    const { rerender } = render(<AppOfflineBanner />);
    expect(await screen.findByText('Add to Home Screen')).toBeTruthy();
    storage.health = health({ persisted: false, pending: 0, parked: 0, oldestUnsentAt: null });
    syncState.current = { isOnline: true, isSyncing: false, pendingCount: 0, lastError: null };
    rerender(<AppOfflineBanner />);
    await waitFor(() => expect(screen.queryByText('Add to Home Screen')).toBeNull());
  });

  it('goes away once the storage becomes persistent (re-read on return to the app)', async () => {
    syncState.current = { isOnline: false, isSyncing: false, pendingCount: 1, lastError: null };
    storage.health = health({ persisted: false });
    render(<AppOfflineBanner />);
    expect(await screen.findByText('Add to Home Screen')).toBeTruthy();
    storage.health = health({ persisted: true });
    document.dispatchEvent(new Event('visibilitychange'));
    await waitFor(() => expect(screen.queryByText('Add to Home Screen')).toBeNull());
  });

  it('unknown persistence is not read as safe', async () => {
    syncState.current = { isOnline: false, isSyncing: false, pendingCount: 1, lastError: null };
    storage.health = health({ persisted: null });
    render(<AppOfflineBanner />);
    expect(await screen.findByText(/This browser may clear changes/)).toBeTruthy();
  });

  it('on Firefox (asking shows a prompt) the note offers a button that asks', async () => {
    syncState.current = { isOnline: false, isSyncing: false, pendingCount: 1, lastError: null };
    storage.health = health({ persisted: false });
    storage.prompts = true;
    storage.request = vi.fn(async () => true);
    render(<AppOfflineBanner />);
    fireEvent.click(await screen.findByRole('button', { name: 'Keep them on this device' }));
    expect(storage.request).toHaveBeenCalledTimes(1);
  });

  it('no unsent work: no note, even on storage that is not persistent', async () => {
    storage.health = health({ persisted: false, pending: 0, parked: 0, oldestUnsentAt: null });
    const { container } = render(<AppOfflineBanner />);
    await new Promise((r) => setTimeout(r, 0));
    expect(container.textContent).toBe('');
  });
});
