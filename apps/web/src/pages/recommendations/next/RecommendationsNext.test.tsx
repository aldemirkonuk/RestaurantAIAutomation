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
 *
 * Second pass (2026-09-03), the founder's review:
 *  - a dismissal ASKS what to silence — this finding · this subject · the whole
 *    rule — defaults to the exact finding, and never invents its own key;
 *  - it offers, separately, to take the day out of the analysis, and refuses
 *    to offer that when the store cannot be read;
 *  - the entry then states in words what will never be shown, and where to
 *    undo it;
 *  - "standing" is the real first-fired date, and says which clock it read.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
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
    firstSeenAt: null,
    subject: null,
    periodKey: null,
    // The gateway builds the keys; the page never does. A rule with no subject
    // and no period collapses all three to the bare key — which is exactly the
    // case the sheet has to disclose.
    suppression: {
      key: ruleKey,
      scope: 'rule',
      keys: { insight: ruleKey, subject: ruleKey, rule: ruleKey },
    },
    ...over,
  };
}

/** The founder's own example: a weekday finding, with all three scopes real. */
function weekdayEntry(over: Record<string, unknown> = {}) {
  const ruleKey = 'sales_below_weekday_baseline';
  return entry({
    ruleKey,
    category: 'sales',
    observation:
      'Wednesday sales came in 40% lower than your average Wednesday ($600 vs $1.0k, over 12 past Wednesdays).',
    subject: 'Wednesday',
    periodKey: 'd:2026-09-02',
    suppression: {
      key: `${ruleKey}#wednesday#d:2026-09-02`,
      scope: 'insight',
      keys: {
        insight: `${ruleKey}#wednesday#d:2026-09-02`,
        subject: `${ruleKey}#wednesday#*`,
        rule: ruleKey,
      },
    },
    ...over,
  });
}

const setDisposition = vi.fn(async () => true);
const dismissFn = vi.fn(async () => {});
const includeDay = vi.fn(async () => {});
const excludeDay = vi.fn(async () => true);
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
  suppressed: 0,
  suppressionsReadable: true,
  exclusions: { items: [], readable: true, problem: null },
  excludeDay,
  includeDay,
  digest: { digestEnabled: false, digestHour: 7, digestMinUrgency: 'this_week', recipientEmail: null, lastSentAt: null },
  team: undefined,
  teamFailed: false,
  loadTeam: vi.fn(),
  note: null,
  undo: null,
  clearUndo: vi.fn(),
  refetch,
  setDisposition,
  dismiss: dismissFn,
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
  dismissFn.mockClear();
  excludeDay.mockClear();
  includeDay.mockClear();
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

  it('shows an em dash for a standing time nothing records, and says so', () => {
    mockData.current = { ...base, entries: [entry()] };
    draw();
    const row = screen.getByTestId('rc-entry');
    // "Standing" is unknown when NOTHING recorded a first firing: a dash,
    // never "0 days", never today's date — and the page names the gap.
    expect(within(row).getByText('—')).toBeInTheDocument();
    expect(within(row).queryByText('0 days')).not.toBeInTheDocument();
    expect(
      within(row).getByText(/nothing has recorded when this entry first fired/),
    ).toBeInTheDocument();
  });

  it('reads standing from the first impression, and says which clock that is', () => {
    mockData.current = {
      ...base,
      entries: [
        weekdayEntry({
          firstSeenAt: new Date(Date.now() - 4 * 86_400_000).toISOString(),
          // The disposition clock says something DIFFERENT, and must not win:
          // when the book last recorded a decision is not when the rule fired.
          updatedAt: new Date().toISOString(),
        }),
      ],
    };
    draw();
    const row = screen.getByTestId('rc-entry');
    expect(within(row).getByText('4 days')).toBeInTheDocument();
    expect(within(row).getByText(/since it was first shown to you/)).toBeInTheDocument();
  });

  it('falls back to the disposition clock only when it must, and labels it', () => {
    mockData.current = {
      ...base,
      entries: [entry({ updatedAt: new Date(Date.now() - 2 * 86_400_000).toISOString() })],
    };
    draw();
    const row = screen.getByTestId('rc-entry');
    expect(within(row).getByText('2 days')).toBeInTheDocument();
    expect(
      within(row).getByText(/not when it first fired/),
    ).toBeInTheDocument();
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

  it('keeps act, dismiss, snooze, pin — and seals only the ruling-off', async () => {
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
    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith(
        expect.stringContaining('/orders?rec=stockout_imminent'),
      ),
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

  it('does not leave the page when the "acted" write did not land', async () => {
    // `navigate()` unmounts this page synchronously, so a fire-and-forget write
    // rolled back and apologised on a component nobody was looking at. The
    // audit trail of "I followed this" is the whole point of the write, and
    // leaving with it silently unrecorded is the failure the page refuses.
    setDisposition.mockResolvedValueOnce(false);
    mockData.current = { ...base, entries: [entry()] };
    draw();
    fireEvent.click(within(screen.getByTestId('rc-entry')).getByText('Draft the PO →'));
    await waitFor(() => expect(setDisposition).toHaveBeenCalled());
    expect(navigate).not.toHaveBeenCalled();
    // …and the control is still there to try again.
    expect(within(screen.getByTestId('rc-entry')).getByText('Draft the PO →')).toBeInTheDocument();
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

  it('the d key opens the dismissal sheet — it never dismisses on its own', () => {
    mockData.current = { ...base, entries: [weekdayEntry()] };
    draw();
    fireEvent.keyDown(window, { key: 'j' });
    fireEvent.keyDown(window, { key: 'd' });
    // A dismissal now carries a scope; a keystroke cannot choose one.
    expect(dismissFn).not.toHaveBeenCalled();
    expect(screen.getByRole('group', { name: 'Dismiss this entry' })).toBeInTheDocument();
  });

  it('bulk-dismisses a selection with the dry die, no seal', () => {
    mockData.current = { ...base, entries: [entry(), entry({ ruleKey: 'dead_stock_capital' })] };
    draw();
    fireEvent.click(within(screen.getAllByTestId('rc-entry')[0]).getByText('Select'));
    expect(screen.getByText('1 selected')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Dismiss them — whole rules'));
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

describe('dismissal — the standing instruction, asked for and said back', () => {
  const openSheet = () => {
    const row = screen.getByTestId('rc-entry');
    fireEvent.click(within(row).getByText('Dismiss'));
    return row;
  };

  it('asks all three scopes, and starts on the exact finding', () => {
    mockData.current = { ...base, entries: [weekdayEntry()] };
    draw();
    const row = openSheet();

    const exact = within(row).getByRole('radio', {
      name: /This exact finding — Wed 2 Sep/,
    });
    const everyWed = within(row).getByRole('radio', { name: /Every Wednesday, for this rule/ });
    const whole = within(row).getByRole('radio', {
      name: /This rule entirely, for this restaurant/,
    });
    expect(exact).toBeChecked();
    expect(everyWed).not.toBeChecked();
    expect(whole).not.toBeChecked();
  });

  it('posts the gateway key for the scope chosen — never one it built itself', () => {
    mockData.current = { ...base, entries: [weekdayEntry()] };
    draw();
    const row = openSheet();

    fireEvent.click(within(row).getByText('Already handled'));
    fireEvent.click(within(row).getByRole('radio', { name: /Every Wednesday/ }));
    fireEvent.click(within(row).getByText('Dismiss it'));

    expect(dismissFn).toHaveBeenCalledWith(
      expect.objectContaining({ ruleKey: 'sales_below_weekday_baseline' }),
      expect.objectContaining({
        reason: 'already_handled',
        scope: 'subject',
        key: 'sales_below_weekday_baseline#wednesday#*',
        excludeDate: null,
      }),
    );
  });

  it('will not dismiss without a reason, and says why the button is dark', () => {
    mockData.current = { ...base, entries: [weekdayEntry()] };
    draw();
    const row = openSheet();
    expect(within(row).getByRole('button', { name: 'Dismiss it' })).toBeDisabled();
    expect(within(row).getByText(/Pick a reason first/)).toBeInTheDocument();
    fireEvent.click(within(row).getByText('Dismiss it'));
    expect(dismissFn).not.toHaveBeenCalled();
  });

  it('states what will never be shown, before the manager commits', () => {
    mockData.current = { ...base, entries: [weekdayEntry()] };
    draw();
    const row = openSheet();
    expect(
      within(row).getByText(/this one finding about Wednesday on Wed 2 Sep/),
    ).toBeInTheDocument();
    expect(within(row).getByText(/Undo it from the History leaf/)).toBeInTheDocument();

    fireEvent.click(within(row).getByRole('radio', { name: /This rule entirely/ }));
    expect(
      within(row).getByText(/anything the rule sales_below_weekday_baseline finds/),
    ).toBeInTheDocument();
  });

  it('offers no narrower silence than the rule can support, and discloses it', () => {
    // `stockout_imminent` names no weekday and no date: all three gateway keys
    // are the bare rule key, so there is exactly one honest choice.
    mockData.current = { ...base, entries: [entry()] };
    draw();
    const row = openSheet();
    const only = within(row).getAllByRole('radio');
    expect(only).toHaveLength(1);
    // …and it is NAMED as what it is. Calling a total silence "this exact
    // finding" because it happens to be the narrowest key available would
    // promise something the store cannot keep.
    expect(only[0]).toHaveAccessibleName(/This rule entirely/);
    expect(
      within(row).getByText(/no narrower silence to offer/),
    ).toBeInTheDocument();
    expect(
      within(row).getByText(/anything the rule stockout_imminent finds/),
    ).toBeInTheDocument();
  });

  it('names the subject scope as the narrowest when the rule has no period', () => {
    const ruleKey = 'staff_spread';
    mockData.current = {
      ...base,
      entries: [
        entry({
          ruleKey,
          category: 'staff',
          subject: 'Ada',
          periodKey: null,
          suppression: {
            key: `${ruleKey}#ada#*`,
            scope: 'subject',
            keys: {
              insight: `${ruleKey}#ada#*`,
              subject: `${ruleKey}#ada#*`,
              rule: ruleKey,
            },
          },
        }),
      ],
    };
    draw();
    const row = openSheet();
    const radios = within(row).getAllByRole('radio');
    expect(radios).toHaveLength(2);
    expect(radios[0]).toHaveAccessibleName(/Every Ada, for this rule/);
    expect(radios[0]).toBeChecked();
    expect(radios[1]).toHaveAccessibleName(/This rule entirely/);
  });

  it('offers the day exclusion separately, and carries it on the choice', () => {
    mockData.current = { ...base, entries: [weekdayEntry()] };
    draw();
    const row = openSheet();
    const box = within(row).getByRole('checkbox', {
      name: /Also exclude Wed 2 Sep from the analysis/,
    });
    expect(box).toBeEnabled();
    fireEvent.click(box);
    fireEvent.click(within(row).getByText('Not relevant'));
    fireEvent.click(within(row).getByText('Dismiss it'));
    expect(dismissFn).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ excludeDate: '2026-09-02' }),
    );
  });

  it('refuses the exclusion when the store cannot be read, and says why', () => {
    mockData.current = {
      ...base,
      entries: [weekdayEntry()],
      exclusions: {
        items: [],
        readable: false,
        problem: "Could not find the table 'public.analytics_day_exclusions'",
      },
    };
    draw();
    const row = openSheet();
    expect(
      within(row).getByRole('checkbox', { name: /Also exclude/ }),
    ).toBeDisabled();
    expect(
      within(row).getByText(/The exclusion store could not be read/),
    ).toBeInTheDocument();
  });

  it('offers nothing to exclude when the entry names no day', () => {
    mockData.current = { ...base, entries: [entry()] };
    draw();
    const row = openSheet();
    expect(within(row).getByRole('checkbox', { name: /Also exclude/ })).toBeDisabled();
    expect(within(row).getByText(/names no single day/)).toBeInTheDocument();
  });

  it('a dismissed entry says what is silenced and how to bring it back', () => {
    mockData.current = {
      ...base,
      leaf: 'dismissed',
      entries: [
        weekdayEntry({
          ruleKey: 'sales_below_weekday_baseline#wednesday#d:2026-09-02',
          status: 'dismissed',
        }),
      ],
    };
    draw();
    const said = screen.getByTestId('rc-silenced');
    expect(said).toHaveTextContent(/this one finding about wednesday on Wed 2 Sep/i);
    expect(said).toHaveTextContent(/The rule still reads every other day/);
    expect(screen.getByText('Return it to the book')).toBeInTheDocument();
  });

  it('counts what a dismissal withheld, so the denominator still adds up', () => {
    mockData.current = { ...base, entries: [weekdayEntry()], suppressed: 2 };
    draw();
    expect(screen.getByTestId('rc-suppressed')).toHaveTextContent(
      /2 entries were withheld because you dismissed them/,
    );
  });

  it('admits when the dismissal store could not be read at all', () => {
    mockData.current = {
      ...base,
      entries: [weekdayEntry()],
      suppressed: null,
      suppressionsReadable: false,
    };
    draw();
    // The dangerous failure is the silent one: a page that looks clean while
    // the dismissals never reached the engine.
    expect(screen.getByTestId('rc-suppressed')).toHaveTextContent(
      /may be standing below/,
    );
  });

  it('lists the days ruled out of the analysis, and can count one again', () => {
    mockData.current = {
      ...base,
      entries: [weekdayEntry()],
      exclusions: {
        items: [{ businessDate: '2026-09-02', reason: 'closed for the holiday', createdAt: null }],
        readable: true,
        problem: null,
      },
    };
    draw();
    expect(screen.getByText('Wed 2 Sep')).toBeInTheDocument();
    expect(screen.getByText('closed for the holiday')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Count it again'));
    expect(includeDay).toHaveBeenCalledWith('2026-09-02');
  });
});
