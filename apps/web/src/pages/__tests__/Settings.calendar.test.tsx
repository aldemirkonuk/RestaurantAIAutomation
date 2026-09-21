/**
 * The legacy /settings calendar subscription section.
 *
 * A VIEW MUST NOT MINT A CREDENTIAL (fixed 2026-09-21, ADR 0111 §5 bracket)
 * -------------------------------------------------------------------------
 * Before this fix, mounting this component fetched `/calendar/ical-token`
 * with a GET the gateway used to answer by MINTING the token when the house
 * had none — a page view writing a permanent, unauthenticated bearer
 * credential, reachable from this exact `useEffect` with no role check at
 * all (the other half of the defect was `useConnectionsNextData.ts`'s
 * identical mount-time GET on `/connections`, fixed in the same session).
 *
 * This file pins: the GET is read-only and a null token renders "no link
 * yet" rather than a token nobody asked to create; Create/Regenerate/Revoke
 * are three separate calls, each disabled and explained for staff; and a
 * failed read is never rendered as "no link".
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), delete: vi.fn() }));
vi.mock('../../services/api/client', () => ({
  apiClient: api,
  getErrorMessage: (e: unknown) => (e as { message?: string })?.message ?? 'unknown error',
}));

const auth = vi.hoisted(() => ({
  current: { activeRestaurantId: 'r1', activeRole: 'owner', user: { role: 'owner' } } as Record<string, unknown>,
}));
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => auth.current }));

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

// `window.confirm` gates Regenerate and Revoke — always confirm, so the
// tests below exercise the call rather than the browser dialog.
vi.stubGlobal('confirm', vi.fn(() => true));

import { CalendarSubscriptionSection } from '../Settings';

beforeEach(() => {
  api.get.mockReset();
  api.post.mockReset();
  api.delete.mockReset();
  toast.success.mockReset();
  toast.error.mockReset();
  auth.current = { activeRestaurantId: 'r1', activeRole: 'owner', user: { role: 'owner' } };
});

describe('legacy /settings — calendar link, no-mint-on-read', () => {
  it('a house with none: GET writes nothing, and offers Create', async () => {
    api.get.mockResolvedValue({ data: { token: null, exists: false } });
    render(<CalendarSubscriptionSection />);

    expect(await screen.findByText(/no calendar link exists yet/i)).toBeInTheDocument();
    // The mutation-tested assertion: only ONE network call happened, the GET.
    expect(api.get).toHaveBeenCalledTimes(1);
    expect(api.get).toHaveBeenCalledWith('/calendar/ical-token');
    expect(api.post).not.toHaveBeenCalled();
    expect(screen.queryByText(/api\/v1\/calendar\/feed/)).not.toBeInTheDocument();
  });

  it('an OWNER can Create, and it is a POST, not the GET', async () => {
    api.get.mockResolvedValue({ data: { token: null, exists: false } });
    api.post.mockResolvedValue({ data: { token: 'a'.repeat(64), exists: true } });
    render(<CalendarSubscriptionSection />);

    fireEvent.click(await screen.findByRole('button', { name: /create calendar link/i }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/calendar/ical-token'));
    expect(await screen.findByText(/api\/v1\/calendar\/feed\/a{64}\.ics/)).toBeInTheDocument();
  });

  it('STAFF sees no Create button and the reason why', async () => {
    auth.current = { activeRestaurantId: 'r1', activeRole: 'staff', user: { role: 'staff' } };
    api.get.mockResolvedValue({ data: { token: null, exists: false } });
    render(<CalendarSubscriptionSection />);

    expect(await screen.findByText(/no calendar link exists yet/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /create calendar link/i })).not.toBeInTheDocument();
    expect(
      screen.getByText(/only managers and owners can create this restaurant's calendar link/i),
    ).toBeInTheDocument();
  });

  it('a house with a token already: renders the address, and STAFF gets no write controls', async () => {
    auth.current = { activeRestaurantId: 'r1', activeRole: 'staff', user: { role: 'staff' } };
    api.get.mockResolvedValue({ data: { token: 'existing-token', exists: true } });
    render(<CalendarSubscriptionSection />);

    expect(await screen.findByText(/api\/v1\/calendar\/feed\/existing-token\.ics/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /regenerate/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /revoke/i })).not.toBeInTheDocument();
    expect(
      screen.getByText(/only managers and owners can regenerate or revoke/i),
    ).toBeInTheDocument();
  });

  it('an OWNER can revoke, and the address is cleared', async () => {
    api.get.mockResolvedValue({ data: { token: 'existing-token', exists: true } });
    api.delete.mockResolvedValue({ data: { revoked: true } });
    render(<CalendarSubscriptionSection />);

    fireEvent.click(await screen.findByRole('button', { name: /revoke calendar link/i }));
    await waitFor(() => expect(api.delete).toHaveBeenCalledWith('/calendar/ical-token'));
    await waitFor(() =>
      expect(screen.queryByText(/api\/v1\/calendar\/feed\/existing-token\.ics/)).not.toBeInTheDocument(),
    );
    expect(await screen.findByText(/no calendar link exists yet/i)).toBeInTheDocument();
  });

  it('a FAILED read says so, and never as "no link yet"', async () => {
    api.get.mockRejectedValue({ message: 'gateway unreachable' });
    render(<CalendarSubscriptionSection />);

    expect(await screen.findByText(/couldn't load your subscription url — gateway unreachable/i)).toBeInTheDocument();
    expect(screen.queryByText(/no calendar link exists yet/i)).not.toBeInTheDocument();
  });
});
