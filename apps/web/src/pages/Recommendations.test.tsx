/**
 * The legacy `/recommendations` page — still what a house sees until the
 * rebuilt page is in `LIVE_PAGES` (ADR 0149 governs its deletion, not this).
 *
 * ADR 0191 round 3, the founder, 2026-09-21, answer 5: "Fix the message".
 * This page dismisses WHOLE rules, and a whole-rule dismissal is owner/manager
 * only (round 2), so the gateway refuses a staff dismissal here with a 403.
 * Before: the page said "Couldn't save that — try again" (a retry changes
 * nothing) and kept the card hidden until a reload. Now: the founder's
 * sentence, and the card comes back. Also pinned: what round 3 records a
 * choice as ("Already handled" is done, "Not right now" is the person's own
 * snooze) is what this page says and undoes.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn() }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }));

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { restaurantId: 'r1', role: 'staff' } }),
}));
vi.mock('../contexts/ToastContext', () => ({ useToast: () => toast }));
vi.mock('../components/layout/Header', () => ({ Header: () => null }));
vi.mock('../services/api/team', () => ({ getTeamMembers: vi.fn(async () => []) }));
vi.mock('../services/api/client', () => ({
  apiClient: api,
  getErrorMessage: (e: any) => e?.response?.data?.message ?? e?.message ?? 'failed',
}));

import Recommendations, { WHOLE_HOUSE_REFUSAL } from './Recommendations';

const REC = {
  ruleKey: 'vendor_concentration',
  observation: 'Purchasing is highly concentrated.',
  recommendation: 'Request quotes from one alternative vendor.',
  rationale: 'A warm second source is cheap insurance.',
  category: 'risk',
  urgency: 'this_month',
  score: 2,
};

function serve() {
  api.get.mockImplementation(async (url: string) => {
    if (url.includes('/digest')) return { data: { digestEnabled: false } };
    return {
      data: {
        recommendations: [REC],
        rulesEvaluated: 12,
        stateCounts: { active: 1, snoozed: 0, dismissed: 0, done: 0 },
      },
    };
  });
}

const feedReads = () =>
  api.get.mock.calls.filter(([u]) => u === '/analytics/recommendations/r1').length;

async function dismissWith(label: string) {
  render(
    <MemoryRouter>
      <Recommendations />
    </MemoryRouter>,
  );
  await screen.findByText(REC.observation);
  fireEvent.click(screen.getByRole('button', { name: /^Dismiss$/ }));
  fireEvent.click(await screen.findByText(label));
}

beforeEach(() => {
  api.get.mockReset();
  api.post.mockReset();
  toast.success.mockReset();
  toast.error.mockReset();
  serve();
});

describe('legacy /recommendations — the founder’s message for a refused whole-rule dismissal', () => {
  it('says the founder’s sentence on a 403, never "try again", and the card comes back', async () => {
    api.post.mockRejectedValue({ response: { status: 403, data: { message: 'Only an owner or manager' } } });
    await dismissWith('Not relevant');
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(WHOLE_HOUSE_REFUSAL));
    expect(WHOLE_HOUSE_REFUSAL).toBe(
      'Only an owner or manager can dismiss this for the whole house.',
    );
    expect(toast.error).not.toHaveBeenCalledWith("Couldn't save that — try again");
    // Nothing was dismissed, so nothing is hidden: the feed is read again.
    await waitFor(() => expect(feedReads()).toBeGreaterThanOrEqual(2));
    expect(await screen.findByText(REC.observation)).toBeInTheDocument();
    // No undo is offered for a dismissal that never happened.
    expect(screen.queryByRole('button', { name: /Undo/ })).not.toBeInTheDocument();
  });

  it('any other failure still says "try again" — that one might work', async () => {
    api.post.mockRejectedValue({ response: { status: 500 } });
    await dismissWith('Not relevant');
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Couldn't save that — try again"),
    );
  });
});

describe('legacy /recommendations — says what round 3 recorded', () => {
  it('"Already handled" is said as done', async () => {
    api.post.mockResolvedValue({ data: { recordedAs: 'done' } });
    await dismissWith('Already handled');
    expect(await screen.findByText('Recorded as done')).toBeInTheDocument();
  });

  it('"Not right now" is said as hidden from you, and Undo wakes it — not a house restore', async () => {
    api.post.mockResolvedValue({ data: { recordedAs: 'snoozed_for_you', row: null } });
    await dismissWith('Not right now');
    expect(
      await screen.findByText('Hidden from you — everyone else still sees it'),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Undo/ }));
    await waitFor(() =>
      expect(api.post).toHaveBeenLastCalledWith(
        '/analytics/recommendations/r1/snoozed-for-me/wake',
        { ruleKey: 'vendor_concentration' },
      ),
    );
  });
});
