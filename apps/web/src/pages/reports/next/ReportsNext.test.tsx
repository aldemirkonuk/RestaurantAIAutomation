/**
 * ReportsNext render contract — the MERGE verdict's structural promises and
 * every honesty rule the sheet is supposed to enforce.
 *
 * The founder's named requirements, each with a test that fails if it goes:
 *  - the drag-to-rearrange canvas is BACK, with one toggle ("Arrange the
 *    sheet") that rules the paper and one that writes the arrangement;
 *  - the ⌘K palette never fabricates: it lists engine sentences verbatim and
 *    says in words that free-text answers do not exist;
 *  - "more graphs" have real producers — a register with no producer renders a
 *    sentence, not an empty axis;
 *  - the report generator is disabled with its reason, because it writes nothing.
 *
 * The data hook is mocked, so these assertions are about the page, not the
 * gateway. A test that would pass against the scaffold is not a test: every
 * case below names a string or a role the scaffold does not have.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { DEFAULT_SHEET } from './rp-sheet';

const hook = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));

vi.mock('./useReportsNextData', () => ({
  useReportsNextData: () => hook.current,
}));

import ReportsNext from './ReportsNext';

/** A register that answered. */
function ok<T>(data: T) {
  return { data, loading: false, failure: null, refetch: vi.fn() };
}
/** A register still in flight. */
const pending = { data: undefined, loading: true, failure: null, refetch: vi.fn() };
/** A register that broke, or refused. */
function broke(status: number | null, message = 'boom') {
  return {
    data: undefined,
    loading: false,
    failure: { status, message, forbidden: status === 403 || status === 401 },
    refetch: vi.fn(),
  };
}

const saveSheet = vi.fn();

const READING = [
  { ruleKey: 'insight:a', sentence: 'Barolo sold 32% above its own average this week.', category: 'sales', score: 9, entityLabel: 'Barolo' },
  { ruleKey: 'insight:b', sentence: 'Tuesday is your quietest night for reds.', category: 'tables', score: 4, entityLabel: null },
];

function base() {
  return {
    restaurantId: 'r1',
    reading: ok(READING),
    till: ok({
      posConnected: true,
      revenue: 4210,
      checkCount: 96,
      from: '2026-08-03',
      to: '2026-09-01',
      days: 30,
      dailySeries: [{ date: '2026-08-04', revenue: 310 }],
    }),
    pacing: ok({
      basis: { outflow: 'delivered procurement_orders' },
      spendLast30d: 1200,
      spendPrev30d: 900,
      paceDeltaPct: 33.3,
      projectedNext4Weeks: null,
      committedOpenOrders: 400,
      openOrderCount: 2,
    }),
    week: ok({
      weekdayProfile: [{ day: 'Monday', mean: 2, stdev: 1, n: 12 }],
      bestDay: 'Friday',
      worstDay: 'Monday',
      trendPerDayPct: -0.4,
    }),
    quadrants: ok({
      basis: { velocity: 'units/day', margin: 'menu price − cost' },
      costCoverage: { total: 10, priced: 4, unpriced: 6, complete: false },
      medians: { velocityPerDay: 0.2, marginPerBottle: 12 },
      counts: { star: 1, plowhorse: 0, puzzle: 1, dog: 0, unclassified: 6 },
      items: [
        { id: 'w1', name: 'Barolo', velocityPerDay: 0.5, marginPerBottle: 22, marginPct: 0.4, quadrant: 'star' },
        { id: 'w2', name: 'Nebbiolo', velocityPerDay: 0.1, marginPerBottle: null, marginPct: null, quadrant: null },
      ],
    }),
    ahead: ok({
      model: 'holt_winters',
      horizon: 14,
      history: { dates: ['2026-08-30', '2026-08-31'], values: [2, 3] },
      forecast: [{ date: '2026-09-01', value: 2.5 }],
      totalForecastDemand: 35,
      accuracy: { mape: 18.2, scoredPoints: 60, basis: 'rolling one-step-ahead' },
    }),
    ledger: ok({
      basis: { revenue: 'unit_price × on-hand qty', inventoryValue: 'on-hand qty × unit cost' },
      costCoverage: { total: 10, priced: 4, unpriced: 6, complete: false },
      inventoryValue: null,
      cogs: 8400,
      revenue: 21000,
      grossMargin: null,
      cogsRatio: null,
      inventoryTurnover: null,
      daysInventoryOutstanding: null,
      gmroi: null,
      deadStockCapital: null,
    }),
    tillDays: 30,
    setTillDays: vi.fn(),
    sheet: { slots: { ...DEFAULT_SHEET }, hidden: [] },
    saveSheet,
    sheetKnown: true,
    refetchAll: vi.fn(),
  };
}

function paint() {
  return render(
    <MemoryRouter>
      <ReportsNext />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  hook.current = base();
});

describe('ReportsNext — the sheet', () => {
  it('opens with the engine’s own loudest sentence and lays out every cutting', () => {
    paint();
    // Fraunces speaks in the opening, but only words the ENGINE wrote.
    expect(within(screen.getByRole('banner')).getByText(READING[0].sentence)).toBeInTheDocument();
    for (const title of [
      'The reading',
      'Through the till',
      'Spend pacing',
      'The week’s shape',
      'What’s coming',
      'Margin against movement',
      'Figures of record',
      'The writing desk',
    ]) {
      expect(screen.getByRole('region', { name: title })).toBeInTheDocument();
    }
  });

  it('brings the drag-to-rearrange canvas back: one toggle rules the paper, one writes it', () => {
    const { container } = paint();
    const sheet = container.querySelector('.rp-sheet') as HTMLElement;
    expect(sheet).toHaveAttribute('data-arranging', 'false');

    fireEvent.click(screen.getByText('Arrange the sheet'));
    expect(sheet).toHaveAttribute('data-arranging', 'true');
    expect(screen.getByText(/Drag a cutting anywhere on the ruling/)).toBeInTheDocument();

    // A cutting can be taken off the sheet and put back by name.
    const reading = screen.getByRole('region', { name: 'The reading' });
    fireEvent.click(within(reading).getByText('Take off'));
    expect(screen.queryByRole('region', { name: 'The reading' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('Put back The reading'));
    expect(screen.getByRole('region', { name: 'The reading' })).toBeInTheDocument();

    fireEvent.click(screen.getByText('Rule it off'));
    expect(saveSheet).toHaveBeenCalledTimes(1);
    expect(sheet).toHaveAttribute('data-arranging', 'false');
    expect(screen.getByText('Ruled off.')).toBeInTheDocument();
  });

  it('carries exactly one period control, and it lives inside the cutting it governs', () => {
    paint();
    const till = screen.getByRole('region', { name: 'Through the till' });
    // Exactly one window picker exists, and it is inside the ONE cutting whose
    // endpoint takes a `days` parameter. A page-level 7/30/90 selector would be
    // lying about the six registers whose window the server fixes.
    expect(screen.getAllByRole('group', { name: 'Till window' })).toHaveLength(1);
    expect(within(till).getByRole('group', { name: 'Till window' })).toBeInTheDocument();
    expect(within(screen.getByRole('banner')).queryByRole('group')).toBeNull();
  });
});

describe('ReportsNext — the palette never fabricates', () => {
  it('lists engine sentences and says plainly that free-text answers do not exist', () => {
    paint();
    fireEvent.click(screen.getByText('Ask the book ⌘K'));
    const dialog = screen.getByRole('dialog', { name: 'Ask the book' });
    expect(within(dialog).getByText(READING[1].sentence)).toBeInTheDocument();
    expect(within(dialog).getByText(/does not answer\s+free-text questions/)).toBeInTheDocument();
  });

  it('answers a question it cannot match with a count, not with a sentence of its own', () => {
    paint();
    fireEvent.click(screen.getByText('Ask the book ⌘K'));
    const dialog = screen.getByRole('dialog', { name: 'Ask the book' });
    fireEvent.change(within(dialog).getByPlaceholderText(/Search what the engine/), {
      target: { value: 'why did prosecco margin jump' },
    });
    expect(within(dialog).getByText(/Nothing the engine has said mentions that/)).toBeInTheDocument();
    expect(within(dialog).queryByText(/Prosecco \(\+/)).not.toBeInTheDocument();
  });

  it('says the insight register is unreadable rather than showing an empty palette', () => {
    hook.current = { ...base(), reading: broke(500, 'gateway down') };
    paint();
    fireEvent.click(screen.getByText('Ask the book ⌘K'));
    expect(
      within(screen.getByRole('dialog', { name: 'Ask the book' })).getByText(
        /insight register could not be read \(gateway down\)/,
      ),
    ).toBeInTheDocument();
  });
});

describe('ReportsNext — honesty', () => {
  it('renders an unknown as an em dash, never as a zero', () => {
    paint();
    const ledger = screen.getByRole('region', { name: 'Figures of record' });
    // Eight figures, five of which the engine returned as null.
    expect(within(ledger).getAllByText('—').length).toBeGreaterThanOrEqual(5);
    expect(within(ledger).queryByText('$0')).not.toBeInTheDocument();
    // …and it says WHY they are dashes, in the engine's own coverage numbers.
    expect(within(ledger).getByText(/4 of 10 on-hand wines carry a recorded cost/)).toBeInTheDocument();
  });

  it('says an absent till feed in words, and does not draw a day of $0', () => {
    hook.current = {
      ...base(),
      till: ok({
        posConnected: false,
        revenue: null,
        checkCount: null,
        from: '',
        to: '',
        days: 30,
        dailySeries: [],
      }),
    };
    paint();
    const till = screen.getByRole('region', { name: 'Through the till' });
    expect(within(till).getByText(/No POS check has ever landed/)).toBeInTheDocument();
    expect(within(till).getByText('Connect a till in Settings')).toBeInTheDocument();
  });

  it('names the register that broke and offers a retry only when retrying can help', () => {
    hook.current = { ...base(), week: broke(500, 'timeout'), quadrants: broke(403) };
    paint();
    const week = screen.getByRole('region', { name: 'The week’s shape' });
    expect(within(week).getByText(/seasonality register could not be read \(timeout\)/)).toBeInTheDocument();
    expect(within(week).getByText('Read it again')).toBeInTheDocument();

    const quad = screen.getByRole('region', { name: 'Margin against movement' });
    expect(within(quad).getByText(/Your role cannot read the menu-engineering register/)).toBeInTheDocument();
    expect(within(quad).queryByText('Read it again')).not.toBeInTheDocument();
  });

  it('shows a register in flight as a skeleton — never as an em dash', () => {
    hook.current = { ...base(), pacing: pending };
    const { container } = paint();
    const pacingCut = screen.getByRole('region', { name: 'Spend pacing' });
    expect(within(pacingCut).getByRole('status', { name: 'Reading the register' })).toBeInTheDocument();
    expect(container.querySelectorAll('.rp-skel').length).toBeGreaterThan(0);
  });

  it('keeps an uncosted wine off the quadrant plot instead of filing it as a dog', () => {
    paint();
    const quad = screen.getByRole('region', { name: 'Margin against movement' });
    expect(within(quad).getByText('No quadrant 6')).toBeInTheDocument();
    expect(within(quad).getByText(/an uncosted wine is unknown, not a dog/)).toBeInTheDocument();
  });

  it('renders the report generator disabled, with the reason it writes nothing', () => {
    paint();
    const desk = screen.getByRole('region', { name: 'The writing desk' });
    const button = within(desk).getByRole('button', { name: 'Write this sheet up' });
    expect(button).toBeDisabled();
    expect(within(desk).getByText(/files a row marked/)).toBeInTheDocument();
    expect(within(desk).getByText('Open the document archive')).toBeInTheDocument();
  });

  it('admits when no restaurant is active instead of shimmering forever', () => {
    hook.current = { ...base(), restaurantId: null };
    paint();
    expect(screen.getByText(/No restaurant is active yet/)).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'The reading' })).not.toBeInTheDocument();
  });

  it('prints the SERVER’s own basis sentence when the working is shown', () => {
    paint();
    const pacingCut = screen.getByRole('region', { name: 'Spend pacing' });
    fireEvent.click(within(pacingCut).getByText('Show the working'));
    expect(within(pacingCut).getByText(/Outflow: delivered procurement_orders/)).toBeInTheDocument();
  });
});
