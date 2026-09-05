/**
 * "Start from a scenario" on the goal sheet — the render contract (ADR 0120).
 *
 *   *"we're going to create possible analytic scenarios a restaurant might set
 *    as a goal"*                                — the founder, 2026-09-04
 *
 * `Entry` is rendered directly rather than through the page, for one reason
 * worth stating: this behaviour belongs to the goal sheet, and driving it
 * through `RecommendationsNext` would couple it to whatever the page's own
 * fixture happens to be. Every prop below is supplied here, so a failure names
 * the sheet.
 *
 * The four things that could go wrong quietly, each with a case:
 *
 *  1. **A target appears.** The whole discipline of the panel is that the book
 *     fills four fields and never the fifth. A range parsed into the number
 *     field would be indistinguishable from a target this house set.
 *  2. **An unservable scenario becomes selectable.** The gateway holds goals on
 *     six measures; the book lists the other twelve on purpose. Selectable, one
 *     of them writes a 400 at the moment of commitment.
 *  3. **The provenance is kept after a swap.** `source_rule_key` is what makes
 *     "this entry is being watched" true. A goal on wine revenue claiming to
 *     watch a purchasing rule would make that line a guess.
 *  4. **A failed read renders as an empty picker.** Absence read as "there are
 *     no scenarios" is the fault ADR 0020 exists to stop.
 */

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import Entry from './Entry';
import type { EntryProps } from './Entry';
import type { EntryVM, GoalRow, GoalWrite } from './useRecommendationsNextData';
import type { GoalScenarioBook } from '@/hooks/useGoalScenarios';

/** A live entry whose rule maps to a goal — `spend_acceleration` is the ceiling. */
const ENTRY: EntryVM = {
  ruleKey: 'spend_acceleration',
  observation: 'Purchasing is running 31% ahead of the month before.',
  recommendation: 'Hold the next two orders back to the reorder point.',
  rationale: 'Spend ahead of demand becomes stock, not sales.',
  category: 'purchasing',
  urgency: 'this_month',
  stake: 'cash',
  hand: 'manager',
  score: 2.4,
  pinned: false,
  acted: false,
  status: 'active',
  reason: null,
  snoozeUntil: null,
  feedback: null,
  assignedTo: null,
  assignedName: null,
  updatedAt: null,
  firstSeenAt: '2026-08-20T10:00:00Z',
  subject: null,
  periodKey: null,
  suppression: {
    key: 'spend_acceleration',
    scope: 'rule',
    keys: {
      insight: 'spend_acceleration',
      subject: 'spend_acceleration',
      rule: 'spend_acceleration',
    },
  },
} as unknown as EntryVM;

const BOOK: GoalScenarioBook = {
  caveat: 'A range from a report is a fact about the houses in that report, not about yours.',
  basis: 'This is a book of scenarios, not a reading of your books.',
  counts: { total: 3, servable: 2, needsAMetric: 1 },
  scenarios: [
    {
      id: 'hold-purchasing-spend',
      name: 'Hold purchasing spend',
      question: 'Keep what we spend with vendors under a line we set.',
      metricKey: 'purchase_spend',
      metricLabel: 'Purchasing spend',
      needsMetric: null,
      direction: 'at_most',
      period: 'month',
      range: {
        kind: 'published',
        words: 'a median of 32.0% of sales among fullservice operators in 2024',
        source: 'National Restaurant Association',
        url: 'https://www.restaurant.org/example',
        published: '2025-08-27',
        caveat: 'That is a ratio to sales, not an absolute ceiling.',
      },
      cuttingId: 'pacing',
      cuttingWhy: 'Spend pacing is the register the ceiling is read from.',
      cuttingAnswers: 'Whether buying is running hot or cold',
      producer: 'ceiling-held',
      ruleKeys: ['spend_acceleration'],
      servable: true,
    },
    {
      id: 'raise-the-average-check',
      name: 'Raise the average check',
      question: 'Get more onto each check without needing more guests.',
      metricKey: 'avg_check',
      metricLabel: 'Average check',
      needsMetric: null,
      direction: 'at_least',
      period: 'month',
      range: { kind: 'none', why: 'No operator source publishes a level.' },
      cuttingId: 'till',
      cuttingWhy: 'Through the till carries the check totals.',
      cuttingAnswers: 'What guests actually paid',
      producer: 'goal-reached',
      ruleKeys: [],
      servable: true,
    },
    {
      id: 'prime-cost',
      name: 'Hold prime cost under a line',
      question: 'Keep cost of goods plus labour under a share of sales.',
      metricKey: null,
      metricLabel: null,
      needsMetric: 'prime_cost_pct — needs a labour feed and a SUPPORTED_METRICS entry.',
      direction: 'at_most',
      period: 'month',
      range: {
        kind: 'published',
        words: 'A full-service restaurant runs a prime cost of 60–65% of sales.',
        source: 'Restaurant365',
        url: 'https://www.restaurant365.com/example',
        published: '2026',
        caveat: 'A second operator source disagrees by five points.',
      },
      cuttingId: 'ledger',
      cuttingWhy: 'Figures of record carries the ratios.',
      cuttingAnswers: 'What the cellar is worth',
      producer: null,
      ruleKeys: [],
      servable: false,
    },
  ],
};

/** What the sheet is about to write, captured. */
type GoalInput = Parameters<EntryProps['onMakeGoal']>[0];

function makeGoalSpy() {
  const wrote: GoalInput[] = [];
  const spy = async (input: GoalInput): Promise<GoalWrite> => {
    wrote.push(input);
    return { ok: true, goal: { id: 'g-new', name: input.name } as GoalRow };
  };
  return { spy, wrote };
}

function renderSheet(
  scenarios: GoalScenarioBook | null | undefined,
  onMakeGoal: (input: GoalInput) => Promise<GoalWrite> = makeGoalSpy().spy,
) {
  render(
    <Entry
      entry={ENTRY}
      index={0}
      leaf="standing"
      focused={false}
      selected={false}
      expanded={false}
      team={[]}
      exclusions={undefined}
      openDismiss={false}
      onDismissOpened={vi.fn()}
      onToggleExpand={vi.fn()}
      onToggleSelect={vi.fn()}
      onAct={vi.fn()}
      onDismiss={vi.fn()}
      onSnooze={vi.fn()}
      onPin={vi.fn()}
      onRate={vi.fn()}
      onDone={vi.fn()}
      onRestore={vi.fn()}
      onAssign={vi.fn()}
      onWantTeam={vi.fn()}
      goals={[]}
      scenarios={scenarios}
      onWantGoals={vi.fn()}
      onMakeGoal={onMakeGoal}
      onSeeInReports={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Make this a goal' }));
}

describe('the goal sheet offers the book above the measure', () => {
  it('lists the servable scenarios and leaves the target empty', () => {
    renderSheet(BOOK);
    const picker = screen.getByLabelText('Start from a scenario');
    expect(picker).toBeTruthy();
    fireEvent.change(picker, { target: { value: 'raise-the-average-check' } });

    // The measure, the direction and the name all moved…
    expect(screen.getByText('Average check')).toBeTruthy();
    expect((screen.getByLabelText('Goal name') as HTMLInputElement).value).toBe(
      'Raise the average check',
    );
    // …and the target did not.
    expect((screen.getByLabelText(/^Target in/) as HTMLInputElement).value).toBe('');
  });

  it('prints the published range as words, with its source and date', () => {
    renderSheet(BOOK);
    fireEvent.change(screen.getByLabelText('Start from a scenario'), {
      target: { value: 'hold-purchasing-spend' },
    });
    const reading = screen.getByTestId('rc-scenario-reading');
    expect(reading.textContent).toContain('a median of 32.0% of sales');
    expect(reading.textContent).toContain('2025-08-27');
    expect(reading.textContent).toContain('not about yours');
    expect(
      reading.querySelector('a[href="https://www.restaurant.org/example"]'),
    ).toBeTruthy();
  });

  it('says so when a scenario has no published range, rather than showing nothing', () => {
    renderSheet(BOOK);
    fireEvent.change(screen.getByLabelText('Start from a scenario'), {
      target: { value: 'raise-the-average-check' },
    });
    expect(screen.getByTestId('rc-scenario-reading').textContent).toContain(
      'No operator source publishes a range for this.',
    );
  });

  it('lists a scenario the gateway cannot hold, and refuses to select it', () => {
    renderSheet(BOOK);
    const option = screen
      .getAllByRole('option')
      .find((o) => o.textContent === 'Hold prime cost under a line');
    expect(option).toBeTruthy();
    expect((option as HTMLOptionElement).disabled).toBe(true);
  });

  it('drops the provenance when the measure is swapped, and says it is dropping it', () => {
    const { spy, wrote } = makeGoalSpy();
    renderSheet(BOOK, spy);
    fireEvent.change(screen.getByLabelText('Start from a scenario'), {
      target: { value: 'raise-the-average-check' },
    });
    expect(screen.getByTestId('rc-scenario-drops-source').textContent).toContain(
      'will not record which entry it came from',
    );
    fireEvent.change(screen.getByLabelText(/^Target in/), { target: { value: '64' } });
    fireEvent.click(screen.getByRole('button', { name: 'Set the goal' }));
    expect(wrote).toHaveLength(1);
    expect(wrote[0].metricKey).toBe('avg_check');
    expect(wrote[0].direction).toBe('at_least');
    expect(wrote[0].targetValue).toBe(64);
    expect('sourceRuleKey' in wrote[0]).toBe(false);
  });

  it('keeps the provenance when the scenario names this rule’s own measure', () => {
    const { spy, wrote } = makeGoalSpy();
    renderSheet(BOOK, spy);
    fireEvent.change(screen.getByLabelText('Start from a scenario'), {
      target: { value: 'hold-purchasing-spend' },
    });
    expect(screen.queryByTestId('rc-scenario-drops-source')).toBeNull();
    fireEvent.change(screen.getByLabelText(/^Target in/), { target: { value: '9000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Set the goal' }));
    expect(wrote).toHaveLength(1);
    expect(wrote[0].sourceRuleKey).toBe('spend_acceleration');
    expect(wrote[0].metricKey).toBe('purchase_spend');
  });

  it('says the book could not be read, rather than showing an empty picker', () => {
    renderSheet(null);
    expect(screen.queryByLabelText('Start from a scenario')).toBeNull();
    expect(screen.getByTestId('rc-scenarios-unread').textContent).toContain(
      'could not be read',
    );
    // The entry's own measure is still offered — the sheet still works.
    expect(screen.getByText('Purchasing spend')).toBeTruthy();
  });

  it('says it is still reading, rather than rendering an empty list', () => {
    renderSheet(undefined);
    expect(screen.queryByLabelText('Start from a scenario')).toBeNull();
    expect(screen.queryByTestId('rc-scenarios-unread')).toBeNull();
    expect(screen.getByText(/Reading the book of scenarios/)).toBeTruthy();
  });
});
