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

vi.mock('./useNotificationsNextData', () => ({
  POLL_MS: 10_000,
  BOOK_PAGE: 100,
  useNotificationsNextData: () => mockData.current,
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
  putAside: vi.fn(),
  restoreAside: vi.fn(),
  refresh: vi.fn(),
  readFurtherBack: vi.fn(),
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
    setAside: new Set<string>(),
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
    const marks = screen.getAllByText('Stock');
    expect(marks).toHaveLength(2);
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

  it('says the set-aside never left this browser', () => {
    const r = row({});
    mockData.current = { ...base([r]), setAside: new Set(['n1']) };
    draw();
    expect(screen.getByText(/on this browser only/)).toBeInTheDocument();
    expect(screen.getByText(/another device still shows/)).toBeInTheDocument();
    fireEvent.click(screen.getByText('Put them back'));
    expect(spies.restoreAside).toHaveBeenCalled();
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
