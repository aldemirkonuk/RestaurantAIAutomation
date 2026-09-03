/**
 * ReportsNext render contract — the MERGE verdict's structural promises, the
 * second pass's two switches, and every honesty rule the sheet enforces.
 *
 * The founder's named requirements, each with a test that fails if it goes:
 *  - the drag-to-rearrange canvas is BACK, with one toggle ("Arrange the
 *    sheet") that rules the paper and one that writes the arrangement;
 *  - **every cutting can change its drawing**, and only to a drawing that is
 *    true of its data — the week's shape is offered no heat map, figures of
 *    record no bars;
 *  - **every cutting can change its subject**, from a catalogue of analyses the
 *    gateway actually serves; one can be taken off and put back;
 *  - both choices persist with the layout, in one preference;
 *  - the ⌘K palette never fabricates: it lists engine sentences verbatim and
 *    says in words that free-text answers do not exist;
 *  - "more graphs" have real producers — a register with no producer renders a
 *    sentence, not an empty axis;
 *  - the report generator is disabled with its reason, because it writes nothing.
 *
 * Plus the three gateway shapes fixed on 2026-09-03 (`financial.cogs` null,
 * `forecast.modelFitted` false, `seasonality.tie` true), read here as the page
 * reads them.
 *
 * The data hook is mocked, so these assertions are about the page, not the
 * gateway. A test that would pass against the scaffold is not a test: every
 * case below names a string or a role the scaffold does not have.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { decodeSheet, defaultSheet, encodeSheet } from './useReportsNextData';
import { CATALOGUE } from './rp-catalogue';
import { DEFAULT_SLOTS } from './rp-sheet';

/**
 * The two registers added in the fourth pass decode heavily on the way in
 * (`goals` reshapes a progress payload; `bench` flattens the overview's eight
 * lenses), so their fixtures go through the catalogue's own `select` — which
 * is what the data layer does, and which pins the decoder as well as the view.
 */
const decode = (id: 'goals' | 'bench', raw: unknown) => CATALOGUE[id].select(raw);

const hook = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));
/** What the page last asked the data layer to READ — the draft included. */
const asked = vi.hoisted(() => ({ showing: undefined as unknown }));

vi.mock('./useReportsNextData', async () => {
  const actual = await vi.importActual<typeof import('./useReportsNextData')>(
    './useReportsNextData',
  );
  return {
    ...actual,
    useReportsNextData: (...args: unknown[]) => {
      asked.showing = args[2];
      return hook.current;
    },
  };
});

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
  {
    ruleKey: 'insight:a',
    sentence: 'Barolo sold 32% above its own average this week.',
    category: 'sales',
    score: 9,
    entityLabel: 'Barolo',
  },
  {
    ruleKey: 'insight:b',
    sentence: 'Tuesday is your quietest night for reds.',
    category: 'tables',
    score: 4,
    entityLabel: null,
  },
];

const TILL = {
  posConnected: true,
  revenue: 4210,
  checkCount: 96,
  from: '2026-08-03',
  to: '2026-09-01',
  days: 30,
  dailySeries: [
    { date: '2026-08-04', revenue: 310 },
    { date: '2026-08-11', revenue: 480 },
  ],
};

/** The goals desk's writes, stubbed. `beforeEach` clears the calls. */
const deskStub = {
  canWrite: true,
  readOnlyReason: null as string | null,
  busy: null as string | null,
  error: null as string | null,
  clearError: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  archive: vi.fn(),
  ask: vi.fn(),
  asking: null as string | null,
  proposal: null as unknown,
  dismiss: vi.fn(),
  place: vi.fn(),
};

/** `GET /analytics/goals/:rid/progress` — three goals, three different truths. */
const GOALS = {
  status: 'active',
  goals: [
    {
      goal: {
        id: 'g1',
        name: 'Lift wine revenue',
        metric_key: 'wine_revenue',
        direction: 'at_least',
        deadline: '2026-12-31',
        period: 'custom',
        baseline_value: 1000,
      },
      metricLabel: 'Wine revenue',
      unit: 'currency',
      current: 4200,
      target: 9000,
      progressPct: 0.4667,
      expectedByNow: 3000,
      onTrack: true,
      daysLeft: 40,
      projectedAtDeadline: 9400,
      projectionHitsTarget: true,
    },
    {
      goal: {
        id: 'g2',
        name: 'Hold purchasing',
        metric_key: 'purchase_spend',
        direction: 'at_most',
        deadline: null,
        period: 'month',
        baseline_value: null,
      },
      metricLabel: 'Purchasing spend',
      unit: 'currency',
      current: null,
      target: 4000,
      progressPct: null,
      expectedByNow: null,
      onTrack: null,
      daysLeft: null,
      projectedAtDeadline: null,
      projectionHitsTarget: null,
    },
    {
      goal: {
        id: 'g3',
        name: 'Attach rate',
        metric_key: 'wine_attach_rate',
        direction: 'at_least',
        deadline: null,
        period: 'month',
        baseline_value: null,
      },
      unreadable: true,
      reason: 'the pos_checks query failed',
    },
  ],
  total: 3,
  computed: 3,
  truncated: false,
  supportedMetrics: [
    { key: 'wine_revenue', label: 'Wine revenue', unit: 'currency' },
    { key: 'purchase_spend', label: 'Purchasing spend', unit: 'currency' },
  ],
  basis: {
    current: 'each goal recomputed over the window that opens on its creation date',
    peers: 'no other restaurant’s books are in this comparison',
  },
};

/** `GET /analytics/overview/:rid` — the benchmark cutting's one call. */
const BENCH = {
  financial: null,
  cashflow: {
    basis: { outflow: 'delivered procurement_orders' },
    spendLast30d: 1200,
    spendPrev30d: 900,
    paceDeltaPct: 33.3,
    committedOpenOrders: 400,
    openOrderCount: 2,
  },
  seasonality: {
    weekdayProfile: [{ day: 'Monday', mean: 2, stdev: 1, n: 12 }],
    bestDay: 'Friday',
    worstDay: 'Monday',
    tie: false,
    trendPerDayPct: -0.4,
    basis: { weekday: 'mean units per weekday over 90d', extremes: 'single weekdays' },
  },
  activeGoals: [
    {
      name: 'Lift wine revenue',
      metric_key: 'wine_revenue',
      baseline_value: 1000,
      current_value: 4200,
      target_value: 9000,
      direction: 'at_least',
    },
  ],
};

function base() {
  return {
    restaurantId: 'r1',
    goalsDesk: deskStub,
    reading: ok(READING),
    registers: {
      reading: ok(READING),
      till: ok(TILL),
      goals: ok(decode('goals', GOALS)),
      bench: ok(decode('bench', BENCH)),
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
        weekdayProfile: [
          { day: 'Monday', mean: 2, stdev: 1, n: 12 },
          { day: 'Friday', mean: 6, stdev: 2, n: 12 },
        ],
        bestDay: 'Friday',
        worstDay: 'Monday',
        tie: false,
        trendPerDayPct: -0.4,
        basis: { weekday: 'mean units per weekday over 90d', extremes: 'single weekdays' },
      }),
      ahead: ok({
        model: 'holt_winters',
        modelFitted: true,
        horizon: 14,
        history: { dates: ['2026-08-30', '2026-08-31'], values: [2, 3] },
        forecast: [{ date: '2026-09-01', value: 2.5 }],
        totalForecastDemand: 35,
        accuracy: { mape: 18.2, scoredPoints: 60, basis: 'rolling one-step-ahead' },
        basis: { model: 'holt_winters fitted on 120 days of history' },
      }),
      quadrants: ok({
        basis: { velocity: 'units/day', margin: 'menu price − cost' },
        costCoverage: { total: 10, priced: 4, unpriced: 6, complete: false },
        medians: { velocityPerDay: 0.2, marginPerBottle: 12 },
        counts: { star: 1, plowhorse: 0, puzzle: 1, dog: 0, unclassified: 6 },
        items: [
          {
            id: 'w1',
            name: 'Barolo',
            velocityPerDay: 0.5,
            marginPerBottle: 22,
            marginPct: 0.4,
            quadrant: 'star',
          },
          {
            id: 'w2',
            name: 'Nebbiolo',
            velocityPerDay: 0.1,
            marginPerBottle: null,
            marginPct: null,
            quadrant: null,
          },
        ],
      }),
      ledger: ok({
        basis: {
          revenue: 'unit_price × on-hand qty',
          cogs: 'delivered procurement_orders (trailing 365d) — 4 orders summed',
          inventoryValue: 'on-hand qty × unit cost',
        },
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
    } as Record<string, unknown>,
    tillDays: 30,
    setTillDays: vi.fn(),
    sheet: defaultSheet(),
    saveSheet,
    sheetKnown: true,
    refetchAll: vi.fn(),
  };
}

/** Replace one register's payload without restating the other six. */
function withRegister(id: string, value: unknown) {
  const b = base();
  return { ...b, registers: { ...b.registers, [id]: value } };
}

function paint() {
  return render(
    <MemoryRouter>
      <ReportsNext />
    </MemoryRouter>,
  );
}

const arrange = () => fireEvent.click(screen.getByText('Arrange the sheet'));

beforeEach(() => {
  vi.clearAllMocks();
  deskStub.canWrite = true;
  deskStub.readOnlyReason = null;
  deskStub.error = null;
  deskStub.busy = null;
  deskStub.asking = null;
  deskStub.proposal = null;
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

  it('prints the window each register speaks about, under its own title', () => {
    paint();
    // The page-level 7/30/90 selector is gone because ten of the eleven
    // registers are computed over a window the SERVER fixes. Each says which.
    expect(
      within(screen.getByRole('region', { name: 'The week’s shape' })).getByText(
        'the last 90 days of the consumption log',
      ),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole('region', { name: 'Figures of record' })).getByText(
        '365 days of COGS; the cellar as it stands today',
      ),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole('region', { name: 'Through the till' })).getByText(
        'the last 30 days of POS checks',
      ),
    ).toBeInTheDocument();
  });

  it('brings the drag-to-rearrange canvas back: one toggle rules the paper, one writes it', () => {
    const { container } = paint();
    const sheet = container.querySelector('.rp-sheet') as HTMLElement;
    expect(sheet).toHaveAttribute('data-arranging', 'false');

    arrange();
    expect(sheet).toHaveAttribute('data-arranging', 'true');
    expect(screen.getByText(/Drag a cutting anywhere on the ruling/)).toBeInTheDocument();
    expect(screen.getByText(/pull its corner to resize/)).toBeInTheDocument();

    // A cutting can be taken off the sheet and put back by name.
    const reading = screen.getByRole('region', { name: 'The reading' });
    fireEvent.click(within(reading).getByText('Take off'));
    expect(screen.queryByRole('region', { name: 'The reading' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'The reading' }));
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
    // lying about the ten registers whose window the server fixes.
    expect(screen.getAllByRole('group', { name: 'Till window' })).toHaveLength(1);
    expect(within(till).getByRole('group', { name: 'Till window' })).toBeInTheDocument();
    expect(within(screen.getByRole('banner')).queryByRole('group')).toBeNull();
  });

  it('asks nothing while you are reading: no drawing or subject control until Arrange', () => {
    paint();
    const till = screen.getByRole('region', { name: 'Through the till' });
    expect(within(till).queryByLabelText('Draw Through the till as')).toBeNull();
    expect(within(till).queryByLabelText('Show instead of Through the till')).toBeNull();
    arrange();
    expect(within(till).getByLabelText('Draw Through the till as')).toBeInTheDocument();
    expect(within(till).getByLabelText('Show instead of Through the till')).toBeInTheDocument();
  });
});

describe('ReportsNext — the drawing is the reader’s, within what is true', () => {
  it('offers a register every drawing its data supports, and switches to it', () => {
    paint();
    arrange();
    const till = screen.getByRole('region', { name: 'Through the till' });
    const picker = within(till).getByLabelText('Draw Through the till as') as HTMLSelectElement;
    expect(Array.from(picker.options).map((o) => o.textContent)).toEqual([
      'Area',
      'Line',
      'Bars',
      'Heat map',
      'Table',
      'One figure',
    ]);

    // The heat map is a real table, so it is legible here as well as on screen.
    fireEvent.change(picker, { target: { value: 'heatmap' } });
    expect(within(till).getByText(/weekday against week beginning/)).toBeInTheDocument();
    expect(within(till).getByLabelText(/Aug 4, \$310/)).toBeInTheDocument();

    // …and the same register as rows.
    fireEvent.change(picker, { target: { value: 'table' } });
    expect(within(till).getByRole('columnheader', { name: 'Taken' })).toBeInTheDocument();

    // …and reduced to its headline figure.
    fireEvent.change(picker, { target: { value: 'figure' } });
    expect(within(till).getByText('$4,210')).toBeInTheDocument();
  });

  it('does not offer a drawing the data cannot support, and says why', () => {
    paint();
    arrange();
    const week = screen.getByRole('region', { name: 'The week’s shape' });
    const weekPicker = within(week).getByLabelText('Draw The week’s shape as') as HTMLSelectElement;
    const weekTypes = Array.from(weekPicker.options).map((o) => o.value);
    expect(weekTypes).toContain('bars');
    // Seasonality returns one dimension; a heat map needs two.
    expect(weekTypes).not.toContain('heatmap');
    expect(weekTypes).not.toContain('scatter');
    expect(within(week).getByText(/No heat map: seasonality returns one dimension/)).toBeInTheDocument();

    // Eight figures in four different units cannot share one axis.
    const ledger = screen.getByRole('region', { name: 'Figures of record' });
    const ledgerTypes = Array.from(
      (within(ledger).getByLabelText('Draw Figures of record as') as HTMLSelectElement).options,
    ).map((o) => o.value);
    expect(ledgerTypes).toEqual(['table', 'figure']);
    expect(within(ledger).getByText(/four different units/)).toBeInTheDocument();
  });

  it('keeps the drawing with the layout, in the one preference', () => {
    paint();
    arrange();
    const till = screen.getByRole('region', { name: 'Through the till' });
    fireEvent.change(within(till).getByLabelText('Draw Through the till as'), {
      target: { value: 'bars' },
    });
    fireEvent.click(screen.getByText('Rule it off'));

    const saved = saveSheet.mock.calls[0][0] as {
      cuttings: Array<{ id: string; graph: string; slot: unknown }>;
    };
    const cutting = saved.cuttings.find((c) => c.id === 'till');
    expect(cutting?.graph).toBe('bars');
    expect(cutting?.slot).toEqual(DEFAULT_SLOTS.till);
  });
});

describe('ReportsNext — the subject is the reader’s too', () => {
  it('swaps a cutting for another analysis in the same square of paper', () => {
    paint();
    arrange();
    const quad = screen.getByRole('region', { name: 'Margin against movement' });
    fireEvent.change(within(quad).getByLabelText('Show instead of Margin against movement'), {
      target: { value: 'seats' },
    });
    // The wine analysis is gone and the room is in its place — the founder's
    // "if it was showing the wine analysis, then maybe people don't want it".
    expect(screen.queryByRole('region', { name: 'Margin against movement' })).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'The room' })).toBeInTheDocument();

    // …and it is READ straight away, rather than shimmering until the sheet is
    // ruled off. You cannot choose an analysis you cannot see.
    expect(asked.showing).toContain('seats');
    expect(asked.showing).not.toContain('quadrants');

    fireEvent.click(screen.getByText('Rule it off'));
    const saved = saveSheet.mock.calls[0][0] as { cuttings: Array<{ id: string; slot: unknown }> };
    expect(saved.cuttings.find((c) => c.id === 'seats')?.slot).toEqual(DEFAULT_SLOTS.quadrants);
    expect(saved.cuttings.some((c) => c.id === 'quadrants')).toBe(false);
  });

  it('offers the whole catalogue, and refuses to show the same register twice', () => {
    paint();
    arrange();
    const quad = screen.getByRole('region', { name: 'Margin against movement' });
    const swap = within(quad).getByLabelText(
      'Show instead of Margin against movement',
    ) as HTMLSelectElement;
    const options = Array.from(swap.options);
    // Thirteen since the fourth pass: the goals desk and the benchmark joined.
    expect(options).toHaveLength(13);
    expect(options.map((o) => o.value)).toEqual(expect.arrayContaining(['goals', 'bench']));
    const already = options.find((o) => o.value === 'till');
    expect(already?.disabled).toBe(true);
    expect(already?.textContent).toContain('already on the sheet');
    expect(options.find((o) => o.value === 'service')?.disabled).toBe(false);
  });

  it('adds a catalogued cutting the default sheet does not carry', () => {
    hook.current = {
      ...base(),
      registers: {
        ...base().registers,
        restock: ok({
          params: { serviceLevel: 0.95, leadTimeDays: 7, demandWindowDays: 90 },
          basis: { demand: 'wine_consumption_log units/day over 90d' },
          skuCount: 40,
          reorderCount: 2,
          reorderList: [
            {
              id: 's1',
              name: 'Chablis',
              onHand: 2,
              daysOfCover: 3,
              reorderPoint: 6,
              safetyStock: 2,
              stockoutProbability: 0.4,
            },
          ],
        }),
      },
    };
    paint();
    arrange();
    expect(screen.queryByRole('region', { name: 'What to buy back' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'What to buy back' }));
    const restock = screen.getByRole('region', { name: 'What to buy back' });
    expect(within(restock).getByText('Chablis')).toBeInTheDocument();
    expect(within(restock).getByText('Below their reorder point')).toBeInTheDocument();
  });

  it('says so when the reader has taken every cutting off, instead of showing blank paper', () => {
    hook.current = { ...base(), sheet: { cuttings: [] } };
    paint();
    expect(screen.getByText(/Every cutting has been taken off this sheet/)).toBeInTheDocument();
  });
});

describe('ReportsNext — the sheet codec', () => {
  it('round-trips positions and drawings through one preference key', () => {
    const sheet = defaultSheet();
    sheet.cuttings[1].graph = 'heatmap';
    const decoded = decodeSheet(encodeSheet(sheet));
    expect(decoded.cuttings).toEqual(sheet.cuttings);
  });

  it('upgrades a sheet saved by the first pass rather than discarding it', () => {
    const v1 = {
      v: 1,
      blocks: [
        { i: 'till', x: 0, y: 0, w: 6, h: 8, hidden: false },
        { i: 'ledger', x: 6, y: 0, w: 6, h: 8, hidden: true },
      ],
    };
    const decoded = decodeSheet(v1);
    // The saved slot and the deliberate removal both survive…
    expect(decoded.cuttings[0]).toEqual({
      id: 'till',
      slot: { x: 0, y: 0, w: 6, h: 8 },
      graph: 'area',
    });
    expect(decoded.cuttings.some((c) => c.id === 'ledger')).toBe(false);
    // …and the two analyses that did not exist when this blob was written are
    // added at the foot, because their absence was never a decision.
    expect(decoded.cuttings.map((c) => c.id)).toEqual(['till', 'goals', 'bench']);
    expect(decoded.cuttings[1].slot.y).toBe(8);
  });

  it('never resurrects a cutting the reader took off, only ones that did not exist', () => {
    // A v3 blob is current: every id in it was offered, so `on: false` is a
    // decision and must be honoured. Nothing is added back.
    const decoded = decodeSheet({
      v: 3,
      blocks: [
        { i: 'till', x: 0, y: 0, w: 6, h: 8, g: 'area', on: true },
        { i: 'goals', on: false },
        { i: 'bench', on: false },
      ],
    });
    expect(decoded.cuttings.map((c) => c.id)).toEqual(['till']);
  });

  it('drops a drawing that is no longer true of its analysis', () => {
    // `ledger` supports table and figure only; a stored heat map is a stale
    // preference, not an instruction to draw an impossible chart.
    const decoded = decodeSheet({
      v: 2,
      blocks: [{ i: 'ledger', x: 0, y: 0, w: 4, h: 4, g: 'heatmap', on: true }],
    });
    expect(decoded.cuttings[0].graph).toBe('table');
  });

  it('falls back to the house sheet for a blob it cannot read', () => {
    expect(decodeSheet({ v: 9, blocks: 'nonsense' })).toEqual(defaultSheet());
    expect(decodeSheet(undefined)).toEqual(defaultSheet());
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

describe('ReportsNext — the three gateway shapes fixed on 2026-09-03', () => {
  it('prints an em dash for a COGS the server withheld, never $0', () => {
    hook.current = withRegister(
      'ledger',
      ok({
        basis: {
          cogs: 'delivered procurement_orders (trailing 365d) — null: no delivered order was returned for this window',
        },
        costCoverage: { total: 0, priced: 0, unpriced: 0, complete: false },
        inventoryValue: null,
        cogs: null,
        revenue: null,
        grossMargin: null,
        cogsRatio: null,
        inventoryTurnover: null,
        daysInventoryOutstanding: null,
        gmroi: null,
        deadStockCapital: null,
      }),
    );
    paint();
    const ledger = screen.getByRole('region', { name: 'Figures of record' });
    expect(within(ledger).queryByText('$0')).not.toBeInTheDocument();
    const cogs = within(ledger).getByText('Cost of goods (365d)').closest('.rp-fig');
    expect(within(cogs as HTMLElement).getByText('—')).toBeInTheDocument();
    // …and the server's own reason is one click away.
    fireEvent.click(within(ledger).getByText('Show the working'));
    expect(within(ledger).getByText(/no delivered order was returned/)).toBeInTheDocument();
  });

  it('claims no forecast total when the server reports no model fitted', () => {
    hook.current = withRegister(
      'ahead',
      ok({
        model: null,
        modelFitted: false,
        horizon: 14,
        history: { dates: ['2026-08-30'], values: [0] },
        forecast: [],
        totalForecastDemand: null,
        accuracy: { mape: null, scoredPoints: 0, basis: 'no_observations_in_scored_window' },
        basis: { model: 'no model fitted — every one of the 120 days of history reads zero' },
      }),
    );
    paint();
    const ahead = screen.getByRole('region', { name: 'What’s coming' });
    expect(within(ahead).getByText(/no model fitted this history/i)).toBeInTheDocument();
    expect(within(ahead).queryByText('0')).not.toBeInTheDocument();
    expect(within(ahead).getAllByText('—').length).toBeGreaterThanOrEqual(2);
  });

  it('withholds both weekdays when the server reports a tie, and says why', () => {
    hook.current = withRegister(
      'week',
      ok({
        weekdayProfile: [
          { day: 'Monday', mean: 4, stdev: 1, n: 12 },
          { day: 'Friday', mean: 4, stdev: 1, n: 12 },
        ],
        bestDay: null,
        worstDay: null,
        tie: true,
        trendPerDayPct: 0.2,
        basis: {
          weekday: 'mean units per weekday over the last 90 days',
          extremes: 'bestDay/worstDay are null: more than one weekday shares the extreme',
        },
      }),
    );
    paint();
    const week = screen.getByRole('region', { name: 'The week’s shape' });
    const best = within(week).getByText('Busiest day').closest('.rp-fig');
    expect(within(best as HTMLElement).getByText('—')).toBeInTheDocument();
    expect(within(week).getByText(/arbitrary tie-break rather than a finding/)).toBeInTheDocument();
    // Sunday-as-both-busiest-and-quietest was the pre-fix payload.
    expect(within(week).queryByText('Sunday')).not.toBeInTheDocument();
  });
});

describe('ReportsNext — honesty', () => {
  it('renders an unknown as an em dash, never as a zero', () => {
    paint();
    const ledger = screen.getByRole('region', { name: 'Figures of record' });
    // Nine figures, six of which the engine returned as null.
    expect(within(ledger).getAllByText('—').length).toBeGreaterThanOrEqual(6);
    expect(within(ledger).queryByText('$0')).not.toBeInTheDocument();
    // …and it says WHY they are dashes, in the engine's own coverage numbers.
    expect(
      within(ledger).getByText(/4 of 10 on-hand wines carry a recorded cost/),
    ).toBeInTheDocument();
  });

  it('says an absent till feed in words, and does not draw a day of $0', () => {
    hook.current = withRegister(
      'till',
      ok({
        posConnected: false,
        revenue: null,
        checkCount: null,
        from: '',
        to: '',
        days: 30,
        dailySeries: [],
      }),
    );
    paint();
    const till = screen.getByRole('region', { name: 'Through the till' });
    expect(within(till).getByText(/No POS check has ever landed/)).toBeInTheDocument();
    expect(within(till).getByText('Connect a till in Settings')).toBeInTheDocument();
  });

  it('keeps saying it, whatever drawing the reader picks', () => {
    // `say` outranks every graph type: an absent feed does not become a chart
    // because somebody chose "bars".
    hook.current = withRegister(
      'till',
      ok({
        posConnected: false,
        revenue: null,
        checkCount: null,
        from: '',
        to: '',
        days: 30,
        dailySeries: [],
      }),
    );
    paint();
    arrange();
    const till = screen.getByRole('region', { name: 'Through the till' });
    fireEvent.change(within(till).getByLabelText('Draw Through the till as'), {
      target: { value: 'bars' },
    });
    expect(within(till).getByText(/No POS check has ever landed/)).toBeInTheDocument();
    expect(till.querySelectorAll('.rp-plot').length).toBe(0);
  });

  it('names the register that broke and offers a retry only when retrying can help', () => {
    const b = base();
    hook.current = {
      ...b,
      registers: { ...b.registers, week: broke(500, 'timeout'), quadrants: broke(403) },
    };
    paint();
    const week = screen.getByRole('region', { name: 'The week’s shape' });
    expect(
      within(week).getByText(/seasonality register could not be read \(timeout\)/),
    ).toBeInTheDocument();
    expect(within(week).getByText('Read it again')).toBeInTheDocument();

    const quad = screen.getByRole('region', { name: 'Margin against movement' });
    expect(
      within(quad).getByText(/Your role cannot read the menu-engineering register/),
    ).toBeInTheDocument();
    expect(within(quad).queryByText('Read it again')).not.toBeInTheDocument();
  });

  it('shows a register in flight as a skeleton — never as an em dash', () => {
    hook.current = withRegister('pacing', pending);
    const { container } = paint();
    const pacingCut = screen.getByRole('region', { name: 'Spend pacing' });
    expect(
      within(pacingCut).getByRole('status', { name: 'Reading the register' }),
    ).toBeInTheDocument();
    expect(container.querySelectorAll('.rp-skel').length).toBeGreaterThan(0);
  });

  it('keeps an uncosted wine off the quadrant plot instead of filing it as a dog', () => {
    paint();
    const quad = screen.getByRole('region', { name: 'Margin against movement' });
    expect(within(quad).getByText('No quadrant')).toBeInTheDocument();
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

/* ══ FOURTH PASS, 2026-09-03 ══════════════════════════════════════════════ */

/** A sheet with ONE cutting, so a move has no neighbour to argue with. */
function alone(id = 'till', slot = { x: 0, y: 0, w: 4, h: 4 }, graph = 'area') {
  return { ...base(), sheet: { cuttings: [{ id, slot, graph }] } };
}

const gripFor = (title: string) =>
  within(screen.getByRole('region', { name: title })).getByRole('button', {
    name: `Move ${title}`,
  });

describe('ReportsNext — moving a cutting without a pointer', () => {
  it('gives every cutting a named grip while arranging, and none while reading', () => {
    paint();
    // Reading: no handles, no chrome. The sheet is plain paper.
    expect(screen.queryByRole('button', { name: 'Move Through the till' })).toBeNull();
    arrange();
    // The grip is a real button with an accessible name — the exact thing
    // Grafana's own dashboard is recorded as lacking (grafana#79627).
    expect(gripFor('Through the till')).toBeInTheDocument();
    expect(gripFor('The reading')).toBeInTheDocument();
  });

  it('picks a cutting up on Space, says where it is, and teaches the keys', () => {
    hook.current = alone();
    paint();
    arrange();
    const grip = gripFor('Through the till');
    expect(grip).toHaveAttribute('aria-pressed', 'false');
    fireEvent.keyDown(grip, { key: ' ' });
    expect(grip).toHaveAttribute('aria-pressed', 'true');

    const said = screen.getByRole('status', { name: '' });
    expect(said.textContent).toContain('Through the till picked up');
    expect(said.textContent).toContain('column 1 of 12, row 1');
    expect(said.textContent).toContain('Shift and an arrow key resize it');
  });

  it('moves one column per arrow key and resizes on Shift, and both survive the save', () => {
    hook.current = alone();
    paint();
    arrange();
    const grip = gripFor('Through the till');
    fireEvent.keyDown(grip, { key: ' ' });
    fireEvent.keyDown(grip, { key: 'ArrowRight' });
    fireEvent.keyDown(grip, { key: 'ArrowRight' });
    fireEvent.keyDown(grip, { key: 'ArrowRight', shiftKey: true });
    fireEvent.keyDown(grip, { key: 'ArrowDown', shiftKey: true });
    fireEvent.keyDown(grip, { key: 'Enter' });
    expect(grip).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(screen.getByText('Rule it off'));
    expect(saveSheet).toHaveBeenCalledTimes(1);
    const saved = saveSheet.mock.calls[0][0] as { cuttings: Array<Record<string, unknown>> };
    expect(saved.cuttings[0]).toEqual({
      id: 'till',
      slot: { x: 2, y: 0, w: 5, h: 5 },
      graph: 'area',
    });
  });

  it('announces the position the RULING gave, not the one the key asked for', () => {
    // Two cuttings stacked in one column. Nudging the lower one down leaves no
    // gap — vertical compaction pulls it straight back — and the sentence must
    // say that rather than reporting the row that was requested.
    hook.current = {
      ...base(),
      sheet: {
        cuttings: [
          { id: 'till', slot: { x: 0, y: 0, w: 6, h: 4 }, graph: 'area' },
          { id: 'ledger', slot: { x: 0, y: 4, w: 6, h: 4 }, graph: 'table' },
        ],
      },
    };
    paint();
    arrange();
    const grip = gripFor('Figures of record');
    fireEvent.keyDown(grip, { key: ' ' });
    fireEvent.keyDown(grip, { key: 'ArrowDown' });
    const said = screen.getByRole('status', { name: '' }).textContent ?? '';
    expect(said).toContain('did not move');
    expect(said).toContain('row 5');
    expect(said).not.toContain('row 6');
  });

  it('puts a cutting back where it was on Escape', () => {
    hook.current = alone();
    paint();
    arrange();
    const grip = gripFor('Through the till');
    fireEvent.keyDown(grip, { key: ' ' });
    fireEvent.keyDown(grip, { key: 'ArrowRight' });
    fireEvent.keyDown(grip, { key: 'ArrowRight' });
    fireEvent.keyDown(grip, { key: 'Escape' });
    expect(screen.getByRole('status', { name: '' }).textContent).toContain('Move cancelled');

    fireEvent.click(screen.getByText('Rule it off'));
    const saved = saveSheet.mock.calls[0][0] as { cuttings: Array<{ slot: { x: number } }> };
    expect(saved.cuttings[0].slot.x).toBe(0);
  });

  it('ignores arrow keys until a cutting is actually picked up', () => {
    hook.current = alone();
    paint();
    arrange();
    const grip = gripFor('Through the till');
    fireEvent.keyDown(grip, { key: 'ArrowRight' });
    fireEvent.keyDown(grip, { key: 'ArrowRight' });
    fireEvent.click(screen.getByText('Rule it off'));
    const saved = saveSheet.mock.calls[0][0] as { cuttings: Array<{ slot: { x: number } }> };
    expect(saved.cuttings[0].slot.x).toBe(0);
  });

  it('offers every keystroke as a button too — WCAG 2.2 SC 2.5.7 is not the keyboard one', () => {
    hook.current = alone();
    paint();
    arrange();
    fireEvent.keyDown(gripFor('Through the till'), { key: ' ' });

    const bar = screen.getByRole('group', { name: 'Placing Through the till' });
    for (const name of [
      'Move Through the till left one column',
      'Move Through the till right one column',
      'Move Through the till up one row',
      'Move Through the till down one row',
      'Make Through the till one column wider',
      'Make Through the till one column narrower',
      'Make Through the till one row taller',
      'Make Through the till one row shorter',
    ]) {
      expect(within(bar).getByRole('button', { name })).toBeInTheDocument();
    }

    // And they do the same thing the keys do — a click, no drag, no keyboard.
    fireEvent.click(
      within(bar).getByRole('button', { name: 'Move Through the till right one column' }),
    );
    fireEvent.click(within(bar).getByRole('button', { name: 'Make Through the till one row taller' }));
    fireEvent.click(within(bar).getByRole('button', { name: 'Place it' }));
    fireEvent.click(screen.getByText('Rule it off'));
    const saved = saveSheet.mock.calls[0][0] as { cuttings: Array<{ slot: unknown }> };
    expect(saved.cuttings[0].slot).toEqual({ x: 1, y: 0, w: 4, h: 5 });
  });

  it('drops the pick-up when the sheet stops being arranged', () => {
    hook.current = alone();
    paint();
    arrange();
    fireEvent.keyDown(gripFor('Through the till'), { key: ' ' });
    expect(screen.getByRole('group', { name: 'Placing Through the till' })).toBeInTheDocument();
    fireEvent.click(screen.getByText('Rule it off'));
    expect(screen.queryByRole('group', { name: 'Placing Through the till' })).toBeNull();
  });
});

describe('ReportsNext — a house layout to start from', () => {
  it('offers the named layouts only while arranging, and applies one to the draft', () => {
    paint();
    expect(screen.queryByText('Buying week')).toBeNull();
    arrange();
    fireEvent.click(screen.getByText('Buying week'));
    // The buying sheet carries the reorder list; the house sheet does not.
    expect(screen.getByRole('region', { name: 'What to buy back' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'The writing desk' })).toBeNull();
    // Nothing is saved until the sheet is ruled off — it is a starting point.
    expect(saveSheet).not.toHaveBeenCalled();
  });
});

describe('ReportsNext — the goals desk', () => {
  it('shows each goal against its own target, and says so when progress is unknown', () => {
    paint();
    const goals = screen.getByRole('region', { name: 'Goals' });
    expect(within(goals).getByText('Lift wine revenue')).toBeInTheDocument();
    // The bar is the SERVER's progressPct, and it is labelled with it.
    expect(within(goals).getByRole('img', { name: '46.7% of the target' })).toBeInTheDocument();
    // A goal whose progress the engine could not compute draws NO bar — an
    // empty track would claim the engine answered zero.
    expect(
      within(goals).getByText(/Progress is unknown — the engine returned no figure/),
    ).toBeInTheDocument();
    // And a goal that could not be scored at all names the failure.
    expect(
      within(goals).getByText(/could not be scored \(the pos_checks query failed\)/),
    ).toBeInTheDocument();
  });

  it('lets an owner set, edit, archive and ask — and asks with the goal’s own id', () => {
    paint();
    const goals = screen.getByRole('region', { name: 'Goals' });
    fireEvent.click(within(goals).getByRole('button', { name: 'Archive Lift wine revenue' }));
    expect(deskStub.archive).toHaveBeenCalledWith('g1');

    fireEvent.click(
      within(goals).getByRole('button', {
        name: 'Ask the book which analysis shows Lift wine revenue',
      }),
    );
    expect(deskStub.ask).toHaveBeenCalledWith('g1', 'Lift wine revenue');

    fireEvent.click(within(goals).getByRole('button', { name: 'Edit Lift wine revenue' }));
    // The measure is locked on an edit, and the form says why.
    const measure = within(goals).getByLabelText('Measure') as HTMLSelectElement;
    expect(measure.disabled).toBe(true);
    expect(within(goals).getByText(/baseline was taken against it when it was set/)).toBeInTheDocument();
  });

  it('is read-only for a role that cannot set goals, and says which role can', () => {
    deskStub.canWrite = false;
    deskStub.readOnlyReason = 'Goals are set by owners and managers.';
    paint();
    const goals = screen.getByRole('region', { name: 'Goals' });
    expect(within(goals).getByText('Goals are set by owners and managers.')).toBeInTheDocument();
    expect(within(goals).queryByRole('button', { name: 'Edit Lift wine revenue' })).toBeNull();
    expect(within(goals).queryByRole('button', { name: /Set a goal/ })).toBeNull();
  });

  it('shows the book’s proposal as a proposal — labelled, and never as a caption', () => {
    deskStub.proposal = {
      goalId: 'g1',
      goalName: 'Lift wine revenue',
      cutting: { id: 'till', graph: 'area', days: 90 },
      why: 'The till is where wine revenue is booked.',
      refusal: null,
    };
    paint();
    const goals = screen.getByRole('region', { name: 'Goals' });
    expect(
      within(goals).getByText(/the assistant’s words, not a measurement/),
    ).toBeInTheDocument();
    fireEvent.click(within(goals).getByRole('button', { name: 'Put it on the sheet' }));
    expect(deskStub.place).toHaveBeenCalledWith({ id: 'till', graph: 'area', days: 90 });
  });

  it('says plainly when the book proposed nothing, and offers nothing to place', () => {
    deskStub.proposal = {
      goalId: 'g1',
      goalName: 'Lift wine revenue',
      cutting: null,
      why: null,
      refusal: 'ANTHROPIC_API_KEY is not configured on this gateway, so no model can be asked.',
    };
    paint();
    const goals = screen.getByRole('region', { name: 'Goals' });
    expect(within(goals).getByText(/ANTHROPIC_API_KEY is not configured/)).toBeInTheDocument();
    expect(within(goals).queryByRole('button', { name: 'Put it on the sheet' })).toBeNull();
  });
});

describe('ReportsNext — the benchmark cutting', () => {
  it('compares the house with its own past and says there are no peers in the data', () => {
    paint();
    const bench = screen.getByRole('region', { name: 'Against ourselves' });
    expect(within(bench).getByText(/No other house is in this comparison/)).toBeInTheDocument();
    expect(
      within(bench).getByText(/there is no market median to stand beside these figures/),
    ).toBeInTheDocument();
  });

  it('names the ambiguity when both buying windows read zero', () => {
    // Measured live on 2026-09-03: the dev tenant returns 0 and 0, and
    // `getCashflow` sums a loader that degrades a failed query to `[]`. A pair
    // of zeros is therefore "no delivered order came back", not "nothing was
    // bought" — and the cutting must not present it as a measured standstill.
    hook.current = withRegister(
      'bench',
      ok(decode('bench', { ...BENCH, cashflow: { ...BENCH.cashflow, spendLast30d: 0, spendPrev30d: 0 } })),
    );
    paint();
    const bench = screen.getByRole('region', { name: 'Against ourselves' });
    expect(
      within(bench).getByText(/Both buying windows came back at zero/),
    ).toBeInTheDocument();
    expect(within(bench).getByText(/not necessarily .nothing was bought./)).toBeInTheDocument();
    // …and it draws no bars at all: two bars at zero are an empty axis.
    expect(within(bench).getByText(/no bars are drawn/)).toBeInTheDocument();
  });

  it('does not say it when the windows carry real figures', () => {
    paint();
    const bench = screen.getByRole('region', { name: 'Against ourselves' });
    expect(within(bench).queryByText(/Both buying windows came back at zero/)).toBeNull();
  });

  it('withholds every figure the overview call did not return, rather than zeroing them', () => {
    hook.current = withRegister('bench', ok(decode('bench', { ...BENCH, cashflow: null })));
    paint();
    const bench = screen.getByRole('region', { name: 'Against ourselves' });
    expect(
      within(bench).getByText(/The buying lens did not answer inside the overview call/),
    ).toBeInTheDocument();
  });
});
