/**
 * RecommendationsNext render contract — the REWORK verdict's structural
 * promises ("more structure and more uniqueness — find another way") and the
 * honesty rules, with the data hook mocked.
 *
 * What each test pins:
 *  - the register: entries filed under WHAT THEY WOULD CHANGE, with the three
 *    facts (would change · whose hand · standing) on every entry;
 *  - the denominator in the head — an empty book is a proven absence;
 *  - 401 said as a session, not as "request failed";
 *  - a failed read is words, never an empty list;
 *  - an unknown standing is an em dash, never a zero and never a guess;
 *  - act / dismiss / snooze / done / pin all survive, and `done` is the one
 *    sealed hold on the page;
 *  - the two controls with no backend (the house's hand, the digest) render
 *    disabled with the reason.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const mockData = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));
const navigate = vi.hoisted(() => vi.fn());

vi.mock('./useRecommendationsNextData', () => ({
  useRecommendationsNextData: () => mockData.current,
}));
vi.mock('react-router-dom', async (orig) => ({
  ...(await orig<typeof import('react-router-dom')>()),
  useNavigate: () => navigate,
}));

import RecommendationsNext from './RecommendationsNext';
import { handOf, stakeOf } from './rec-format';

function entry(over: Record<string, unknown> = {}) {
  const ruleKey = (over.ruleKey as string) ?? 'stockout_imminent';
  const category = (over.category as string) ?? 'inventory';
  return {
    ruleKey,
    observation: 'Chablis 2021 runs out in 3 days at the current pace.',
    recommendation: 'Draft a PO to the distributor today.',
    rationale: 'Lead time is 2 days; the cover is gone before the case lands.',
    category,
    urgency: 'now',
    stake: stakeOf(category),
    hand: handOf(ruleKey, category),
    score: 3,
    pinned: false,
    acted: false,
    status: 'active',
    reason: null,
    snoozeUntil: null,
    feedback: null,
    assignedTo: null,
    assignedName: null,
    updatedAt: null,
    ...over,
  };
}

const setDisposition = vi.fn(async () => {});
const bulk = vi.fn(async () => {});
const restore = vi.fn(async () => {});
const refetch = vi.fn();

const base = {
  leaf: 'standing',
  setLeaf: vi.fn(),
  phase: 'ready',
  entries: [],
  failure: null,
  counts: { active: 1, snoozed: 2, dismissed: 3, done: 4 },
  rulesEvaluated: 17,
  generatedAt: '2026-09-02T19:04:00.000Z',
  digest: { digestEnabled: false, digestHour: 7, digestMinUrgency: 'this_week', recipientEmail: null, lastSentAt: null },
  team: undefined,
  teamFailed: false,
  loadTeam: vi.fn(),
  note: null,
  undo: null,
  clearUndo: vi.fn(),
  refetch,
  setDisposition,
  restore,
  bulk,
};

const draw = (path = '/recommendations') =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <RecommendationsNext />
    </MemoryRouter>,
  );

beforeEach(() => {
  setDisposition.mockClear();
  bulk.mockClear();
  navigate.mockClear();
  mockData.current = { ...base, entries: [] };
});

describe('RecommendationsNext — the standing book', () => {
  it('files entries under what they would change and states the three facts on each', () => {
    mockData.current = {
      ...base,
      entries: [entry(), entry({ ruleKey: 'staff_spread', category: 'staff', urgency: 'this_week' })],
    };
    draw();

    // the register sections — the page's organising axis, not a score
    expect(screen.getByRole('heading', { name: 'Stock' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'The floor' })).toBeInTheDocument();

    const rows = screen.getAllByTestId('rc-entry');
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(within(row).getByText('Would change')).toBeInTheDocument();
      expect(within(row).getByText('Whose hand')).toBeInTheDocument();
      expect(within(row).getByText('Standing')).toBeInTheDocument();
    }
    // the hand names where the work actually lands
    expect(within(rows[0]).getByText(/Yours, in Orders/)).toBeInTheDocument();
    expect(within(rows[1]).getByText(/Yours, in Team/)).toBeInTheDocument();
  });

  it('prints the denominator so a short book is a proven absence', () => {
    mockData.current = { ...base, entries: [entry()] };
    draw();
    expect(screen.getByText(/17 rules were read\./)).toBeInTheDocument();
    expect(screen.getByText(/1 entry stands/)).toBeInTheDocument();
  });

  it('says an empty book is empty, and why it might be short', () => {
    draw();
    expect(screen.getByText(/17 rules were read, and none of them stands/)).toBeInTheDocument();
    expect(screen.getByText(/stay silent without a POS/)).toBeInTheDocument();
  });

  it('shows an em dash for a standing time nothing records', () => {
    mockData.current = { ...base, entries: [entry()] };
    draw();
    const row = screen.getByTestId('rc-entry');
    // "Standing" is unknown for an entry the store has never touched: a dash,
    // never "0 days", never today's date.
    expect(within(row).getByText('—')).toBeInTheDocument();
    expect(within(row).queryByText('0 days')).not.toBeInTheDocument();
  });

  it('says a 401 as an expired session, not as a failed request', () => {
    mockData.current = {
      ...base,
      phase: 'failed',
      entries: [],
      failure: { status: 401, message: 'Request failed', expired: true, forbidden: false },
    };
    draw();
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(/session has expired/);
    expect(alert).toHaveTextContent(/Nothing below is claimed/);
  });

  it('says any other failure in words with a retry, never as an empty book', () => {
    mockData.current = {
      ...base,
      phase: 'failed',
      entries: [],
      failure: { status: 500, message: 'upstream exploded', expired: false, forbidden: false },
    };
    draw();
    expect(screen.getByRole('alert')).toHaveTextContent(/could not be read \(upstream exploded\)/);
    expect(screen.getByRole('alert')).toHaveTextContent(/this is not an empty book/);
    fireEvent.click(screen.getByText('Read it again'));
    expect(refetch).toHaveBeenCalled();
  });

  it('keeps act, dismiss, snooze, pin — and seals only the ruling-off', () => {
    mockData.current = { ...base, entries: [entry()] };
    draw();
    const row = screen.getByTestId('rc-entry');

    fireEvent.click(within(row).getByText('Draft the PO →'));
    expect(setDisposition).toHaveBeenCalledWith(
      expect.objectContaining({ ruleKey: 'stockout_imminent' }),
      { acted: true },
      expect.any(String),
      false,
    );
    expect(navigate).toHaveBeenCalledWith(expect.stringContaining('/orders?rec=stockout_imminent'));

    fireEvent.click(within(row).getByText('Dismiss'));
    fireEvent.click(within(row).getByText('Already handled'));
    expect(setDisposition).toHaveBeenCalledWith(
      expect.anything(),
      { status: 'dismissed', reason: 'already_handled' },
      expect.any(String),
      true,
    );

    fireEvent.click(within(row).getByText('Snooze'));
    fireEvent.click(within(row).getByText('Until next week'));
    expect(setDisposition).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ status: 'snoozed' }),
      expect.any(String),
      true,
    );

    fireEvent.click(within(row).getByText('Pin'));
    expect(setDisposition).toHaveBeenCalledWith(
      expect.anything(),
      { pinned: true },
      expect.any(String),
      false,
    );

    // the seal is rationed to one act: ruling the entry off, inside the working
    // (which is closed — and aria-hidden — until asked for)
    expect(screen.queryByRole('button', { name: 'Hold to rule off' })).not.toBeInTheDocument();
    fireEvent.click(within(row).getByText('The working'));
    expect(within(row).getByRole('button', { name: 'Hold to rule off' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Hold to dismiss/ })).not.toBeInTheDocument();
  });

  it('renders the two controls with no backend disabled, each with its reason', () => {
    mockData.current = { ...base, entries: [entry()] };
    draw();
    fireEvent.click(within(screen.getByTestId('rc-entry')).getByText('The working'));

    const house = screen.getByRole('button', { name: 'Let Mudavym do it' });
    expect(house).toBeDisabled();
    expect(screen.getByText(/nothing in the gateway can carry out a recommendation/i)).toBeInTheDocument();

    const digest = screen.getByRole('button', { name: /Stored: off/ });
    expect(digest).toBeDisabled();
    expect(screen.getByText(/the preference stores, but nothing sends it/)).toBeInTheDocument();
  });

  it('moves and acts from the keyboard', () => {
    mockData.current = { ...base, entries: [entry()] };
    draw();
    fireEvent.keyDown(window, { key: 'j' });
    fireEvent.keyDown(window, { key: 'p' });
    expect(setDisposition).toHaveBeenCalledWith(
      expect.objectContaining({ ruleKey: 'stockout_imminent' }),
      { pinned: true },
      expect.any(String),
      false,
    );
    expect(screen.queryByRole('button', { name: 'Hold to rule off' })).not.toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'e' });
    expect(screen.getByRole('button', { name: 'Hold to rule off' })).toBeInTheDocument();
  });

  it('bulk-dismisses a selection with the dry die, no seal', () => {
    mockData.current = { ...base, entries: [entry(), entry({ ruleKey: 'dead_stock_capital' })] };
    draw();
    fireEvent.click(within(screen.getAllByTestId('rc-entry')[0]).getByText('Select'));
    expect(screen.getByText('1 selected')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Dismiss them'));
    expect(bulk).toHaveBeenCalledWith(
      [expect.objectContaining({ ruleKey: 'stockout_imminent' })],
      expect.objectContaining({ status: 'dismissed' }),
      expect.stringContaining('1'),
    );
  });

  it('opens the entry an ?insight= link asks for, and admits when it cannot', () => {
    mockData.current = { ...base, entries: [entry(), entry({ ruleKey: 'staff_spread', category: 'staff' })] };
    const { unmount } = draw('/recommendations?insight=staff_spread');
    // exactly one working is open, and it belongs to the linked entry: a
    // collapsed panel is aria-hidden, so *ByRole cannot see into it.
    const seals = screen.getAllByRole('button', { name: 'Hold to rule off' });
    expect(seals).toHaveLength(1);
    expect(seals[0].closest('article')).toHaveAttribute('id', 'rc-entry-staff_spread');
    unmount();

    // a link to something that is not standing says so instead of landing mute
    mockData.current = { ...base, entries: [entry()] };
    draw('/recommendations?insight=gone_rule');
    expect(screen.getByText(/which is not standing/)).toBeInTheDocument();
  });

  it('keeps every leaf, and a snoozed entry says when it wakes', () => {
    const wakes = new Date(Date.now() + 3 * 86_400_000).toISOString();
    mockData.current = {
      ...base,
      leaf: 'snoozed',
      entries: [entry({ status: 'snoozed', snoozeUntil: wakes, updatedAt: new Date().toISOString() })],
    };
    draw();
    for (const label of ['Standing', 'Snoozed', 'Dismissed', 'Ruled off', 'History'])
      expect(screen.getByRole('button', { name: new RegExp(`^${label}`) })).toBeInTheDocument();
    const row = screen.getByTestId('rc-entry');
    expect(within(row).getByText('Wakes')).toBeInTheDocument();
    expect(within(row).getByText('wakes in 3 days')).toBeInTheDocument();
    // a snoozed entry is not acted on from here — it is returned to the book
    expect(within(row).getByText('Return it to the book')).toBeInTheDocument();
    expect(within(row).queryByText(/Draft the PO/)).not.toBeInTheDocument();
  });
});
