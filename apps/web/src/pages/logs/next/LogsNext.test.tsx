/**
 * LogsNext render contract.
 *
 * Every state the page can be in, and every ADR 0086 clause the legacy page
 * pinned, plus the two things this rebuild added: the window is marked (a
 * floor on every count, "the first N" at the foot, a gateway that never said
 * is reported as not having said), and the timeline has a way out (a row's
 * register decides where it leads; a register with no page says so). The
 * flag-off tree is pinned last: PageGate with the flag off renders the legacy
 * element and none of this page.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { LogsNextData } from './useLogsNextData';
import type { TimelineEvent } from './lg-format';

const mockData = vi.hoisted(() => ({ current: {} as Partial<LogsNextData> }));

vi.mock('./useLogsNextData', async () => {
  const real = await vi.importActual<typeof import('./useLogsNextData')>('./useLogsNextData');
  return { ...real, useLogsNextData: () => mockData.current };
});

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ activeRestaurantId: 'r1' }),
}));

/**
 * `animate` is spied, not stubbed: the real tokens still come through, so a
 * case can assert WHICH token fired and on which render. Nothing else about
 * the motion module is replaced.
 */
const motion = vi.hoisted(() => ({ animate: vi.fn() }));
vi.mock('@/lib/mudavym/motion', async () => {
  const real = await vi.importActual<typeof import('@/lib/mudavym/motion')>('@/lib/mudavym/motion');
  return { ...real, animate: (...args: unknown[]) => motion.animate(...args) };
});

const flags = vi.hoisted(() => ({ on: false }));
vi.mock('@/lib/mudavym/useMudavymDesign', async () => {
  const real = await vi.importActual<typeof import('@/lib/mudavym/useMudavymDesign')>(
    '@/lib/mudavym/useMudavymDesign',
  );
  return { ...real, useMudavymDesign: () => flags.on };
});

import LogsNext from './LogsNext';
import { settle, turn } from '@/lib/mudavym/motion';
import { PageGate } from '@/components/mudavym/PageGate';

const SIX = [
  'pos_checks',
  'decision_log',
  'inventory_transactions',
  'procurement_documents',
  'system_audit_log',
  'event_store',
] as const;

function ev(over: Partial<TimelineEvent>): TimelineEvent {
  return {
    id: 'e1',
    source: 'decision_log',
    occurredAt: '2026-09-10T10:00:00.000Z',
    correlationId: null,
    summary: 'drift: scan',
    detail: {},
    ...over,
  };
}

function ready(over: Partial<LogsNextData> = {}): LogsNextData {
  const events = over.events ?? [];
  const counts: Record<string, number> = {};
  for (const e of events) counts[e.source] = (counts[e.source] ?? 0) + 1;
  return {
    state: 'ready',
    failure: null,
    events,
    counts,
    sourcesQueried: [...SIX],
    failedSources: [],
    hasMore: false,
    window: 100,
    stalled: false,
    readingMore: false,
    pagesRead: 1,
    readMore: vi.fn(),
    refetch: vi.fn(),
    ...over,
  };
}

function renderPage(path = '/logs') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/logs" element={<LogsNext />} />
      </Routes>
    </MemoryRouter>,
  );
}

/** The register cell for a source, found by its mark. */
function cell(label: string): HTMLElement {
  const marks = screen.getAllByText(label).filter((n) => n.className.includes('lg-eyebrow'));
  expect(marks.length).toBeGreaterThan(0);
  return marks[0].closest('button') as HTMLElement;
}

beforeEach(() => {
  flags.on = false;
  motion.animate.mockClear();
  mockData.current = ready();
});

describe('LogsNext — states', () => {
  /**
   * This used to assert the opposite — that a loading register renders the em
   * dash — and the page did. `MOTIONS.md` has always said why that is wrong:
   * "A skeleton means 'the first page is in flight'; a dash means 'asked, and
   * there is no answer'. They are never the same element." A dash on every
   * cell for the length of the load made them the same element, so the page's
   * own rule is the contract now and this case is inverted.
   */
  it('shows a register still being asked as a waiting bar, never as the unknown dash', () => {
    mockData.current = {
      ...ready(),
      state: 'loading',
      events: null,
      counts: null,
      sourcesQueried: null,
      failedSources: null,
      hasMore: null,
      window: null,
    };
    const { container } = renderPage();
    expect(screen.getByRole('status')).toHaveTextContent('Reading six registers');
    expect(cell('Till')).toHaveTextContent('reading');
    expect(cell('Till')).not.toHaveTextContent('—');
    expect(container.querySelectorAll('.lg-figure--wait')).toHaveLength(6);
  });

  it('keeps the dash for a register that WAS asked and did not answer', () => {
    mockData.current = ready({ events: [ev({})], failedSources: ['pos_checks'] });
    const { container } = renderPage();
    expect(cell('Till')).toHaveTextContent('—');
    expect(container.querySelector('.lg-figure--wait')).toBeNull();
  });

  it('names the thread it is reading while a pivot is in flight', () => {
    mockData.current = { ...ready(), state: 'loading', events: null, counts: null };
    renderPage('/logs?correlationId=corr-5');
    expect(screen.getByRole('status')).toHaveTextContent('Reading every register for this thread');
  });

  it('says a whole-request failure is a failure, not a quiet house, and offers a retry', () => {
    const refetch = vi.fn();
    mockData.current = {
      ...ready(),
      state: 'unreadable',
      failure: { status: 500, message: 'Timeline failed', forbidden: false },
      events: null,
      counts: null,
      sourcesQueried: null,
      failedSources: null,
      hasMore: null,
      refetch,
    };
    renderPage();
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('The timeline could not be read');
    expect(alert).toHaveTextContent('Timeline failed');
    expect(alert).toHaveTextContent('(500)');
    expect(screen.queryByText(/^No entries/)).toBeNull();
    expect(cell('Till')).toHaveTextContent('not reached');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('tells a refusal apart from a breakage, and does not offer a retry', () => {
    mockData.current = {
      ...ready(),
      state: 'unreadable',
      failure: { status: 403, message: 'Access denied to this restaurant', forbidden: true },
      events: null,
      counts: null,
    };
    renderPage();
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('refused to your account');
    expect(alert).toHaveTextContent('403');
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });

  it('renders a real empty feed as words, not as a dead list', () => {
    mockData.current = ready({ events: [], sourcesQueried: SIX.slice(0, 5) as never });
    renderPage();
    expect(screen.getByRole('status')).toHaveTextContent('No entries.');
    expect(screen.getByText(/All 0 entries the registers hold are on the page/)).toBeTruthy();
    expect(screen.getByText(/Read 5 of 6 registers/)).toBeTruthy();
    expect(cell('Event')).toHaveTextContent('read only along a thread');
  });
});

describe('LogsNext — ADR 0086, every clause kept', () => {
  it('names the registers that could not be read and shows an em dash, never a count', () => {
    mockData.current = ready({
      events: [ev({})],
      failedSources: ['pos_checks', 'system_audit_log'],
    });
    renderPage();
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('two registers could not be read');
    expect(alert).toHaveTextContent('the till and the audit trail');
    expect(cell('Till')).toHaveTextContent('—');
    expect(cell('Till')).not.toHaveTextContent('0');
    expect(cell('Till')).toHaveTextContent('could not be read');
    expect(cell('Audit')).toHaveTextContent('—');
    expect(cell('Agent')).toHaveTextContent('1');
    expect(screen.getByText(/Every count is a floor: the till and the audit trail could not be read/)).toBeTruthy();
  });

  /**
   * A failure has to be impossible to miss, not merely present. Three things
   * carry that and all three are pinned: the band is STRUCK (a heavier rule
   * than the band used for a quiet Tuesday, so the two cannot be skimmed as
   * one), the failed cells are struck too, and the band precedes the strip —
   * it used to sit below it, so the reader met six unexplained dashes first.
   */
  it('marks a failure as a failure, and explains it before the dashes it explains', () => {
    mockData.current = ready({ events: [ev({})], failedSources: ['pos_checks'] });
    const { container } = renderPage();
    const alert = screen.getByRole('alert');
    expect(alert.className).toContain('lg-band--struck');
    expect(within(alert).getByText('Not read')).toBeTruthy();
    expect(cell('Till').getAttribute('data-struck')).toBe('true');
    expect(cell('Agent').getAttribute('data-struck')).toBeNull();
    const strip = container.querySelector('.lg-strip') as HTMLElement;
    // 4 === Node.DOCUMENT_POSITION_FOLLOWING: the strip comes after the band.
    expect(alert.compareDocumentPosition(strip) & 4).toBeTruthy();
  });

  /**
   * A failed register IS in `sourcesQueried` — it was asked — so it never
   * appeared in the `skipped` set this line was built from. The count fell
   * from 6 to 5 and named nobody; only the banner said who.
   */
  it('names the failed registers in the tally line, not only in the banner', () => {
    mockData.current = ready({
      events: [ev({})],
      failedSources: ['pos_checks', 'system_audit_log'],
      sourcesQueried: SIX.slice(0, 5) as never,
    });
    renderPage();
    const hint = screen.getByText(/Read 3 of 6 registers/);
    expect(hint).toHaveTextContent('could not be read: the till and the audit trail');
    expect(hint).toHaveTextContent('not read: the event store');
  });

  it('makes no claim at all when the gateway reports neither field', () => {
    mockData.current = ready({
      events: [ev({ source: 'pos_checks', summary: 'POS check 42 closed (toast)' })],
      sourcesQueried: null,
      failedSources: null,
      hasMore: null,
      window: null,
    });
    renderPage();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText(/Read \d of \d registers/)).toBeNull();
    expect(cell('Till')).toHaveTextContent('1');
    expect(screen.getByText(/whether older entries exist was not reported by this gateway/)).toBeTruthy();
  });

  it('renders an undated row as "not recorded", never Invalid Date', () => {
    mockData.current = ready({
      events: [ev({ id: 'd1', source: 'procurement_documents', occurredAt: null, summary: 'invoice #7 → received' })],
    });
    renderPage();
    expect(screen.getByText(/invoice #7/)).toBeTruthy();
    expect(screen.queryByText(/Invalid Date/)).toBeNull();
    expect(screen.getByTitle('This row records no timestamp')).toHaveTextContent('not recorded');
    expect(screen.getByText('No date recorded')).toBeTruthy();
  });

  it('shows a register it has not mirrored by its raw key, and tallies it with the strip', () => {
    mockData.current = ready({
      events: [ev({ id: 'w1', source: 'webhook_log' as never, summary: 'webhook delivered' })],
      sourcesQueried: [...SIX, 'webhook_log'] as never,
    });
    renderPage();
    expect(screen.getByText(/Read 7 of 7 registers/)).toBeTruthy();
    expect(cell('webhook_log')).toHaveTextContent('1');
    expect(screen.getAllByText('webhook_log').some((n) => n.className.includes('lg-mark'))).toBe(true);
  });
});

describe('LogsNext — the window is marked', () => {
  it('floors every count and prints "the first N" while rows remain beyond the window', () => {
    const readMore = vi.fn();
    mockData.current = ready({
      events: [ev({ id: 'a', source: 'pos_checks' }), ev({ id: 'b', source: 'pos_checks' }), ev({ id: 'c' })],
      hasMore: true,
      window: 100,
      readMore,
    });
    renderPage();
    expect(cell('Till')).toHaveTextContent('≥ 2');
    expect(cell('Till')).toHaveTextContent('on this page, at least');
    expect(screen.getByText(/Showing the first 3 entries · older entries exist — the gateway reads 100 at a time/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Read older entries' }));
    expect(readMore).toHaveBeenCalledTimes(1);
  });

  it('prints an exact count with no floor mark once the gateway says nothing remains', () => {
    mockData.current = ready({ events: [ev({ id: 'a', source: 'pos_checks' })], hasMore: false });
    renderPage();
    expect(cell('Till')).toHaveTextContent('1');
    expect(cell('Till')).not.toHaveTextContent('≥');
    expect(screen.getByText(/All 1 entries the registers hold are on the page/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Read older entries' })).toBeNull();
  });

  it('says in words when the feed cannot walk past a page with no dated entry', () => {
    mockData.current = ready({ events: [ev({ occurredAt: null })], hasMore: true, stalled: true });
    renderPage();
    expect(screen.getByText(/cannot walk past this point/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Read older entries' })).toBeNull();
  });
});

describe('LogsNext — the way out, and the thread', () => {
  it('links a row out to the page its register has, and says when it has none', () => {
    mockData.current = ready({
      events: [
        ev({ id: 's1', source: 'inventory_transactions', summary: 'Stock sale (pos): -1' }),
        ev({ id: 'p1', source: 'pos_checks', summary: 'POS check 9 closed (simpos)' }),
        ev({ id: 'd1', source: 'procurement_documents', summary: 'invoice #7 → received' }),
        ev({ id: 'a1', source: 'decision_log', summary: 'drift: scan' }),
      ],
    });
    renderPage();
    expect(screen.getByRole('link', { name: 'Open the stock ledger' })).toHaveAttribute('href', '/inventory');
    expect(screen.getByRole('link', { name: 'Open the till log' })).toHaveAttribute('href', '/simpos/r1/orders');
    expect(screen.getByRole('link', { name: 'Open in receipts' })).toHaveAttribute('href', '/receipts?doc=d1');
    expect(screen.getAllByText('no page of its own')).toHaveLength(1);
  });

  it('sends a document to the canonical page when that flag is on', () => {
    flags.on = true;
    mockData.current = ready({ events: [ev({ id: 'd1', source: 'procurement_documents' })] });
    renderPage();
    expect(screen.getByRole('link', { name: 'Open the document' })).toHaveAttribute('href', '/documents/d1');
  });

  it('opens a row as a sheet with its payload and its thread, and follows the thread from there', () => {
    mockData.current = ready({
      events: [
        ev({
          id: 'a1',
          source: 'system_audit_log',
          correlationId: 'corr-77',
          summary: 'user update on procurement_order',
          detail: { actorType: 'user', entityType: 'procurement_order', reason: null },
        }),
      ],
    });
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'user update on procurement_order' }));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('Who changed what, and why they said they did');
    expect(dialog).toHaveTextContent('The row, as the register holds it');
    expect(within(dialog).getByText('actorType')).toBeTruthy();
    expect(within(dialog).getByText('procurement_order')).toBeTruthy();
    expect(within(dialog).getAllByText('not recorded').length).toBeGreaterThan(0);
    expect(within(dialog).getByRole('link', { name: 'Open the orders' })).toHaveAttribute('href', '/orders');
    expect(within(dialog).getByRole('button', { name: 'Close' })).toBeTruthy();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Follow this thread' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('main', { name: 'One thread' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: 'corr-77' })).toBeTruthy();
  });

  it('reads a thread like a ledger page — oldest first, ruled off — and leaves it', () => {
    mockData.current = ready({
      events: [
        ev({ id: 'n', source: 'inventory_transactions', correlationId: 'corr-1', occurredAt: '2026-09-10T10:00:05.000Z', summary: 'Stock sale (pos): -1' }),
        ev({ id: 'o', source: 'pos_checks', correlationId: 'corr-1', occurredAt: '2026-09-10T10:00:00.000Z', summary: 'POS check 9 closed (simpos)' }),
      ],
    });
    renderPage('/logs?correlationId=corr-1');
    const main = screen.getByRole('main', { name: 'One thread' });
    expect(main).toHaveTextContent('2 entries across two registers, from');
    const items = within(main).getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('01');
    expect(items[0]).toHaveTextContent('POS check 9 closed');
    expect(items[1]).toHaveTextContent('02');
    expect(items[1]).toHaveTextContent('Stock sale');
    expect(main).toHaveTextContent('Ruled off · 2 entries');
    expect(screen.getByText(/All 2 entries this thread holds are on the page/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Leave the thread' }));
    expect(screen.getByRole('main', { name: 'The feed' })).toBeTruthy();
  });

  it('pivots onto a thread from a row’s correlation id, through the URL', () => {
    mockData.current = ready({ events: [ev({ id: 'x', correlationId: 'corr-9' })] });
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Follow thread corr-9' }));
    expect(screen.getByRole('main', { name: 'One thread' })).toBeTruthy();
    expect((screen.getByLabelText('Correlation id') as HTMLInputElement).value).toBe('corr-9');
  });

  it('filters the loaded rows to one register from the strip, and says so', () => {
    mockData.current = ready({
      events: [ev({ id: 'a', source: 'pos_checks', summary: 'till one' }), ev({ id: 'b', summary: 'agent one' })],
    });
    renderPage();
    fireEvent.click(cell('Till'));
    expect(screen.getByText('till one')).toBeTruthy();
    expect(screen.queryByText('agent one')).toBeNull();
    expect(screen.getByText(/showing the till only/)).toBeTruthy();
    expect(screen.getByText(/1 of them match the register you chose/)).toBeTruthy();
    fireEvent.click(cell('Till'));
    expect(screen.getByText('agent one')).toBeTruthy();
  });
});

describe('LogsNext — without the mouse', () => {
  const three = () => [
    ev({ id: 'a', source: 'pos_checks', summary: 'till one', occurredAt: '2026-09-10T10:00:02.000Z' }),
    ev({ id: 'b', summary: 'agent one', correlationId: 'corr-3', occurredAt: '2026-09-10T10:00:01.000Z' }),
    ev({ id: 'c', source: 'system_audit_log', summary: 'audit one', occurredAt: '2026-09-10T10:00:00.000Z' }),
  ];

  function press(key: string) {
    fireEvent.keyDown(window, { key });
  }

  it('walks the feed with j and k, opens with Enter, and puts the cursor down with Escape', () => {
    mockData.current = ready({ events: three() });
    const { container } = renderPage();
    const rows = () => Array.from(container.querySelectorAll('.lg-row'));

    press('j');
    expect(rows()[0].getAttribute('data-cursor')).toBe('true');
    press('j');
    expect(rows()[1].getAttribute('data-cursor')).toBe('true');
    expect(rows()[0].getAttribute('data-cursor')).toBeNull();
    press('k');
    expect(rows()[0].getAttribute('data-cursor')).toBe('true');
    // The walk clamps at the ends; it never wraps round.
    press('k');
    expect(rows()[0].getAttribute('data-cursor')).toBe('true');

    press('Enter');
    expect(within(screen.getByRole('dialog')).getByText('till one')).toBeTruthy();
  });

  it('follows the cursor row’s thread with f, through the URL', () => {
    mockData.current = ready({ events: three() });
    renderPage();
    press('j');
    press('j'); // the agent row, the only one carrying a correlation id
    press('f');
    expect(screen.getByRole('main', { name: 'One thread' })).toBeTruthy();
    expect((screen.getByLabelText('Correlation id') as HTMLInputElement).value).toBe('corr-3');
  });

  it('never fires while the reader is typing a correlation id', () => {
    mockData.current = ready({ events: three() });
    const { container } = renderPage();
    const box = screen.getByLabelText('Correlation id');
    fireEvent.keyDown(box, { key: 'j' });
    fireEvent.keyDown(box, { key: 'f' });
    expect(container.querySelector('.lg-row[data-cursor="true"]')).toBeNull();
    expect(screen.getByRole('main', { name: 'The feed' })).toBeTruthy();
  });

  it('backs out one step at a time — the cursor first, then the thread', () => {
    mockData.current = ready({ events: [ev({ id: 'n', correlationId: 'corr-1' })] });
    renderPage('/logs?correlationId=corr-1');
    press('j');
    press('Escape');
    expect(screen.getByRole('main', { name: 'One thread' })).toBeTruthy();
    press('Escape');
    expect(screen.getByRole('main', { name: 'The feed' })).toBeTruthy();
  });

  it('prints the key map over a ledger there is something to walk', () => {
    mockData.current = ready({ events: three() });
    renderPage();
    expect(screen.getByRole('heading', { name: 'Without the mouse' })).toBeTruthy();
  });

  it('does not promise keys over rows that are not there', () => {
    mockData.current = ready({ events: [] });
    renderPage();
    expect(screen.queryByRole('heading', { name: 'Without the mouse' })).toBeNull();
  });
});

describe('LogsNext — the sheet is not a dead end', () => {
  const three = () => [
    ev({ id: 'a', summary: 'newest', occurredAt: '2026-09-10T10:00:02.000Z' }),
    ev({ id: 'b', summary: 'middle', occurredAt: '2026-09-10T10:00:01.000Z' }),
    ev({ id: 'c', summary: 'oldest', occurredAt: '2026-09-10T10:00:00.000Z' }),
  ];

  it('steps to the entry either side without closing, and says where it stands', () => {
    mockData.current = ready({ events: three() });
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'middle' }));
    let dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('Entry 2 of the 3 on this page.');

    fireEvent.click(within(dialog).getByRole('button', { name: 'Earlier' }));
    dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('oldest');
    expect(dialog).toHaveTextContent('Entry 3 of the 3 on this page.');

    fireEvent.click(within(dialog).getByRole('button', { name: 'Later' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('middle');
  });

  it('draws no control where it cannot move, and says why in words instead', () => {
    mockData.current = ready({ events: three(), hasMore: true });
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'oldest' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).queryByRole('button', { name: 'Earlier' })).toBeNull();
    expect(within(dialog).getByRole('button', { name: 'Later' })).toBeTruthy();
    expect(dialog).toHaveTextContent('older ones exist beyond the window');
  });

  it('says the registers are exhausted only when the gateway said so', () => {
    mockData.current = ready({ events: three(), hasMore: false });
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'oldest' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('the earliest entry the registers hold');
  });

  it('makes no claim about older entries when the gateway never said', () => {
    mockData.current = ready({ events: three(), hasMore: null });
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'oldest' }));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('was not reported by this gateway');
    expect(dialog).not.toHaveTextContent('the earliest entry the registers hold');
  });

  it('walks the sheet with j and k, in the list’s own direction', () => {
    mockData.current = ready({ events: three() });
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'newest' }));
    fireEvent.keyDown(window, { key: 'j' });
    expect(screen.getByRole('dialog')).toHaveTextContent('middle');
    fireEvent.keyDown(window, { key: 'k' });
    expect(screen.getByRole('dialog')).toHaveTextContent('newest');
  });
});

/**
 * `lg-turn` is the page's one signature motion, and it used to play on the
 * LOADING SKELETON: the effect depended on `correlationId` alone, so it ran on
 * the render in which the URL changed — at which point `<main>` holds the
 * loading band — and by the time the thread arrived `correlationId` had not
 * changed, so nothing animated. `MOTIONS.md` described a behaviour the page
 * did not have. These cases pin the sequencing, which is otherwise only
 * checkable by reading the effect.
 */
describe('LogsNext — the page turns on what arrived', () => {
  const tokens = () => motion.animate.mock.calls.map((c) => c[2]);
  const turns = () => tokens().filter((t) => t === turn).length;

  it('does not turn on arrival — the opening is the opening', () => {
    mockData.current = ready({ events: [ev({ id: 'x', correlationId: 'corr-9' })] });
    renderPage();
    expect(tokens()).toContain(settle);
    expect(turns()).toBe(0);
  });

  it('does not turn while the pivot is still in flight', () => {
    mockData.current = ready({ events: [ev({ id: 'x', correlationId: 'corr-9' })] });
    renderPage();
    motion.animate.mockClear();
    // The pivot changes the query key, so the next render is the loading band.
    mockData.current = { ...ready(), state: 'loading', events: null, counts: null };
    fireEvent.click(screen.getByRole('button', { name: 'Follow thread corr-9' }));
    expect(screen.getByRole('status')).toHaveTextContent('Reading every register for this thread');
    expect(turns()).toBe(0);
  });

  it('turns once when the thread lands, and again when the reader leaves it', () => {
    mockData.current = ready({ events: [ev({ id: 'x', correlationId: 'corr-9' })] });
    const { rerender } = renderPage();
    motion.animate.mockClear();

    mockData.current = { ...ready(), state: 'loading', events: null, counts: null };
    fireEvent.click(screen.getByRole('button', { name: 'Follow thread corr-9' }));
    expect(turns()).toBe(0);

    // The thread arrives. Same tree, same router, same URL — only the read
    // has settled, which is exactly the frame the motion belongs on.
    mockData.current = ready({ events: [ev({ id: 'x', correlationId: 'corr-9' })] });
    rerender(
      <MemoryRouter initialEntries={['/logs']}>
        <Routes>
          <Route path="/logs" element={<LogsNext />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(turns()).toBe(1);
    expect(screen.getByRole('main', { name: 'One thread' })).toBeTruthy();

    // Leaving is the same turn, not a reverse — and it waits for the feed too.
    mockData.current = { ...ready(), state: 'loading', events: null, counts: null };
    fireEvent.click(screen.getByRole('button', { name: 'Leave the thread' }));
    expect(turns()).toBe(1);
    mockData.current = ready({ events: [ev({ id: 'x', correlationId: 'corr-9' })] });
    rerender(
      <MemoryRouter initialEntries={['/logs']}>
        <Routes>
          <Route path="/logs" element={<LogsNext />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(turns()).toBe(2);
  });

  it('turns on the same frame when the thread is already in cache', () => {
    mockData.current = ready({ events: [ev({ id: 'x', correlationId: 'corr-9' })] });
    renderPage();
    motion.animate.mockClear();
    // No loading render at all: react-query answers from cache, so `ready` and
    // the new correlationId land together.
    fireEvent.click(screen.getByRole('button', { name: 'Follow thread corr-9' }));
    expect(turns()).toBe(1);
  });
});

describe('LogsNext — the gate', () => {
  it('leaves the legacy tree untouched while the flag is off', () => {
    flags.on = false;
    render(
      <MemoryRouter>
        <PageGate page="logs" legacy={<div>legacy logs page</div>} next={<LogsNext />} />
      </MemoryRouter>,
    );
    expect(screen.getByText('legacy logs page')).toBeTruthy();
    expect(screen.queryByText('What the house recorded, across six registers.')).toBeNull();
    expect(document.querySelector('.mudavym')).toBeNull();
  });
});
