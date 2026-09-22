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
 *
 * ADR 0191 round 4, the founder, 2026-09-21 ("Take all seven" — the options
 * he picked): Done and "Already handled" act on THIS card's own key, never the
 * whole rule (answer 4); the quick Dismiss, its `d` key and the bulk Dismiss
 * stay the person's own one-day "Not now" (answer 3, confirmed); a return of
 * someone else's act is refused in its own words, and a tab row the gateway
 * says is not yours offers no Restore (answer 5).
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

import Recommendations, { NO_CARD_KEY, WHOLE_HOUSE_REFUSAL, cardKeyOf } from './Recommendations';

/** This card's own key, as the gateway sends it: the rule plus this month's firing. */
const FIRING = 'vendor_concentration#*#fire:month:2026-09';

const REC = {
  ruleKey: 'vendor_concentration',
  observation: 'Purchasing is highly concentrated.',
  recommendation: 'Request quotes from one alternative vendor.',
  rationale: 'A warm second source is cheap insurance.',
  category: 'risk',
  urgency: 'this_month',
  score: 2,
  suppression: {
    key: FIRING,
    scope: 'insight',
    keys: { insight: FIRING, subject: FIRING, rule: 'vendor_concentration' },
  },
};

function serve(recs: unknown[] = [REC], tabRows: unknown[] = []) {
  api.get.mockImplementation(async (url: string) => {
    if (url.includes('/digest')) return { data: { digestEnabled: false } };
    if (url.includes('/actions?status=')) return { data: { items: tabRows } };
    return {
      data: {
        recommendations: recs,
        rulesEvaluated: 12,
        stateCounts: { active: 1, snoozed: 0, dismissed: 1, done: 0 },
      },
    };
  });
}

function mount() {
  render(
    <MemoryRouter>
      <Recommendations />
    </MemoryRouter>,
  );
}

/** The card's own Done — the tab bar has a "Done" tab above the cards. */
const cardDone = () => {
  const all = screen.getAllByRole('button', { name: /^Done$/ });
  return all[all.length - 1];
};

const actionPosts = () =>
  api.post.mock.calls.filter(([u]) => u === '/analytics/recommendations/r1/action');

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

describe('legacy /recommendations — round 4, answer 4: Done is this card, never the whole rule', () => {
  it('reads the card key the gateway sent, and nothing else', () => {
    expect(cardKeyOf(REC)).toBe(FIRING);
    expect(cardKeyOf({ suppression: null })).toBeNull();
    expect(cardKeyOf({ suppression: { key: '  ' } })).toBeNull();
    expect(cardKeyOf({ suppression: { key: 7 } })).toBeNull();
  });

  it('Done writes done at the card’s own key, and Undo returns that key', async () => {
    api.post.mockResolvedValue({ data: { recordedAs: 'done' } });
    mount();
    await screen.findByText(REC.observation);
    fireEvent.click(cardDone());
    await waitFor(() => expect(actionPosts()).toHaveLength(1));
    expect(actionPosts()[0][1]).toMatchObject({ ruleKey: FIRING, status: 'done' });
    fireEvent.click(await screen.findByRole('button', { name: /Undo/ }));
    await waitFor(() => expect(actionPosts()).toHaveLength(2));
    expect(actionPosts()[1][1]).toMatchObject({ ruleKey: FIRING, status: 'active' });
  });

  it('"Already handled" is written at the card’s own key too', async () => {
    api.post.mockResolvedValue({ data: { recordedAs: 'done' } });
    await dismissWith('Already handled');
    await waitFor(() => expect(actionPosts()).toHaveLength(1));
    expect(actionPosts()[0][1]).toMatchObject({
      ruleKey: FIRING,
      status: 'dismissed',
      reason: 'already_handled',
    });
  });

  it('a card that came without its own key writes nothing — never the whole rule', async () => {
    const { suppression: _dropped, ...bare } = REC;
    serve([bare]);
    mount();
    await screen.findByText(REC.observation);
    fireEvent.click(cardDone());
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(NO_CARD_KEY));
    expect(actionPosts()).toEqual([]);
    expect(screen.getByText(REC.observation)).toBeInTheDocument();
  });

  it('a real dismissal keeps the key it had (the whole-rule door, owner/manager)', async () => {
    api.post.mockResolvedValue({ data: { recordedAs: 'dismissed' } });
    await dismissWith('Not relevant');
    await waitFor(() => expect(actionPosts()).toHaveLength(1));
    expect(actionPosts()[0][1]).toMatchObject({
      ruleKey: 'vendor_concentration',
      reason: 'not_relevant',
    });
  });
});

describe('legacy /recommendations — round 4, answer 3 (confirmed): the quick Dismiss is "Not now"', () => {
  it('the d key sends "Not now" — the person’s own one-day snooze at the gateway', async () => {
    api.post.mockResolvedValue({ data: { recordedAs: 'snoozed_for_you', row: null } });
    mount();
    await screen.findByText(REC.observation);
    fireEvent.keyDown(window, { key: 'd' });
    await waitFor(() => expect(actionPosts()).toHaveLength(1));
    expect(actionPosts()[0][1]).toMatchObject({
      ruleKey: 'vendor_concentration',
      status: 'dismissed',
      reason: 'not_now',
    });
    // No instant: the gateway's one day (item-state NOT_NOW_DEFAULT_MS).
    expect(actionPosts()[0][1]).not.toHaveProperty('snoozeUntil');
  });

  it('the right-click Dismiss sends "Not now"', async () => {
    api.post.mockResolvedValue({ data: { recordedAs: 'snoozed_for_you', row: null } });
    mount();
    const card = await screen.findByText(REC.observation);
    fireEvent.contextMenu(card, { clientX: 10, clientY: 10 });
    const items = await screen.findAllByRole('button', { name: /^Dismiss$/ });
    fireEvent.click(items[items.length - 1]);
    await waitFor(() => expect(actionPosts()).toHaveLength(1));
    expect(actionPosts()[0][1]).toMatchObject({ status: 'dismissed', reason: 'not_now' });
  });

  it('the bulk Dismiss sends "Not now" for the selection', async () => {
    api.post.mockResolvedValue({ data: { updated: 1, snoozedForYou: 1 } });
    mount();
    await screen.findByText(REC.observation);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select recommendation' }));
    const dismissButtons = screen.getAllByRole('button', { name: /^Dismiss$/ });
    // The bulk bar's is the first on the page (it sits above the cards).
    fireEvent.click(dismissButtons[0]);
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/analytics/recommendations/r1/bulk-action', {
        items: [expect.objectContaining({ ruleKey: 'vendor_concentration' })],
        status: 'dismissed',
        reason: 'not_now',
      }),
    );
  });
});

describe('legacy /recommendations — round 4, answer 5: staff undo only their own acts', () => {
  const ROW = {
    ruleKey: FIRING,
    status: 'dismissed',
    reason: 'not_relevant',
    observation: 'Purchasing is highly concentrated.',
    category: 'risk',
    urgency: 'this_month',
  };

  it('a Dismissed row the gateway says is not yours offers no Restore, and says why', async () => {
    serve([REC], [{ ...ROW, undoableByYou: false }]);
    mount();
    await screen.findByText(REC.observation);
    fireEvent.click(screen.getByRole('button', { name: /^Dismissed/ }));
    const blocked = await screen.findByTestId('rec-restore-not-yours');
    expect(blocked).toBeDisabled();
    expect(
      screen.getByText('Only the person who did this, or an owner or manager, can undo it.'),
    ).toBeInTheDocument();
    fireEvent.click(blocked);
    expect(actionPosts()).toEqual([]);
  });

  it('a row that is yours — or that the gateway could not tell — keeps its Restore', async () => {
    for (const undoableByYou of [true, null]) {
      api.post.mockReset();
      api.post.mockResolvedValue({ data: {} });
      serve([REC], [{ ...ROW, undoableByYou }]);
      const view = render(
        <MemoryRouter>
          <Recommendations />
        </MemoryRouter>,
      );
      await screen.findByText(REC.observation);
      fireEvent.click(screen.getByRole('button', { name: /^Dismissed/ }));
      fireEvent.click(await screen.findByRole('button', { name: /Restore to feed/ }));
      await waitFor(() => expect(actionPosts()).toHaveLength(1));
      expect(actionPosts()[0][1]).toMatchObject({ ruleKey: FIRING, status: 'active' });
      expect(screen.queryByTestId('rec-restore-not-yours')).not.toBeInTheDocument();
      view.unmount();
    }
  });

  it('a refused return of someone else’s act says the gateway’s sentence, not the whole-house one', async () => {
    const said = 'It is not recorded who did this, so only an owner or manager can undo it.';
    api.post.mockRejectedValue({
      response: { status: 403, data: { statusCode: 403, message: said, code: 'not_your_act' } },
    });
    serve([REC], [{ ...ROW, undoableByYou: null }]);
    mount();
    await screen.findByText(REC.observation);
    fireEvent.click(screen.getByRole('button', { name: /^Dismissed/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Restore to feed/ }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(said));
    expect(toast.error).not.toHaveBeenCalledWith(
      'Only an owner or manager can return this for the whole house.',
    );
  });

  it('a bulk act refused as someone else’s says the gateway’s sentence too', async () => {
    const said = "Only an owner or manager can undo someone else's act (2 in this selection).";
    api.post.mockRejectedValue({
      response: { status: 403, data: { statusCode: 403, message: said, code: 'not_your_act' } },
    });
    mount();
    await screen.findByText(REC.observation);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select recommendation' }));
    fireEvent.click(screen.getAllByRole('button', { name: /^Dismiss$/ })[0]);
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(said));
    expect(toast.error).not.toHaveBeenCalledWith(WHOLE_HOUSE_REFUSAL);
  });
});

/**
 * ADR 0191 round 5 (the founder, 2026-09-22, "Gate like acts"): a pin, a
 * rating or an assignment is gated the way an act is — someone else's is
 * refused (403, `not_your_note`), and any from the platform admin. This page
 * is what a house sees, so a refused note must say the gateway's words (never
 * the whole-house dismiss sentence), be put back as it was, and never be
 * followed by a success toast.
 */
describe('legacy /recommendations — round 5, answer 2: someone else’s note', () => {
  const SAID = 'Only the person who made this note, or an owner or manager, can change or clear it.';
  const refuse = () =>
    api.post.mockRejectedValue({
      response: { status: 403, data: { statusCode: 403, message: SAID, code: 'not_your_note' } },
    });

  it('a refused unpin says the gateway’s sentence and the card stays pinned', async () => {
    refuse();
    serve([{ ...REC, pinned: true }]);
    mount();
    await screen.findByText(REC.observation);
    expect(screen.getByText('Pinned')).toBeInTheDocument();
    fireEvent.click(screen.getByTitle('Pin to top'));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(SAID));
    expect(toast.error).not.toHaveBeenCalledWith(WHOLE_HOUSE_REFUSAL);
    expect(actionPosts()[0][1]).toMatchObject({ pinned: false });
    await waitFor(() => expect(screen.getByText('Pinned')).toBeInTheDocument());
  });

  it('a refused rating is put back as it was', async () => {
    refuse();
    serve([{ ...REC, feedback: 'helpful' }]);
    mount();
    await screen.findByText(REC.observation);
    fireEvent.click(screen.getByTitle('Not helpful'));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(SAID));
    await waitFor(() => expect(screen.getByTitle('Helpful').className).toMatch(/text-emerald-600/));
    expect(screen.getByTitle('Not helpful').className).not.toMatch(/text-rose-600/);
  });

  it('a refused clear of someone else’s assignment says so — no "Assignment cleared", the name stays', async () => {
    refuse();
    serve([{ ...REC, assignedTo: 'u-cook', assignedName: 'Cook' }]);
    mount();
    const card = await screen.findByText(REC.observation);
    fireEvent.contextMenu(card, { clientX: 10, clientY: 10 });
    fireEvent.click(await screen.findByRole('button', { name: /Assigned: Cook/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Clear assignment/ }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(SAID));
    expect(actionPosts()[0][1]).toMatchObject({ assignedTo: null, assignedName: null });
    expect(toast.success).not.toHaveBeenCalledWith('Assignment cleared');
    expect(await screen.findByText('Cook')).toBeInTheDocument();
  });
});
