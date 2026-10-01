/**
 * /inventory rework (INV-W4) — the page's states and its pure rules.
 *
 * The page's data hook is replaced with a controllable stand-in; the pure
 * functions in the same module (sort, fold, chips, the read sentence) are the
 * real ones. Heavy panels reused from the legacy page are stubbed: they own
 * their own tests, and none of them is under test here.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { InvRow } from './useInventoryNextData';

const mock = vi.hoisted(() => ({ data: {} as Record<string, unknown> }));

vi.mock('./useInventoryNextData', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  useInventoryNextData: () => mock.data,
}));
vi.mock('../command/CellarMapView', () => ({ CellarMapView: () => <div data-testid="cellar-map" /> }));
vi.mock('../command/HousePriceCell', () => ({
  HousePriceCell: ({ bottle }: { bottle: number | null }) => <span data-testid="house-price">{String(bottle)}</span>,
}));
vi.mock('../../../components/inventory/PosMappingPanel', () => ({ PosMappingPanel: () => null, default: () => null }));
vi.mock('../../../components/inventory/StorageLocationManager', () => ({ StorageLocationManager: () => null }));
vi.mock('../../../components/scanner/MenuScannerFlow', () => ({ MenuScannerFlow: () => null }));
vi.mock('@/components/mudavym/DeliveriesToName', () => ({
  DELIVERIES_TO_NAME_KEY: ['deliveries-to-name'],
  DeliveriesToName: () => <div data-testid="deliveries-to-name" />,
}));

import InventoryNext from './InventoryNext';
import { fold, matchesSearch, needsYouFirst, readSentence, sortRows } from './useInventoryNextData';

function row(over: Partial<InvRow> = {}): InvRow {
  return {
    id: 'i1',
    wineId: 'w1',
    name: 'Gravner Ribolla',
    libraryName: null,
    producer: 'Gravner',
    type: 'orange',
    vintage: 2016,
    grape: 'Ribolla Gialla',
    bottleSizeMl: 750,
    stock: 12,
    shadow: 0,
    par: 6,
    reorderPoint: null,
    analyticsReadable: true,
    velocity: 1,
    runway: 12,
    daysSinceSale: 1,
    deadStock: false,
    bottle: 92,
    glass: 18,
    pourMl: 150,
    wac: 40,
    costProvenance: 'invoice',
    value: 480,
    lastCountedAt: '2026-09-30T10:00:00Z',
    openMl: null,
    zones: [{ locationId: 'z1', qty: 12 }],
    providerId: null,
    providerName: null,
    standing: 'above',
    ...over,
  };
}

function data(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    state: 'ready',
    error: null,
    stale: false,
    refetch: vi.fn(),
    rid: 'r1',
    canManage: true,
    branches: [],
    rows: [],
    rawItems: [],
    libraryUnread: false,
    currency: { state: 'recorded', code: 'EUR' },
    locations: { list: [{ id: 'z1', name: 'Cave' }], loading: false, unavailable: false, setLocations: vi.fn() },
    providers: { list: [], error: null },
    advice: { status: 'loading' },
    refetchAdvice: vi.fn(),
    waiting: {
      invoices: { n: 0, failed: false },
      deliveries: { n: 0, failed: false },
      outbox: { n: 0, failed: false },
    },
    ...over,
  };
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <InventoryNext />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** A bare 0 anywhere in the text — the figure this page must never invent. */
const BARE_ZERO = /(^|[^\d.,])0([^\d.,]|$)/;

afterEach(() => {
  vi.useRealTimers();
});

describe('Needs you first', () => {
  it('puts a stock-out with no runway first, ahead of shorter runways', () => {
    const out = row({ id: 'out', name: 'Out, no sale', stock: 0, velocity: null, runway: null, standing: 'out' });
    const below = row({ id: 'below', name: 'Below', stock: 3, runway: 3, standing: 'below' });
    const dry = row({ id: 'dry', name: 'Dry soon', stock: 8, par: 6, runway: 0.8, standing: 'above' });
    const fine = row({ id: 'fine', name: 'Fine', runway: 40 });
    const nobody = row({ id: 'nobody', name: 'Nobody buys', velocity: null, runway: null });

    const sorted = [fine, nobody, dry, below, out].sort(needsYouFirst).map((r) => r.id);
    expect(sorted).toEqual(['out', 'below', 'dry', 'fine', 'nobody']);
    expect(sortRows([nobody, out], 'needs')[0].id).toBe('out');
  });

  it('draws the rows in that order, headed by severity', () => {
    mock.data = data({
      rows: [
        row({ id: 'fine', name: 'Fine', runway: 40 }),
        row({ id: 'out', name: 'Out, no sale', stock: 0, velocity: null, runway: null, standing: 'out' }),
        row({ id: 'below', name: 'Below', stock: 3, runway: 3, standing: 'below' }),
      ],
    });
    renderPage();
    const ids = [...screen.getByTestId('inventory-table').querySelectorAll('tr[data-testid^="inv-row-"]')].map((tr) =>
      tr.getAttribute('data-testid'),
    );
    expect(ids).toEqual(['inv-row-out', 'inv-row-below', 'inv-row-fine']);
    const groups = [...screen.getByTestId('inventory-table').querySelectorAll('tr.iv-group')].map((g) => g.textContent);
    expect(groups).toEqual(['Out 1', 'Below par 1', 'Everything else, by runway']);
  });
});

describe('search ignores accents and folds the Turkish i', () => {
  it('folds diacritics, dotted İ and dotless ı', () => {
    expect(fold('Château')).toBe('chateau');
    expect(fold('İSTANBUL')).toBe('istanbul');
    expect(fold('ıstanbul')).toBe('istanbul');
    expect(fold('Kavaklıdere Öküzgözü')).toBe('kavaklidere okuzgozu');
  });

  it('matches across name, producer and zone with the fold applied', () => {
    const zoneName = (id: string | null) => (id === 'z1' ? 'Büyük Mahzen' : null);
    const r = row({ name: 'Château Musar', producer: 'Kavaklıdere', zones: [{ locationId: 'z1', qty: 2 }] });
    expect(matchesSearch(r, 'chateau musar', zoneName)).toBe(true);
    expect(matchesSearch(r, 'KAVAKLIDERE', zoneName)).toBe(true);
    expect(matchesSearch(r, 'buyuk mahzen', zoneName)).toBe(true);
    expect(matchesSearch(r, 'chateau margaux', zoneName)).toBe(false);
  });

  it('filters the table as you type', () => {
    mock.data = data({
      rows: [row({ id: 'a', name: 'Château Musar' }), row({ id: 'b', name: 'İstanbul Kırmızı' })],
    });
    renderPage();
    fireEvent.change(screen.getByPlaceholderText('Search titles, producers, grapes'), { target: { value: 'istanbul' } });
    expect(screen.queryByTestId('inv-row-a')).toBeNull();
    expect(screen.getByTestId('inv-row-b')).toBeTruthy();
  });
});

describe('unknown is never zero', () => {
  it('shows nothing for 400ms, then "Reading the cellar…", and never a 0', () => {
    vi.useFakeTimers();
    mock.data = data({ state: 'reading', rows: null });
    const { container } = renderPage();
    expect(screen.getByTestId('inventory-reading').textContent).toBe('');
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(screen.getByText('Reading the cellar…')).toBeTruthy();
    expect(container.textContent).not.toMatch(BARE_ZERO);
    expect(screen.queryByTestId('inventory-chips')).toBeNull();
    expect(screen.queryByTestId('inventory-table')).toBeNull();
  });

  it('says the stock could not be read when the read fails, and claims nothing else', () => {
    mock.data = data({ state: 'failed', rows: null, error: 'Network Error' });
    const { container } = renderPage();
    expect(screen.getByText('The stock could not be read.')).toBeTruthy();
    expect(container.textContent).not.toMatch(BARE_ZERO);
    expect(screen.queryByTestId('inventory-empty')).toBeNull();
    expect(screen.queryByTestId('inventory-chips')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Read again' }));
    expect((mock.data.refetch as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
  });

  it('draws an unread stock, cost and currency as the dash', () => {
    mock.data = data({
      currency: { state: 'reading', code: null },
      rows: [
        row({
          id: 'u',
          stock: null,
          shadow: null,
          wac: null,
          value: null,
          velocity: null,
          runway: null,
          zones: null,
          standing: 'unknown',
        }),
      ],
      canManage: false,
    });
    renderPage();
    const tr = screen.getByTestId('inv-row-u');
    const cells = within(tr);
    expect(cells.getByText('Stock not read')).toBeTruthy();
    const live = tr.querySelector('td[data-label="Live / shadow · par"]')!;
    expect(live.textContent).toContain('—');
    expect(live.textContent).not.toMatch(/^0/);
    expect(tr.querySelector('td[data-label="Value at cost"]')!.textContent).toBe('—');
    expect(tr.querySelector('td[data-label="Zone"]')!.textContent).toBe('—');
    expect(tr.querySelector('td[data-label="Your price"]')!.textContent).toBe('— · —');
  });

  it('never says "0 bottles" when no stock was read', () => {
    const s = readSentence(
      [row({ stock: null, value: null, standing: 'unknown' }), row({ id: 'b', stock: null, value: null, standing: 'unknown' })],
      { state: 'recorded', code: 'EUR' },
      true,
    );
    expect(s).not.toMatch(BARE_ZERO);
    expect(s).toContain('no title');
    expect(s).not.toContain('Nothing is out');
  });
});

describe('the empty house', () => {
  it('shows the first steps and hides the chips, the filters and the table', () => {
    mock.data = data({ rows: [] });
    renderPage();
    expect(screen.getByText('No bottles on the books yet.')).toBeTruthy();
    expect(screen.getByTestId('inventory-headline').textContent).toBe('Inventory.');
    expect(screen.getByRole('link', { name: 'Receive a delivery' }).getAttribute('href')).toBe('/receiving');
    expect(screen.getByRole('link', { name: 'Upload an invoice' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Scan your wine list' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Set up storage locations' })).toBeTruthy();
    expect(screen.queryByTestId('inventory-chips')).toBeNull();
    expect(screen.queryByTestId('inventory-toolbar')).toBeNull();
    expect(screen.queryByTestId('inventory-table')).toBeNull();
    expect(screen.queryByTestId('inventory-read-sentence')).toBeNull();
  });

  it('still shows the quiet line when an invoice waits', () => {
    mock.data = data({
      rows: [],
      waiting: { invoices: { n: 2, failed: false }, deliveries: { n: 0, failed: false }, outbox: { n: 0, failed: false } },
    });
    renderPage();
    expect(screen.getByTestId('inventory-quiet-line').textContent).toContain('2 invoices wait for a match');
  });
});

describe('the quiet line', () => {
  it('is absent when nothing waits', () => {
    mock.data = data({ rows: [row()] });
    renderPage();
    expect(screen.queryByTestId('inventory-quiet-line')).toBeNull();
  });

  it('names delivered lines and the device outbox, and opens the naming card', () => {
    mock.data = data({
      rows: [row()],
      waiting: { invoices: { n: 0, failed: false }, deliveries: { n: 3, failed: false }, outbox: { n: 2, failed: false } },
    });
    renderPage();
    const line = screen.getByTestId('inventory-quiet-line');
    expect(line.textContent).toContain('3 delivered lines wait for their item');
    expect(line.textContent).toContain('2 spot counts wait on this device; queued is never confirmed');
    expect(screen.queryByTestId('deliveries-to-name')).toBeNull();
    fireEvent.click(within(line).getByRole('button', { name: 'Name them' }));
    expect(screen.getByTestId('deliveries-to-name')).toBeTruthy();
  });
});

describe('chips', () => {
  it('counts Out apart from Below par and marks Price signals unread', () => {
    mock.data = data({
      rows: [
        row({ id: 'o', stock: 0, runway: null, standing: 'out' }),
        row({ id: 'b', stock: 3, standing: 'below' }),
        row({ id: 'a', stock: 6, standing: 'at' }),
      ],
    });
    renderPage();
    const chips = screen.getByTestId('inventory-chips');
    expect(within(chips).getByRole('button', { name: /^Out 1$/ })).toBeTruthy();
    expect(within(chips).getByRole('button', { name: /^Below par 1$/ })).toBeTruthy();
    const price = within(chips).getByRole('button', { name: /Price signals/ }) as HTMLButtonElement;
    expect(price.disabled).toBe(true);
    expect(price.textContent).toContain('—');
    fireEvent.click(within(chips).getByRole('button', { name: /^Below par 1$/ }));
    expect(screen.queryByTestId('inv-row-o')).toBeNull();
    expect(screen.getByTestId('inv-row-b')).toBeTruthy();
  });

  it('shows the house price editor only to owners and managers', () => {
    mock.data = data({ rows: [row()], canManage: true });
    const { unmount } = renderPage();
    expect(screen.getByTestId('house-price')).toBeTruthy();
    unmount();
    mock.data = data({ rows: [row()], canManage: false });
    renderPage();
    expect(screen.queryByTestId('house-price')).toBeNull();
    expect(screen.getByTestId('inv-row-i1').querySelector('td[data-label="Your price"]')!.textContent).toContain('€');
  });
});
