/**
 * NotificationsNext render contract.
 *
 * What this asserts is exactly what the REWORK verdict and the page's own
 * defect list promise:
 *
 *  - Federation's density — a collapsed line carries its register, its own
 *    message, its folded-duplicate count and its age, and the rail says how
 *    much of the book is on screen;
 *  - Editorial's subduing — a handled line leaves "Needs a hand" and appears
 *    under the double rule instead, so the page quiets as it is worked;
 *  - the `--calm` band — an autonomous step by the house is dashed, says
 *    nothing was sent, and carries a human control;
 *  - honesty — a refused read and a broken read are told apart, neither
 *    renders as an empty inbox, and an unknown total is an em dash;
 *  - no emoji, anywhere: a row whose STORED title carries the producer's
 *    emoji renders clean and the register's mark is drawn in ink instead;
 *  - one-tap actions have left this page (founder, 2026-09-03) — the desk is
 *    gone and the band says where they went, rather than going silent.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { Notification } from '@/services/api/notifications';

const mockData = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));

vi.mock('./useNotificationsNextData', async () => {
  const real = await vi.importActual<typeof import('./useNotificationsNextData')>(
    './useNotificationsNextData',
  );
  return {
    ...real,
    POLL_MS: 10_000,
    BOOK_PAGE: 100,
    useNotificationsNextData: () => mockData.current,
  };
});

/**
 * The market-price box owns its own read. It is mocked to a settled, EMPTY
 * register here — which is the measured production truth
 * (`vendor_price_observations` holds no rows) — so the day-book's own
 * assertions are never answered by a stray price row, and the box's four
 * states get their own cases at the end of this file.
 */
const mockMarket = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));
vi.mock('./useMarketPrice', () => ({
  MARKET_POLL_MS: 60_000,
  useMarketPrice: () => mockMarket.current,
}));

import NotificationsNext from './NotificationsNext';

function row(over: Partial<Notification>): Notification {
  return {
    id: 'n1',
    userId: 'u1',
    restaurantId: 'r1',
    type: 'inventory_low_stock',
    title: '3 wines dropped below par',
    message: 'The sweep found three wines under their par level.',
    status: 'unread',
    priority: 'high',
    metadata: {},
    timestamp: new Date(Date.now() - 3 * 3_600_000).toISOString(),
    createdAt: new Date(Date.now() - 3 * 3_600_000).toISOString(),
    ...over,
  } as Notification;
}

const spies = {
  markRead: vi.fn(),
  markUnread: vi.fn(),
  archive: vi.fn(),
  remove: vi.fn(),
  markAllRead: vi.fn(),
  snooze: vi.fn(),
  wake: vi.fn(),
  wakeAll: vi.fn(),
  setFilters: vi.fn(),
  setMonth: vi.fn(),
  refresh: vi.fn(),
  readFurtherBack: vi.fn(),
};

const EMPTY_MARKET = {
  state: 'ready',
  failure: null,
  items: [],
  scannedObservations: 0,
  scannedProducts: 0,
  skippedThin: 0,
  skippedNotBelow: 0,
  skippedMixedCurrency: 0,
  windowDays: 30,
  minObservations: 3,
  refresh: vi.fn(),
};

function base(rows: Notification[]) {
  return {
    book: {
      register: { state: 'ready', rows },
      total: rows.length,
      hasMore: false,
      pages: 1,
    },
    stack: { items: rows, foldedById: {}, foldedCount: 0 },
    lastReadAt: new Date('2026-09-02T18:00:00'),
    refreshing: false,
    asleep: new Set<string>(),
    snoozes: [] as Array<{ id: string; until: number; seenAt: number; seenFolded: number }>,
    woke: [] as Array<{ id: string; reason: string }>,
    folds: {} as Record<string, { newestAt: number | null; winnerIsStale: boolean }>,
    days: [] as Array<Record<string, unknown>>,
    month: '2026-09',
    filters: { type: null, status: null, day: null },
    failureNote: null,
    ...spies,
  };
}

function draw() {
  return render(
    <MemoryRouter>
      <NotificationsNext />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  Object.values(spies).forEach((s) => s.mockClear());
  mockData.current = base([]);
  mockMarket.current = { ...EMPTY_MARKET };
});

describe('NotificationsNext — the day-book', () => {
  it('renders a line that needs a hand with the density the verdict asked for', () => {
    const r = row({
      metadata: { count: 3, criticalCount: 1, mode: 'instant' },
    });
    mockData.current = {
      ...base([r]),
      stack: { items: [r], foldedById: { n1: 4 }, foldedCount: 4 },
    };
    draw();

    expect(screen.getByText('1 line needs a hand.')).toBeInTheDocument();
    expect(screen.getByText('3 wines dropped below par')).toBeInTheDocument();
    // the row's own message, its register, its folded duplicates and its age
    expect(screen.getAllByText(/sweep found three wines/).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Stock').length).toBeGreaterThan(0);
    expect(screen.getByText('+4 folded')).toBeInTheDocument();
    expect(screen.getByText('3h ago')).toBeInTheDocument();
    // the rail says how much of the book is on screen, and what folding hid
    expect(screen.getByText(/lines the register holds/)).toBeInTheDocument();
    expect(screen.getByText(/4 repeats folded/)).toBeInTheDocument();
  });

  it('expands a line into every fact it actually carries, and no others', () => {
    const r = row({
      metadata: {
        count: 3,
        wines: [
          { wineName: 'Rioja Reserva', currentStock: 2, threshold: 6 },
          { wineName: 'Chablis 1er' }, // no numbers on this one
        ],
      },
    });
    mockData.current = base([r]);
    draw();
    fireEvent.click(screen.getByText('3 wines dropped below par'));

    expect(screen.getByText('Below par')).toBeInTheDocument();
    expect(screen.getByText('Rioja Reserva')).toBeInTheDocument();
    // an absent stock figure is an em dash, never a zero
    const chablis = screen.getByText('Chablis 1er').closest('tr') as HTMLElement;
    expect(within(chablis).getAllByText('—')).toHaveLength(2);
    expect(within(chablis).queryByText('0')).not.toBeInTheDocument();
    // a fact the metadata does not hold is simply absent
    expect(screen.queryByText('Vendor')).not.toBeInTheDocument();
  });

  it('subdues a handled line: it leaves “Needs a hand” for the ruled-off band', () => {
    const handled = row({ id: 'n2', status: 'read', title: 'Order delivered', type: 'order_delivered' });
    mockData.current = base([handled]);
    draw();

    const needs = screen.getByRole('region', { name: 'Needs a hand' });
    expect(within(needs).queryByText('Order delivered')).not.toBeInTheDocument();
    expect(screen.getByText(/New lines land at the top of this band/)).toBeInTheDocument();

    fireEvent.click(screen.getByText('Show 1'));
    const ruled = screen.getByRole('region', { name: 'Ruled off' });
    expect(within(ruled).getByText('Order delivered')).toBeInTheDocument();
  });

  it('rules a line off through the real endpoint, and never fakes it', () => {
    mockData.current = base([row({})]);
    draw();
    fireEvent.click(screen.getByText('3 wines dropped below par'));
    fireEvent.click(screen.getByText('Rule it off'));
    expect(spies.markRead).toHaveBeenCalledWith('n1');
  });

  it('marks what the house did on its own `--calm`, unsent, with a human control', () => {
    const draft = row({
      id: 'd1',
      type: 'draft_ready',
      title: 'A reply to Bodega Álvaro is drafted',
      message: 'They quoted a new price.',
      actionUrl: '/orders?draft=abc',
    });
    mockData.current = base([draft]);
    draw();

    const band = screen.getByRole('region', { name: 'What the house did on its own' });
    expect(within(band).getByText('Drafted by the house · unsent')).toBeInTheDocument();
    expect(within(band).getByText(/Nothing has gone to the vendor/)).toBeInTheDocument();
    expect(within(band).getByText(/Read the draft before it goes/)).toBeInTheDocument();
    // and it is NOT sitting in the plain queue pretending to be a chore
    const needs = screen.getByRole('region', { name: 'Needs a hand' });
    expect(within(needs).queryByText(/drafted/i)).not.toBeInTheDocument();
  });

  it('no longer keeps a one-tap desk — the day-book holds lines, and says where the actions went', () => {
    mockData.current = base([
      row({ id: 'd1', type: 'draft_ready', title: 'A reply to Bodega Álvaro is drafted' }),
    ]);
    draw();

    // The desk that used to sit in the rail is gone from this page entirely.
    expect(screen.queryByRole('region', { name: 'Your one-tap actions' })).not.toBeInTheDocument();
    expect(screen.queryByText('Write a new one')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Hold to mark it done' })).not.toBeInTheDocument();

    // And the band that used to hold house-raised actions points at their new home
    // rather than going quiet about them.
    const band = screen.getByRole('region', { name: 'What the house did on its own' });
    expect(within(band).getByText(/Standing one-tap actions/)).toBeInTheDocument();
    expect(within(band).getByRole('link', { name: 'dashboard rail' })).toHaveAttribute('href', '/');
  });

  it('strips the producer’s emoji out of a stored title and draws the register’s own mark', () => {
    const r = row({
      // Exactly what production rows carry today (low-stock-alerts.service.ts:302
      // before the producers were cleaned): a row already written keeps its emoji
      // forever. Written as escapes so this directory's own emoji grep stays
      // clean — the string the component receives is byte-identical to the
      // stored one.
      title: '\u{1F6A8} 50 wines dropped below par',
      message: '\u26A0\uFE0F Just crossed below par: Rioja, Chablis',
      type: 'inventory_low_stock',
    });
    mockData.current = base([r]);
    const { container } = draw();

    expect(screen.getByText('50 wines dropped below par')).toBeInTheDocument();
    // the message is drawn twice — once on the collapsed line, once in the
    // (always-mounted, 0fr) detail — and both must be clean
    expect(screen.getAllByText('Just crossed below par: Rioja, Chablis')).toHaveLength(2);
    // no emoji survives anywhere on the rendered page
    expect(container.textContent ?? '').not.toMatch(
      /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u,
    );
    // and the mark the emoji used to carry is drawn instead — a lucide <svg>
    // inside the register chip on the line AND beside the rail's tally row, so
    // the two can never disagree about which register this is.
    // Three places name this register now — the line's chip, the rail's
    // tally, and the register filter's pill — and all three draw the SAME
    // mark, because the map is keyed by register and not by type.
    const marks = screen.getAllByText('Stock');
    expect(marks).toHaveLength(3);
    for (const el of marks) {
      expect(el.querySelector('svg.lucide-boxes')).not.toBeNull();
    }
  });

  it('says a broken read in words — an unread book is never an empty one', () => {
    mockData.current = {
      ...base([]),
      book: {
        register: {
          state: 'unreadable',
          failure: { status: 500, message: 'boom', forbidden: false },
        },
        total: null,
        hasMore: null,
        pages: 1,
      },
      stack: { items: [], foldedById: {}, foldedCount: 0 },
    };
    draw();

    expect(screen.getByRole('alert')).toHaveTextContent('could not be read');
    expect(screen.getByRole('alert')).toHaveTextContent('The book is unknown, not empty.');
    expect(screen.getByText(/an unread page is not a quiet house/)).toBeInTheDocument();
    expect(screen.queryByText(/Nothing is waiting on you/)).not.toBeInTheDocument();
    expect(screen.queryByText(/open and empty/)).not.toBeInTheDocument();
    // and no band reports its own emptiness as a finding
    expect(screen.getByText(/not because nothing\s+needs a hand/)).toBeInTheDocument();
    expect(screen.getByText(/not because the house has been\s+idle/)).toBeInTheDocument();
    expect(screen.queryByText(/has not acted unasked/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('Try again'));
    expect(spies.refresh).toHaveBeenCalled();
  });

  it('tells a refusal apart from a breakage, and does not offer a pointless retry', () => {
    mockData.current = {
      ...base([]),
      book: {
        register: {
          state: 'unreadable',
          failure: { status: 403, message: 'Forbidden', forbidden: true },
        },
        total: null,
        hasMore: null,
        pages: 1,
      },
      stack: { items: [], foldedById: {}, foldedCount: 0 },
    };
    draw();

    expect(screen.getByRole('alert')).toHaveTextContent('refused this account');
    expect(screen.getByText(/not allowed to read the book/)).toBeInTheDocument();
    expect(screen.queryByText('Try again')).not.toBeInTheDocument();
  });

  it('renders an em dash, not a zero, when the register will not say how big it is', () => {
    const r = row({});
    mockData.current = {
      ...base([r]),
      book: { register: { state: 'ready', rows: [r] }, total: null, hasMore: null, pages: 1 },
    };
    draw();
    const rail = screen.getByRole('region', { name: 'On this page' });
    expect(within(rail).getByText(/of — lines the register holds/)).toBeInTheDocument();
  });

  it('says a sleeping line never left this browser, and when it is due back', () => {
    const r = row({});
    mockData.current = {
      ...base([r]),
      asleep: new Set(['n1']),
      snoozes: [{ id: 'n1', until: Date.now() + 90 * 60_000, seenAt: 0, seenFolded: 0 }],
    };
    draw();
    const band = screen.getByRole('region', { name: 'Put down for now' });
    expect(within(band).getByText(/in this browser only/)).toBeInTheDocument();
    expect(within(band).getByText(/another device still/)).toBeInTheDocument();
    // the deadline is drawn, not implied
    expect(within(band).getByText(/back in 1h 30m/)).toBeInTheDocument();
    // and it is NOT in the band that asks for a hand
    expect(screen.getByText('Nothing is waiting on you. Every line in the book has been ruled off.'))
      .toBeInTheDocument();
    fireEvent.click(screen.getByText('Bring them all back'));
    expect(spies.wakeAll).toHaveBeenCalled();
  });

  it('shows a skeleton while the first read is genuinely in flight, and claims nothing', () => {
    mockData.current = {
      ...base([]),
      book: { register: { state: 'loading' }, total: null, hasMore: null, pages: 1 },
      lastReadAt: null,
      stack: { items: [], foldedById: {}, foldedCount: 0 },
    };
    draw();
    expect(screen.getByText('Opening the book…')).toBeInTheDocument();
    expect(screen.queryByText(/Nothing is waiting on you/)).not.toBeInTheDocument();
    expect(screen.queryByText(/open and empty/)).not.toBeInTheDocument();
    expect(screen.getByText(/not known yet/)).toBeInTheDocument();
  });

  it('states the live-read contract that keeps stacked digests fresh', () => {
    mockData.current = base([]);
    draw();
    expect(screen.getByText(/re-read every 10 seconds/)).toBeInTheDocument();
    expect(screen.getByText(/updates in place rather than going stale/)).toBeInTheDocument();
  });
});

/**
 * FOURTH PASS, 2026-09-03 — the founder asked for the competitor-lens
 * behaviours that leave us behind, and for the market-price box. Each case
 * below is one of them, and each is written so that removing the behaviour
 * fails it rather than merely changing a label.
 */
describe('NotificationsNext — what the inbox lens asked for', () => {
  const two = () => [
    row({ id: 'n1', title: 'Terra Nostra invoice is past its terms' }),
    row({ id: 'n2', title: 'Chablis 1er Cru Montmains is below par' }),
  ];

  it('walks the lines with j and k, and shows where the cursor is', () => {
    mockData.current = base(two());
    const { container } = draw();
    expect(container.querySelectorAll('[data-selected="true"]')).toHaveLength(0);

    fireEvent.keyDown(window, { key: 'j' });
    let selected = container.querySelectorAll('[data-selected="true"]');
    expect(selected).toHaveLength(1);
    expect(selected[0].textContent).toMatch(/Terra Nostra/);

    fireEvent.keyDown(window, { key: 'j' });
    selected = container.querySelectorAll('[data-selected="true"]');
    expect(selected[0].textContent).toMatch(/Chablis/);

    fireEvent.keyDown(window, { key: 'k' });
    selected = container.querySelectorAll('[data-selected="true"]');
    expect(selected[0].textContent).toMatch(/Terra Nostra/);
  });

  it('rules a line off with e and puts it down with s — and binds nothing destructive', () => {
    mockData.current = base(two());
    draw();
    fireEvent.keyDown(window, { key: 'j' });

    fireEvent.keyDown(window, { key: 'e' });
    expect(spies.markRead).toHaveBeenCalledWith('n1');

    fireEvent.keyDown(window, { key: 's' });
    expect(spies.snooze).toHaveBeenCalledWith('n1', 60 * 60 * 1000);

    // The two irreversible ones are not reachable from the keyboard at all.
    fireEvent.keyDown(window, { key: 'd' });
    fireEvent.keyDown(window, { key: '#' });
    fireEvent.keyDown(window, { key: 'Backspace' });
    expect(spies.remove).not.toHaveBeenCalled();
    expect(spies.archive).not.toHaveBeenCalled();
  });

  it('does not fire a shortcut while the reader is typing in the search box', () => {
    mockData.current = base(two());
    draw();
    fireEvent.keyDown(window, { key: 'j' });

    const box = screen.getByPlaceholderText('Search what is on screen');
    fireEvent.keyDown(box, { key: 'e' });
    fireEvent.keyDown(box, { key: 's' });
    expect(spies.markRead).not.toHaveBeenCalled();
    expect(spies.snooze).not.toHaveBeenCalled();
  });

  it('narrows the lines on screen with the search box and says whose count that is', () => {
    mockData.current = base(two());
    draw();
    fireEvent.change(screen.getByPlaceholderText('Search what is on screen'), {
      target: { value: 'chablis' },
    });
    expect(screen.getByText('Chablis 1er Cru Montmains is below par')).toBeInTheDocument();
    expect(
      screen.queryByText('Terra Nostra invoice is past its terms'),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/of them match/)).toBeInTheDocument();
    // and the register's own filters are named as the register's
    expect(screen.getByText(/Register, status and the day are the register/)).toBeInTheDocument();
    expect(screen.getByText(/no full-text search behind this table/)).toBeInTheDocument();
  });

  it('hides what is ruled off without deleting it, and says how many it folded', () => {
    const handled = row({ id: 'n3', status: 'read', title: 'Delivery arrived' });
    mockData.current = base([...two(), handled]);
    draw();
    fireEvent.click(screen.getByText('Hide what is ruled off'));
    expect(screen.getByText(/folded away by/)).toBeInTheDocument();
    expect(screen.getByText(/Nothing was deleted and nothing was told to the server/))
      .toBeInTheDocument();
  });

  it('sends the day to the REGISTER, not to the browser', () => {
    mockData.current = {
      ...base(two()),
      days: [
        { key: '2026-09-02', onScreen: 3, open: 1, records: 'yes' },
        { key: '2026-09-03', onScreen: 2, open: 2, records: 'yes' },
      ],
    };
    draw();
    expect(screen.getByText(/count the lines on this screen, not the register/))
      .toBeInTheDocument();
    fireEvent.click(
      screen.getByLabelText(/Wednesday 2 September — 3 lines on this screen, 1 still open/),
    );
    expect(spies.setFilters).toHaveBeenCalledWith({
      type: null,
      status: null,
      day: '2026-09-02',
    });
  });

  it('shares the house day strip — a month, a keyboard, and the hatch rule', () => {
    // `DayRail.tsx` is deleted; this page now renders
    // `components/mudavym/DayStrip.tsx`, which is where those behaviours are
    // asserted in full (`DayStrip.test.tsx`). What is asserted HERE is that
    // this page reaches them at all — it had no keyboard map of its own.
    mockData.current = {
      ...base(two()),
      days: [
        { key: '2026-09-02', onScreen: 0, open: 0, records: 'none' },
        { key: '2026-09-03', onScreen: 2, open: 2, records: 'yes' },
      ],
    };
    draw();
    expect(screen.getByTestId('mdv-ds-month')).toHaveTextContent('September 2026');
    // a whole month of cells, not a fortnight
    expect(screen.getAllByTestId('mdv-ds-day')).toHaveLength(30);
    const hatched = screen.getByLabelText(/Wednesday 2 September/);
    expect(hatched).toHaveAttribute('data-records', 'none');
    expect(hatched).toHaveAccessibleName(/not a zero, nothing was written/);
    // and the month is walkable
    fireEvent.click(screen.getByRole('button', { name: 'Show August 2026' }));
    expect(spies.setMonth).toHaveBeenCalledWith('2026-08');
  });

  it('prints the register’s own total for the day it is reading', () => {
    mockData.current = {
      ...base(two()),
      filters: { type: null, status: null, day: '2026-09-03' },
      book: { register: { state: 'ready', rows: two() }, total: 6, hasMore: false, pages: 1 },
    };
    draw();
    const rail = screen.getByRole('region', { name: 'The day-book, by the month' });
    // The whole sentence, not the digit on its own: a month of cells now
    // carries a "6" of its own, and asserting on a bare figure would pass on
    // the sixth of the month.
    const line = within(rail).getByText(/the register holds/).textContent ?? '';
    expect(line).toContain('Reading 2026-09-03');
    expect(line).toContain('the register holds 6 lines for that day');
  });

  it('shows a folded line’s NEWEST stamp when the surviving line is older', () => {
    const winner = row({
      id: 'n1',
      title: '50 wines dropped below par',
      timestamp: new Date(Date.now() - 6 * 3_600_000).toISOString(),
      createdAt: new Date(Date.now() - 6 * 3_600_000).toISOString(),
    });
    mockData.current = {
      ...base([winner]),
      stack: { items: [winner], foldedById: { n1: 44 }, foldedCount: 44 },
      folds: {
        n1: { newestAt: Date.now() - 40 * 60_000, winnerIsStale: true },
      },
    };
    draw();
    // the age of the NEWS, and the age of the line standing for it, both drawn
    expect(screen.getByText('40m ago')).toBeInTheDocument();
    expect(screen.getByText('this line 6h ago')).toBeInTheDocument();
    expect(
      screen.getByText(/the line standing for them, which is the one with the highest count/),
    ).toBeInTheDocument();
  });
});

describe('NotificationsNext — the market-price box', () => {
  it('says the price register is empty rather than saying nothing is cheap', () => {
    mockData.current = base([]);
    draw();
    const box = screen.getByRole('region', { name: 'Cheaper than lately' });
    expect(within(box).getByText(/holds no sightings at all/)).toBeInTheDocument();
    expect(within(box).queryByText(/Nothing is below its recent average/)).not.toBeInTheDocument();
    // the rule is printed in full, and the box's limits are stated
    expect(within(box).getByText(/not folded into its own average/)).toBeInTheDocument();
    expect(within(box).getByText(/never places an order/)).toBeInTheDocument();
    expect(
      within(box).getByText(/does not yet write a line in the book/),
    ).toBeInTheDocument();
  });

  it('says nothing is below average only when something was actually compared', () => {
    mockMarket.current = {
      ...EMPTY_MARKET,
      scannedObservations: 41,
      scannedProducts: 9,
      skippedThin: 6,
      skippedNotBelow: 3,
    };
    mockData.current = base([]);
    draw();
    const box = screen.getByRole('region', { name: 'Cheaper than lately' });
    expect(within(box).getByText(/Nothing is below its recent average/)).toBeInTheDocument();
    expect(within(box).getByText(/41 sightings across/)).toBeInTheDocument();
    expect(within(box).queryByText(/holds no sightings at all/)).not.toBeInTheDocument();
  });

  it('draws a real drop with both prices, the count behind the average, and the source', () => {
    mockMarket.current = {
      ...EMPTY_MARKET,
      scannedObservations: 41,
      scannedProducts: 9,
      items: [
        {
          productKey: 'wine:1',
          productName: 'Etna Rosso Contrada Guardiola',
          currency: 'EUR',
          latestPrice: 19.4,
          latestAt: '2026-09-03T09:00:00.000Z',
          latestVendor: 'Terra Nostra',
          latestSource: 'quote',
          averagePrice: 24.25,
          averageOf: 5,
          absoluteBelow: 4.85,
          fractionBelow: 0.2,
        },
      ],
    };
    mockData.current = base([]);
    draw();
    const box = screen.getByRole('region', { name: 'Cheaper than lately' });
    expect(within(box).getByText('Etna Rosso Contrada Guardiola')).toBeInTheDocument();
    expect(within(box).getByText('−20.0%')).toBeInTheDocument();
    expect(within(box).getByText(/€19\.40/)).toBeInTheDocument();
    expect(within(box).getByText(/€24\.25/)).toBeInTheDocument();
    expect(within(box).getByText(/5 earlier sightings/)).toBeInTheDocument();
    expect(within(box).getByText(/Terra Nostra · quote/)).toBeInTheDocument();
  });

  it('tells a refused price sweep apart from an empty market', () => {
    mockMarket.current = {
      ...EMPTY_MARKET,
      state: 'unreadable',
      failure: { status: 403, message: 'Forbidden', forbidden: true },
      scannedObservations: null,
    };
    mockData.current = base([]);
    draw();
    const box = screen.getByRole('region', { name: 'Cheaper than lately' });
    expect(within(box).getByText(/refused this account/)).toBeInTheDocument();
    expect(within(box).queryByText(/holds no sightings at all/)).not.toBeInTheDocument();
    expect(within(box).queryByText(/Nothing is below its recent average/)).not.toBeInTheDocument();
  });
});
