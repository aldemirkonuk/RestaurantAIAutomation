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

/**
 * The ribbon's window is relative to "now", so every fixture date is derived
 * rather than written down: a literal would rot out of the window the next day
 * and the test would start asserting nothing.
 */
const dayKey = (back: number) =>
  new Date(Date.now() - back * 86_400_000).toISOString().substring(0, 10);
const TODAY = dayKey(0);
const TILL_FROM = dayKey(21);
/** A day inside the window that DID carry a record. */
const TILL_DAY = dayKey(3);

const setDisposition = vi.fn(async () => true);
const dismissFn = vi.fn(async () => {});
const includeDay = vi.fn(async () => {});
const excludeDay = vi.fn(async () => true);
const ruleOutDay = vi.fn(async () => {});
const bulk = vi.fn(async () => {});
const restore = vi.fn(async () => {});
const refetch = vi.fn();
const loadGoals = vi.fn();
interface GoalInput {
  name: string;
  metricKey: string;
  targetValue: number;
  direction: 'at_least' | 'at_most';
  period: string;
  deadline: string;
  /** The rule the goal remembers it came from (migration `20260903161000`). */
  sourceRuleKey?: string;
}
interface GoalRes {
  ok: boolean;
  goal?: Record<string, unknown>;
  message?: string;
  expired?: boolean;
}
const createGoal = vi.fn(async (_input: GoalInput): Promise<GoalRes> => ({
  ok: true,
  goal: {
    id: 'g1',
    name: 'Wine revenue back to baseline',
    metricKey: 'wine_revenue',
    targetValue: 2500,
    currentValue: 0,
    deadline: '2026-09-10',
    status: 'active',
  },
}));

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
  ruleOutDay,
  includeDay,
  digest: { digestEnabled: false, digestHour: 7, digestMinUrgency: 'this_week', recipientEmail: null, lastSentAt: null },
  team: undefined,
  teamFailed: false,
  loadTeam: vi.fn(),
  goals: [] as unknown,
  loadGoals,
  createGoal,
  // The till window behind the ribbon's record marks. A window with ONE day in
  // its series is the interesting fixture: every other day in it is absent,
  // which is what "no records" means and what must not become a zero.
  pos: {
    connected: true,
    from: TILL_FROM,
    to: TODAY,
    byDay: { [TILL_DAY]: 612 },
  } as unknown,
  posProblem: null,
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
  ruleOutDay.mockClear();
  bulk.mockClear();
  navigate.mockClear();
  loadGoals.mockClear();
  createGoal.mockClear();
  mockData.current = { ...base, entries: [] };
});

describe('RecommendationsNext — the standing book', () => {
  it('files entries under THE ACT — the docket — and states the three facts on each', () => {
    mockData.current = {
      ...base,
      entries: [entry(), entry({ ruleKey: 'staff_spread', category: 'staff', urgency: 'this_week' })],
    };
    draw();

    // THE REWORK. The docket's sections are acts, not registers: a stockout is
    // an order and a server spread is a pre-shift. Filing both under what they
    // would CHANGE (stock · the floor) put two different jobs in two sections
    // that told nobody what to do with their hands.
    expect(screen.getByRole('heading', { name: 'Order it' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Brief the floor' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Stock' })).not.toBeInTheDocument();
    // the register survives as the rail that cuts across the docket
    expect(screen.getByRole('button', { name: /Stock/ })).toBeInTheDocument();

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

/**
 * Fourth pass, 2026-09-03 — the two forward doors.
 *
 * The founder asked for "couple buttons — that will let them set the
 * recommendations as goals, or have them see this changes in reports". These
 * pin what the buttons actually do, and — the load-bearing half — what they
 * refuse to do: a rule with no measurable metric and a rule with no cutting
 * both render DARK with the reason, rather than sending a manager to the
 * wrong figure or the wrong drawing.
 */
describe('RecommendationsNext — the two forward doors', () => {
  it('classifies the controls into carrying out and filing', () => {
    mockData.current = { ...base, entries: [weekdayEntry()] };
    draw();
    const row = screen.getAllByTestId('rc-entry')[0];
    expect(within(row).getByText('Carry it out')).toBeInTheDocument();
    expect(within(row).getByText('File it')).toBeInTheDocument();
  });

  it('opens a goal sheet with the metric, direction and period derived from the rule', () => {
    mockData.current = { ...base, entries: [weekdayEntry()] };
    draw();
    fireEvent.click(screen.getByText('Make this a goal'));
    expect(loadGoals).toHaveBeenCalled();
    // wine revenue, at least, over the week the "now" urgency implies
    expect(screen.getByText('Wine revenue')).toBeInTheDocument();
    expect(screen.getByLabelText("The goal's period")).toBeInTheDocument();
    const week = screen.getByRole('radio', { name: 'This week' }) as HTMLInputElement;
    expect(week.checked).toBe(true);
    // and it says why THIS metric, rather than leaving the mapping unexplained
    expect(screen.getByText(/same weekday.s baseline/)).toBeInTheDocument();
  });

  it('will not invent the target, and refuses to write without one', () => {
    mockData.current = { ...base, entries: [weekdayEntry()] };
    draw();
    fireEvent.click(screen.getByText('Make this a goal'));
    const target = screen.getByLabelText('Target in $') as HTMLInputElement;
    expect(target.value).toBe('');
    expect(screen.getByText(/will not invent the number/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Set the goal' })).toBeDisabled();
    fireEvent.change(target, { target: { value: '0' } });
    expect(screen.getByRole('button', { name: 'Set the goal' })).toBeDisabled();
  });

  it('writes the goal with everything the gateway needs, and nothing it did not ask for', async () => {
    mockData.current = { ...base, entries: [weekdayEntry()] };
    draw();
    fireEvent.click(screen.getByText('Make this a goal'));
    fireEvent.change(screen.getByLabelText('Target in $'), { target: { value: '2500' } });
    fireEvent.click(screen.getByRole('button', { name: 'Set the goal' }));
    await waitFor(() => expect(createGoal).toHaveBeenCalled());
    const sent = createGoal.mock.calls[0][0];
    expect(sent).toMatchObject({
      metricKey: 'wine_revenue',
      targetValue: 2500,
      direction: 'at_least',
      period: 'week',
    });
    expect(sent.name).toBe('Wednesday wine revenue back to baseline');
    expect(sent.deadline).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // an actor id is never sent from the client — the JWT is the only witness
    expect(sent).not.toHaveProperty('createdBy');
  });

  it('stores a rate as a fraction — 60% typed is 0.6 written', async () => {
    mockData.current = {
      ...base,
      entries: [entry({ ruleKey: 'pairing_promotion', category: 'basket', urgency: 'this_week' })],
    };
    draw();
    fireEvent.click(screen.getByText('Make this a goal'));
    fireEvent.change(screen.getByLabelText('Target in %'), { target: { value: '60' } });
    expect(screen.getByText(/Stored as 0\.6/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Set the goal' }));
    await waitFor(() => expect(createGoal).toHaveBeenCalled());
    expect(createGoal.mock.calls[0][0].targetValue).toBe(0.6);
  });

  it("shows the gateway's own refusal rather than a generic failure", async () => {
    createGoal.mockResolvedValueOnce({
      ok: false,
      message: 'targetValue must be > 0',
      expired: false,
    });
    mockData.current = { ...base, entries: [weekdayEntry()] };
    draw();
    fireEvent.click(screen.getByText('Make this a goal'));
    fireEvent.change(screen.getByLabelText('Target in $'), { target: { value: '2500' } });
    fireEvent.click(screen.getByRole('button', { name: 'Set the goal' }));
    expect(await screen.findByTestId('rc-goal-refusal')).toHaveTextContent(
      'targetValue must be > 0',
    );
    // and the sheet stays open, so the mistake is fixable
    expect(screen.getByLabelText('Target in $')).toBeInTheDocument();
  });

  it('warns when a live goal already exists on the same figure, and says what that match is', () => {
    mockData.current = {
      ...base,
      entries: [weekdayEntry()],
      goals: [
        {
          id: 'g0',
          name: 'September wine push',
          metricKey: 'wine_revenue',
          targetValue: 4000,
          currentValue: 1200,
          deadline: '2026-09-30',
          status: 'active',
        },
      ],
    };
    draw();
    fireEvent.click(screen.getByText('Make this a goal'));
    const dup = screen.getByTestId('rc-goal-duplicate');
    expect(dup).toHaveTextContent('September wine push');
    // it never claims provenance it cannot read
    expect(dup).toHaveTextContent(/match on the figure, not on this entry/);
  });

  it('an unreadable goal list is said out loud, not treated as "no goals"', () => {
    mockData.current = { ...base, entries: [weekdayEntry()], goals: null };
    draw();
    fireEvent.click(screen.getByText('Make this a goal'));
    expect(screen.getByText(/goals could not be read/)).toBeInTheDocument();
    expect(screen.queryByTestId('rc-goal-duplicate')).not.toBeInTheDocument();
  });

  it('renders the goal button DARK, with the reason, for a rule no metric can measure', () => {
    mockData.current = { ...base, entries: [entry()] }; // stockout_imminent
    draw();
    const dark = screen.getByTestId('rc-goal-dark');
    expect(dark).toBeDisabled();
    expect(dark).toHaveAttribute('title', expect.stringContaining('availability event'));
    expect(screen.getByText(/availability event/)).toBeInTheDocument();
  });

  it('refuses to make a second goal out of an entry that is already about a goal', () => {
    mockData.current = {
      ...base,
      entries: [
        entry({ ruleKey: 'goal_behind_abc', category: 'goals', urgency: 'this_week' }),
      ],
    };
    draw();
    expect(screen.getByTestId('rc-goal-dark')).toBeDisabled();
    expect(screen.getByText(/double-count the same target/)).toBeInTheDocument();
  });

  it('sends "see it in reports" to the cutting whose register answers the rule', () => {
    mockData.current = { ...base, entries: [entry()] }; // stockout_imminent → restock
    draw();
    fireEvent.click(screen.getByText('See it in reports'));
    expect(navigate).toHaveBeenCalledWith(
      '/reports?cutting=restock&rec=stockout_imminent&from=recommendations',
    );
    // and it names the cutting, its basis, and what will actually happen
    expect(screen.getByText(/What to buy back/)).toBeInTheDocument();
    expect(screen.getByText(/the same register this rule read/)).toBeInTheDocument();
    expect(screen.getByText(/Add a cutting/)).toBeInTheDocument();
  });

  it('renders the reports button DARK, with the reason, where no cutting answers the rule', () => {
    mockData.current = {
      ...base,
      entries: [
        entry({ ruleKey: 'vendor_concentration', category: 'risk', urgency: 'this_month' }),
      ],
    };
    draw();
    const dark = screen.getByTestId('rc-cutting-dark');
    expect(dark).toBeDisabled();
    expect(screen.getByText(/No cutting answers this one/)).toBeInTheDocument();
    fireEvent.click(dark);
    expect(navigate).not.toHaveBeenCalled();
  });
});


/**
 * THE REWORK, 2026-09-03 — the docket, and the day strip as a ribbon.
 *
 * The founder: *"we need everything in a categorized classified section in
 * order for people to understand what to do as action"* and *"a calendar strip
 * that we can select and see that is highly advanced and elegant looking"*.
 *
 * What these pin is the part a screenshot cannot show:
 *  - the docket's sections are ACTS, and a one-entry section still carries its
 *    count and its money line;
 *  - the money line is WITHHELD IN WORDS, never totalled and never zero;
 *  - the ribbon hatches a day with no record and refuses to hatch anything at
 *    all when the till window could not be read;
 *  - selecting a day narrows the docket, and clearing it restores the book;
 *  - an entry no day can hold is SAID, not silently dropped;
 *  - a goal that names this rule makes the entry say it is being watched — and
 *    a goal set by hand does not.
 */
describe('RecommendationsNext — the docket', () => {
  it('carries a count and a money line on every section, including one with a single entry', () => {
    mockData.current = { ...base, entries: [entry()] };
    draw();
    const sections = screen.getAllByTestId('rc-act-section');
    expect(sections).toHaveLength(1);
    expect(within(sections[0]).getByText('1 entry')).toBeInTheDocument();
    // the money line is an em dash with words, never 0 and never a total
    expect(within(sections[0]).getByText(/at stake · not carried/)).toBeInTheDocument();
    expect(within(sections[0]).queryByText('$0')).not.toBeInTheDocument();
  });

  it('says once, above the docket, why no section can be totalled', () => {
    mockData.current = { ...base, entries: [entry()] };
    draw();
    expect(screen.getByTestId('rc-money-why')).toHaveTextContent(
      /engine states each entry’s money inside its sentence, not as a field/,
    );
  });

  it('draws the founder’s fifth heading dark, with the reason, rather than leaving it out', () => {
    mockData.current = { ...base, entries: [entry()] };
    draw();
    const dark = screen.getByTestId('rc-change-a-rule');
    expect(within(dark).getByRole('heading', { name: 'Change a rule' })).toBeInTheDocument();
    expect(within(dark).getByRole('button', { name: /Retune the rule/ })).toBeDisabled();
    expect(within(dark).getByText(/thresholds are constants/)).toBeInTheDocument();
  });

  it('files an unrecognised rule as unfiled rather than guessing a heading for it', () => {
    mockData.current = {
      ...base,
      entries: [entry({ ruleKey: 'brand_new_rule', category: 'sales' })],
    };
    draw();
    expect(screen.getByRole('heading', { name: 'Not yet filed' })).toBeInTheDocument();
  });

  it('states, in the working, why an entry is filed where it is', () => {
    mockData.current = { ...base, entries: [weekdayEntry()] };
    draw();
    fireEvent.click(screen.getByText('The working'));
    expect(screen.getByTestId('rc-filing-why')).toHaveTextContent(/brief the floor/);
    // the act and the hand disagree here, and the page says so rather than
    // quietly filing by the hand
    expect(screen.getByTestId('rc-filing-why')).toHaveTextContent(/hand is Reports/);
  });
});

describe('RecommendationsNext — the ribbon', () => {
  const fired = (over = {}) =>
    entry({ ruleKey: 'stockout_imminent', firstSeenAt: `${TILL_DAY}T09:00:00.000Z`, ...over });

  it('hatches a day the till window holds no record for, and never draws it as a zero', () => {
    mockData.current = { ...base, entries: [fired()] };
    draw();
    const blank = screen.getAllByTestId('rc-day').find((d) =>
      (d.getAttribute('aria-label') ?? '').includes('no record at all'),
    );
    expect(blank).toBeTruthy();
    expect(blank).toHaveAttribute('data-records', 'none');
    expect(blank?.textContent).not.toContain('0');
    expect(screen.getByTestId('rc-records-note')).toHaveTextContent(
      /never drawn as a bar of zero/,
    );
  });

  it('claims nothing about any day when the till window could not be read', () => {
    mockData.current = {
      ...base,
      entries: [fired()],
      pos: null,
      posProblem: 'Failed to load POS revenue',
    };
    draw();
    expect(screen.getByTestId('rc-records-note')).toHaveTextContent(
      /could not be read \(Failed to load POS revenue\)/,
    );
    expect(
      screen.getAllByTestId('rc-day').filter((d) => d.getAttribute('data-records') === 'none'),
    ).toHaveLength(0);
  });

  it('says a house with no till is not a house with no trade', () => {
    mockData.current = {
      ...base,
      entries: [fired()],
      pos: { connected: false, from: TILL_FROM, to: TODAY, byDay: {} },
    };
    draw();
    expect(screen.getByTestId('rc-records-note')).toHaveTextContent(
      /an absence of a POS is not an absence of trade/,
    );
  });

  it('narrows the docket to the entries that touch the selected day, and restores it', () => {
    mockData.current = {
      ...base,
      entries: [fired(), entry({ ruleKey: 'staff_spread', category: 'staff' })],
    };
    draw();
    expect(screen.getAllByTestId('rc-entry')).toHaveLength(2);

    const day = screen
      .getAllByTestId('rc-day')
      .find((d) => (d.getAttribute('aria-label') ?? '').includes('1 first fired'))!;
    fireEvent.click(day);
    expect(screen.getAllByTestId('rc-entry')).toHaveLength(1);
    expect(screen.getByTestId('rc-dayhead')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Show the whole book' }));
    expect(screen.getAllByTestId('rc-entry')).toHaveLength(2);
  });

  it('clears the selection on Escape, and moves the day with the arrow keys', () => {
    mockData.current = { ...base, entries: [fired()] };
    draw();
    const days = screen.getAllByTestId('rc-day');
    fireEvent.click(days[3]);
    expect(screen.getByTestId('rc-dayhead')).toBeInTheDocument();

    fireEvent.keyDown(days[3], { key: 'ArrowRight' });
    expect(days[4]).toHaveFocus();

    fireEvent.keyDown(days[4], { key: 'Escape' });
    expect(screen.queryByTestId('rc-dayhead')).not.toBeInTheDocument();
  });

  it('states its two limits whether or not they bite today', () => {
    // A cap that only announces itself once it has already distorted the
    // picture is not a disclosure.
    mockData.current = { ...base, entries: [fired()] };
    draw();
    const limits = screen.getByTestId('rc-ribbon-limits');
    expect(limits).toHaveTextContent(/at most forty rule keys/);
    expect(limits).toHaveTextContent(/no vendor cutoff exists/);
    // and nothing is undated in this fixture, so the OTHER line is absent
    expect(screen.queryByTestId('rc-undated')).not.toBeInTheDocument();
  });

  it('says how many entries no day can hold, rather than dropping them', () => {
    mockData.current = { ...base, entries: [entry({ firstSeenAt: null })] };
    draw();
    expect(screen.getByTestId('rc-undated')).toHaveTextContent(
      /no first-fired date/,
    );
    expect(screen.getByTestId('rc-undated')).toHaveTextContent(/at most forty rule keys/);
  });

  it('an entry with no first-fired date is not drawn on today', () => {
    mockData.current = { ...base, entries: [entry({ firstSeenAt: null })] };
    draw();
    const today = screen
      .getAllByTestId('rc-day')
      .find((d) => d.getAttribute('data-today') === 'true')!;
    expect(today.getAttribute('aria-label')).toContain('0 first fired');
  });

  it('strikes a day out of the analysis only after a reason is picked', () => {
    mockData.current = { ...base, entries: [fired()] };
    draw();
    const day = screen
      .getAllByTestId('rc-day')
      .find((d) => (d.getAttribute('aria-label') ?? '').includes('1 first fired'))!;
    fireEvent.click(day);
    fireEvent.click(screen.getByRole('button', { name: /Rule this day out of the analysis/ }));

    const strike = screen.getByRole('button', { name: 'Rule it out' });
    expect(strike).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Closed' }));
    fireEvent.click(strike);
    expect(ruleOutDay).toHaveBeenCalledWith(TILL_DAY, 'closed');
  });

  it('refuses to offer the strike at all when the exclusion store could not be read', () => {
    mockData.current = {
      ...base,
      entries: [fired()],
      exclusions: { items: [], readable: false, problem: 'relation missing' },
    };
    draw();
    const day = screen
      .getAllByTestId('rc-day')
      .find((d) => (d.getAttribute('aria-label') ?? '').includes('1 first fired'))!;
    fireEvent.click(day);
    const panel = screen.getByTestId('rc-dayhead');
    expect(
      within(panel).queryByRole('button', { name: /Rule this day out of the analysis/ }),
    ).not.toBeInTheDocument();
    expect(within(panel).getByText(/could not be read \(relation missing\)/)).toBeInTheDocument();
  });

  it('marks a day the manager already ruled out, and offers it back', () => {
    mockData.current = {
      ...base,
      entries: [fired()],
      exclusions: {
        items: [{ businessDate: TILL_DAY, reason: 'closed', createdAt: null }],
        readable: true,
        problem: null,
      },
    };
    draw();
    const day = screen
      .getAllByTestId('rc-day')
      .find((d) => d.getAttribute('data-excluded') === 'true')!;
    expect(day.getAttribute('aria-label')).toContain('out of the analysis');
    fireEvent.click(day);
    // the strip's own control, not the rail's list of every excluded day
    fireEvent.click(
      within(screen.getByTestId('rc-dayhead')).getByRole('button', { name: 'Count it again' }),
    );
    expect(includeDay).toHaveBeenCalledWith(TILL_DAY);
  });
});

describe('RecommendationsNext — a goal remembers the entry it came from', () => {
  const watched = {
    id: 'g7',
    name: 'Hold purchasing spend',
    metricKey: 'purchase_spend',
    targetValue: 9000,
    currentValue: 4000,
    deadline: '2026-09-10',
    status: 'active',
    sourceRuleKey: 'spend_acceleration',
  };
  const spend = () =>
    entry({ ruleKey: 'spend_acceleration', category: 'purchasing', urgency: 'this_week' });

  it('says an entry is being watched, and names the goal and its deadline', () => {
    mockData.current = { ...base, entries: [spend()], goals: [watched] };
    draw();
    expect(screen.getByTestId('rc-watched-stamp')).toBeInTheDocument();
    expect(screen.getByTestId('rc-watched')).toHaveTextContent(/Hold purchasing spend/);
    expect(screen.getByTestId('rc-watched')).toHaveTextContent(/due Thu 10 Sep/);
  });

  it('does NOT call an entry watched because a hand-set goal shares its figure', () => {
    // `source_rule_key` null means "a person typed this". Matching on the
    // metric instead would tell an owner their own target is a watch on a rule
    // they never saw.
    mockData.current = {
      ...base,
      entries: [spend()],
      goals: [{ ...watched, sourceRuleKey: null }],
    };
    draw();
    expect(screen.queryByTestId('rc-watched')).not.toBeInTheDocument();
    expect(screen.queryByTestId('rc-watched-stamp')).not.toBeInTheDocument();
  });

  it('sends the rule key with the goal it writes', async () => {
    mockData.current = { ...base, entries: [spend()], goals: [] };
    draw();
    fireEvent.click(screen.getByText('Make this a goal'));
    fireEvent.change(screen.getByLabelText('Target in $'), { target: { value: '9000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Set the goal' }));
    await waitFor(() => expect(createGoal).toHaveBeenCalled());
    expect(createGoal.mock.calls[0][0].sourceRuleKey).toBe('spend_acceleration');
  });

  it('warns about the exact duplicate, not just about the figure', () => {
    mockData.current = { ...base, entries: [spend()], goals: [watched] };
    draw();
    fireEvent.click(screen.getByText('Make this a goal'));
    expect(screen.getByTestId('rc-goal-watching')).toHaveTextContent(
      /already being watched/,
    );
    expect(screen.queryByTestId('rc-goal-duplicate')).not.toBeInTheDocument();
  });
});
