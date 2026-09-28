/**
 * The sign-off register's empty state.
 *
 * A house that has never set a sign-off name has no `sender_identity` row. That
 * is a SUCCESSFUL read, and it used to reach `Register` as a bare `null` — which
 * `Register` reads as "no answer held" and rendered as "could not be read —
 * unknown error". Absence reported as failure (ADR 0020), on every house that
 * had not yet named itself. `EmailSection.tsx`'s own `row ? … : 'nothing is on
 * file yet'` branch was unreachable.
 *
 * The fix wraps the answer (`SenderRegister.row`) so "nothing on file" is a
 * value. These tests hold both halves: the fetcher wraps it, and the section
 * renders it as an honest empty state — while a real failure still fails loudly.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

const get = vi.hoisted(() => vi.fn());
vi.mock('@/services/api/client', () => ({ apiClient: { get, post: vi.fn(), patch: vi.fn(), put: vi.fn() } }));

import EmailSection from './EmailSection';
import { fetchSender } from './useSettingsNextData';

function remote(data: unknown, status = 'ok', error: string | null = null) {
  return { status, data, error, reload: vi.fn(), set: vi.fn() };
}

function mount(sender: ReturnType<typeof remote>) {
  const data = {
    sender,
    saveSender: vi.fn(),
    sendTestEmail: vi.fn(),
    writer: { busy: null, failed: null, run: vi.fn(), clear: vi.fn() },
  };
  return render(<EmailSection data={data as never} />);
}

const ROW = { id: 't1', type: 'sender_identity', body: 'Chef Ada', updatedAt: '2026-09-01T10:00:00.000Z' };

// Braces matter: a `beforeEach` that returns the mock is run as its teardown.
beforeEach(() => { get.mockReset(); });

describe('fetchSender', () => {
  it('reports a house with no sender_identity row as an answered read with nothing on file', async () => {
    get.mockResolvedValue({ data: [{ id: 't0', type: 'order_email', body: 'x' }] });
    await expect(fetchSender('r1')).resolves.toEqual({ row: null });
    expect(get).toHaveBeenCalledWith('/restaurants/r1/templates');
  });

  it('treats an empty list and a non-array body the same way — nothing on file, not a failure', async () => {
    get.mockResolvedValueOnce({ data: [] });
    await expect(fetchSender('r1')).resolves.toEqual({ row: null });
    get.mockResolvedValueOnce({ data: null });
    await expect(fetchSender('r1')).resolves.toEqual({ row: null });
  });

  it('returns the sender_identity row when one exists', async () => {
    get.mockResolvedValue({ data: [{ id: 't0', type: 'order_email', body: 'x' }, ROW] });
    await expect(fetchSender('r1')).resolves.toEqual({ row: ROW });
  });

  it('lets a failed read reject, so useRemote reports an error rather than an empty register', async () => {
    get.mockRejectedValue(new Error('gateway unreachable'));
    await expect(fetchSender('r1')).rejects.toThrow('gateway unreachable');
  });
});

describe('EmailSection', () => {
  it('shows a house with no sign-off row as empty and editable — not as a failed read', () => {
    mount(remote({ row: null }));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText(/could not be read/i)).toBeNull();
    expect(screen.getByLabelText('Sign-off name')).toHaveValue('');
    expect(screen.getByText(/nothing is on file yet/i)).toBeInTheDocument();
    // Nothing typed, nothing to save.
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('shows the stored sign-off and its own date when a row exists', () => {
    mount(remote({ row: ROW }));
    expect(screen.getByLabelText('Sign-off name')).toHaveValue('Chef Ada');
    expect(screen.queryByText(/nothing is on file yet/i)).toBeNull();
  });

  it('still reports a genuinely failed read as a failure', () => {
    mount(remote(null, 'error', 'gateway unreachable'));
    expect(screen.getByRole('alert')).toHaveTextContent(/could not be read — gateway unreachable/i);
  });

  it('reports a successful-but-unreadable answer (bare null) as a failure, in words that say so', () => {
    mount(remote(null));
    expect(screen.getByRole('alert')).toHaveTextContent(/answered with nothing readable/i);
    expect(screen.getByRole('alert')).not.toHaveTextContent(/unknown error/i);
  });
});
