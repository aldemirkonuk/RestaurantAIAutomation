/**
 * Get-started's "Subscribe to your calendar" row.
 *
 * A SCREEN MUST NOT MINT A CREDENTIAL (ADR 0111 §5 bracket, 2026-09-21)
 * -------------------------------------------------------------------
 * `OptionalTail` mounts on its own the moment a menu import finishes. Before
 * the bracket its mount effect called the GET that minted the house's
 * calendar token; the first cut of the fix swapped that for the create POST,
 * which moved the defect rather than closing it. This file pins: mounting
 * reads and never creates; creating is the click; a failed read says it
 * failed instead of "Loading…" forever; a refused create is reported.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const cal = vi.hoisted(() => ({ getIcalToken: vi.fn(), createIcalToken: vi.fn() }));
vi.mock('../../../services/api/calendar', () => cal);

vi.mock('../../../services/api/client', () => ({
  getErrorMessage: (e: unknown) => (e as { message?: string })?.message ?? 'unknown error',
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

const TOKEN = 'a'.repeat(64);

function mount() {
  return render(
    <MemoryRouter>
      <OptionalTail restaurantId="r1" />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  cal.getIcalToken.mockReset();
  cal.createIcalToken.mockReset();
  toast.error.mockReset();
});

describe('get-started calendar row — reads on mount, creates on a click', () => {
  it('a house with no link: mounting reads, creates NOTHING, and offers the act', async () => {
    cal.getIcalToken.mockResolvedValue({ token: null, exists: false });
    mount();

    const create = await screen.findByRole('button', { name: /create a calendar link/i });
    expect(create).toBeInTheDocument();
    // The mutation-tested assertion: the mount is a read, never the create.
    expect(cal.getIcalToken).toHaveBeenCalledTimes(1);
    expect(cal.createIcalToken).not.toHaveBeenCalled();
    expect(screen.queryByText(/api\/v1\/calendar\/feed/)).not.toBeInTheDocument();
  });

  it('the click is the create, and the address appears after it', async () => {
    cal.getIcalToken.mockResolvedValue({ token: null, exists: false });
    cal.createIcalToken.mockResolvedValue({ token: TOKEN, exists: true });
    mount();

    fireEvent.click(await screen.findByRole('button', { name: /create a calendar link/i }));
    await waitFor(() => expect(cal.createIcalToken).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(new RegExp(`api/v1/calendar/feed/${TOKEN}\\.ics`))).toBeInTheDocument();
  });

  it('a house that already has a link: shows it, creates nothing', async () => {
    cal.getIcalToken.mockResolvedValue({ token: TOKEN, exists: true });
    mount();

    expect(await screen.findByText(new RegExp(`api/v1/calendar/feed/${TOKEN}\\.ics`))).toBeInTheDocument();
    expect(cal.createIcalToken).not.toHaveBeenCalled();
  });

  it('a FAILED read says so — never "Loading…" forever, never an offer to create', async () => {
    cal.getIcalToken.mockRejectedValue({ message: 'gateway unreachable' });
    mount();

    expect(await screen.findByText(/couldn't read your calendar link — gateway unreachable/i)).toBeInTheDocument();
    expect(screen.queryByText(/loading your calendar feed link/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /create a calendar link/i })).not.toBeInTheDocument();
  });

  it('a REFUSED create is reported, and the row still offers the act', async () => {
    cal.getIcalToken.mockResolvedValue({ token: null, exists: false });
    cal.createIcalToken.mockRejectedValue({ message: 'Only managers and owners can create a calendar link for this restaurant' });
    mount();

    fireEvent.click(await screen.findByRole('button', { name: /create a calendar link/i }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/no calendar link was created — only managers and owners/i)),
    );
    expect(screen.getByRole('button', { name: /create a calendar link/i })).toBeInTheDocument();
    expect(screen.queryByText(/api\/v1\/calendar\/feed/)).not.toBeInTheDocument();
  });
});
