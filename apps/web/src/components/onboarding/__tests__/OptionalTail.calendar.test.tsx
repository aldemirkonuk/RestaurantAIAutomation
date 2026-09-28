/**
 * Get-started's "Connect my calendar" row — the reader's OWN calendar link
 * (ADR 0111, review trail 2026-09-21).
 *
 * A SCREEN MUST NOT MINT A CREDENTIAL. `OptionalTail` mounts on its own the
 * moment a menu import finishes. Before the ADR 0111 §5 bracket its mount
 * effect called the GET that minted the house's calendar token; the first cut
 * of the fix swapped that for the create POST, which moved the defect rather
 * than closing it. The founder then made the link personal: "they can connect
 * their own". This file pins: mounting reads once and never creates; any
 * member (staff included) connects on a click; the address appears once,
 * marked as a secret, and never from a read; a failed read says it failed
 * instead of "Reading…" forever; a refused connect is reported and the row
 * still offers the act.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createContext } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), delete: vi.fn(), patch: vi.fn() }));
vi.mock('../../../services/api/client', () => ({
  apiClient: api,
  getErrorMessage: (e: unknown) => (e as { message?: string })?.message ?? 'unknown error',
}));
vi.mock('../../../contexts/AuthContext', () => ({
  AuthContext: createContext(undefined),
}));
vi.mock('../../../services/api/menus', () => ({
  getVendorEmail: vi.fn().mockResolvedValue({ address: null }),
}));
vi.mock('../../../services/api/profile', () => ({
  profileApi: { getLinkedProviders: vi.fn().mockResolvedValue({ google: false }) },
}));
vi.mock('../../auth/GoogleLinkButton', () => ({ GoogleLinkButton: () => null }));
vi.mock('../../team/InviteTeamDialog', () => ({ InviteTeamDialog: () => null }));

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

import { OptionalTail } from '../OptionalTail';

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

function mount() {
  return render(
    <MemoryRouter>
      <OptionalTail restaurantId="r1" />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  api.get.mockReset();
  api.post.mockReset();
  api.delete.mockReset();
  api.patch.mockReset();
  toast.error.mockReset();
});

describe('get-started calendar row — reads on mount, connects on a click', () => {
  it('no link yet: mounting reads ONCE, writes NOTHING, and offers the act to staff too', async () => {
    api.get.mockResolvedValue({ data: mine() });
    mount();

    expect(await screen.findByRole('button', { name: /connect my calendar/i })).toBeInTheDocument();
    // The mutation-tested assertion: the mount is a read, never the create.
    expect(api.get).toHaveBeenCalledTimes(1);
    expect(api.get).toHaveBeenCalledWith('/calendar/ical-token');
    expect(api.post).not.toHaveBeenCalled();
    expect(api.delete).not.toHaveBeenCalled();
    expect(screen.queryByText(/api\/v1\/calendar\/feed/)).not.toBeInTheDocument();
  });

  it('the click is the connect, and the address appears once, marked as a secret', async () => {
    api.get.mockResolvedValue({ data: mine() });
    api.post.mockResolvedValue({
      data: mine({
        connected: true,
        issued: {
          feedUrl: `/api/v1/calendar/feed/${SECRET}.ics`,
          absoluteFeedUrl: ADDRESS,
          webcalUrl: ADDRESS.replace('https://', 'webcal://'),
          originSource: 'env',
        },
      }),
    });
    mount();

    fireEvent.click(await screen.findByRole('button', { name: /connect my calendar/i }));
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    expect(api.post).toHaveBeenCalledWith('/calendar/ical-token', {});
    const shown = await screen.findByText(ADDRESS);
    expect(shown).toHaveAttribute('data-secret', 'credential');
  });

  it('already connected: no address (a read never carries it), nothing written, a way to manage it', async () => {
    api.get.mockResolvedValue({ data: mine({ connected: true, createdAt: '2026-09-21T10:00:00Z' }) });
    mount();

    expect(await screen.findByText(/your calendar is connected/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /manage my calendar link/i })).toBeInTheDocument();
    expect(screen.queryByText(/api\/v1\/calendar\/feed/)).not.toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled();
  });

  it('a FAILED read says so — never "Reading…" forever, never an offer to connect', async () => {
    api.get.mockRejectedValue({ message: 'gateway unreachable' });
    mount();

    expect(await screen.findByText(/couldn't read your calendar link — gateway unreachable/i)).toBeInTheDocument();
    expect(screen.queryByText(/reading your calendar link/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /connect my calendar/i })).not.toBeInTheDocument();
  });

  it('a REFUSED connect is reported, and the row still offers the act', async () => {
    api.get.mockResolvedValue({ data: mine() });
    api.post.mockRejectedValue({ message: 'You are not a member of this house.' });
    mount();

    fireEvent.click(await screen.findByRole('button', { name: /connect my calendar/i }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        expect.stringMatching(/your calendar was not connected — you are not a member of this house/i),
      ),
    );
    expect(screen.getByRole('button', { name: /connect my calendar/i })).toBeInTheDocument();
    expect(screen.queryByText(/api\/v1\/calendar\/feed/)).not.toBeInTheDocument();
  });
});
