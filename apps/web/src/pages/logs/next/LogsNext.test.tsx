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

const flags = vi.hoisted(() => ({ on: false }));
vi.mock('@/lib/mudavym/useMudavymDesign', async () => {
  const real = await vi.importActual<typeof import('@/lib/mudavym/useMudavymDesign')>(
    '@/lib/mudavym/useMudavymDesign',
  );
  return { ...real, useMudavymDesign: () => flags.on };
});

import LogsNext from './LogsNext';
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
  mockData.current = ready();
});

describe('LogsNext — states', () => {
  it('states that it is loading, and counts nothing', () => {
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
    renderPage();
    expect(screen.getByRole('status')).toHaveTextContent('Reading six registers');
    expect(cell('Till')).toHaveTextContent('—');
    expect(cell('Till')).toHaveTextContent('reading');
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
