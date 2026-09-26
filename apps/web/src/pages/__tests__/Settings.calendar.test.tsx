/**
 * The legacy /settings calendar section — the reader's OWN calendar link
 * (ADR 0111, review trail 2026-09-21).
 *
 * A VIEW MUST NOT MINT A CREDENTIAL. This component's mount used to GET a
 * route that minted the house's token when it had none; then (earlier on
 * 2026-09-21) it read the house's token and gated its writes on
 * manager/owner. The founder then made the link personal: "they can connect
 * their own". So this file pins: opening reads once and writes nothing; any
 * member — staff included — may connect their own; the address appears once,
 * marked as a secret, and never from a read; a new link and stopping are
 * separate calls; and a failed read is never "not connected".
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createContext } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), delete: vi.fn(), patch: vi.fn() }));
vi.mock('../../services/api/client', () => ({
  apiClient: api,
  getErrorMessage: (e: unknown) => (e as { message?: string })?.message ?? 'unknown error',
}));

vi.mock('../../contexts/AuthContext', () => ({
  AuthContext: createContext(undefined),
  useAuth: () => ({ activeRestaurantId: 'r1', activeRole: 'staff', user: { role: 'staff' } }),
}));

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

// `window.confirm` gates "Get a new link" and "Stop my link" — always confirm,
// so the tests below exercise the call rather than the browser dialog.
vi.stubGlobal('confirm', vi.fn(() => true));

import { CalendarSubscriptionSection } from '../Settings';

const SECRET = 'a'.repeat(64);
const ADDRESS = `https://api.mudavym.test/api/v1/calendar/feed/${SECRET}.ics`;

function mine(over: Record<string, unknown> = {}) {
  return {
    connected: false,
    createdAt: null,
    issuedAt: null,
    lastFetchedAt: null,
    role: 'staff',
    scope: 'Your link shows your own shifts and the house calendar you can already see here.',
    categories: null,
    canPickCategories: false,
    areasModelled: false,
    houseLinkRetired: false,
    ...over,
  };
}

beforeEach(() => {
  api.get.mockReset();
  api.post.mockReset();
  api.delete.mockReset();
  toast.success.mockReset();
  toast.error.mockReset();
});

describe('legacy /settings — my calendar link', () => {
  it('no link yet: ONE read, nothing written, and STAFF may connect their own', async () => {
    api.get.mockResolvedValue({ data: mine() });
    render(<CalendarSubscriptionSection />);

    expect(await screen.findByRole('button', { name: /Connect my calendar/ })).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledTimes(1);
    expect(api.get).toHaveBeenCalledWith('/calendar/ical-token');
    expect(api.post).not.toHaveBeenCalled();
    expect(api.delete).not.toHaveBeenCalled();
  });

  it('connecting is a POST, and the address is shown once, marked as a secret', async () => {
    api.get.mockResolvedValue({ data: mine() });
    api.post.mockResolvedValue({
      data: mine({
        connected: true,
        createdAt: '2026-09-21T12:00:00Z',
        issued: { feedUrl: `/api/v1/calendar/feed/${SECRET}.ics`, absoluteFeedUrl: ADDRESS, webcalUrl: null, originSource: 'config' },
      }),
    });
    render(<CalendarSubscriptionSection />);

    fireEvent.click(await screen.findByRole('button', { name: /Connect my calendar/ }));
    const address = await screen.findByText(ADDRESS);
    expect(api.post).toHaveBeenCalledTimes(1);
    expect(api.post).toHaveBeenCalledWith('/calendar/ical-token', {});
    expect(address).toHaveAttribute('data-secret', 'credential');
    expect(screen.getByText(/shown only once, when it is made/i)).toBeInTheDocument();
  });

  it('a connected reader: no address from the read, and a new link / stop are separate calls', async () => {
    api.get.mockResolvedValue({ data: mine({ connected: true, createdAt: '2026-09-21T12:00:00Z' }) });
    api.post.mockResolvedValue({ data: mine({ connected: true }) });
    api.delete.mockResolvedValue({ data: { revoked: true } });
    render(<CalendarSubscriptionSection />);

    fireEvent.click(await screen.findByRole('button', { name: /Get a new link/ }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/calendar/ical-token/regenerate'));
    expect(screen.queryByText(/api\/v1\/calendar\/feed/)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /Stop my link/ }));
    await waitFor(() => expect(api.delete).toHaveBeenCalledWith('/calendar/ical-token'));
  });

  it('an owner or manager is told the shared house link was switched off', async () => {
    api.get.mockResolvedValue({ data: mine({ role: 'manager', houseLinkRetired: true }) });
    render(<CalendarSubscriptionSection />);
    expect(await screen.findByText(/shared calendar link for this house was switched off/i)).toBeInTheDocument();
  });

  it('a FAILED read says so, and never as "not connected"', async () => {
    api.get.mockRejectedValue(new Error('gateway unreachable'));
    render(<CalendarSubscriptionSection />);

    expect(await screen.findByText(/couldn't read your calendar link — gateway unreachable/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Connect my calendar/ })).not.toBeInTheDocument();
  });
});
