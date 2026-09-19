/**
 * `DigestPost` — sketch 120 item 1, the two-door replacement for the disabled
 * "Daily digest" placeholder. Two different facts must never blur into one
 * control: the house's own armed/hour/floor row, and a person's own copy of
 * it, on the sender built on `feat/finish-digest`.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import DigestPost from './DigestPost';
import type { DigestPref, DigestWrite } from './useRecommendationsNextData';

const api = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn(), delete: vi.fn() }));
vi.mock('@/services/api/client', () => ({ apiClient: api }));

// A house that HAS stored a preference (explicitly armed off, at the default
// hour). Distinct from `UNSET_DIGEST` below — the two must never render the
// same sentence, or a house that never touched this setting reads as a house
// that armed the post and then turned it off at 07:00.
const DIGEST: DigestPref = {
  set: true,
  digestEnabled: false,
  digestHour: 7,
  digestMinUrgency: 'this_week',
  recipientEmail: null,
  lastSentAt: null,
};

// A house that has never stored a digest row at all. The gateway still fills
// in the same defaults (`digestEnabled: false, digestHour: 7`) so a naive
// read would be indistinguishable from `DIGEST` above — `set: false` is the
// only honest signal that nothing was ever chosen.
const UNSET_DIGEST: DigestPref = {
  set: false,
  digestEnabled: false,
  digestHour: 7,
  digestMinUrgency: 'this_week',
  recipientEmail: null,
  lastSentAt: null,
};

beforeEach(() => {
  api.get.mockReset();
  api.put.mockReset();
  api.delete.mockReset();
});

describe('DigestPost — the rail block', () => {
  it('reads the house state before anything is known, then shows the honest unset state once loaded — never a fabricated 07:00', () => {
    const { rerender } = render(<DigestPost digest={undefined} onSaveHouse={vi.fn()} />);
    expect(screen.getByText('Reading the house’s post…')).toBeInTheDocument();
    rerender(<DigestPost digest={UNSET_DIGEST} onSaveHouse={vi.fn()} />);
    expect(screen.getByText('Not yet set for this house')).toBeInTheDocument();
    expect(screen.queryByText(/Not armed, 07:00/)).not.toBeInTheDocument();
  });

  it('shows the stored armed/hour once a house has actually set a preference', () => {
    render(<DigestPost digest={DIGEST} onSaveHouse={vi.fn()} />);
    expect(screen.getByText('Not armed, 07:00')).toBeInTheDocument();
  });

  it('says the house preference is unreadable rather than guessing "off"', () => {
    render(<DigestPost digest={null} onSaveHouse={vi.fn()} />);
    expect(screen.getByText(/House preference unreadable/)).toBeInTheDocument();
  });
});

describe('DigestPost — the house’s post sheet', () => {
  it('opens pre-filled from the stored preference and writes what was changed', async () => {
    const onSaveHouse = vi.fn(
      async (): Promise<DigestWrite> => ({
        ok: true,
        digest: { ...DIGEST, digestEnabled: true, digestHour: 9 },
      }),
    );
    render(<DigestPost digest={DIGEST} onSaveHouse={onSaveHouse} />);
    fireEvent.click(screen.getByRole('button', { name: "The house's post" }));

    const checkbox = screen.getByRole('checkbox', { name: "Arm the house's post" });
    expect(checkbox).not.toBeChecked();
    fireEvent.click(checkbox);
    fireEvent.change(screen.getByLabelText('Digest hour'), { target: { value: '9' } });

    fireEvent.click(screen.getByRole('button', { name: 'Store it' }));
    await waitFor(() =>
      expect(onSaveHouse).toHaveBeenCalledWith({
        digestEnabled: true,
        digestHour: 9,
        digestMinUrgency: 'this_week',
      }),
    );
    // A successful write closes the sheet.
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Store it' })).not.toBeInTheDocument(),
    );
  });

  it('never claims an unset house has a stored hour — the sheet says so and labels the picker a starting point', () => {
    render(<DigestPost digest={UNSET_DIGEST} onSaveHouse={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: "The house's post" }));
    expect(
      screen.getByText(/This house has never stored a post preference/),
    ).toBeInTheDocument();
    expect(screen.getByText(/starting point, not yet stored/)).toBeInTheDocument();
  });

  it('keeps the sheet open and shows the gateway’s own refusal on a failed write', async () => {
    const onSaveHouse = vi.fn(
      async (): Promise<DigestWrite> => ({ ok: false, message: 'the hour must be 0-23', expired: false }),
    );
    render(<DigestPost digest={DIGEST} onSaveHouse={onSaveHouse} />);
    fireEvent.click(screen.getByRole('button', { name: "The house's post" }));
    fireEvent.click(screen.getByRole('button', { name: 'Store it' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('the hour must be 0-23'));
    expect(screen.getByRole('button', { name: /Store it/ })).toBeInTheDocument();
  });
});

describe('DigestPost — your copy sheet', () => {
  it('reads a 404 as "not merged here yet" rather than as a broken account', async () => {
    api.get.mockRejectedValue({ response: { status: 404, data: { message: 'not found' } } });
    render(<DigestPost digest={DIGEST} onSaveHouse={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Your copy' }));
    await waitFor(() =>
      expect(screen.getByText(/has not merged here yet/)).toBeInTheDocument(),
    );
    expect(screen.queryByText(/not claimed/)).not.toBeInTheDocument();
  });

  it('offers to ask for a copy when none exists, and shows the blockers first', async () => {
    api.get.mockResolvedValue({
      data: {
        armed: true,
        armedFlag: 'x',
        served: true,
        servedReason: null,
        unsubscribeLinkReady: false,
        house: { set: true, enabled: true, hour: 7, urgencyFloor: 'this_week' },
        timeZone: { zone: 'America/Los_Angeles', isFallback: false },
        isMember: true,
        subscription: null,
        preferences: {
          email: true,
          category: { key: 'ai', on: true },
          quietHours: { enabled: false, start: '22:00', end: '07:00' },
          usingDefaults: true,
        },
        willReceive: false,
        blockers: ['Not subscribed yet.'],
        nextDueAt: null,
        lastSend: null,
      },
    });
    render(<DigestPost digest={DIGEST} onSaveHouse={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Your copy' }));
    await waitFor(() => expect(screen.getByText('Not subscribed yet.')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /Ask for a copy/ })).toBeInTheDocument();
    expect(screen.getByText('None recorded.')).toBeInTheDocument();
  });

  it('offers to stop an existing subscription, and shows its last send', async () => {
    api.get.mockResolvedValue({
      data: {
        armed: true,
        armedFlag: 'x',
        served: true,
        servedReason: null,
        unsubscribeLinkReady: true,
        house: { set: true, enabled: true, hour: 7, urgencyFloor: 'this_week' },
        timeZone: { zone: 'America/Los_Angeles', isFallback: false },
        isMember: true,
        subscription: {
          frequency: 'daily',
          weekday: null,
          subscribedAt: '2026-09-07',
          updatedAt: '2026-09-07',
          unsubscribedAt: null,
          unsubscribedVia: null,
        },
        preferences: {
          email: true,
          category: { key: 'ai', on: true },
          quietHours: { enabled: false, start: '22:00', end: '07:00' },
          usingDefaults: true,
        },
        willReceive: true,
        blockers: [],
        nextDueAt: '2026-09-18T07:00:00-07:00',
        lastSend: {
          periodKey: 'd:2026-09-15',
          frequency: 'daily',
          dueAt: '2026-09-15T07:00:00-07:00',
          claimedAt: '2026-09-15T07:00:00-07:00',
          finishedAt: '2026-09-15T07:00:41-07:00',
          sentAt: '2026-09-15T07:00:41-07:00',
          outcome: 'sent',
          reason: null,
          entriesCount: 4,
        },
      },
    });
    render(<DigestPost digest={DIGEST} onSaveHouse={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Your copy' }));
    await waitFor(() => expect(screen.getByText('Daily')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /Stop my copy/ })).toBeInTheDocument();
    expect(screen.getByText(/sent/)).toBeInTheDocument();
    expect(screen.getByText(/4 entries/)).toBeInTheDocument();
  });
});
